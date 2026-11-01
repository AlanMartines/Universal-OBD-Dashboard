/* Meus Dados: mostra ou esconde senhas e envia a foto ao escolher o arquivo. */
(function () {
  'use strict';

  document.querySelectorAll('[data-password-toggle]').forEach(function (button) {
    button.addEventListener('click', function () {
      var input = document.getElementById(button.dataset.passwordToggle);
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.setAttribute('aria-pressed', String(show));
      var icon = button.querySelector('i');
      icon.classList.toggle('fa-eye', show);
      icon.classList.toggle('fa-eye-slash', !show);
    });
  });

  var file = document.getElementById('avatar');
  if (file) {
    file.addEventListener('change', function () {
      if (file.files.length) file.form.submit();
    });
  }
}());
