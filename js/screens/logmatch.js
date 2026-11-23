// Partita aperta (Passo 10): schermata a tocchi per il tavolo, cronologia, rosa, modifica e inserimento delle voci.
// Lo stato (ferite rimaste, incapacitati, punti, turno) viene SEMPRE dal replay degli eventi (js/matchlog.js).

import * as D from '../db.js';
import * as ML from '../matchlog.js';
import { toast } from '../app.js';
import { esc, menuSheet, confirmSheet, formSheet, pickSheet, keypadSheet, textSheet, openSheet, closeSheet } from '../ui.js';
import * as LS from '../logsticker.js';
import { generateForMatch } from '../logsource.js';
import { buildLogPdf } from '../logexport.js';
import { saveBlob, shareBlobs, logPdfFilename, fmtBytes } from '../export.js';
import { queueButtonHTML, bindQueueButton } from './coda.js';

let S = null; // stato della schermata aperta

export function cleanup() {
  S = null;
  document.documentElement.style.removeProperty('--t0');
  document.documentElement.style.removeProperty('--t1');
}

// Colori dei team (Passo 14): variabili CSS --t0/--t1 sulla pagina (valgono anche per i pannelli) e segno ●/◆ accanto al nome.
function applyTeamColors() {
  const [c0, c1] = ML.teamColors(S.match);
  document.documentElement.style.setProperty('--t0', c0.hex);
  document.documentElement.style.setProperty('--t1', c1.hex);
}
const mark = (side) => `<span class="tmark tm${side}" aria-hidden="true">${ML.TEAM_MARKS[side] || ''}</span>`;
const sideOfEvent = (i) => {
  const d = S.rep.derived[i];
  const e = S.events[i];
  const v = d && d.side != null ? d.side : e.side;
  return v === 0 || v === 1 ? v : null;
};

export async function renderMatch(el, id, query) {
  await D.ready();
  const match = await D.getMatch(id);
  if (!match) { el.innerHTML = '<p class="empty">Partita non trovata.</p><p><a href="#/log">Torna al Log</a></p>'; return; }
  const game = match.gameId != null ? await D.getGame(match.gameId) : null;
  S = { el, id, game, view: query.get('v') === 'cron' ? 'cron' : 'tavolo', cursor: null, inserted: 0, busy: false, match, units: [], events: [], rep: null };
  el.addEventListener('click', onClick);
  await reload();
  draw();
}

async function reload() {
  if (!S) return;
  const cur = S;
  const st = await D.getMatchState(S.id);
  if (!st.match || S !== cur) return; // nel frattempo si e' lasciata la schermata (cleanup): niente da aggiornare
  S.match = st.match; S.units = st.units; S.events = st.events; S.rep = st.rep;
  if (S.cursor != null) S.cursor = Math.min(S.cursor, S.events.length);
}

// ---------- utilita' ----------

const sideName = (i) => {
  const s = (S.match.sides || [])[i];
  return (s && (s.player || s.factionName)) || `Lato ${i + 1}`;
};
const unitOf = (id) => S.units.find((u) => u.id === id);
const unitName = (id) => (unitOf(id) ? unitOf(id).name : '?');
const turnLabel = () => S.match.turnLabel || 'Turno';
const describeOpts = () => ({ sideName, turnLabel: turnLabel() });
const isDone = () => S.match.status === 'done';
const isRebuild = () => S.match.mode === 'rebuild';

// Stato "qui": alla fine del log oppure, se si sta inserendo in mezzo, al punto di inserimento.
function repHere() {
  if (S.cursor == null) return S.rep;
  return ML.replay(S.units, S.events.slice(0, S.cursor), { dismissed: S.match.dismissed || [] });
}

async function add(ev) {
  if (!S) throw new Error('Schermata chiusa');
  const id = await D.addMatchEvent(S.id, ev, S.cursor);
  if (S.cursor != null) { S.cursor += 1; S.inserted += 1; }
  await reload();
  return id;
}

// Esegue un'azione dell'interfaccia una alla volta e ridisegna.
async function run(fn) {
  if (!S || S.busy) return;
  S.busy = true;
  try { await fn(); } catch (err) { console.error(err); toast('Errore: ' + err.message); }
  if (!S) return;
  S.busy = false;
  await reload();
  draw();
}

const woundsBadge = (u) => (u.max != null ? `${u.left}/${u.max}` : '–');

function unitOption(u, extra = '') {
  const w = u.max != null ? `${u.left}/${u.max} ferite` : 'ferite non tracciate';
  return { value: String(u.id), side: u.side, label: u.name, sub: `${sideName(u.side)} · ${w}${u.incapacitated ? ' · incapacitato' : ''}${extra}` };
}

const bySideThenName = (a, b) => a.side - b.side || a.name.localeCompare(b.name);

