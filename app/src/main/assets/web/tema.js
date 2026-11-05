'use strict';

/*
 * Aparência do app (Ajustes → Aparência): escuro (padrão), claro ou automático.
 * Carregado no <head> para a tela já abrir com o tema certo, sem piscar.
 *
 * Automático: no navegador segue o sistema; dentro do app (a WebView nem sempre informa o tema do
 * Android) usa o horário, claro das 6 h às 18 h, como o modo automático dos mostradores.
 * Usa html[data-app-theme], e não data-theme, para não forçar o dia/noite dos mostradores (dash.js).
 */
(function () {
  const KEY = 'app-theme';
  const MODES = ['dark', 'light', 'auto'];
  const root = document.documentElement;

  function stored() {
    try { const v = localStorage.getItem(KEY); return MODES.includes(v) ? v : 'dark'; } catch (e) { return 'dark'; }
  }
  function resolve(mode) {
    if (mode !== 'auto') return mode;
    if (!window.AndroidBridge && window.matchMedia) {
      if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    }
    const h = new Date().getHours();
    return h >= 6 && h < 18 ? 'light' : 'dark';
  }
  let current = stored();
  function apply() {
    const t = resolve(current);
    if (t === 'light') root.dataset.appTheme = 'light'; else delete root.dataset.appTheme;
  }

  apply();
  setInterval(apply, 60000);
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(apply);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const sel = document.getElementById('app-theme');
    if (!sel) return;
    sel.value = stored();
    sel.addEventListener('change', () => {
      if (!MODES.includes(sel.value)) return;
      current = sel.value;
      try { localStorage.setItem(KEY, current); } catch (e) { /* sem armazenamento: vale só nesta abertura */ }
      apply();
    });
  });
})();
