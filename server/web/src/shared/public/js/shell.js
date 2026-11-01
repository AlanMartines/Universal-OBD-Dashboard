/* Menu lateral. Roda no <head> para aplicar a preferência antes de desenhar a página. */
(function () {
  'use strict';

  var KEY = 'obd-sidebar-collapsed';
  var root = document.documentElement;
  var desktop = window.matchMedia('(min-width: 992px)');

  function remembered() {
    try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; }
  }
  function remember(collapsed) {
    try { localStorage.setItem(KEY, collapsed ? '1' : '0'); } catch (e) { /* preferência só desta visita */ }
  }

  root.classList.toggle('sidebar-collapsed', remembered());

  document.addEventListener('DOMContentLoaded', function () {
    var toggles = document.querySelectorAll('[data-sidebar-toggle]');

    function isOpen() {
      return desktop.matches ? !root.classList.contains('sidebar-collapsed') : root.classList.contains('sidebar-open');
    }
    function sync() {
      var open = isOpen();
      toggles.forEach(function (el) { el.setAttribute('aria-expanded', String(open)); });
    }
    // Leva o foco ao botão que ficou visível depois de abrir ou fechar.
    function focusVisibleToggle() {
      for (var i = 0; i < toggles.length; i += 1) {
        if (toggles[i].offsetParent !== null && getComputedStyle(toggles[i]).visibility !== 'hidden') {
          toggles[i].focus();
          return;
        }
      }
    }
    function closeMobile() {
      root.classList.remove('sidebar-open');
      sync();
    }

    toggles.forEach(function (el) {
      el.addEventListener('click', function () {
        if (desktop.matches) {
          remember(root.classList.toggle('sidebar-collapsed'));
        } else {
          root.classList.toggle('sidebar-open');
        }
        sync();
        if (!desktop.matches && root.classList.contains('sidebar-open')) {
          // O menu só pode receber foco depois de terminar de aparecer.
          setTimeout(function () { document.querySelector('.sidebar-close').focus(); }, 220);
        } else {
          focusVisibleToggle();
        }
      });
    });
    document.querySelectorAll('[data-sidebar-close]').forEach(function (el) {
      el.addEventListener('click', function () {
        closeMobile();
        focusVisibleToggle();
      });
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && root.classList.contains('sidebar-open')) {
        closeMobile();
        focusVisibleToggle();
      }
    });
    desktop.addEventListener('change', closeMobile);
    sync();
  });
}());