async function pickUnit(title, list, hint = '') {
  if (!list.length) { toast('Nessun operativo disponibile: controlla la rosa'); return null; }
  const v = await pickSheet({ title, hint, options: list.map((u) => unitOption(u)) });
  return v == null ? null : Number(v);
}

// ---------- disegno ----------

function draw() {
  if (!S) return;
  const { match } = S;
  const here = repHere();
  const lastTurn = here.turns[here.turns.length - 1];
  const ini = lastTurn ? lastTurn.initiative : null;
  const title = match.name || [0, 1].map(sideName).join(' vs ');
  const sc = here.score;
  const iniLine = ini ? `Iniziativa: ${esc(ML.initiativeText(ini, sideName))}` : '';
  const warns = S.rep.warnings.length;
  applyTeamColors();
  const body = S.view === 'cron' ? cronHTML() : tableHTML(here);

  S.el.innerHTML = `
    <div class="lg-top">
      <a class="lg-back" href="#/log" aria-label="Elenco partite">‹</a>
      <div class="lg-mid">
        <div class="lg-title">${esc(title)}</div>
        <div class="lg-sub" data-turn>${here.turn ? `${esc(turnLabel())} ${here.turn}` : 'Prima del primo turno'}${iniLine ? ' · ' + iniLine : ''}${isRebuild() ? ' · ricostruzione' : ''}${isDone() ? ' · terminata' : ''}</div>
      </div>
      ${queueButtonHTML()}
      <button type="button" class="kebab" data-act="match-menu" aria-label="Menu partita">⋮</button>
    </div>
    <div class="lg-score" data-score>
      <div class="lg-side tm0"><span class="lg-name">${mark(0)} ${esc(sideName(0))}</span><b data-pts="0">${sc[0] ?? 0}</b></div>
      <span class="lg-dash">–</span>
      <div class="lg-side tm1"><b data-pts="1">${sc[1] ?? 0}</b><span class="lg-name">${esc(sideName(1))} ${mark(1)}</span></div>
    </div>
    <div class="chips lg-tabs">
      <button type="button" class="chip" data-view="tavolo" aria-pressed="${S.view === 'tavolo'}">Tavolo</button>
      <button type="button" class="chip" data-view="cron" aria-pressed="${S.view === 'cron'}">Cronologia${warns ? ` ⚠ ${warns}` : ''}</button>
    </div>
    ${body}`;
  bindQueueButton(S.el);
}

function tableHTML(here) {
  const proposals = here.proposals.map((id) => here.units.get(id)).filter(Boolean);
  const parts = [];
  if (S.cursor != null) {
    parts.push(`<div class="lg-banner"><span>Inserimento: le nuove voci vanno dopo la voce n. ${S.cursor}</span><button type="button" data-act="end-insert">Fine inserimento</button></div>`);
  }
  if (isDone()) {
    parts.push(`<div class="lg-banner"><span>Partita terminata</span><button type="button" data-act="reopen">Riapri</button></div>`);
  }
  for (const u of proposals) {
    parts.push(`<div class="lg-banner lg-alert" data-proposal="${u.id}"><span>${esc(u.name)} è a 0 ferite: incapacitato?</span>
      <button type="button" class="primary" data-act="incap-yes" data-unit="${u.id}">Sì</button>
      <button type="button" data-act="incap-no" data-unit="${u.id}">No</button></div>`);
  }
  if (!isDone()) {
    const first = here.turn === 0;
    parts.push(`<div class="lg-big">
      ${first
        ? `<button type="button" class="primary lg-main" data-act="next-turn">Inizia il ${esc(turnLabel().toLowerCase())} 1</button>`
        : `<button type="button" class="primary lg-main" data-act="activate">Nuova attivazione</button>`}
      <div class="lg-grid">
        ${first ? '' : `<button type="button" data-act="next-turn">Prossimo ${esc(turnLabel().toLowerCase())}</button>`}
        <button type="button" data-act="score">Punti</button>
        <button type="button" data-act="note">Nota</button>
        <button type="button" data-act="undo" ${undoDisabled() ? 'disabled' : ''}>Annulla ultima voce</button>
      </div>
    </div>`);
  }
  parts.push(recentHTML());
  parts.push(rosterHTML(here));
  return parts.join('');
}

const undoDisabled = () => (S.cursor != null ? S.inserted === 0 : S.events.length === 0);

function recentHTML() {
  const end = S.cursor != null ? S.cursor : S.events.length;
  const from = Math.max(0, end - 4);
  if (end === 0) return '<p class="empty">Nessuna voce nel log. Tocca «Nuova attivazione» nel Tavolo per registrare la prima.</p>';
  const rows = [];
  for (let i = end - 1; i >= from; i--) {
    rows.push(`<li class="lg-recent${sideOfEvent(i) != null ? ' tm' + sideOfEvent(i) : ''}"><span class="lg-seq">${S.events[i].seq}</span><span>${esc(ML.describeEvent(S.events, i, S.rep, S.units, describeOpts()))}</span></li>`);
  }
  return `<h2>Ultime voci</h2><ul class="lg-recent-list" data-recent>${rows.join('')}</ul>`;
}

