/* Pede confirmação antes de enviar formulários com data-confirm. */
(function () {
  'use strict';

  var element = document.getElementById('confirm-modal');
  if (!element) return;
  var modal = window.bootstrap.Modal.getOrCreateInstance(element);
  var pending = null;

  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!form.matches('form[data-confirm]')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // Primeiro os erros do formulário; só depois a pergunta.
    if (form.matches('[data-validate]') && !window.jQuery(form).valid()) return;
    pending = form;
    document.getElementById('confirm-text').textContent = form.dataset.confirm;
    document.getElementById('confirm-ok').textContent = form.dataset.confirmLabel || 'Confirmar';
    modal.show();
  }, true);

  document.getElementById('confirm-ok').addEventListener('click', function () {
    if (!pending) return;
    var form = pending;
    pending = null;
    modal.hide();
    form.submit();
  });
  element.addEventListener('hidden.bs.modal', function () { pending = null; });
}());
