#!/usr/bin/env python3
"""Build the rain-and-snow maps for saved event briefings (wxmap.pro/event/).

For each event in event/events/*.json whose window has not ended, every 6 h from a day before the
event to its end, on a 0.5 degree box around it:

  gfs, ifs, aifs  each deterministic run: sea-level pressure, 6 h precipitation and its type,
                  500 mb height and 1000-500 mb thickness
  blend           the "most likely" map: a probability-matched mean of the 6 h precipitation over
                  GFS, ECMWF IFS, AIFS and the GEFS (31), ENS (51) and AIFS ENS (51) members, with
                  each system weighted equally; the chance of 0.01 in (0.25 mm) or more over those
                  systems; rain or snow from the members' snow fraction; pressure, height and
                  thickness as the mean of the three deterministic runs

Only the needed GRIB records are read, by HTTP range, through the shared `nwp` package
(jkrek17/awips-tools nwp; AWS open-data mirrors). About 100 MB per map time, mostly the two
51-member ECMWF ensembles; under 2 GB for a two-day event. ECMWF runs are the newest 00/12 UTC.

  python3 tools/event_build.py --out event/data            # every active event
  python3 tools/event_build.py --out event/data --event philly-eagles-steelers-2026

Writes <out>/<slug>/synoptic.json (blend, the default view) and synoptic-<model>.json for each
model tab. On the VPS, vps-config bin/event-job.sh runs it after model runs, into /srv/event/data.
"""
import argparse
import datetime as dt
import json
import math
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from zoneinfo import ZoneInfo

import numpy as np
import nwp
from nwp import sources

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EVENTS = os.path.join(REPO, "event", "events")

HALF_LAT, HALF_LON, STEP = 13.0, 20.0, 0.5   # box half-size (deg) and output spacing
WET = 0.25                                   # mm in 6 h: "measurable" (0.01 in)
MAX_FH = {"gfs": 384, "gefs": 240, "ifs": 360, "aifs": 360, "ens": 360, "aifs-ens": 360}
NAMES = {"blend": "Most likely", "gfs": "GFS", "ifs": "ECMWF", "aifs": "ECMWF AI"}

GFS_WANT = {"PRMSL:mean sea level": "msl", "HGT:500 mb": "z500", "HGT:1000 mb": "z1000",
            "APCP:surface": "apcp", "CSNOW:surface": "csnow", "CFRZR:surface": "cfrzr", "CICEP:surface": "cicep"}
# ECMWF IFS and ENS give tp and sf in metres of water; AIFS and AIFS ENS in kg m-2 (mm)
TO_MM = {"ifs": 1000.0, "aifs": 1.0, "ens": 1000.0, "aifs-ens": 1.0}
EC_SEL = {("sfc", "msl", None): "msl", ("pl", "gh", "500"): "z500", ("pl", "gh", "1000"): "z1000",
          ("sfc", "tp", None): "tp", ("sfc", "sf", None): "sf"}


def log(*a):
    print(*a, file=sys.stderr)


def utc(s, tz):
    return dt.datetime.fromisoformat(s).replace(tzinfo=ZoneInfo(tz)).astimezone(dt.timezone.utc)


def box(lat, lon):
    lon360 = lon % 360
    lats = np.arange(min(89.75, lat + HALF_LAT), max(-89.75, lat - HALF_LAT) - 1e-6, -STEP)
    lons = np.arange(lon360 - HALF_LON, lon360 + HALF_LON + 1e-6, STEP)
    iy = np.rint((90 - lats) / 0.25).astype(int)
    ix = np.rint((lons % 360) / 0.25).astype(int) % 1440
    return lats, lons, np.ix_(iy, ix)


