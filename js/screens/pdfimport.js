// Importa PDF squadra (Passo 6): PDF ufficiale in inglese -> lettura per coordinate -> revisione -> salvataggio.
// Route: #/pdf?g=<gioco>[&f=<fazione>]. Il PDF letto vive solo in memoria (pending); nulla del PDF finisce in IndexedDB
// tranne i dati letti e, se spuntato, i ritagli (profili arma, ritratti).

import * as D from '../db.js';
import { toast, parseHash } from '../app.js';
import { esc, openSheet, closeSheet, confirmSheet } from '../ui.js';
import { openPdf, extractPages, renderRect } from '../pdfread.js';
import { parseTeam, weaponGroups, matchWeaponGroups, displayWeaponName, splitRules, FORMAT, LANGS } from '../pdfteam.js';

const MAX_SIDE = 1200;   // lato lungo massimo dei ritagli
const THUMB_SIDE = 96;
const DPI = 300;

let pending = null;      // { gameId, factionId, fileName, doc, pages, title, lang, team }
let pdfjsPromise = null;

export function cleanup() {
  if (pending && pending.doc) { try { pending.doc.destroy(); } catch (_) { /* gia' chiuso */ } }
  pending = null;
}

function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('../../vendor/pdfjs/pdf.min.mjs').then((m) => {
      m.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
      return m;
    });
    pdfjsPromise.catch(() => { pdfjsPromise = null; });
  }
  return pdfjsPromise;
}

function pickPdf() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf,.pdf';
    input.hidden = true;
    let done = false;
    const finish = (f) => { if (done) return; done = true; input.remove(); resolve(f); };
    input.addEventListener('change', () => finish(input.files && input.files[0] ? input.files[0] : null));
    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}

// ---------- ingresso (chiamato da Libreria dentro il tocco: il selettore va aperto subito) ----------

export async function startPdfImport({ gameId, factionId = null }) {
  const file = await pickPdf();
  if (!file) return;
  try {
    toast('Leggo il PDF…');
    const pdfjs = await loadPdfjs();
    const doc = await openPdf(pdfjs, await file.arrayBuffer());
    const { pages, title } = await extractPages(pdfjs, doc);
    cleanup();
    pending = { gameId, factionId, fileName: file.name, doc, pages, title, lang: 'en', team: null };
    reparse();
    location.hash = `#/pdf?g=${gameId}${factionId != null ? '&f=' + factionId : ''}`;
  } catch (err) {
    console.error(err);
    toast('PDF non leggibile: ' + (err && err.message ? err.message : err));
  }
}

function reparse() {
  const titleGuess = pending.title || pending.fileName.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ');
  pending.team = parseTeam(pending.pages, { lang: pending.lang, title: titleGuess });
}

// ---------- schermata di revisione ----------

export async function render(el) {
  const q = parseHash().query;
  const ids = { g: Number(q.get('g')), f: q.has('f') ? Number(q.get('f')) : null };
  if (!pending || pending.gameId !== ids.g || pending.factionId !== ids.f) { location.replace('#/libreria'); return; }
  const my = pending;
  await D.ready();
  const game = await D.getGame(ids.g);
  const faction = ids.f != null ? await D.getFaction(ids.f) : null;
  if (pending !== my) return;
  if (!game || (ids.f != null && !faction)) { location.replace('#/libreria'); return; }
  draw(el, game, faction);
}

const field = (k, v, { cls = '', label = '', mode = 'text', bad = false } = {}) =>
  `<label class="pdf-f ${cls}">${label ? `<span>${esc(label)}</span>` : ''}<input type="text" data-k="${k}" value="${esc(v ?? '')}" autocomplete="off" spellcheck="false" inputmode="${mode}"${bad ? ' class="invalid"' : ''}></label>`;

