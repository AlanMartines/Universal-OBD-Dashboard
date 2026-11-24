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

  /*
   * "Mais": as abas que não cabem na largura (celular, ou tela estreita com o menu aberto) vão para um menu.
   * Os botões de verdade continuam os mesmos (só ficam escondidos); o menu só os aciona. Se a aba aberta
   * estiver no menu, o "Mais" mostra o nome dela; se uma escondida tiver aviso (falha ativa, manutenção
   * vencida), o "Mais" ganha um ponto vermelho.
   */
  document.querySelectorAll('[data-tabs]').forEach(function (list) {
    var mais = list.querySelector('[data-tabs-mais]');
    if (!mais) return;
    var menu = mais.querySelector('[data-tabs-menu]');
    var rotulo = mais.querySelector('[data-tabs-mais-rotulo]');
    var toggle = mais.querySelector('[data-bs-toggle="dropdown"]');
    var itens = Array.prototype.filter.call(list.children, function (li) { return li !== mais; });
    list.classList.add('tabs-mais-pronto');

    function cabe() {
      var limite = list.getBoundingClientRect().right + 1;
      return Array.prototype.every.call(list.children, function (li) {
        return li.hidden || li.classList.contains('tab-extra') || li.getBoundingClientRect().right <= limite;
      });
    }
    function botaoDe(li) { return li.querySelector('[data-bs-toggle="tab"]'); }

    function montarMenu() {
      menu.replaceChildren();
      var aviso = false;
      var ativoNoMenu = null;
      itens.forEach(function (li) {
        if (!li.classList.contains('tab-extra')) return;
        var b = botaoDe(li);
        if (!b) return;
        var item = document.createElement('button');
        item.type = 'button';
        item.className = 'dropdown-item d-flex align-items-center gap-2' + (b.classList.contains('active') ? ' active' : '');
        Array.prototype.forEach.call(b.childNodes, function (n) { item.appendChild(n.cloneNode(true)); });
        item.addEventListener('click', function () { if (window.bootstrap) window.bootstrap.Tab.getOrCreateInstance(b).show(); });
        var entrada = document.createElement('li');
        entrada.appendChild(item);
        menu.appendChild(entrada);
        if (b.querySelector('.badge.text-bg-danger, .badge.text-bg-warning')) aviso = true;
        if (b.classList.contains('active')) ativoNoMenu = b;
      });
      rotulo.textContent = ativoNoMenu ? ativoNoMenu.textContent.trim() : 'Mais';
      toggle.classList.toggle('active', Boolean(ativoNoMenu));
      toggle.classList.toggle('tabs-mais-aviso', aviso && !ativoNoMenu);
    }

    function arrumar() {
      itens.forEach(function (li) { li.classList.remove('tab-extra'); });
      mais.hidden = true;
      if (!cabe()) {
        mais.hidden = false;
        for (var i = itens.length - 1; i > 0 && !cabe(); i -= 1) itens[i].classList.add('tab-extra');
      }
      montarMenu();
    }

    var espera = 0;
    window.addEventListener('resize', function () { clearTimeout(espera); espera = setTimeout(arrumar, 120); });
    list.addEventListener('shown.bs.tab', montarMenu);
    // As fontes mudam a largura dos rótulos: arruma de novo quando terminam de carregar
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(arrumar);
    arrumar();
  });

  /** Mostra uma aba pelo endereço (ex.: 'historico'), para atalhos de outras partes da página. */
  window.showTab = function (hash) {
    var b = document.querySelector('[data-bs-toggle="tab"][data-hash="' + hash + '"]');
    if (b && window.bootstrap) window.bootstrap.Tab.getOrCreateInstance(b).show();
  };
}());
