/*
 * Página Mapas: escolha da área em listas encadeadas (planeta ou continente → país → região ou estado),
 * tamanho e aviso antes de baixar, e acompanhamento do trabalho em andamento. Tudo montado com
 * createElement e textContent, sem montar HTML a partir de texto, por causa da política de segurança do painel.
 */
(function () {
  'use strict';

  var form = document.getElementById('mapas-form');
  var niveis = document.getElementById('mapas-niveis');
  var campoArea = document.getElementById('mapas-area');
  var tipo = document.getElementById('mapas-tipo');
  var botao = document.getElementById('mapas-baixar');
  var infoTamanho = document.getElementById('mapas-tamanho');
  var alerta = document.getElementById('mapas-alerta');
  var filhos = {};
  var porId = {};
  var ultimoTamanho = null;
  var GB = 1024 * 1024 * 1024;

  function nome(a) { return a.nome; }

  function opcao(valor, texto) {
    var o = document.createElement('option');
    o.value = valor;
    o.textContent = texto;
    return o;
  }

  function areaEscolhida() {
    var selects = niveis.querySelectorAll('select');
    for (var i = selects.length - 1; i >= 0; i -= 1) if (selects[i].value) return selects[i].value;
    return '';
  }

  function nivel(pai, profundidade) {
    var lista = (filhos[pai || ''] || []).slice().sort(function (a, b) { return nome(a).localeCompare(nome(b), 'pt-BR'); });
    if (!lista.length) return;
    var s = document.createElement('select');
    s.className = 'form-select w-auto';
    s.setAttribute('aria-label', profundidade === 0 ? 'Continente ou planeta' : 'Detalhar a área (opcional)');
    s.appendChild(opcao('', profundidade === 0 ? 'Escolha…' : 'Toda a área acima'));
    lista.forEach(function (a) { s.appendChild(opcao(a.id, a.nome)); });
    s.addEventListener('change', function () {
      var todos = Array.prototype.slice.call(niveis.querySelectorAll('select'));
      todos.slice(todos.indexOf(s) + 1).forEach(function (el) { el.remove(); });
      if (s.value) nivel(s.value, profundidade + 1);
      escolher();
    });
    niveis.appendChild(s);
  }

  function mostrarTamanho() {
    alerta.hidden = true;
    infoTamanho.textContent = '';
    var d = ultimoTamanho;
    if (!d || d.area !== campoArea.value) return;
    var grande = d.area === 'planeta' || (d.bytesPbf && d.bytesPbf > 3 * GB);
    if (tipo.value === 'encaixe') {
      infoTamanho.textContent = d.pbfTxt
        ? 'Download: ' + d.pbfTxt + '. Depois de pronto: cerca de ' + d.discoTxt + ' em disco e ' + d.memoriaTxt + ' de memória.'
        : 'Não foi possível saber o tamanho desta área agora.';
    } else {
      infoTamanho.textContent = 'O mapa base é recortado só no retângulo da área; o tamanho final depende dela (um estado ocupa de dezenas a centenas de MB).';
    }
    if (grande) {
      alerta.hidden = false;
      alerta.textContent = d.area === 'planeta'
        ? 'Planeta inteiro: centenas de GB de disco e, no encaixe, de memória, e muitas horas de processamento. O ideal é baixar só as regiões onde os carros rodam.'
        : 'Área grande: confira o espaço em disco e a memória do servidor antes de baixar. Se possível, escolha uma região menor.';
    }
  }

  function escolher() {
    var area = areaEscolhida();
    campoArea.value = area;
    botao.disabled = !area;
    ultimoTamanho = null;
    mostrarTamanho();
    if (!area) return;
    var a = porId[area];
    form.dataset.confirm = 'Baixar ' + (tipo.value === 'base' ? 'o mapa base' : 'o encaixe nas ruas') + ' de "' + (a ? a.nome : area) + '"? Pode levar de minutos a horas, conforme o tamanho. O mapa atual segue funcionando até o novo ficar pronto.';
    infoTamanho.textContent = 'Consultando o tamanho…';
    fetch('/admin/mapas/tamanho.json?area=' + encodeURIComponent(area), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (campoArea.value === area) { ultimoTamanho = d; mostrarTamanho(); } })
      .catch(function () { infoTamanho.textContent = ''; });
  }

  if (form) {
    tipo.addEventListener('change', escolher);
    fetch('/admin/mapas/catalogo.json', { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(function (d) {
        (d.areas || []).forEach(function (a) {
          porId[a.id] = a;
          var pai = a.pai || '';
          (filhos[pai] = filhos[pai] || []).push(a);
        });
        document.getElementById('mapas-carregando').remove();
        nivel('', 0);
      })
      .catch(function () {
        document.getElementById('mapas-carregando').textContent = 'Não foi possível carregar o catálogo de áreas agora. Tente recarregar a página.';
      });
  }

  // ---------- Trabalho em andamento ----------
  var cartao = document.getElementById('mapas-trabalho');
  if (!cartao) return;
  var badge = document.getElementById('mapas-trabalho-badge');
  var fase = document.getElementById('mapas-trabalho-fase');
  var barra = document.getElementById('mapas-trabalho-barra');
  var preenchimento = document.getElementById('mapas-trabalho-barra-fill');
  var erro = document.getElementById('mapas-trabalho-erro');
  var registro = document.getElementById('mapas-trabalho-registro');
  var andando = !cartao.hidden && badge.textContent.trim() === 'Em andamento';

  function atualizar() {
    fetch('/admin/mapas/estado.json', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var t = d && d.trabalho;
        if (!t) return;
        cartao.hidden = false;
        fase.textContent = t.fase;
        registro.textContent = (t.registro || []).join('\n');
        var pct = typeof t.progresso === 'number' ? Math.round(t.progresso * 100) : null;
        barra.hidden = pct === null;
        if (pct !== null) {
          barra.setAttribute('aria-valuenow', String(pct));
          preenchimento.style.width = pct + '%';
        }
        if (t.fim) {
          badge.textContent = t.erro ? 'Falhou' : 'Concluído';
          erro.hidden = !t.erro;
          erro.textContent = t.erro || '';
          window.setTimeout(function () { window.location.reload(); }, 1500);
          return;
        }
        window.setTimeout(atualizar, 3000);
      })
      .catch(function () { window.setTimeout(atualizar, 6000); });
  }
  if (andando) window.setTimeout(atualizar, 2000);
}());
