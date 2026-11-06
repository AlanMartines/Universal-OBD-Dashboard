/* Instala o service worker do painel (PWA: ícone na tela inicial e página "Sem conexão"). */
(function () {
  'use strict';
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function () { /* sem PWA: o painel funciona igual */ });
  });
}());
