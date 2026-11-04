/* Abas com endereço: #historico, #percurso… abre direto na aba e o voltar do navegador funciona. */
(function () {
  'use strict';

  document.querySelectorAll('[data-tabs]').forEach(function (list) {
    var buttons = list.querySelectorAll('[data-bs-toggle="tab"][data-hash]');
    function byHash(hash) {
      for (var i = 0; i < buttons.length; i += 1) if (buttons[i].dataset.hash === hash) return buttons[i];
      return null;
    }
    function fromLocation() {
      var b = byHash(window.location.hash.slice(1));
      if (b && window.bootstrap) window.bootstrap.Tab.getOrCreateInstance(b).show();
    }
    buttons.forEach(function (b) {
      b.addEventListener('shown.bs.tab', function () {
        var hash = '#' + b.dataset.hash;
        if (window.location.hash !== hash) history.replaceState(null, '', hash);
      });
    });
    window.addEventListener('hashchange', fromLocation);
    fromLocation();
  });

  /** Mostra uma aba pelo endereço (ex.: 'historico'), para atalhos de outras partes da página. */
  window.showTab = function (hash) {
    var b = document.querySelector('[data-bs-toggle="tab"][data-hash="' + hash + '"]');
    if (b && window.bootstrap) window.bootstrap.Tab.getOrCreateInstance(b).show();
  };
}());