def fh_of(cycle, valid):
    return int((valid - cycle).total_seconds() // 3600)


def newest(kind, last_valid, now, hours, exists_url):
    """Newest cycle at one of `hours` (UTC) whose file for last_valid, capped at the model's
    range, is posted. Looks back two days."""
    c = now.replace(minute=0, second=0, microsecond=0, hour=now.hour // 6 * 6)
    for _ in range(8):
        if c.hour in hours:
            fh = min(MAX_FH[kind], fh_of(c, last_valid) // 6 * 6)
            if fh > 0 and nwp.exists(exists_url(c, fh)):
                return c
        c -= dt.timedelta(hours=6)
    return None


def ymd(c):
    return c.strftime("%Y%m%d")


def hh(c):
    return c.strftime("%H")


def ec_url(model, stream, typ, c, fh):
    return sources.ecmwf(model, stream, typ, ymd(c), hh(c), fh) + ".index"


# ---------- deterministic runs ----------

def gfs_time(cycle, fh, crop):
    if fh <= 0 or fh > MAX_FH["gfs"]:
        return None
    got = nwp.ncep(sources.gfs(ymd(cycle), hh(cycle), fh), GFS_WANT, crop)
    if got is None:
        return None
    ptype = np.zeros(got["apcp"].shape, int)
    ptype[(got["cfrzr"] > 0.5) | (got["cicep"] > 0.5)] = 2
    ptype[got["csnow"] > 0.5] = 1
    return {"msl": got["msl"] / 100.0, "z500": got["z500"], "thk": got["z500"] - got["z1000"],
            "pcp": got["apcp"], "ptype": ptype, "snowfrac": (got["csnow"] > 0.5).astype(float)}


def ec_det_series(model, cycle, steps, crop):
    """{fh: fields} for an ECMWF deterministic run; 6 h precipitation from accumulated tp (m)."""
    src = "ifs" if model == "ifs" else "aifs-single"
    want = sorted(set(steps) | {s - 6 for s in steps if s - 6 >= 0})

    def one(fh):
        if fh == 0:
            raw = nwp.fields(src, cycle.strftime("%Y%m%d%H"), 0, EC_SEL, crop=crop)
            if raw is not None and "tp" not in raw:
                raw["tp"] = np.zeros_like(raw["msl"]); raw["sf"] = np.zeros_like(raw["msl"])
            return raw
        return nwp.fields(src, cycle.strftime("%Y%m%d%H"), fh, EC_SEL, crop=crop)
    with ThreadPoolExecutor(4) as pool:
        raw = dict(zip(want, pool.map(one, want)))
    out = {}
    for s in steps:
        a, b = raw.get(s), raw.get(s - 6)
        if not a or not b or any(k not in a for k in ("msl", "z500", "z1000", "tp")) or "tp" not in b:
            continue
        pcp = np.clip((a["tp"] - b["tp"]) * TO_MM[model], 0, None)
        sfa = a.get("sf"); sfb = b.get("sf")
        snow = np.clip((sfa - sfb) * TO_MM[model], 0, None) if sfa is not None and sfb is not None else np.zeros_like(pcp)
        frac = np.where(pcp > 0.05, np.clip(snow / np.maximum(pcp, 1e-6), 0, 1), 0)
        out[s] = {"msl": a["msl"] / 100.0, "z500": a["z500"], "thk": a["z500"] - a["z1000"],
                  "pcp": pcp, "snowfrac": frac, "ptype": frac_type(frac)}
    return out


def frac_type(frac):
    t = np.zeros(frac.shape, int)
    t[frac >= 0.3] = 2
    t[frac >= 0.6] = 1
    return t


# ---------- ensembles (precipitation and snow fraction only) ----------

def gefs_series(cycle, steps, crop):
    out = {}
    for s in steps:
        if s <= 0 or s > MAX_FH["gefs"]:
            continue
        got = nwp.gefs_members(ymd(cycle), hh(cycle), s, {"APCP:surface": "pcp", "CSNOW:surface": "csnow"}, crop=crop)
        if got is None:
            continue
        _, f = got
        out[s] = {"pcp": f["pcp"], "snowfrac": (f["csnow"] > 0.5).astype(float)}
    return out


def ec_ens_series(model, cycle, steps, crop):
    k = 1000.0 if model == "ifs" else 1.0   # see TO_MM
    want = sorted(set(steps) | {s - 6 for s in steps if s - 6 > 0})
    raw = {}
    for s in want:
        r = nwp.ec_ens(model, ymd(cycle), hh(cycle), s, {"tp": "tp", "sf": "sf"}, crop=crop, workers=8)
        if r is not None:
            raw[s] = r
    out = {}
    for s in steps:
        a = raw.get(s)
        if a is None:
            continue
        if s - 6 == 0:
            b = {"tp": np.zeros_like(a["tp"]), "sf": np.zeros_like(a["sf"])}
        else:
            b = raw.get(s - 6)
        if b is None or b["tp"].shape != a["tp"].shape:
            continue
        pcp = np.clip((a["tp"] - b["tp"]) * k, 0, None)
        snow = np.clip((a["sf"] - b["sf"]) * k, 0, None)
        out[s] = {"pcp": pcp, "snowfrac": np.where(pcp > 0.05, np.clip(snow / np.maximum(pcp, 1e-6), 0, 1), 0)}
    return out


# ---------- the blend ----------

def pm_mean(systems):
    """Probability-matched mean. systems: list of [n, y, x] arrays, each system weighted equally.
    The pattern of the weighted mean, with its values replaced, rank for rank, by the pooled
    distribution of all members, so heavy cores keep realistic amounts."""
    w = [np.full(a.shape[0], 1.0 / a.shape[0]) for a in systems]
    mean = sum(np.tensordot(wi, a, 1) for wi, a in zip(w, systems)) / len(systems)
    vals = np.concatenate([a.reshape(a.shape[0], -1).ravel() for a in systems])
    wts = np.concatenate([np.repeat(wi, a.shape[1] * a.shape[2]) for wi, a in zip(w, systems)])
    order = np.argsort(vals)
    cw = np.cumsum(wts[order]); cw /= cw[-1]
    flat = mean.ravel()
    q = (np.argsort(np.argsort(flat)) + 0.5) / flat.size
    pm = np.interp(q, cw, vals[order]).reshape(mean.shape)
    return np.where(mean < 0.05, 0.0, pm)


def blend_time(dets, ens):
    """dets: {model: fields}; ens: {system: fields with [n,y,x]}. -> blend fields or None."""
    systems, snows = [], []
    for f in dets.values():
        systems.append(f["pcp"][None]); snows.append(f["snowfrac"][None])
    for f in ens.values():
        systems.append(f["pcp"]); snows.append(f["snowfrac"])
    if len(systems) < 2 or not dets:
        return None
    pcp = pm_mean(systems)
    chance = sum((a >= WET).mean(axis=0) for a in systems) / len(systems)
    # snow fraction weighted by each member's own precipitation
    num = sum((s * a).mean(axis=0) for s, a in zip(snows, systems))
    den = sum(a.mean(axis=0) for a in systems)
    frac = np.where(den > 0.01, num / np.maximum(den, 1e-6), 0)
    d = list(dets.values())
    return {"msl": np.mean([f["msl"] for f in d], 0), "z500": np.mean([f["z500"] for f in d], 0),
            "thk": np.mean([f["thk"] for f in d], 0), "pcp": pcp, "ptype": frac_type(frac),
            "chance": chance * 100, "n": int(sum(a.shape[0] for a in systems))}


# ---------- output ----------

def pack(f):
    out = {"msl": np.rint(f["msl"] * 10).astype(int), "z500": np.rint(f["z500"] / 10).astype(int),
           "thk": np.rint(f["thk"] / 10).astype(int), "pcp": np.rint(f["pcp"] * 10).astype(int),
           "ptype": f["ptype"].astype(int)}
    if "chance" in f:
        out["chance"] = np.rint(f["chance"]).astype(int)
    return {k: v.tolist() for k, v in out.items()}


def write(d, name, doc):
    tmp = os.path.join(d, name + ".tmp")
    with open(tmp, "w") as fh:
        json.dump(doc, fh, separators=(",", ":"))
    os.replace(tmp, os.path.join(d, name))


def build(ev, out_dir, now):
    tz = ev.get("tz", "UTC")
    start, end = utc(ev["start"], tz), utc(ev["end"], tz)
    if end < now:
        log("event %s: over; skipped" % ev["slug"])
        return False
    first = max(now, start - dt.timedelta(hours=24))
    v0 = first.replace(minute=0, second=0, microsecond=0, hour=first.hour // 6 * 6) + dt.timedelta(hours=6)
    valids = []
    v = v0
    while v <= end + dt.timedelta(hours=5):
        valids.append(v); v += dt.timedelta(hours=6)
    lats, lons, crop = box(ev["lat"], ev["lon"])

    cyc = {
        "gfs": newest("gfs", valids[-1], now, (0, 6, 12, 18), lambda c, f: sources.gfs(ymd(c), hh(c), f) + ".idx"),
        "gefs": newest("gefs", valids[-1], now, (0, 6, 12, 18), lambda c, f: sources.gefs(ymd(c), hh(c), f, "p30") + ".idx"),
        "ifs": newest("ifs", valids[-1], now, (0, 12), lambda c, f: ec_url("ifs", "oper", "fc", c, f)),
        "aifs": newest("aifs", valids[-1], now, (0, 12), lambda c, f: ec_url("aifs-single", "oper", "fc", c, f)),
        "ens": newest("ens", valids[-1], now, (0, 12), lambda c, f: ec_url("ifs", "enfo", "ef", c, f)),
        "aifs-ens": newest("aifs-ens", valids[-1], now, (0, 12), lambda c, f: ec_url("aifs-ens", "enfo", "pf", c, f)),
    }
    log("event %s: %d map times; cycles %s" % (ev["slug"], len(valids), {k: c and c.strftime("%d/%HZ") for k, c in cyc.items()}))

    def steps(k):
        c = cyc[k]
        return [] if c is None else [fh_of(c, v) for v in valids if 0 < fh_of(c, v) <= MAX_FH[k]]

    det = {}
    if cyc["gfs"]:
        with ThreadPoolExecutor(6) as pool:
            det["gfs"] = {s: r for s, r in zip(steps("gfs"), pool.map(lambda s: gfs_time(cyc["gfs"], s, crop), steps("gfs"))) if r}
    for m in ("ifs", "aifs"):
        if cyc[m]:
            det[m] = ec_det_series(m, cyc[m], steps(m), crop)
    ens = {}
    if cyc["gefs"]:
        ens["gefs"] = gefs_series(cyc["gefs"], steps("gefs"), crop)
    for m in ("ens", "aifs-ens"):
        if cyc[m]:
            ens[m] = ec_ens_series("ifs" if m == "ens" else m, cyc[m], steps(m), crop)
    log("event %s: decoded %s" % (ev["slug"], {k: len(v) for k, v in list(det.items()) + list(ens.items())}))

    d = os.path.join(out_dir, ev["slug"])
    os.makedirs(d, exist_ok=True)
    base = {"built": now.strftime("%Y-%m-%dT%H:%MZ"), "lat0": float(lats[0]),
            "lon0": float(((lons[0] + 180) % 360) - 180), "step": STEP, "ny": len(lats), "nx": len(lons),
            "units": {"msl": "0.1 hPa", "z500": "dam", "thk": "dam", "pcp": "0.1 mm per 6 h",
                      "ptype": "0 rain, 1 snow, 2 mix", "chance": "% chance of 0.25 mm or more in 6 h"}}
    models = []
    for m in ("gfs", "ifs", "aifs"):
        ser = det.get(m) or {}
        times, frames = [], []
        for v in valids:
            f = ser.get(fh_of(cyc[m], v)) if cyc[m] else None
            if f is None:
                continue
            times.append(v.strftime("%Y-%m-%dT%H:%MZ")); frames.append(pack(f))
        if not times:
            continue
        write(d, "synoptic-%s.json" % m, dict(base, model=m, name=NAMES[m], cycle=cyc[m].strftime("%Y-%m-%dT%HZ"), times=times, frames=frames))
        models.append({"id": m, "name": NAMES[m], "cycle": cyc[m].strftime("%Y-%m-%dT%HZ")})
    times, frames = [], []
    members = 0
    for v in valids:
        dv = {m: det[m][fh_of(cyc[m], v)] for m in det if fh_of(cyc[m], v) in det[m]}
        ev_ = {k: ens[k][fh_of(cyc[k], v)] for k in ens if fh_of(cyc[k], v) in ens[k]}
        b = blend_time(dv, ev_)
        if b is None:
            continue
        members = max(members, b["n"])
        times.append(v.strftime("%Y-%m-%dT%H:%MZ")); frames.append(pack(b))
    if not times:
        log("event %s: no blended map times" % ev["slug"])
        return False
    sysnames = {"gfs": "GFS", "ifs": "ECMWF", "aifs": "ECMWF AI", "gefs": "GEFS", "ens": "ECMWF ENS", "aifs-ens": "ECMWF AI ENS"}
    write(d, "synoptic.json", dict(base, model="blend", name=NAMES["blend"], members=members,
                                   sources=[{"id": k, "name": sysnames[k], "cycle": c.strftime("%Y-%m-%dT%HZ")} for k, c in cyc.items() if c],
                                   models=[{"id": "blend", "name": NAMES["blend"]}] + models,
                                   times=times, frames=frames))
    log("event %s: blend of %d runs, %d map times -> %s" % (ev["slug"], members, len(times), d))
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", required=True, help="output folder (served as event/data/)")
    ap.add_argument("--event", help="one event slug (default: every event not yet over)")
    a = ap.parse_args()
    now = dt.datetime.now(dt.timezone.utc)
    names = sorted(n for n in os.listdir(EVENTS) if n.endswith(".json") and n != "index.json")
    ok = 0
    for n in names:
        with open(os.path.join(EVENTS, n)) as f:
            ev = json.load(f)
        if a.event and ev["slug"] != a.event:
            continue
        ok += build(ev, a.out, now)
    log("built %d event(s)" % ok)


if __name__ == "__main__":
    main()
