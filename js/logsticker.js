// Sticker dal log (Passo 11): parte PURA (senza DOM e senza database), testata in Node (tests/logsticker-test.mjs).
//
// Dal log di una partita (eventi + rosa + replay) ricava, nell'ordine del log, le "voci da stickerare":
//   activation -> sticker "Attivazione"  (attaccante + arma usata nell'attivazione, se c'e')
//   action     -> sticker "Azione"       (nome dell'azione scritto nell'evento)
//   damage     -> sticker "Risultato"    (bersaglio, danni, ferite rimaste, INCAPACITATO)
//   score      -> sticker "Risultato"    (lato e motivo, "+2 punti")
// Tutti i nomi vengono dal log (copiati); gli id di Libreria (unitId/weaponId/actionId) servono solo a cercare le immagini
// se le righe esistono ancora.

import { logStickerFilename } from './export.js';
import { parseSigned } from './matchlog.js';

export const STICKER_TYPES = ['activation', 'action', 'result', 'score'];
export const TYPE_LABELS = { activation: 'Attivazioni', action: 'Azioni', result: 'Risultati', score: 'Punti' };
export const TYPE_OF_EVENT = { activation: 'activation', action: 'action', damage: 'result', score: 'score' };
// Tipo di template da usare per ogni tipo di voce (i punti usano il template "Risultato").
export const TEMPLATE_KIND = { activation: 'activation', action: 'action', result: 'result', score: 'result' };

export const isStickerEvent = (ev) => !!ev && ev.type in TYPE_OF_EVENT;

const noNegZero = (n) => (Object.is(n, -0) ? 0 : n);

// Testi di un danno. amount = quanto inflitto; woundsLeft = ferite rimaste (null = bersaglio senza ferite tracciate).
export function damageTexts({ amount, woundsLeft = null, incapacitated = false }) {
  const a = noNegZero(Number(amount) || 0);
  const damageText = a > 0 ? `-${a}` : String(a);
  const hasLeft = woundsLeft !== null && woundsLeft !== undefined && Number.isFinite(Number(woundsLeft));
  const woundsLeftText = hasLeft ? `${Number(woundsLeft) === 1 ? 'rimane' : 'rimangono'} ${Number(woundsLeft)}` : '';
  return {
    damageText,
    woundsLeftText,
    damageLeftText: woundsLeftText ? `${damageText} · ${woundsLeftText}` : damageText,
    statusText: incapacitated ? 'INCAPACITATO' : ''
  };
}

// Testi di un punteggio: "+2 punti" (anche negativo).
export function scoreTexts(points) {
  const p = parseSigned(points) ?? 0;
  const t = `${p >= 0 ? '+' : ''}${p} ${Math.abs(p) === 1 ? 'punto' : 'punti'}`;
  return { damageText: t, woundsLeftText: '', damageLeftText: t, statusText: '' };
}

// Unisce i testi dei campi del risultato (usato anche dall'Anteprima quando si modificano a mano).
export function joinDamageLeft(damageText, woundsLeftText) {
  const d = String(damageText ?? '').trim();
  const w = String(woundsLeftText ?? '').trim();
  return d && w ? `${d} · ${w}` : d || w;
}

const idOf = (ev) => ev.id;

// Arma usata in un'attivazione: primo attacco (o azione con arma) dello stesso operativo prima della prossima attivazione.
function weaponOfActivation(events, index) {
  const act = events[index];
  for (let j = index + 1; j < events.length; j++) {
    const e = events[j];
    if (e.type === 'activation' || e.type === 'turn-start') break;
    if (e.unitRef !== act.unitRef) continue;
    if (e.type === 'attack') return { weaponId: e.weaponId ?? null, weaponName: (e.data && e.data.weaponName) || '' };
    if (e.type === 'action' && e.data && e.data.weaponName) return { weaponId: e.weaponId ?? null, weaponName: e.data.weaponName };
  }
  return { weaponId: null, weaponName: '' };
}

// Attacco che ha causato un danno: quello citato in data.source, altrimenti il piu' vicino prima dello stesso attaccante/bersaglio.
function attackOfDamage(events, index) {
  const dmg = events[index];
  const src = dmg.data && dmg.data.source;
  if (src != null) {
    const a = events.find((e) => e.type === 'attack' && idOf(e) === src);
    if (a) return a;
  }
  for (let j = index - 1; j >= 0; j--) {
    const e = events[j];
    if (e.type === 'activation' || e.type === 'turn-start') break;
    if (e.type === 'attack' && e.targetRef === dmg.targetRef && (dmg.unitRef == null || e.unitRef === dmg.unitRef)) return e;
  }
  return null;
}

