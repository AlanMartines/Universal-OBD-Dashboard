/* Pede confirmação antes de enviar formulários com data-confirm. */
(function () {
  'use strict';

  var element = document.getElementById('confirm-modal');
  if (!element) return;
  var modal = window.bootstrap.Modal.getOrCreateInstance(element);
  var pending = null;
  var TONES = {
    danger: { icon: 'fa-triangle-exclamation', button: 'btn-danger' },
    warning: { icon: 'fa-circle-exclamation', button: 'btn-warning' },
    primary: { icon: 'fa-circle-question', button: 'btn-primary' },
  };

  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!form.matches('form[data-confirm]')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // Primeiro os erros do formulário; só depois a pergunta.
    if (form.matches('[data-validate]') && !window.jQuery(form).valid()) return;
    pending = form;
    document.getElementById('confirm-text').textContent = form.dataset.confirm;
    // Gravidade (data-confirm-tone): danger apaga sem volta; warning corta acesso ou muda algo
    // reversível; primary é só uma pergunta. Sem o atributo, vale danger.
    var tone = TONES[form.dataset.confirmTone] ? form.dataset.confirmTone : 'danger';
    var ok = document.getElementById('confirm-ok');
    ok.textContent = form.dataset.confirmLabel || 'Confirmar';
    ok.className = 'btn ' + TONES[tone].button;
    document.getElementById('confirm-icon').dataset.tone = tone;
    document.getElementById('confirm-icon-glyph').className = 'fa-solid ' + TONES[tone].icon;
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
