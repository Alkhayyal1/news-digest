// Theme toggle: system default, user choice remembered per browser.
const root = document.documentElement;
try {
  const t = localStorage.getItem('theme');
  if (t === 'dark' || t === 'light') root.dataset.theme = t;
} catch {}
function wire() {
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try {
      localStorage.setItem('theme', root.dataset.theme);
    } catch {}
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
else wire();