function rosterHTML(here) {
  const blocks = [0, 1].map((side) => {
    const units = [...here.units.values()].filter((u) => u.side === side);
    const s = (S.match.sides || [])[side] || {};
    return `<div class="lg-roster-side tm${side}" data-side="${side}">
      <h3 class="team-h">${mark(side)} ${esc(sideName(side))}${s.factionName && s.player ? ` <span class="meta">· ${esc(s.factionName)}</span>` : ''}</h3>
      ${units.length ? `<ul class="list">${units.map((u) => `
        <li class="item tm${side}"><button type="button" class="item-main lg-unit${u.incapacitated ? ' out' : ''}" data-unit-menu="${u.id}">
          <span class="item-name">${esc(u.name)}</span>
          <span class="item-meta">${u.incapacitated ? 'incapacitato' : (u.max != null ? 'ferite' : 'ferite non tracciate')}</span>
          ${u.max != null ? `<span class="lg-bar"><i style="width:${Math.round(100 * u.left / u.max)}%"></i></span>` : ''}
          <span class="lg-wounds" data-wounds="${u.id}">${woundsBadge(u)}</span>
        </button></li>`).join('')}</ul>` : '<p class="empty">Rosa vuota. Aggiungi gli operativi con «+ Dalla squadra» o «+ A mano».</p>'}
      <div class="row">
        <button type="button" data-act="roster-faction" data-side="${side}">+ Dalla ${esc(((S.game && S.game.labels && S.game.labels.faction) || 'fazione')).toLowerCase()}</button>
        <button type="button" data-act="roster-manual" data-side="${side}">+ A mano</button>
      </div>
    </div>`;
  });
  return `<h2>Rosa</h2>${blocks.join('')}`;
}

function cronHTML() {
  const { events, rep } = S;
  if (!events.length) return '<p class="empty">Nessuna voce nel log. Tocca «Nuova attivazione» nel Tavolo per registrare la prima.</p>';
  const warn = new Map();
  rep.warnings.forEach((w) => { if (!warn.has(w.index)) warn.set(w.index, []); warn.get(w.index).push(w.message); });
  const groups = [];
  events.forEach((ev, i) => {
    const t = rep.derived[i].turn;
    let g = groups[groups.length - 1];
    if (!g || g.turn !== t) { g = { turn: t, rows: [] }; groups.push(g); }
    g.rows.push(i);
  });
  const html = groups.map((g) => {
    const t = rep.turns.find((x) => x.n === g.turn);
    const head = g.turn === 0 ? 'Prima dell\'inizio' : `${turnLabel()} ${g.turn}${t && t.initiative ? ` · iniziativa: ${ML.initiativeText(t.initiative, sideName)}` : ''}`;
    return `<h2 class="lg-turn-h">${esc(head)}</h2><ul class="lg-ev-list">${g.rows.map((i) => {
      const ev = events[i];
      const sub = ev.type === 'damage' || ev.type === 'incapacitated' || ev.type === 'attack';
      return `<li><button type="button" class="lg-ev${sub ? ' sub' : ''}${warn.has(i) ? ' warn' : ''}${sideOfEvent(i) != null ? ' tm' + sideOfEvent(i) : ''}" data-ev="${i}">
        <span class="lg-seq">${ev.seq}</span>${sideOfEvent(i) != null ? mark(sideOfEvent(i)) : ''}
        <span class="lg-txt">${esc(ML.describeEvent(events, i, rep, S.units, describeOpts()))}${warn.has(i) ? `<small class="lg-wtxt">⚠ ${esc(warn.get(i).join('; '))}</small>` : ''}</span>
      </button></li>`;
    }).join('')}</ul>`;
  }).join('');
  return `<div class="row"><button type="button" data-act="summary">Copia riepilogo</button></div>${html}`;
}

// ---------- gestione dei tocchi ----------

function onClick(e) {
  if (!S) return;
  const view = e.target.closest('[data-view]');
  if (view) { setView(view.dataset.view); return; }
  const um = e.target.closest('[data-unit-menu]');
  if (um) { run(() => unitMenu(Number(um.dataset.unitMenu))); return; }
  const ev = e.target.closest('[data-ev]');
  if (ev) { run(() => eventMenu(Number(ev.dataset.ev))); return; }
  const btn = e.target.closest('[data-act]');
  if (!btn || btn.disabled) return;
  const side = Number(btn.dataset.side);
  const unit = Number(btn.dataset.unit);
  const acts = {
    activate: activationFlow,
    'next-turn': nextTurnFlow,
    score: scoreFlow,
    note: noteFlow,
    undo: undoFlow,
    'match-menu': matchMenu,
    summary: showSummary,
    'end-insert': async () => { S.cursor = null; S.inserted = 0; },
    reopen: async () => { await D.endMatch(S.id, false); },
    'incap-yes': async () => { await incapFlow(unit, true); },
    'incap-no': async () => { await D.dismissIncapacitated(S.id, unit); },
    'roster-faction': () => addFromFaction(side),
    'roster-manual': () => addManual(side)
  };
  if (acts[btn.dataset.act]) run(acts[btn.dataset.act]);
}

