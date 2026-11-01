/* Avisos passageiros. Montados com nós do DOM: a mensagem nunca é tratada como HTML. */
(function () {
  'use strict';

  var ICONS = { success: 'fa-circle-check', danger: 'fa-circle-exclamation' };

  function show(text, kind) {
    var type = ICONS[kind] ? kind : 'success';
    var box = document.getElementById('app-toasts');
    if (!box) return;
    var toast = document.createElement('div');
    toast.className = 'toast align-items-center border-0 text-bg-' + type;
    toast.setAttribute('role', type === 'danger' ? 'alert' : 'status');
    var row = document.createElement('div');
    row.className = 'd-flex';
    var body = document.createElement('div');
    body.className = 'toast-body';
    var icon = document.createElement('i');
    icon.className = 'fa-solid me-2 ' + ICONS[type];
    icon.setAttribute('aria-hidden', 'true');
    body.append(icon, document.createTextNode(text));
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn-close btn-close-white me-2 m-auto';
    close.setAttribute('data-bs-dismiss', 'toast');
    close.setAttribute('aria-label', 'Fechar');
    row.append(body, close);
    toast.append(row);
    box.append(toast);
    toast.addEventListener('hidden.bs.toast', function () { toast.remove(); });
    window.bootstrap.Toast.getOrCreateInstance(toast, { delay: 5000 }).show();
  }

  window.appToast = show;

  var flash = document.getElementById('app-flash');
  if (flash) show(flash.dataset.message, 'success');
}());