function draw(el, game, faction) {
  const P = pending;
  const t = P.team;
  const L = LANGS[P.lang];
  const nW = t.operatives.reduce((n, o) => n + o.weapons.length, 0);
  const crumbs = `<nav class="crumbs"><a href="#/libreria">Libreria</a><span class="sep">›</span><a href="#/libreria/g${game.id}">${esc(game.name)}</a><span class="sep">›</span><span class="cur">Importa PDF</span></nav>`;

  const warnHTML = t.warnings.length
    ? `<div class="pdf-warn"><h2>⚠ Avvisi (${t.warnings.length})</h2><p>Controlla questi punti sul PDF prima di salvare. I campi con bordo rosso hanno un formato dubbio e si correggono qui sotto.</p>
        <ul>${t.warnings.map((w) => `<li><b>${w.page ? 'Pag. ' + w.page : 'Generale'}</b>: ${esc(w.message)}${w.text ? `<br><small>«${esc(w.text)}»</small>` : ''}</li>`).join('')}</ul></div>`
    : '<div class="pdf-ok">✓ Nessun avviso: tutto è stato riconosciuto con certezza.</div>';

  const opsHTML = t.operatives.map((o, i) => `
    <details class="pdf-op">
      <summary><span class="pdf-op-name">${esc(o.name)}</span><span class="meta">${o.weapons.length} armi · pag. ${o.pages.join(', ')}</span></summary>
      ${field(`op.${i}.name`, o.name, { label: 'Nome operativo' })}
      <div class="pdf-stats">
        ${['apl', 'move', 'save', 'wounds'].map((k) => field(`op.${i}.stats.${k}`, o.stats[k], { label: L.stats[k], bad: o.stats[k] == null || !FORMAT[k].test(o.stats[k]) })).join('')}
      </div>
      ${o.weapons.map((w, j) => `
        <div class="pdf-w">
          ${field(`op.${i}.w.${j}.name`, w.name, { label: 'Arma', bad: w.suspect.includes('name') })}
          ${field(`op.${i}.w.${j}.mode`, w.mode, { label: 'Profilo (es. short range)' })}
          <div class="pdf-stats three">
            ${['atk', 'hit', 'dmg'].map((k) => field(`op.${i}.w.${j}.${k}`, w[k], { label: L.cols[k], bad: w[k] == null || !FORMAT[k].test(w[k]) })).join('')}
          </div>
          ${field(`op.${i}.w.${j}.rules`, w.rules.join(', '), { label: L.cols.wr })}
          <label class="pdf-f"><span>Tipo</span><select data-k="op.${i}.w.${j}.kind">
            ${[['ranged', 'A distanza'], ['melee', 'Mischia'], ['other', 'Altro']].map(([v, l]) => `<option value="${v}"${w.kind === v ? ' selected' : ''}>${l}</option>`).join('')}
          </select></label>
        </div>`).join('') || '<p class="empty">Nessuna arma letta.</p>'}
      ${o.abilities.length ? `<h3>Abilità</h3>${o.abilities.map((a) => `<p class="pdf-txt"><b>${esc(a.name)}</b> ${esc(a.text)}</p>`).join('')}` : ''}
      ${o.actions.length ? `<h3>Azioni</h3>${o.actions.map((a) => `<p class="pdf-txt"><b>${esc(a.name)}</b> <span class="pdf-cost">${esc(a.cost)}</span> ${esc(a.text)}</p>`).join('')}` : ''}
      ${o.keywords.length ? `<p class="meta">${esc(o.keywords.join(', '))}</p>` : ''}
    </details>`).join('') || '<p class="empty">Nessun operativo riconosciuto.</p>';

  const rulesList = (title, rows, fmt) => rows.length ? `<details class="pdf-op"><summary><span class="pdf-op-name">${esc(title)}</span><span class="meta">${rows.length}</span></summary>${rows.map(fmt).join('')}</details>` : '';
  const ruleRow = (r) => `<p class="pdf-txt"><b>${esc(r.name)}</b>${r.cost ? ` <span class="pdf-cost">${esc(r.cost)}</span>` : ''} ${esc(r.text)}</p>`;

  el.innerHTML = `
    ${crumbs}
    <h1>Importa PDF squadra</h1>
    <p class="meta">${esc(P.fileName)} · ${t.report.pages} pagine · ${t.report.cards} carte · ${t.operatives.length} operativi · ${nW} armi</p>
    <label class="pdf-f"><span>Lingua del PDF</span><select data-lang>
      <option value="en"${P.lang === 'en' ? ' selected' : ''}>English (PDF ufficiali)</option>
      <option value="it"${P.lang === 'it' ? ' selected' : ''}>Italiano (solo prova)</option>
    </select></label>
    ${warnHTML}
    ${field('faction.name', t.faction.name, { label: `${game.labels.faction}${t.faction.nameSource ? ' (nome da: ' + t.faction.nameSource + ')' : ''}`, bad: !t.faction.name })}
    <p class="meta" data-summary>${faction ? `Aggiorna «${esc(faction.name)}».` : ''}</p>
    <h2>Immagini</h2>
    <label class="check"><input type="checkbox" data-opt="weapons" checked><span>Ritaglia i profili arma dal PDF (riga della tabella con intestazione)</span></label>
    <label class="check"><input type="checkbox" data-opt="units" ${t.operatives.some((o) => o.boxes.portrait) ? 'checked' : 'disabled'}><span>Ritaglia il ritratto degli operativi${t.operatives.some((o) => o.boxes.portrait) ? ` (trovato in ${t.operatives.filter((o) => o.boxes.portrait).length})` : ' (nessuna immagine trovata)'}</span></label>
    <h2>Operativi (${t.operatives.length})</h2>
    ${opsHTML}
    <h2>Regole</h2>
    ${rulesList('Regola di fazione', t.factionRule, ruleRow) || '<p class="empty">Nessuna regola di fazione letta.</p>'}
    ${rulesList('Stratagemmi Strategy', t.ploys.filter((p) => p.kind === 'strategy'), ruleRow)}
    ${rulesList('Stratagemmi Firefight', t.ploys.filter((p) => p.kind === 'firefight'), ruleRow)}
    ${rulesList('Equipaggiamento', t.equipment, ruleRow)}
    ${t.ignoredPages.length ? `<details class="pdf-op"><summary><span class="pdf-op-name">Pagine ignorate</span><span class="meta">${t.ignoredPages.length}</span></summary>${t.ignoredPages.map((p) => `<p class="pdf-txt">Pag. ${p.page}${p.heading ? ` «${esc(p.heading)}»` : ''}: ${esc(p.reason)}</p>`).join('')}</details>` : ''}
    <div class="pdf-bar"><button type="button" data-cancel>Annulla</button><button type="button" class="primary" data-save>Salva${t.warnings.length ? ' (con avvisi)' : ''}</button></div>`;

  wire(el, game, faction);
  refreshSummary(el, game, faction);
}

