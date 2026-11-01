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
    var toggle = document.getElementById('sidebar-toggle');

    function sync() {
      var visible = desktop.matches ? !root.classList.contains('sidebar-collapsed') : root.classList.contains('sidebar-open');
      toggle.setAttribute('aria-expanded', String(visible));
    }
    function closeMobile() {
      root.classList.remove('sidebar-open');
      sync();
    }

    toggle.addEventListener('click', function () {
      if (desktop.matches) {
        remember(root.classList.toggle('sidebar-collapsed'));
      } else {
        root.classList.toggle('sidebar-open');
      }
      sync();
    });
    document.querySelectorAll('[data-sidebar-close]').forEach(function (el) {
      el.addEventListener('click', function () {
        closeMobile();
        toggle.focus();
      });
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && root.classList.contains('sidebar-open')) {
        closeMobile();
        toggle.focus();
      }
    });
    desktop.addEventListener('change', closeMobile);
    sync();
  });
}());