function setView(v) {
  S.view = v;
  history.replaceState(null, '', `#/log?m=${S.id}${v === 'cron' ? '&v=cron' : ''}`);
  draw();
}

// ---------- flussi del tavolo ----------

async function activationFlow() {
  const here = repHere();
  const alive = [...here.units.values()].filter((u) => !u.incapacitated).sort(bySideThenName);
  const uid = await pickUnit('Chi attiva?', alive);
  if (uid == null) return;
  const activationId = await add({ type: 'activation', unitRef: uid });
  const actions = await D.listActions(S.match.gameId);
  for (;;) {
    const a = await pickAction(uid, actions);
    if (a == null || a === 'done') break;
    const w = await pickWeapon(uid);
    if (w === undefined) continue; // annullato: si torna alla scelta dell'azione, nulla scritto
    let target = null, amount = null;
    if (w) {
      target = await pickTarget(uid);
      if (target == null) continue;
      const t = repHere().units.get(target);
      amount = await keypadSheet({ title: `Danni a ${t.name}`, sub: t.max != null ? `Ferite ora: ${t.left}/${t.max}` : 'Ferite non tracciate', value: 0, okLabel: 'Conferma danno' });
      if (amount == null) continue;
    }
    const actionId = await add({ type: 'action', unitRef: uid, actionId: a.id, data: { actionName: a.name, source: activationId } });
    if (w) {
      const attackId = await add({ type: 'attack', unitRef: uid, targetRef: target, weaponId: w.id, data: { weaponName: w.name, source: actionId } });
      const damageId = await add({ type: 'damage', unitRef: uid, targetRef: target, data: { amount, source: attackId } });
      await maybeIncapacitate(target, damageId);
    }
  }
}

async function pickAction(uid, actions) {
  const v = await pickSheet({
    title: `${unitName(uid)}: azione`,
    options: [
      { value: 'done', label: 'Fine attivazione', primary: true },
      ...actions.map((a) => ({ value: 'a:' + a.id, label: a.label || a.name })),
      { value: 'other', label: 'Altra azione…' }
    ]
  });
  if (v == null || v === 'done') return v;
  if (v === 'other') {
    const f = await formSheet({ title: 'Altra azione', fields: [{ name: 'name', label: 'Nome dell\'azione', type: 'text', required: true }] });
    return f ? { id: null, name: f.name } : null;
  }
  const a = actions.find((x) => x.id === Number(v.slice(2)));
  return { id: a.id, name: a.name };
}

// undefined = annullato, null = senza arma, { id, name } = arma scelta.
async function pickWeapon(uid) {
  const mu = unitOf(uid);
  const weapons = mu && mu.unitId != null ? await D.listWeaponsOfUnit(mu.unitId) : [];
  const v = await pickSheet({
    title: `${unitName(uid)}: arma?`,
    options: [{ value: 'none', label: 'Senza arma', primary: true }, ...weapons.map((w) => ({ value: 'w:' + w.id, label: w.name })), { value: 'other', label: 'Altra arma…' }]
  });
  if (v == null) return undefined;
  if (v === 'none') return null;
  if (v === 'other') {
    const f = await formSheet({ title: 'Altra arma', fields: [{ name: 'name', label: 'Nome dell\'arma', type: 'text', required: true }] });
    return f ? { id: null, name: f.name } : undefined;
  }
  const w = weapons.find((x) => x.id === Number(v.slice(2)));
  return { id: w.id, name: w.name };
}

async function pickTarget(uid) {
  const me = unitOf(uid);
  const alive = [...repHere().units.values()].filter((u) => !u.incapacitated && u.id !== uid);
  const enemy = alive.filter((u) => u.side !== me.side).sort(bySideThenName);
  const own = alive.filter((u) => u.side === me.side).sort(bySideThenName);
  const v = await pickSheet({
    title: `Bersaglio di ${me.name}`,
    options: [...enemy.map((u) => unitOption(u)), ...own.map((u) => unitOption(u, ' · alleato'))]
  });
  return v == null ? null : Number(v);
}

// A 0 ferite chiede subito se e' incapacitato (la proposta resta anche come avviso nel tavolo).
async function maybeIncapacitate(targetId, damageId) {
  const t = repHere().units.get(targetId);
  if (!t || t.max == null || t.left !== 0 || t.incapacitated) return;
  const ok = await confirmSheet({ title: `${t.name} è a 0 ferite`, lines: ['Segnarlo come incapacitato?'], confirmLabel: 'Sì, incapacitato' });
  if (ok) await add({ type: 'incapacitated', unitRef: targetId, data: { source: damageId } });
  else await D.dismissIncapacitated(S.id, targetId);
}

