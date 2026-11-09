// Runs before the page paints, so a saved theme or team color never flashes. The CSP forbids inline scripts, so this is its own
// file, included once in <head> and once right after the name in the header. It only reads the copy src/appearance.ts writes.
(function () {
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem('part-requests-appearance')); } catch (error) { /* Falls back to the defaults in the stylesheet. */ }
  if (!saved || typeof saved !== 'object') saved = {};
  var root = document.documentElement;
  var theme = saved.theme === 'light' ? 'light' : 'dark';
  root.setAttribute('data-theme', theme);
  var tokens = saved.tokens && saved.tokens[theme];
  ['--primary', '--secondary', '--on-primary', '--on-secondary', '--accent-text', '--primary-edge', '--ui-focus'].forEach(function (name) {
    var value = tokens && tokens[name];
    if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) root.style.setProperty(name, value);
  });
  var heading = document.getElementById('brand-name');
  if (heading && typeof saved.name === 'string' && saved.name) heading.textContent = saved.name;
})();
