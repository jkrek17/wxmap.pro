// Theme switch: system (no attribute), light or dark. The choice is kept per
// browser; without storage the page simply follows the system setting.
(function () {
  var KEY = 'wxmap-theme';
  var root = document.documentElement;
  function read() { try { return localStorage.getItem(KEY) || 'system'; } catch (e) { return 'system'; } }
  function apply(mode) {
    if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode);
    else root.removeAttribute('data-theme');
    document.querySelectorAll('[data-theme-set]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-theme-set') === mode));
    });
  }
  apply(read());
  document.addEventListener('DOMContentLoaded', function () {
    apply(read());
    document.querySelectorAll('[data-theme-set]').forEach(function (b) {
      b.addEventListener('click', function () {
        var mode = b.getAttribute('data-theme-set');
        try { localStorage.setItem(KEY, mode); } catch (e) { /* follow system only */ }
        apply(mode);
        document.dispatchEvent(new CustomEvent('wxmap-theme'));
      });
    });
  });
})();
