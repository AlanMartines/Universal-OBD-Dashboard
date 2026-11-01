/* Adicionar dispositivo: gera o código no modal e espera o app concluir o pareamento. */
(function ($) {
  'use strict';

  var element = document.getElementById('add-device-modal');
  if (!element) return;
  var POLL_MS = 3000;
  var form = document.getElementById('add-device-form');
  var error = document.getElementById('add-device-error');
  var timer = null;
  var deadline = 0;
  var changed = false;

  function step(name) {
    ['form', 'wait', 'done', 'expired'].forEach(function (s) {
      document.getElementById('add-device-step-' + s).hidden = s !== name;
    });
    document.getElementById('add-device-submit').hidden = name !== 'form';
    document.getElementById('add-device-cancel').hidden = name === 'done';
    document.getElementById('add-device-ok').hidden = name !== 'done';
  }

  function stop() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function showError(text) {
    error.textContent = text;
    error.hidden = !text;
  }

  function poll(id) {
    timer = setTimeout(function () {
      if (Date.now() > deadline) {
        step('expired');
        return;
      }
      fetch('/dispositivos/' + encodeURIComponent(id) + '/estado', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : { paired: false }; })
        .catch(function () { return { paired: false }; })
        .then(function (state) {
          if (!timer) return;
          if (state.paired) {
            stop();
            step('done');
          } else {
            poll(id);
          }
        });
    }, POLL_MS);
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!$(form).valid()) return;
    showError('');
    var button = document.getElementById('add-device-submit');
    button.disabled = true;
    fetch('/dispositivos', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(new FormData(form)).toString(),
    })
      .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
      .then(function (res) {
        if (!res.ok) {
          showError(res.data.error || 'Não foi possível adicionar. Tente de novo.');
          return;
        }
        changed = true;
        document.getElementById('add-device-code').textContent = res.data.pairingCode;
        document.getElementById('add-device-minutes').textContent = res.data.expiresInMinutes;
        deadline = Date.now() + res.data.expiresInMinutes * 60000;
        step('wait');
        poll(res.data.id);
      })
      .catch(function () { showError('Sem conexão com o painel. Tente de novo.'); })
      .then(function () { button.disabled = false; });
  }, true);

  // Ao fechar depois de gerar um código, a lista precisa mostrar o dispositivo novo.
  element.addEventListener('hidden.bs.modal', function () {
    stop();
    if (changed) {
      // Sem o parâmetro ok, para não repetir um aviso antigo.
      var url = new URL(window.location.href);
      url.searchParams.delete('ok');
      window.location.assign(url.toString());
      return;
    }
    form.reset();
    showError('');
  });

  step('form');
}(window.jQuery));