async function incapFlow(unitId, yes) {
  if (yes) await add({ type: 'incapacitated', unitRef: unitId, data: {} });
}

const INITIATIVE_HOW = [{ value: 'roll', label: 'Tiro di dado' }, { value: 'choice', label: 'Scelta' }, { value: 'other', label: 'Altro' }];

function initiativeFields(ini = null) {
  const r = (ini && ini.rolls) || [];
  return [
    { name: 'side', label: 'Chi ha l\'iniziativa?', type: 'select', value: String(ini && ini.side != null ? ini.side : 0), options: [0, 1].map((i) => ({ value: String(i), label: sideName(i) })) },
    { name: 'how', label: 'Come l\'ha ottenuta?', type: 'select', value: (ini && ini.how) || 'roll', options: INITIATIVE_HOW },
    { name: 'r0', label: `Tiro di ${sideName(0)} (se tiro di dado)`, type: 'text', value: r[0] != null ? String(r[0]) : '' },
    { name: 'r1', label: `Tiro di ${sideName(1)} (se tiro di dado)`, type: 'text', value: r[1] != null ? String(r[1]) : '' },
    { name: 'text', label: 'Dettaglio (se «Altro»)', type: 'text', value: (ini && ini.text) || '' }
  ];
}

function initiativeFromForm(v) {
  const num = (s) => { const n = ML.parseCount(s); return n == null ? null : n; };
  return { side: Number(v.side), how: v.how, rolls: v.how === 'roll' ? [num(v.r0), num(v.r1)] : [], text: v.text };
}

async function nextTurnFlow() {
  const n = repHere().turn + 1;
  const v = await formSheet({ title: `${turnLabel()} ${n}: iniziativa`, submitLabel: `Inizia il ${turnLabel().toLowerCase()} ${n}`, fields: initiativeFields() });
  if (!v) return;
  await add({ type: 'turn-start', data: { initiative: initiativeFromForm(v) } });
}

const scoreFields = (ev = null) => [
  { name: 'side', label: 'A chi vanno i punti?', type: 'select', value: String(ev && ev.side != null ? ev.side : 0), options: [0, 1].map((i) => ({ value: String(i), label: sideName(i) })) },
  { name: 'points', label: 'Punti (anche negativi)', type: 'text', value: ev ? String((ev.data || {}).points ?? '') : '1' },
  { name: 'reason', label: 'Motivo (facoltativo)', type: 'text', value: ev ? (ev.data || {}).reason || '' : '' }
];

async function scoreFlow() {
  const v = await formSheet({ title: 'Punti', fields: scoreFields() });
  if (!v) return;
  const pts = ML.parseSigned(v.points);
  if (pts == null) { toast('Punti non validi'); return; }
  await add({ type: 'score', side: Number(v.side), data: { points: pts, reason: v.reason } });
}

async function noteFlow() {
  const v = await formSheet({ title: 'Nota', fields: [{ name: 'note', label: 'Testo', type: 'text', required: true }] });
  if (v) await add({ type: 'note', note: v.note });
}

async function undoFlow() {
  const idx = S.cursor != null ? S.cursor - 1 : null;
  const ev = await D.undoMatchEvent(S.id, idx);
  if (!ev) return;
  if (S.cursor != null) { S.cursor = Math.max(0, S.cursor - 1); S.inserted = Math.max(0, S.inserted - 1); }
  toast('Annullata l\'ultima voce');
}

// ---------- rosa ----------

async function addFromFaction(side) {
  let fid = ((S.match.sides || [])[side] || {}).factionId;
  if (fid == null || !(await D.getFaction(fid))) {
    if (S.match.gameId == null) { toast('Il gioco non esiste più: aggiungi a mano'); return; }
    const factions = await D.listFactions(S.match.gameId);
    if (!factions.length) { toast('Nessuna squadra in Libreria: aggiungi a mano'); return; }
    const pick = await pickSheet({ title: 'Da quale squadra?', options: factions.map((f) => ({ value: String(f.id), label: f.name })) });
    if (pick == null) return;
    fid = Number(pick);
  }
  const units = await D.listUnits(fid);
  if (!units.length) { toast('Questa squadra non ha ancora miniature'); return; }
  const v = await formSheet({
    title: `Aggiungi a ${sideName(side)}`, submitLabel: 'Aggiungi',
    fields: [{ name: 'u', label: 'Scegli le miniature (una per ogni esemplare: scegline più volte aggiungendo di nuovo)', type: 'checks',
      options: units.map((u) => ({ value: String(u.id), label: `${u.name}${ML.parseWounds(u.stats && u.stats.wounds) ? ` (${u.stats.wounds} ferite)` : ''}` })) }]
  });
  if (!v || !v.u.length) return;
  await D.addMatchUnitsFromFaction(S.id, side, v.u.map(Number));
}

