/* Link para a oficina: botão Copiar (o campo continua selecionável se a área de transferência não deixar). */
(function () {
  'use strict';
  var button = document.getElementById('share-copy');
  var field = button && document.getElementById(button.dataset.copyTarget);
  if (!button || !field) return;
  var label = button.querySelector('span');
  button.addEventListener('click', function () {
    field.select();
    var done = function () { label.textContent = 'Copiado'; setTimeout(function () { label.textContent = 'Copiar'; }, 2000); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(field.value).then(done).catch(function () { /* fica selecionado para copiar à mão */ });
    } else {
      done();
    }
  });
}());