// ---------- modifiche a mano ----------

function setPath(path, value) {
  const t = pending.team;
  const p = path.split('.');
  if (p[0] === 'faction') { t.faction.name = value; return; }
  const o = t.operatives[Number(p[1])];
  if (!o) return;
  if (p[2] === 'name') o.name = value;
  else if (p[2] === 'stats') o.stats[p[3]] = value === '' ? null : value;
  else if (p[2] === 'w') {
    const w = o.weapons[Number(p[3])];
    const k = p[4];
    if (k === 'rules') w.rules = splitRules(value);
    else if (k === 'name' || k === 'mode' || k === 'kind') w[k] = value;
    else w[k] = value === '' ? null : value;
    // il campo non e' piu' dubbio se ora ha il formato giusto
    if (['atk', 'hit', 'dmg'].includes(k) && FORMAT[k].test(value)) w.suspect = w.suspect.filter((s) => s !== k);
    if (k === 'name' && value.trim()) w.suspect = w.suspect.filter((s) => s !== 'name');
  }
}

function validate(input) {
  const p = input.dataset.k.split('.');
  let fmt = null;
  if (p[2] === 'stats') fmt = FORMAT[p[3]];
  else if (p[2] === 'w' && ['atk', 'hit', 'dmg'].includes(p[4])) fmt = FORMAT[p[4]];
  const v = input.value.trim();
  const bad = (p[0] === 'faction' && !v) || (p[2] === 'w' && p[4] === 'name' && !v) || (fmt && !fmt.test(v));
  input.classList.toggle('invalid', !!bad);
}

