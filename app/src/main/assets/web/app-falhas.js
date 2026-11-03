'use strict';
/* Aba Falhas: códigos ativos com descrição e análise com IA. Só leitura: nada aqui apaga falhas na injeção. */
let lastFaultsKey = '';

function faultItem(code, kind) {
  const d = dtcDescribe(code, meta.dtcDescriptions);
  const el = document.createElement('div');
  el.className = 'item';
  const head = document.createElement('div');
  head.className = 'row-between';
  const title = document.createElement('b');
  title.textContent = code;
  const tag = document.createElement('span');
  tag.className = 'pill ' + (kind === 'pending' ? 'pill-warn' : 'pill-bad');
  tag.textContent = kind === 'pending' ? 'Pendente' : 'Confirmada';
  head.append(title, tag);
  el.appendChild(head);
  const text = document.createElement('div');
  text.className = 'small';
  text.textContent = d.text || 'Sem descrição conhecida para este código.';
  el.appendChild(text);
  if (d.source === 'norma' || d.source === 'grupo') {
    const src = document.createElement('div');
    src.className = 'small muted';
    src.textContent = d.source === 'norma' ? 'Descrição genérica da norma SAE.' : 'O significado exato depende do fabricante.';
    el.appendChild(src);
  }
  const actions = document.createElement('div');
  actions.className = 'actions';
  if (aiReady()) {
    const b = document.createElement('button');
    b.className = 'btn btn-small';
    b.textContent = 'Analisar com IA';
    b.addEventListener('click', () => explainDtc({ code, kind, description: d.text }));
    actions.appendChild(b);
  } else {
    const hint = document.createElement('span');
    hint.className = 'small muted';
    hint.textContent = 'Configure a IA em Ajustes para analisar.';
    actions.appendChild(hint);
  }
  el.appendChild(actions);
  return el;
}

function renderFaultsNow(conf, pend, s) {
  const mil = $('mil');
  $('fault-mil').textContent = mil.textContent;
  $('fault-mil').className = mil.className;
  const key = conf.join() + '|' + pend.join() + '|' + aiReady() + '|' + s.connection;
  if (key === lastFaultsKey) return;
  lastFaultsKey = key;
  const box = $('fault-now');
  box.innerHTML = '';
  if (conf.length + pend.length === 0) {
    box.className = 'list muted small';
    box.textContent = s.connection === 'STREAMING' ? 'Nenhuma falha ativa.' : 'Nenhuma falha lida ainda. Elas aparecem durante a captura.';
    return;
  }
  box.className = 'list';
  conf.forEach((c) => box.appendChild(faultItem(c, 'confirmed')));
  pend.forEach((c) => box.appendChild(faultItem(c, 'pending')));
}

document.querySelectorAll('[data-goto]').forEach((a) => a.addEventListener('click', (e) => {
  e.preventDefault();
  const tab = document.querySelector(`.tab[data-tab="${a.dataset.goto}"]`);
  if (tab) tab.click();
}));