// Il danno ha portato a un incapacitato confermato? (evento incapacitated che lo cita, oppure subito dopo per lo stesso bersaglio)
function incapacitatedAfter(events, index) {
  const dmg = events[index];
  return events.some((e, j) => e.type === 'incapacitated' && j > index
    && ((dmg.id != null && e.data && e.data.source === dmg.id) || (j === index + 1 && e.unitRef === dmg.targetRef)));
}

// Voce da stickerare per l'evento `index`, oppure null se il tipo non ha sticker.
// `rep` = risultato di replay (per ferite rimaste e applicate); `units` = rosa; `match` = partita.
export function itemFor(match, units, events, rep, index) {
  const ev = events[index];
  if (!isStickerEvent(ev)) return null;
  const byId = new Map(units.map((u) => [u.id, u]));
  const nm = (id) => (id != null && byId.has(id) ? byId.get(id).name : '');
  const libId = (id) => (id != null && byId.has(id) ? byId.get(id).unitId ?? null : null);
  const sideName = (s) => {
    const x = ((match && match.sides) || [])[s];
    return (x && (x.player || x.factionName)) || `Lato ${(s ?? 0) + 1}`;
  };
  const factionOf = (s) => {
    const x = ((match && match.sides) || [])[s];
    return (x && x.factionName) || '';
  };
  const data = ev.data || {};
  const base = { index, id: ev.id ?? null, seq: ev.seq, side: ev.side ?? null, event: ev };
  const type = TYPE_OF_EVENT[ev.type];
  const common = { ...base, type, templateKind: TEMPLATE_KIND[type], unitName: nm(ev.unitRef), unitLibId: libId(ev.unitRef), factionName: factionOf(ev.side) };

  if (type === 'activation') {
    const w = weaponOfActivation(events, index);
    return { ...common, weaponName: w.weaponName, weaponLibId: w.weaponId, actionName: '', actionLibId: null,
      parts: [common.unitName, w.weaponName] };
  }
  if (type === 'action') {
    const actionName = data.actionName || '';
    return { ...common, weaponName: data.weaponName || '', weaponLibId: ev.weaponId ?? null, actionName, actionLibId: ev.actionId ?? null,
      parts: [common.unitName, actionName] };
  }
  if (type === 'result') {
    const d = (rep && rep.derived && rep.derived[index]) || {};
    const woundsLeft = d.woundsLeft !== undefined ? d.woundsLeft : data.woundsLeft ?? null;
    const amount = data.amount ?? 0;
    const atk = attackOfDamage(events, index);
    const t = damageTexts({ amount, woundsLeft, incapacitated: incapacitatedAfter(events, index) });
    const weaponName = (atk && atk.data && atk.data.weaponName) || '';
    return { ...common, weaponName, weaponLibId: atk ? atk.weaponId ?? null : null, actionName: '', actionLibId: null,
      targetName: nm(ev.targetRef), targetLibId: libId(ev.targetRef), amount, woundsLeft, ...t,
      parts: [nm(ev.targetRef), `dmg${noNegZero(Number(amount) || 0)}`] };
  }
  // score
  const p = parseSigned(data.points) ?? 0;
  const reason = String(data.reason || '').trim();
  const t = scoreTexts(p);
  const who = sideName(ev.side);
  return { ...common, unitName: '', unitLibId: null, weaponName: '', weaponLibId: null, actionName: '', actionLibId: null,
    targetName: reason ? `${who}: ${reason}` : who, targetLibId: null, points: p, ...t,
    parts: ['punti', who, `pt${p}`] };
}

// Tutte le voci del log per i tipi scelti, nell'ordine del log. types: iterabile di STICKER_TYPES.
export function buildItems(match, units, events, rep, types = STICKER_TYPES) {
  const want = new Set(types);
  const out = [];
  for (let i = 0; i < events.length; i++) {
    const t = TYPE_OF_EVENT[events[i].type];
    if (!t || !want.has(t)) continue;
    out.push(itemFor(match, units, events, rep, i));
  }
  return out;
}

// Quante voci per tipo (per le spunte del pannello "Genera").
export function countByType(events) {
  const c = { activation: 0, action: 0, result: 0, score: 0 };
  for (const e of events) { const t = TYPE_OF_EVENT[e.type]; if (t) c[t]++; }
  return c;
}

export const itemFilename = (match, item) => logStickerFilename((match && match.name) || '', item.seq, item.parts);

// Descrizione breve per l'elenco della coda ("12 · Hormagaunt -3 · rimangono 5").
export function itemLabel(item) {
  if (item.type === 'activation') return [item.unitName, item.weaponName].filter(Boolean).join(' · ') || 'Attivazione';
  if (item.type === 'action') return [item.unitName, item.actionName].filter(Boolean).join(' · ') || 'Azione';
  if (item.type === 'result') return `${item.targetName || '?'} ${item.damageLeftText}${item.statusText ? ' · ' + item.statusText : ''}`;
  return `${item.targetName} ${item.damageLeftText}`;
}
