/*
 * Indicador global "Ao vivo": quantos veículos estão transmitindo agora (leitura no último minuto).
 * Aparece no item Dispositivos do menu e, no celular, na barra de cima, com atalho para o veículo.
 */
(function () {
  'use strict';
  var count = document.querySelector('[data-live-count]');
  var link = document.querySelector('[data-live-link]');
  var text = document.querySelector('[data-live-text]');
  if (!count && !link) return;
  var INTERVAL_MS = 30000;

  function show(live) {
    var n = live.length;
    if (count) {
      count.hidden = !n;
      count.textContent = n > 1 ? String(n) : '';
      count.setAttribute('aria-label', n + (n === 1 ? ' veículo ao vivo' : ' veículos ao vivo'));
    }
    if (link) {
      link.hidden = !n;
      link.href = n === 1 ? '/dispositivos/' + encodeURIComponent(live[0].id) : '/painel';
      text.textContent = n === 1 ? live[0].name : n + ' ao vivo';
      link.title = n === 1 ? live[0].name + ' ao vivo' : n + ' veículos ao vivo';
    }
  }
  function refresh() {
    if (document.hidden) return;
    fetch('/painel/ao-vivo', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : { live: [] }; })
      .then(function (d) { show(Array.isArray(d.live) ? d.live : []); })
      .catch(function () { /* sem rede: mantém como estava */ });
  }
  refresh();
  setInterval(refresh, INTERVAL_MS);
  document.addEventListener('visibilitychange', refresh);
}());
