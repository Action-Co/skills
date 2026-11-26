// Runs before styles load so the saved appearance is applied before first paint.
(() => {
  const config = window.TabbyAppearance;
  const storageKey = 'tabby.theme.v1';
  let current = config.defaultTheme;
  if (config.mode === 'demo') {
    try {
      const saved = localStorage.getItem(storageKey);
      if (config.themes.some(theme => theme.id === saved)) current = saved;
    } catch { /* Storage can be disabled; the host's default still works. */ }
  }
  document.documentElement.dataset.theme = current;

  function loadFont(theme) {
    if (!theme.font || document.getElementById('theme-font')) return;
    const link = document.createElement('link');
    link.id = 'theme-font';
    link.rel = 'stylesheet';
    link.href = theme.font;
    document.head.append(link);
  }
  loadFont(config.themes.find(theme => theme.id === current));

  function init() {
    const options = document.getElementById('theme-options');
    const status = document.getElementById('theme-status');
    const logo = document.getElementById('brand-logo');
    const byline = document.getElementById('brand-by');
    const heading = document.getElementById('appearance-help');
    const note = document.getElementById('theme-note');

    function apply(id, persist = false) {
      const theme = config.themes.find(theme => theme.id === id);
      if (!theme || config.mode === 'fixed' && id !== config.defaultTheme) return;
      current = theme.id;
      document.documentElement.dataset.theme = current;
      loadFont(theme);
      byline.textContent = theme.byline;
      if (theme.logo) {
        logo.hidden = false;
        logo.alt = 'Action';
        if (logo.getAttribute('src') !== theme.logo) logo.src = theme.logo;
      } else {
        logo.hidden = true;
        logo.removeAttribute('src');
        logo.alt = '';
      }
      for (const input of options.querySelectorAll('input')) input.checked = input.value === current;
      status.textContent = `${theme.name} is active.`;
      if (persist && config.mode === 'demo') {
        try { localStorage.setItem(storageKey, current); }
        catch { status.textContent += ' Your browser could not save this choice.'; }
      }
    }

    const fixed = config.mode === 'fixed';
    heading.textContent = fixed
      ? 'This copy of Tabby uses a fixed company theme.'
      : 'Choose a theme for Tabby. Changes apply immediately and are remembered in this browser.';
    note.textContent = fixed
      ? 'The selected appearance is managed for this copy. Embedded dashboards and exported reports keep their own styling.'
      : 'Company-inspired themes are demo interpretations. Embedded dashboards and exported reports keep their own styling.';
    for (const theme of config.themes) {
      const label = document.createElement('label');
      label.className = 'theme-card';
      label.innerHTML = '<span class="theme-preview" aria-hidden="true"><span class="preview-bar"><i></i><i></i><i></i></span><span class="preview-body"><span class="preview-sidebar"></span><span class="preview-content"><i></i><i></i><b></b></span></span></span><span class="theme-card-title"><input type="radio" name="theme"><span></span></span><span class="theme-card-detail"></span>';
      label.querySelector('.theme-preview').dataset.themePreview = theme.id;
      label.querySelector('.theme-card-title span').textContent = theme.name;
      label.querySelector('.theme-card-detail').textContent = theme.description;
      const input = label.querySelector('input');
      input.value = theme.id;
      input.disabled = fixed;
      input.addEventListener('change', () => { if (input.checked) apply(theme.id, true); });
      options.append(label);
    }
    apply(current);
  }
  document.addEventListener('DOMContentLoaded', init, { once: true });
})();
