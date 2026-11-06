/* Dicas ao passar o mouse (ou tocar e segurar) nos botões só de ícone: usa o title que eles já têm. */
(function () {
  'use strict';
  if (!window.bootstrap || !window.bootstrap.Tooltip) return;
  function init(root) {
    root.querySelectorAll('.btn[title], a.btn[title]').forEach(function (el) {
      if (el.textContent.trim() || el.dataset.tooltipReady) return;
      el.dataset.tooltipReady = '1';
      window.bootstrap.Tooltip.getOrCreateInstance(el, { trigger: 'hover focus', container: 'body' });
    });
  }
  init(document);
}());
