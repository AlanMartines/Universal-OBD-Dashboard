/* Tema claro, escuro ou automático (segue o sistema). Roda no <head>: aplica antes de desenhar a página. */
(function () {
  'use strict';

  var KEY = 'obd-theme';
  var MODES = ['auto', 'light', 'dark'];
  var LABELS = { auto: 'Tema automático', light: 'Tema claro', dark: 'Tema escuro' };
  var ICONS = { auto: 'fa-circle-half-stroke', light: 'fa-sun', dark: 'fa-moon' };
  var root = document.documentElement;
  var system = window.matchMedia('(prefers-color-scheme: dark)');

  function stored() {
    try { var v = localStorage.getItem(KEY); return MODES.indexOf(v) >= 0 ? v : 'auto'; } catch (e) { return 'auto'; }
  }
  function resolved(mode) { return mode === 'auto' ? (system.matches ? 'dark' : 'light') : mode; }

  var mode = stored();
  function apply() {
    var theme = resolved(mode);
    if (root.getAttribute('data-bs-theme') !== theme) {
      root.setAttribute('data-bs-theme', theme);
      document.dispatchEvent(new CustomEvent('app-theme', { detail: { theme: theme } }));
    }
    document.querySelectorAll('[data-theme-toggle]').forEach(function (b) {
      var next = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
      b.setAttribute('title', LABELS[mode] + '. Tocar: ' + LABELS[next].toLowerCase());
      b.setAttribute('aria-label', LABELS[mode] + '. Trocar para ' + LABELS[next].toLowerCase());
      var icon = b.querySelector('[data-theme-icon]');
      if (icon) icon.className = 'fa-solid fa-fw ' + ICONS[mode];
      var text = b.querySelector('[data-theme-label]');
      if (text) text.textContent = LABELS[mode];
    });
  }

  /** Tema em uso agora ('light' ou 'dark'), para gráficos e mapas. */
  window.appTheme = function () { return root.getAttribute('data-bs-theme') === 'dark' ? 'dark' : 'light'; };

  apply();
  system.addEventListener('change', function () { if (mode === 'auto') apply(); });
  document.addEventListener('DOMContentLoaded', function () {
    apply();
    document.querySelectorAll('[data-theme-toggle]').forEach(function (b) {
      b.addEventListener('click', function () {
        mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
        try { localStorage.setItem(KEY, mode); } catch (e) { /* vale só nesta visita */ }
        apply();
      });
    });
  });
}());
