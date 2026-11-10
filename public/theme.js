// Day / night mode. Loaded in <head> (before paint) so there is no flash. Saved per browser.
// Night (graphite) is the default, like the Android app; the first visit follows the computer's setting.
(function () {
  var KEY = 'skillswap-theme';
  var SUN = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2.6V4.6M12 19.4V21.4M2.6 12H4.6M19.4 12H21.4M5.4 5.4L6.8 6.8M17.2 17.2L18.6 18.6M5.4 18.6L6.8 17.2M17.2 6.8L18.6 5.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  var MOON = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M19.6 14.6A8 8 0 1 1 9.4 4.4a6.4 6.4 0 0 0 10.2 10.2Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  function saved() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function current() { return document.documentElement.getAttribute('data-theme') || 'dark'; }
  function apply(t) {
    document.documentElement.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t === 'dark' ? '#0e1014' : '#f7f6f2');
    var b = document.querySelectorAll('.theme-toggle');
    for (var i = 0; i < b.length; i++) paint(b[i], t);
  }
  function paint(btn, t) {
    btn.innerHTML = t === 'dark' ? SUN : MOON;
    btn.setAttribute('aria-label', t === 'dark' ? 'Switch to day mode' : 'Switch to night mode');
    btn.title = btn.getAttribute('aria-label');
  }
  function toggle() {
    var t = current() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, t); } catch (e) {}
    apply(t);
  }
  function makeButton() {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'theme-toggle';
    b.addEventListener('click', toggle);
    paint(b, current());
    return b;
  }
  var first = saved();
  if (!first && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) first = 'light';
  apply(first === 'light' ? 'light' : 'dark');
  window.skillswapTheme = { toggle: toggle, makeButton: makeButton };
  document.addEventListener('DOMContentLoaded', function () {
    var slot = document.querySelector('[data-theme-slot]');
    if (slot) slot.appendChild(makeButton());
  });
})();