async function addManual(side) {
  const v = await formSheet({
    title: `Aggiungi a ${sideName(side)}`, submitLabel: 'Aggiungi',
    fields: [{ name: 'name', label: 'Nome', type: 'text', required: true }, { name: 'wounds', label: 'Ferite (vuoto = non tracciate)', type: 'text', value: '' }]
  });
  if (!v) return;
  await D.addMatchUnit(S.id, { side, name: v.name, maxWounds: v.wounds });
}

async function unitMenu(id) {
  const u = unitOf(id);
  const st = repHere().units.get(id);
  const items = [
    { label: 'Ferite massime…', run: () => run(async () => {
      const f = await formSheet({ title: `Ferite di ${u.name}`, fields: [{ name: 'w', label: 'Ferite massime (vuoto = non tracciate)', type: 'text', value: u.maxWounds != null ? String(u.maxWounds) : '' }] });
      if (f) await D.updateMatchUnit(id, { maxWounds: f.w });
    }) },
    { label: 'Rinomina…', run: () => run(async () => {
      const f = await formSheet({ title: 'Rinomina', fields: [{ name: 'name', label: 'Nome', type: 'text', value: u.name, required: true }] });
      if (f) await D.updateMatchUnit(id, { name: f.name });
    }) },
    st && st.incapacitated
      ? { label: 'Rimetti in gioco (toglie «incapacitato»)', run: () => run(async () => {
        const ev = S.events.find((e) => e.type === 'incapacitated' && e.unitRef === id);
        if (ev) await D.deleteMatchEvent(ev.id, { cascade: false });
      }) }
      : { label: 'Segna incapacitato', run: () => run(async () => { await add({ type: 'incapacitated', unitRef: id, data: {} }); }) },
    { label: 'Rimuovi dalla rosa', danger: true, run: () => run(async () => {
      const ok = await D.removeMatchUnit(id);
      toast(ok ? 'Tolto dalla rosa' : 'Ha voci nel log: eliminale prima');
    }) }
  ];
  menuSheet(u.name, items);
}

// ---------- cronologia: modifica, elimina, inserisci ----------

async function eventMenu(i) {
  const ev = S.events[i];
  const items = [];
  // Sticker dal log (Passo 11): attivazione, azione, danno (risultato) e punti hanno uno sticker.
  if (LS.isStickerEvent(ev) && ev.id != null) {
    items.push({ label: 'Crea sticker', run: () => { location.hash = `#/anteprima?match=${S.id}&ev=${ev.id}`; } });
  }
  items.push({ label: 'Modifica', run: () => run(() => editEvent(ev)) });
  if (isRebuild()) {
    items.push({ label: 'Inserisci prima di questa voce', run: () => { S.cursor = i; S.inserted = 0; S.view = 'tavolo'; draw(); } });
    items.push({ label: 'Inserisci dopo questa voce', run: () => { S.cursor = i + 1; S.inserted = 0; S.view = 'tavolo'; draw(); } });
  }
  items.push({ label: 'Elimina', danger: true, run: () => run(() => deleteEvent(ev)) });
  menuSheet(`${ev.seq}. ${ML.describeEvent(S.events, i, S.rep, S.units, describeOpts())}`, items);
}

async function deleteEvent(ev) {
  const ids = await D.previewDeleteEvent(ev.id);
  const lines = ids.length > 1 ? [`Verranno eliminate anche ${ids.length - 1} voci collegate (attacco, danni, incapacitato).`, 'Le ferite si ricalcolano.'] : ['Le ferite si ricalcolano.'];
  const ok = await confirmSheet({ title: 'Eliminare questa voce?', lines, confirmLabel: 'Elimina', danger: true });
  if (!ok) return;
  await D.deleteMatchEvent(ev.id, { cascade: true });
  toast('Voce eliminata');
}

const unitSelect = (name, label, value, { none = false } = {}) => ({
  name, label, type: 'select', value: value != null ? String(value) : '',
  options: [...(none ? [{ value: '', label: '(nessuno)' }] : []), ...S.units.map((u) => ({ value: String(u.id), label: `${u.name} (${sideName(u.side)})` }))]
});
const refOf = (s) => (s === '' || s == null ? null : Number(s));

