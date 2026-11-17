#!/usr/bin/env python3
"""Build the "big picture" maps for saved event briefings (wxmap.pro/event/).

For each event in event/events/*.json whose window has not ended, a small GFS pull from the AWS
open-data mirror (only the records needed, by HTTP range, through the shared `nwp` package in
jkrek17/awips-tools): sea-level pressure, 6 h precipitation with its type, 500 mb height and
1000-500 mb thickness, every 6 h from a day before the event to its end, cut to a box around the
event at 0.5 degrees. Writes <out>/<slug>/synoptic.json for the page to draw.

  python3 tools/event_build.py --out event/data            # every active event
  python3 tools/event_build.py --out event/data --event philly-eagles-steelers-2026

About 5 MB streamed per map time (6 records of a 0.25 degree GFS file), a few hundred kB kept.
On the VPS, vps-config bin/event-job.sh runs it after each GFS cycle and writes /srv/event/data.
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

WANT = {
    "PRMSL:mean sea level": "msl",
    "HGT:500 mb": "z500",
    "HGT:1000 mb": "z1000",
    "APCP:surface": "apcp",      # first record at a 6 h step is the last 6 h
    "CSNOW:surface": "csnow",    # first record is the instantaneous one
    "CFRZR:surface": "cfrzr",
    "CICEP:surface": "cicep",
}
HALF_LAT, HALF_LON, STEP = 13.0, 20.0, 0.5   # box half-size (deg) and output spacing
MAX_FH = 384


def utc(s, tz):
    return dt.datetime.fromisoformat(s).replace(tzinfo=ZoneInfo(tz)).astimezone(dt.timezone.utc)


def newest_cycle(last_valid, now):
    """Newest 00/06/12/18Z GFS whose step for last_valid (or its last step) is posted."""
    c = now.replace(minute=0, second=0, microsecond=0, hour=now.hour // 6 * 6)
    for _ in range(8):
        fh = min(MAX_FH, int((last_valid - c).total_seconds() // 3600) // 6 * 6)
        if fh >= 0 and nwp.exists(sources.gfs(c.strftime("%Y%m%d"), c.strftime("%H"), fh) + ".idx"):
            return c
        c -= dt.timedelta(hours=6)
    return None


def box(lat, lon):
    lon360 = lon % 360
    lats = np.arange(min(89.75, lat + HALF_LAT), max(-89.75, lat - HALF_LAT) - 1e-6, -STEP)
    lons = np.arange(lon360 - HALF_LON, lon360 + HALF_LON + 1e-6, STEP)
    iy = np.rint((90 - lats) / 0.25).astype(int)
    ix = np.rint((lons % 360) / 0.25).astype(int) % 1440
    return lats, lons, np.ix_(iy, ix)


def one_time(cycle, fh, crop):
    url = sources.gfs(cycle.strftime("%Y%m%d"), cycle.strftime("%H"), fh)
    want = dict(WANT)
    if fh == 0:   # the analysis has no precipitation
        for k in ("APCP:surface", "CSNOW:surface", "CFRZR:surface", "CICEP:surface"):
            want.pop(k)
    got = nwp.ncep(url, want, crop)
    if got is None:
        return None
    out = {
        "msl": np.rint(got["msl"] / 10.0).astype(int),                       # 0.1 hPa
        "z500": np.rint(got["z500"] / 10.0).astype(int),                     # dam
        "thk": np.rint((got["z500"] - got["z1000"]) / 10.0).astype(int),     # dam
    }
    if "apcp" in got:
        out["pcp"] = np.rint(got["apcp"] * 10.0).astype(int)                 # 0.1 mm / 6 h
        ptype = np.zeros(got["apcp"].shape, int)                            # 0 rain, 1 snow, 2 mix/ice
        ptype[(got["cfrzr"] > 0.5) | (got["cicep"] > 0.5)] = 2
        ptype[got["csnow"] > 0.5] = 1
        out["ptype"] = ptype
    return out


def build(ev, out_dir, now):
    tz = ev.get("tz", "UTC")
    start, end = utc(ev["start"], tz), utc(ev["end"], tz)
    if end < now:
        print("event %s: over; skipped" % ev["slug"], file=sys.stderr)
        return False
    first = max(now - dt.timedelta(hours=6), start - dt.timedelta(hours=24))
    cycle = newest_cycle(end, now)
    if cycle is None:
        print("event %s: no GFS cycle posted" % ev["slug"], file=sys.stderr)
        return False
    f0 = max(0, math.floor((first - cycle).total_seconds() / 3600 / 6) * 6)
    f1 = min(MAX_FH, math.ceil((end - cycle).total_seconds() / 3600 / 6) * 6)
    if f0 > MAX_FH:
        print("event %s: beyond GFS range (%d h); skipped" % (ev["slug"], f0), file=sys.stderr)
        return False
    lats, lons, crop = box(ev["lat"], ev["lon"])
    steps = list(range(f0, f1 + 1, 6))
    with ThreadPoolExecutor(6) as pool:
        res = list(pool.map(lambda fh: one_time(cycle, fh, crop), steps))
    times, fields = [], {k: [] for k in ("msl", "z500", "thk", "pcp", "ptype")}
    for fh, r in zip(steps, res):
        if r is None:
            continue
        times.append({"fh": fh, "valid": (cycle + dt.timedelta(hours=fh)).strftime("%Y-%m-%dT%H:%MZ")})
        for k in fields:
            fields[k].append(r[k].tolist() if k in r else None)
    if not times:
        print("event %s: no map times decoded" % ev["slug"], file=sys.stderr)
        return False
    doc = {
        "model": "GFS 0.25", "cycle": cycle.strftime("%Y-%m-%dT%HZ"),
        "built": now.strftime("%Y-%m-%dT%H:%MZ"),
        "lat0": float(lats[0]), "lon0": float(((lons[0] + 180) % 360) - 180), "step": STEP,
        "ny": len(lats), "nx": len(lons),
        "units": {"msl": "0.1 hPa", "z500": "dam", "thk": "dam", "pcp": "0.1 mm per 6 h",
                  "ptype": "0 rain, 1 snow, 2 freezing rain or sleet"},
        "times": times, "fields": fields,
    }
    d = os.path.join(out_dir, ev["slug"])
    os.makedirs(d, exist_ok=True)
    tmp = os.path.join(d, "synoptic.json.tmp")
    with open(tmp, "w") as f:
        json.dump(doc, f, separators=(",", ":"))
    os.replace(tmp, os.path.join(d, "synoptic.json"))
    print("event %s: GFS %s, %d map times -> %s" % (ev["slug"], doc["cycle"], len(times), d), file=sys.stderr)
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
    print("built %d event(s)" % ok, file=sys.stderr)


if __name__ == "__main__":
    main()
