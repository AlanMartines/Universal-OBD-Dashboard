/*
 * Avisos passageiros, no mesmo estilo do app: empilhados (até 4), ícone e cor pelo tipo, barra do tempo
 * que falta. Passar o mouse ou segurar o dedo pausa; arrastar para o lado dispensa; o X fecha.
 * Montados com nós do DOM: a mensagem nunca é tratada como HTML.
 */
(function () {
  'use strict';

  var ICONS = { success: 'fa-circle-check', danger: 'fa-circle-exclamation', warning: 'fa-triangle-exclamation', info: 'fa-circle-info' };
  var MAX = 4;

  function show(text, kind, ms) {
    var box = document.getElementById('app-toasts');
    if (!box || !text) return;
    var type = ICONS[kind] ? kind : 'success';
    var delay = ms || (type === 'danger' ? 7000 : 5000);
    var toast = document.createElement('div');
    toast.className = 'app-toast app-toast-' + type;
    toast.setAttribute('role', type === 'danger' ? 'alert' : 'status');
    toast.style.setProperty('--toast-ms', delay + 'ms');
    var icon = document.createElement('i');
    icon.className = 'fa-solid app-toast-icon ' + ICONS[type];
    icon.setAttribute('aria-hidden', 'true');
    var body = document.createElement('div');
    body.className = 'app-toast-text';
    body.textContent = text;
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn-close app-toast-close';
    close.setAttribute('aria-label', 'Fechar');
    var bar = document.createElement('span');
    bar.className = 'app-toast-bar';
    toast.append(icon, body, close, bar);
    box.append(toast);
    while (box.children.length > MAX) box.firstElementChild.remove();
    requestAnimationFrame(function () { toast.classList.add('show'); });

    var left = delay;
    var started = Date.now();
    var timer = setTimeout(hide, left);
    function pause() {
      if (toast.classList.contains('paused')) return;
      clearTimeout(timer);
      left -= Date.now() - started;
      toast.classList.add('paused');
    }
    function resume() {
      if (!toast.classList.contains('paused')) return;
      toast.classList.remove('paused');
      started = Date.now();
      timer = setTimeout(hide, Math.max(left, 1000));
    }
    function hide(dx) {
      clearTimeout(timer);
      if (toast.classList.contains('leaving')) return;
      toast.classList.add('leaving');
      if (dx) toast.style.transform = 'translateX(' + (dx > 0 ? 120 : -120) + '%)';
      setTimeout(function () { toast.remove(); }, 220);
    }
    close.addEventListener('click', function () { hide(); });
    toast.addEventListener('mouseenter', pause);
    toast.addEventListener('mouseleave', resume);

    // Arrastar para o lado (toque ou mouse) dispensa.
    var x0 = null;
    var moved = 0;
    toast.addEventListener('pointerdown', function (e) {
      if (e.target === close) return;
      x0 = e.clientX;
      moved = 0;
      pause();
      toast.setPointerCapture(e.pointerId);
    });
    toast.addEventListener('pointermove', function (e) {
      if (x0 === null) return;
      moved = e.clientX - x0;
      toast.classList.add('dragging');
      toast.style.transform = 'translateX(' + moved + 'px)';
      toast.style.opacity = String(Math.max(0.2, 1 - Math.abs(moved) / 220));
    });
    function release(e) {
      if (x0 === null) return;
      x0 = null;
      toast.classList.remove('dragging');
      if (Math.abs(moved) > 80) { hide(moved); return; }
      toast.style.transform = '';
      toast.style.opacity = '';
      if (e.pointerType !== 'mouse') resume();
    }
    toast.addEventListener('pointerup', release);
    toast.addEventListener('pointercancel', release);
  }

  window.appToast = show;

  var flash = document.getElementById('app-flash');
  if (flash) show(flash.dataset.message, flash.dataset.kind || 'success');
}());