async function refreshSummary(el, game, faction) {
  const t = pending.team;
  const out = el.querySelector('[data-summary]');
  if (!t.faction.name || !out) return;
  const groups = weaponGroups(t.operatives);
  const pv = await D.previewTeamSave({ gameId: game.id, factionId: faction ? faction.id : null, team: t, groups, match: matchWeaponGroups });
  if (!el.contains(out)) return;
  out.textContent = `${pv.factionExists ? 'Squadra già presente: verrà aggiornata.' : 'Nuova squadra.'} Operativi: ${pv.unitsNew} nuovi, ${pv.unitsUpdated} aggiornati. Armi: ${pv.weaponsNew} nuove, ${pv.weaponsUpdated} aggiornate.`;
}

function wire(el, game, faction) {
  let timer = 0;
  el.addEventListener('input', (e) => {
    const inp = e.target;
    if (!inp.dataset || !inp.dataset.k) return;
    setPath(inp.dataset.k, inp.value.trim());
    if (inp.tagName === 'INPUT') validate(inp);
    clearTimeout(timer);
    timer = setTimeout(() => refreshSummary(el, game, faction), 300);
  });
  el.querySelector('[data-lang]').addEventListener('change', (e) => {
    pending.lang = e.target.value;
    reparse();
    draw(el, game, faction);
  });
  el.querySelector('[data-cancel]').addEventListener('click', () => history.back());
  el.querySelector('[data-save]').addEventListener('click', () => save(el, game, faction));
}

// ---------- scelte a tre vie ----------

function choiceSheet({ title, lines, choices }) {
  return new Promise((resolve) => {
    let result = null;
    const sheet = openSheet(`
      <h3 class="sheet-title">${esc(title)}</h3>
      ${lines.map((l) => `<p class="sheet-text">${esc(l)}</p>`).join('')}
      <div class="sheet-menu">${choices.map((c, i) => `<button type="button" class="${c.primary ? 'primary' : ''}" data-i="${i}">${esc(c.label)}</button>`).join('')}</div>`,
    { onClose: () => resolve(result) });
    sheet.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => { result = choices[Number(b.dataset.i)].value; closeSheet(); }));
  });
}

// ---------- ritagli ----------

const makeCanvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
const toBlob = (c, type = 'image/png') => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob fallito'))), type));

async function finishImage(canvas) {
  const k = Math.min(1, MAX_SIDE / Math.max(canvas.width, canvas.height));
  let c = canvas;
  if (k < 1) {
    c = makeCanvas(Math.max(1, Math.round(canvas.width * k)), Math.max(1, Math.round(canvas.height * k)));
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(canvas, 0, 0, c.width, c.height);
  }
  const tk = THUMB_SIDE / Math.max(c.width, c.height);
  const th = makeCanvas(Math.max(1, Math.round(c.width * Math.min(1, tk))), Math.max(1, Math.round(c.height * Math.min(1, tk))));
  const tg = th.getContext('2d');
  tg.imageSmoothingQuality = 'high';
  tg.drawImage(c, 0, 0, th.width, th.height);
  return { blob: await toBlob(c), width: c.width, height: c.height, thumb: await toBlob(th) };
}

// Profilo arma = intestazione colonne + riga, alla stessa larghezza, una sopra l'altra.
async function weaponImage(box) {
  const s = DPI / 72;
  const [h, r] = await Promise.all([
    renderRect(pending.doc, box.header.page, box.header, { scale: s, makeCanvas }),
    renderRect(pending.doc, box.row.page, box.row, { scale: s, makeCanvas })
  ]);
  const c = makeCanvas(Math.max(h.width, r.width), h.height + r.height);
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(h, 0, 0);
  g.drawImage(r, 0, h.height);
  return finishImage(c);
}

async function portraitImage(box) {
  const c = await renderRect(pending.doc, box.page, box, { scale: DPI / 72, makeCanvas });
  return finishImage(c);
}

// ---------- salvataggio ----------

