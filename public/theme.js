// Day / night mode. Loaded in <head> (before paint) so there is no flash. Saved per browser.
(function () {
  var KEY = 'skillswap-theme';
  function saved() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function apply(t) {
    document.documentElement.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t === 'dark' ? '#080b1f' : '#f4f5fb');
    var b = document.querySelectorAll('.theme-toggle');
    for (var i = 0; i < b.length; i++) paint(b[i], t);
  }
  function paint(btn, t) {
    btn.textContent = t === 'dark' ? '☀' : '☾';
    btn.setAttribute('aria-label', t === 'dark' ? 'Switch to day mode' : 'Switch to night mode');
    btn.title = btn.getAttribute('aria-label');
  }
  function current() { return document.documentElement.getAttribute('data-theme') || 'dark'; }
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
  apply(saved() === 'light' ? 'light' : 'dark');
  window.skillswapTheme = { toggle: toggle, makeButton: makeButton };
  document.addEventListener('DOMContentLoaded', function () {
    // Pages without the app header (home, login, sign up) get a floating button.
    if (/^\/(login|signup|index\.html)?\/?$/.test(location.pathname) && !document.querySelector('.theme-toggle')) {
      var b = makeButton(); b.classList.add('theme-float'); document.body.appendChild(b);
    }
  });
})();
