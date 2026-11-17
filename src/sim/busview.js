// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Onglet « Analyseur de bus » du banc de mesure (src/sim/bench.js) : les transactions I2C, SPI et série de chaque carte
// (src/sim/buslog.js), comme les décode un analyseur logique. Une adresse I2C sans réponse (NACK) ressort en rouge :
// c'est la première chose à regarder quand un capteur ne répond pas.
import { tl } from '../i18n/index.js';
import { icon } from '../ui/icons.js';
import { hex, ascii, toCsv } from './buslog.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SHOW = 400; // lignes affichées au plus (les plus récentes) ; l'export CSV prend tout l'historique

/** o : { bench(), log, boardName(id), save(text, name) } */
export function installBusView(o) {
  const el = document.createElement('div'); el.className = 'busView';
  el.innerHTML = `<div class="bvBar">
      <div class="seg mini" role="group" aria-label="${tl('Bus affichés')}">
        <button type="button" class="segBtn" data-f="all" aria-pressed="true">${tl('Tous')}</button><button type="button" class="segBtn" data-f="i2c" aria-pressed="false">I2C</button><button type="button" class="segBtn" data-f="spi" aria-pressed="false">SPI</button><button type="button" class="segBtn" data-f="uart" aria-pressed="false">${tl('Série')}</button>
      </div>
      <label class="check"><input type="checkbox" data-a="nack"> ${tl('NACK seulement')}</label>
      <span class="grow"></span><span class="bvCount"></span>
      <button type="button" class="btn small" data-a="pause" aria-pressed="false">${icon('pause')}<span>${tl('Figer')}</span></button>
      <button type="button" class="btn small" data-a="clear">${icon('trash')}<span>${tl('Effacer')}</span></button>
      <button type="button" class="btn small" data-a="csv">${icon('save')}<span>CSV</span></button>
    </div>
    <div class="bvScroll"><table class="bvTable"><thead><tr><th>${tl('Temps')}</th><th>${tl('Carte')}</th><th>${tl('Bus')}</th><th>${tl('Module')}</th><th>${tl('Échange')}</th></tr></thead><tbody></tbody></table>
      <p class="bvEmpty">${tl('Lancez la simulation : chaque échange I2C, SPI et série des cartes s’affiche ici, octet par octet. Une adresse I2C sans réponse (NACK) ressort en rouge.')}</p></div>`;
  const tbody = el.querySelector('tbody'), scroll = el.querySelector('.bvScroll'), count = el.querySelector('.bvCount');
  let filter = 'all', nackOnly = false, visible = false, queued = false;

  const keep = r => (filter === 'all' || r.bus === filter) && (!nackOnly || (r.bus === 'i2c' && (!r.ack || r.bytes.some((x, i) => r.write && !x.ack && i < r.bytes.length))));
  function cells(r) {
    const t = `${r.t.toFixed(3)} ms`, b = esc(o.boardName(r.board));
    if (r.bus === 'i2c') {
      const head = `<b class="bvAddr">0x${hex(r.addr)}</b> <span class="bvRw">${r.write ? tl('écriture') : tl('lecture')}</span>`;
      const body = r.ack ? r.bytes.map(x => `<code class="${x.ack ? '' : 'nk'}" title="${x.ack ? 'ACK' : 'NACK'}">${hex(x.v)}</code>`).join(' ') : `<span class="bvNack">${tl('NACK : aucun module ne répond à cette adresse')}</span>`;
      return [t, b, 'I2C', esc(r.dev || '—'), `${head} ${body}`];
    }
    if (r.bus === 'spi') {
      return [t, b, 'SPI', esc(r.dev || '—'), `<span class="bvDir">MOSI</span> ${r.mosi.map(x => `<code>${hex(x)}</code>`).join(' ')}<br><span class="bvDir">MISO</span> ${r.miso.map(x => `<code>${hex(x)}</code>`).join(' ')}`];
    }
    return [t, b, esc(r.port), r.dir === 'tx' ? tl('carte → module') : tl('module → carte'), `<span class="bvText">${esc(ascii(r.bytes))}</span> <small>${r.bytes.map(hex).join(' ')}</small>`];
  }
  const row = r => `<tr class="bv-${r.bus}${r.bus === 'i2c' && !r.ack ? ' bad' : ''}" data-id="${r.id}">${cells(r).map(c => `<td>${c}</td>`).join('')}</tr>`;
  function paint() {
    queued = false;
    if (!visible) return;
    const all = o.log.list(), rows = all.filter(keep), shown = rows.slice(-SHOW);
    const atEnd = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 30;
    tbody.innerHTML = shown.map(row).join('');
    el.querySelector('.bvEmpty').hidden = all.length > 0;
    count.textContent = rows.length > SHOW ? tl('{0} échanges ({1} derniers affichés)', rows.length, SHOW) : tl('{0} échanges', rows.length);
    if (atEnd) scroll.scrollTop = scroll.scrollHeight;
  }
  const soon = () => { if (!queued && visible) { queued = true; requestAnimationFrame(paint); } };
  o.log.on(soon);

  el.addEventListener('click', e => {
    const f = e.target.closest('[data-f]');
    if (f) { filter = f.dataset.f; el.querySelectorAll('[data-f]').forEach(b => b.setAttribute('aria-pressed', String(b === f))); paint(); return; }
    const a = e.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'pause') { o.log.paused = !o.log.paused; a.setAttribute('aria-pressed', String(o.log.paused)); }
    if (a.dataset.a === 'clear') o.log.clear();
    if (a.dataset.a === 'csv') o.save(toCsv(o.log.list(), o.boardName), 'analyseur-bus.csv');
  });
  el.querySelector('[data-a="nack"]').onchange = e => { nackOnly = e.target.checked; paint(); };

  // Le banc est créé avec la scène : l'onglet s'y ajoute dès qu'il existe.
  const hook = () => { const b = o.bench(); if (!b) { setTimeout(hook, 300); return; } b.addTab({ id: 'bus', label: tl('Analyseur de bus'), icon: 'list', el, onShow: on => { visible = on; if (on) paint(); } }); };
  hook();
  return { paint };
}
