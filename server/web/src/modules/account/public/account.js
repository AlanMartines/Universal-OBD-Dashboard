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
      if (!file.files.length) return;
      var error = document.getElementById('avatar-error');
      if (file.files[0].size > 5 * 1024 * 1024) {
        error.textContent = 'A foto passa de 5 MB. Escolha um arquivo menor.';
        error.hidden = false;
        file.value = '';
        return;
      }
      error.hidden = true;
      file.form.submit();
    });
  }
}());