async function editEvent(ev) {
  const data = ev.data || {};
  let fields = [];
  switch (ev.type) {
    case 'turn-start': fields = initiativeFields(data.initiative); break;
    case 'activation':
    case 'incapacitated': fields = [unitSelect('unit', 'Operativo', ev.unitRef)]; break;
    case 'action':
      fields = [unitSelect('unit', 'Operativo', ev.unitRef), { name: 'name', label: 'Azione', type: 'text', value: data.actionName || '' },
        unitSelect('target', 'Bersaglio', ev.targetRef, { none: true }), { name: 'ap', label: 'Punti azione (facoltativo)', type: 'text', value: data.ap != null ? String(data.ap) : '' }];
      break;
    case 'attack':
      fields = [unitSelect('unit', 'Chi attacca', ev.unitRef), { name: 'weapon', label: 'Arma', type: 'text', value: data.weaponName || '' },
        unitSelect('target', 'Bersaglio', ev.targetRef, { none: true }), { name: 'dice', label: 'Dadi, colpi, parate, critici (facoltativo)', type: 'text', value: (data.dice && data.dice.text) || '' }];
      break;
    case 'damage':
      fields = [unitSelect('unit', 'Chi lo causa', ev.unitRef, { none: true }), unitSelect('target', 'Bersaglio', ev.targetRef), { name: 'amount', label: 'Ferite inflitte', type: 'text', value: String(data.amount ?? 0) }];
      break;
    case 'score': fields = scoreFields(ev); break;
    case 'note': fields = [{ name: 'note', label: 'Testo', type: 'text', value: ev.note || '' }]; break;
    default: toast('Questa voce non si può modificare'); return;
  }
  const v = await formSheet({ title: `Modifica voce ${ev.seq}`, fields });
  if (!v) return;
  const changes = {};
  switch (ev.type) {
    case 'turn-start': changes.data = { ...data, initiative: initiativeFromForm(v) }; break;
    case 'activation':
    case 'incapacitated': changes.unitRef = refOf(v.unit); break;
    case 'action':
      changes.unitRef = refOf(v.unit); changes.targetRef = refOf(v.target);
      changes.data = { ...data, actionName: v.name || data.actionName, ap: v.ap === '' ? undefined : v.ap };
      if (v.name !== (data.actionName || '')) changes.actionId = null;
      break;
    case 'attack':
      changes.unitRef = refOf(v.unit); changes.targetRef = refOf(v.target);
      changes.data = { ...data, weaponName: v.weapon || data.weaponName, dice: v.dice ? { text: v.dice } : undefined };
      if (v.weapon !== (data.weaponName || '')) changes.weaponId = null;
      break;
    case 'damage': {
      const amount = ML.parseCount(v.amount);
      if (amount == null) { toast('Ferite non valide'); return; }
      changes.unitRef = refOf(v.unit); changes.targetRef = refOf(v.target); changes.data = { ...data, amount };
      break;
    }
    case 'score': {
      const pts = ML.parseSigned(v.points);
      if (pts == null) { toast('Punti non validi'); return; }
      changes.side = Number(v.side); changes.data = { ...data, points: pts, reason: v.reason };
      break;
    }
    case 'note': changes.note = v.note; break;
    default: break;
  }
  await D.updateMatchEvent(ev.id, changes);
  toast('Voce modificata, ferite ricalcolate');
}

// ---------- partita ----------

async function showSummary() {
  textSheet({ title: 'Riepilogo', text: ML.summarize(S.match, S.units, S.events, S.rep, { sideName }) });
}

// "Esporta PDF…" (Passo 13): il log in un PDF (stesso contenuto del riepilogo, impaginato) da salvare in Download o
// condividere con la share sheet di Android. Il PDF e' sempre in Download (la cartella dedicata e' solo per gli sticker).
async function exportPdfFlow() {
  if (!S.events.length) { toast('Il log è vuoto: non c\'è niente da esportare'); return; }
  const blob = new Blob([buildLogPdf(S.match, S.units, S.events, S.rep, { sideName })], { type: 'application/pdf' });
  const name = logPdfFilename(S.match.name || [0, 1].map(sideName).join(' vs '));
  const v = await pickSheet({
    title: 'Esporta il log in PDF',
    hint: `${name} · ${fmtBytes(blob.size)}`,
    options: [
      { value: 'save', label: 'Salva in Download', primary: true },
      { value: 'share', label: 'Condividi…', sub: 'Drive, e-mail, WhatsApp…' }
    ]
  });
  if (!v) return;
  if (v === 'save') { saveBlob(blob, name); toast(`Salvato ${name} in Download`); return; }
  const r = await shareBlobs([blob], [name]);
  if (r === 'saved') toast(`Condivisione non disponibile: salvato ${name} in Download`);
  else if (r === 'shared') toast('PDF condiviso');
}

