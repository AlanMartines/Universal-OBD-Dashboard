/* Aba Falhas: descrição genérica de cada código (tabela do app, norma SAE). Só texto: nada vira HTML. */
(function () {
  'use strict';
  if (typeof window.dtcDescribe !== 'function') return;
  document.querySelectorAll('[data-dtc-describe]').forEach(function (cell) {
    var d = window.dtcDescribe(cell.dataset.dtcDescribe, {});
    cell.textContent = d.text || 'Sem descrição conhecida';
    if (d.source === 'grupo') cell.classList.add('text-body-secondary');
  });
}());