async function save(el, game, faction) {
  const P = pending;
  const t = P.team;
  const btn = el.querySelector('[data-save]');
  try {
    if (!t.faction.name || !t.faction.name.trim()) { toast('Scrivi il nome della squadra'); return; }
    if (!t.operatives.length) { toast('Nessun operativo da salvare'); return; }
    if (t.operatives.some((o) => !o.name.trim())) { toast('Un operativo non ha nome'); return; }
    const groups = weaponGroups(t.operatives);
    if (groups.some((g) => !g.name.trim())) { toast('Un\'arma non ha nome'); return; }
    const wantW = el.querySelector('[data-opt="weapons"]').checked;
    const wantU = el.querySelector('[data-opt="units"]').checked;
    const pv = await D.previewTeamSave({ gameId: game.id, factionId: faction ? faction.id : null, team: t, groups, match: matchWeaponGroups });

    if (t.warnings.length) {
      const ok = await confirmSheet({ title: 'Salvare con avvisi?', lines: [`Ci sono ${t.warnings.length} avvisi: i dati dubbi restano come li vedi nella revisione.`], confirmLabel: 'Salva' });
      if (!ok) return;
    }
    let replaceW = new Set(), replaceU = new Set();
    let skipW = false, skipU = false;
    if (wantW && pv.weaponImages.length) {
      const c = await choiceSheet({
        title: 'Profili arma già presenti',
        lines: [`${pv.weaponImages.length} armi hanno già un profilo immagine.`],
        choices: [{ label: 'Sostituisci con quelli del PDF', value: 'replace', primary: true }, { label: 'Tieni quelli esistenti', value: 'keep' }, { label: 'Torna indietro', value: null }]
      });
      if (c == null) return;
      if (c === 'replace') replaceW = new Set(pv.weaponImages); else skipW = true;
    }
    if (wantU && pv.unitImages.length) {
      const c = await choiceSheet({
        title: 'Ritratti già presenti',
        lines: [`${pv.unitImages.length} operativi hanno già un'immagine.`],
        choices: [{ label: 'Sostituisci con quelli del PDF', value: 'replace', primary: true }, { label: 'Tieni quelli esistenti', value: 'keep' }, { label: 'Torna indietro', value: null }]
      });
      if (c == null) return;
      if (c === 'replace') replaceU = new Set(pv.unitImages); else skipU = true;
    }

    btn.disabled = true;
    const images = { weapons: new Map(), units: new Map() };
    if (wantW) {
      // niente ritaglio per le armi che manterrebbero comunque la loro immagine
      const ids = matchWeaponGroups(pv.factionId != null ? await D.listWeaponsOfFaction(pv.factionId) : [], groups);
      const weaponsRows = pv.factionId != null ? await D.listWeaponsOfFaction(pv.factionId) : [];
      for (let i = 0; i < groups.length; i++) {
        const row = ids[i] != null ? weaponsRows.find((w) => w.id === ids[i]) : null;
        if (row && row.imageId != null && (skipW || !replaceW.has(i))) continue;
        if (!groups[i].box) continue;
        toast(`Ritaglio profili arma… ${i + 1}/${groups.length}`);
        try { images.weapons.set(i, await weaponImage(groups[i].box)); } catch (err) { console.warn('ritaglio arma fallito', groups[i].name, err); }
      }
    }
    if (wantU) {
      const unitsRows = pv.factionId != null ? await D.listUnits(pv.factionId) : [];
      for (const o of t.operatives) {
        if (!o.boxes.portrait) continue;
        const row = unitsRows.find((u) => u.name.toLowerCase().replace(/\s+/g, ' ') === o.name.toLowerCase().replace(/\s+/g, ' '));
        if (row && row.imageId != null && (skipU || !replaceU.has(o.name))) continue;
        try { images.units.set(o.name, await portraitImage(o.boxes.portrait)); } catch (err) { console.warn('ritaglio ritratto fallito', o.name, err); }
      }
    }
    toast('Salvo…');
    const sum = await D.saveTeam({
      gameId: game.id, factionId: faction ? faction.id : null, team: t, groups, match: matchWeaponGroups,
      images, replaceWeaponImages: replaceW, replaceUnitImages: replaceU
    });
    toast(`Salvato: ${sum.unitsNew + sum.unitsUpdated} operativi, ${sum.weaponsNew + sum.weaponsUpdated} armi, ${sum.rules} regole`);
    cleanup();
    location.replace(`#/libreria/g${game.id}/f${sum.factionId}`);
  } catch (err) {
    console.error(err);
    toast('Errore: ' + (err && err.message ? err.message : err));
    btn.disabled = false;
  }
}