// "Genera sticker della partita" (Passo 11): spunte per tipo, poi li disegna in sequenza nell'ordine del log e li mette in
// coda (nomi BR_<partita>_<nnn>_...png). Si puo' interrompere: quelli gia' in coda restano.
async function generateFlow() {
  const counts = LS.countByType(S.events);
  const total = LS.STICKER_TYPES.reduce((n, t) => n + counts[t], 0);
  if (!total) { toast('Nessuna voce da trasformare in sticker'); return; }
  const v = await formSheet({
    title: `Genera sticker della partita (${total} voci)`,
    submitLabel: 'Genera',
    fields: [{ name: 'types', label: 'Quali sticker', type: 'checks',
      options: LS.STICKER_TYPES.map((t) => ({ value: t, label: `${LS.TYPE_LABELS[t]} (${counts[t]})`, checked: counts[t] > 0 })) }]
  });
  if (!v) return;
  const types = v.types.filter((t) => counts[t] > 0);
  if (!types.length) { toast('Nessun tipo scelto'); return; }
  const n = types.reduce((a, t) => a + counts[t], 0);
  let stop = false;
  const sheet = openSheet(`
    <h3 class="sheet-title">Genero gli sticker…</h3>
    <p class="sheet-text" data-gen-status>0 / ${n}</p>
    <progress class="gen-bar" data-gen-bar max="${n}" value="0"></progress>
    <div class="row"><button type="button" data-gen-stop>Interrompi</button></div>`, { onClose: () => { stop = true; } });
  sheet.querySelector('[data-gen-stop]').addEventListener('click', () => { stop = true; });
  let res;
  try {
    res = await generateForMatch(S.id, types, {
      shouldStop: () => stop,
      onProgress: (d, t) => {
        const st = sheet.querySelector('[data-gen-status]');
        if (st) st.textContent = `${d} / ${t}`;
        const bar = sheet.querySelector('[data-gen-bar]');
        if (bar) bar.value = d;
      }
    });
  } finally {
    closeSheet();
  }
  const msg = `${res.done} sticker in coda${res.failed ? `, ${res.failed} non riusciti` : ''}${res.stopped ? ' (interrotto)' : ''}`;
  const done = openSheet(`
    <h3 class="sheet-title">${esc(msg)}</h3>
    <p class="sheet-text">Sono nell'ordine del log. Da Altro o dalla coda li salvi o li condividi tutti.</p>
    <div class="row"><button type="button" data-close>Chiudi</button><button type="button" class="primary" data-open-queue>Apri la coda</button></div>`);
  done.querySelector('[data-close]').addEventListener('click', closeSheet);
  done.querySelector('[data-open-queue]').addEventListener('click', () => { closeSheet(); location.hash = '#/coda'; });
}

async function matchMenu() {
  menuSheet(S.match.name || 'Partita', [
    { label: 'Nome, missione, giocatori…', run: () => run(async () => {
      const m = S.match;
      const tc = ML.teamColors(m);
      const colorOptions = ML.TEAM_COLORS.map((c) => ({ value: c.key, label: c.label }));
      const v = await formSheet({ title: 'Partita', fields: [
        { name: 'name', label: 'Nome', type: 'text', value: m.name || '' },
        { name: 'mission', label: 'Missione', type: 'text', value: m.mission || '' },
        { name: 'p0', label: 'Giocatore 1', type: 'text', value: (m.sides[0] || {}).player || '' },
        { name: 'p1', label: 'Giocatore 2', type: 'text', value: (m.sides[1] || {}).player || '' },
        { name: 'c0', label: 'Colore del giocatore 1', type: 'select', value: tc[0].key, options: colorOptions },
        { name: 'c1', label: 'Colore del giocatore 2', type: 'select', value: tc[1].key, options: colorOptions },
        { name: 'notes', label: 'Note', type: 'text', value: m.notes || '' }] });
      if (!v) return;
      if (v.c0 === v.c1) { toast('I due team devono avere colori diversi'); return; }
      const sides = [0, 1].map((i) => ({ ...(m.sides[i] || {}), player: v['p' + i], color: v['c' + i] }));
      await D.updateMatch(S.id, { name: v.name, mission: v.mission, notes: v.notes, sides });
    }) },
    { label: isRebuild() ? 'Passa a «in diretta»' : 'Passa a «ricostruzione»', run: () => run(async () => { await D.updateMatch(S.id, { mode: isRebuild() ? 'live' : 'rebuild' }); S.cursor = null; }) },
    isDone()
      ? { label: 'Riapri la partita', run: () => run(async () => { await D.endMatch(S.id, false); }) }
      : { label: 'Termina la partita', run: () => run(async () => { await D.endMatch(S.id, true); }) },
    { label: 'Copia riepilogo', run: () => run(showSummary) },
    { label: 'Esporta PDF…', run: () => run(exportPdfFlow) },
    { label: 'Genera sticker della partita…', run: () => run(generateFlow) },
    { label: 'Elimina partita', danger: true, run: async () => {
      const ok = await confirmSheet({ title: 'Eliminare la partita?', lines: [`Verranno eliminate ${S.events.length} voci e la rosa. Non si può annullare.`], confirmLabel: 'Elimina', danger: true });
      if (!ok) return;
      await D.deleteMatch(S.id);
      toast('Partita eliminata');
      location.hash = '#/log';
    } }
  ]);
}
