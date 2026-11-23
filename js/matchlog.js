// Log della partita (Passo 10): parte PURA (senza DOM e senza database), testata in Node (tests/log-test.mjs).
//
// Il log e' una lista ordinata di eventi (`seq`). Lo stato (ferite rimaste, incapacitati, punti, turno, iniziativa)
// NON e' salvato come verita': si ricostruisce rileggendo gli eventi con `replay`. Annulla = togliere l'ultimo evento,
// modificare/inserire/eliminare = cambiare la lista e rifare il replay.
//
// Evento: { id?, matchId, seq, turn, side, type, unitRef, actionId, weaponId, targetRef, data{}, note, at }
//   turn-start    data.initiative = { side, how: 'roll'|'choice'|'other', rolls: [a, b], text }
//   activation    unitRef = chi attiva
//   action        unitRef, actionId|null, data.actionName, data.weaponName?, data.ap?, data.source? (id dell'attivazione)
//   attack        unitRef, weaponId|null, data.weaponName, targetRef, data.dice? ({ text }), data.source? (id dell'azione)
//   damage        unitRef (chi lo causa, se noto), targetRef, data.amount, data.source? (id dell'attacco);
//                 data.woundsLeft e data.applied sono CALCOLATI dal replay (si riscrivono a ogni ricalcolo)
//   incapacitated unitRef = l'operativo/unita' incapacitato (proposto quando le ferite arrivano a 0, confermabile)
//   score         side, data.points (anche negativi), data.reason
//   note          note
//
// Rosa (matchUnits): { id, matchId, side, unitId|null, name, maxWounds|null, note }.

export const EVENT_TYPES = ['turn-start', 'activation', 'action', 'attack', 'damage', 'incapacitated', 'score', 'note'];

// Ferite massime valide: intero > 0 (il PDF le da' come stringa "9"); altrimenti null = tracciamento spento.
export function parseWounds(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (!/^\d{1,3}$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

// Intero >= 0 da un campo di testo; null se non valido.
export function parseCount(v) {
  const s = String(v ?? '').trim();
  if (!/^\d{1,4}$/.test(s)) return null;
  return Number(s);
}

// Intero con segno (punti: anche negativi).
export function parseSigned(v) {
  const s = String(v ?? '').trim();
  if (!/^[-+]?\d{1,4}$/.test(s)) return null;
  return Number(s);
}

const key = (ev, i) => (ev.id != null ? ev.id : 'i' + i);

// Ricostruisce lo stato rileggendo gli eventi in ordine. `upTo` = quanti eventi leggere (default tutti).
// Restituisce:
//   units      Map id -> { id, side, name, max, left, incapacitated, incapIndex, damageTaken }  (left null = non tracciato)
//   turn       numero dell'ultimo turn-start (0 = prima del primo turno)
//   turns      [{ n, index, side?, initiative }] uno per turn-start
//   score      [punti lato 0, punti lato 1, ...] (lunghezza = massimo lato visto + 1, minimo 2)
//   derived    array parallelo agli eventi: { turn, side, woundsLeft?, applied? }
//   warnings   [{ index, code, message }]  (avvisi, mai blocchi)
//   proposals  id delle unita' a 0 ferite non ancora incapacitate (da proporre)
export function replay(units, events, { upTo = events.length, dismissed = [] } = {}) {
  const st = new Map();
  for (const u of units) {
    const max = parseWounds(u.maxWounds);
    st.set(u.id, { id: u.id, side: u.side, name: u.name, max, left: max, incapacitated: false, incapIndex: -1, damageTaken: 0 });
  }
  const derived = [];
  const warnings = [];
  const turns = [];
  const score = [0, 0];
  let turn = 0;
  const warn = (index, code, message) => warnings.push({ index, code, message });
  const n = Math.min(upTo, events.length);

  for (let i = 0; i < n; i++) {
    const ev = events[i];
    const data = ev.data || {};
    const d = { turn, side: ev.side ?? null };
    const unit = ev.unitRef != null ? st.get(ev.unitRef) : null;
    if (unit) d.side = unit.side;

    switch (ev.type) {
      case 'turn-start': {
        turn += 1;
        d.turn = turn;
        const ini = data.initiative || null;
        d.side = ini && ini.side != null ? ini.side : null;
        turns.push({ n: turn, index: i, initiative: ini });
        break;
      }
      case 'activation': {
        if (unit && unit.incapacitated) warn(i, 'activate-incapacitated', `${unit.name} è incapacitato ma viene attivato`);
        if (ev.unitRef != null && !unit) warn(i, 'unit-missing', 'Operativo non più nella rosa');
        break;
      }
      case 'action':
      case 'attack': {
        if (unit && unit.incapacitated) warn(i, 'act-incapacitated', `${unit.name} è incapacitato ma agisce`);
        if (ev.targetRef != null && !st.get(ev.targetRef)) warn(i, 'target-missing', 'Bersaglio non più nella rosa');
        break;
      }
      case 'damage': {
        const t = ev.targetRef != null ? st.get(ev.targetRef) : null;
        const amount = Math.max(0, parseCount(data.amount) ?? 0);
        if (!t) { warn(i, 'target-missing', 'Danno senza bersaglio nella rosa'); d.woundsLeft = null; d.applied = null; break; }
        t.damageTaken += amount;
        if (t.incapacitated && amount > 0) warn(i, 'damage-incapacitated', `${t.name} è già incapacitato`);
        if (t.max != null) {
          const applied = Math.min(amount, t.left);
          t.left -= applied; // le ferite non scendono sotto 0
          d.applied = applied;
          d.woundsLeft = t.left;
        } else {
          d.applied = null; // ferite non tracciate: il danno e' registrato ma senza ferite rimaste
          d.woundsLeft = null;
        }
        break;
      }
      case 'incapacitated': {
        if (!unit) { warn(i, 'unit-missing', 'Incapacitato: operativo non nella rosa'); break; }
        if (unit.incapacitated) { warn(i, 'incap-twice', `${unit.name} è già incapacitato`); break; }
        unit.incapacitated = true;
        unit.incapIndex = i;
        if (unit.max != null && unit.left > 0) warn(i, 'incap-with-wounds', `${unit.name} è incapacitato ma ha ancora ${unit.left} ferite`);
        break;
      }
      case 'score': {
        const side = Number.isInteger(ev.side) && ev.side >= 0 ? ev.side : null;
        const pts = parseSigned(data.points) ?? 0;
        if (side != null) { while (score.length <= side) score.push(0); score[side] += pts; }
        break;
      }
      default:
        break; // note e tipi sconosciuti: nessun effetto sullo stato
    }
    derived.push(d);
  }

  const proposals = [];
  for (const u of st.values()) {
    if (u.max != null && u.left === 0 && !u.incapacitated && !dismissed.includes(u.id)) proposals.push(u.id);
  }
  return { units: st, turn, turns, score, derived, warnings, proposals };
}

// Stato come sarebbe prima di un certo indice (serve per inserire "in mezzo": chi è incapacitato a quel punto).
export const stateAt = (units, events, index) => replay(units, events, { upTo: index });

// ---------- modifica della lista (pura: restituisce una lista nuova, `seq` ricalcolato 1..n) ----------

export function renumber(events) {
  return events.map((e, i) => ({ ...e, seq: i + 1 }));
}

// Inserisce `ev` in posizione `pos` (0 = in testa, events.length = in coda).
export function insertEvent(events, pos, ev) {
  const p = Math.max(0, Math.min(pos, events.length));
  return renumber([...events.slice(0, p), ev, ...events.slice(p)]);
}

// Ids da eliminare insieme a `id`: eventi che lo citano come `data.source` (a catena: azione -> attacco -> danno -> ...).
export function cascadeIds(events, id) {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of events) {
      const s = e.data && e.data.source;
      if (e.id != null && s != null && out.has(s) && !out.has(e.id)) { out.add(e.id); grew = true; }
    }
    // l'incapacitato nato da un danno (source = id del danno) e' gia' coperto dal ciclo sopra
  }
  return [...out];
}

export function removeEvents(events, ids) {
  const set = new Set(ids);
  return renumber(events.filter((e) => !set.has(e.id)));
}

// Completa un evento nuovo: valori predefiniti e lato dell'attore.
export function completeEvent(ev, units) {
  const out = { type: 'note', unitRef: null, actionId: null, weaponId: null, targetRef: null, note: '', ...ev };
  out.data = { ...(ev.data || {}) };
  if (out.unitRef != null) {
    const u = units.find((x) => x.id === out.unitRef);
    if (u) out.side = u.side;
  }
  if (out.side === undefined) out.side = null;
  return out;
}

// Applica i valori calcolati dal replay agli eventi; restituisce solo quelli cambiati ({ index, changes }).
export function derivedChanges(events, rep) {
  const out = [];
  events.forEach((e, i) => {
    const d = rep.derived[i];
    const changes = {};
    if (e.turn !== d.turn) changes.turn = d.turn;
    if ((e.side ?? null) !== (d.side ?? null)) changes.side = d.side ?? null;
    if (e.type === 'damage') {
      const data = e.data || {};
      if ((data.woundsLeft ?? null) !== (d.woundsLeft ?? null) || (data.applied ?? null) !== (d.applied ?? null)) {
        changes.data = { ...data, woundsLeft: d.woundsLeft ?? null, applied: d.applied ?? null };
      }
    }
    if (Object.keys(changes).length) out.push({ index: i, changes });
  });
  return out;
}

// ---------- testi ----------

const plural = (n, one, many) => (n === 1 ? one : many);
export const woundsText = (n) => `${n} ${plural(n, 'ferita', 'ferite')}`;

export function initiativeText(ini, sideName = (s) => `Lato ${s + 1}`) {
  if (!ini) return '';
  const who = ini.side != null ? sideName(ini.side) : '';
  if (ini.how === 'roll') {
    const r = Array.isArray(ini.rolls) ? ini.rolls : [];
    const dice = r.length === 2 && r[0] != null && r[1] != null && r[0] !== '' && r[1] !== '' ? ` (tiro ${r[0]} contro ${r[1]})` : ' (tiro)';
    return `${who}${dice}`.trim();
  }
  if (ini.how === 'choice') return `${who} (scelta)`.trim();
  return `${who}${ini.text ? ` (${ini.text})` : ''}`.trim();
}

// Testo di una voce. ctx = { units: Map|array di rosa, derived (per indice) opzionale, events }.
// `rep` = risultato di replay sugli stessi eventi.
export function describeEvent(events, index, rep, units, { sideName, turnLabel = 'Turno' } = {}) {
  const byId = new Map(units.map((u) => [u.id, u]));
  const nm = (id) => (id != null && byId.has(id) ? byId.get(id).name : '?');
  const ev = events[index];
  const data = ev.data || {};
  const d = rep.derived[index] || {};
  switch (ev.type) {
    case 'turn-start': {
      const t = rep.turns.find((x) => x.index === index);
      return `Inizio ${turnLabel.toLowerCase()} ${t ? t.n : ''}${data.initiative ? ' - iniziativa: ' + initiativeText(data.initiative, sideName) : ''}`.trim();
    }
    case 'activation': return `${nm(ev.unitRef)} attiva`;
    case 'action': {
      const w = data.weaponName ? ` (${data.weaponName})` : '';
      const t = ev.targetRef != null ? ` su ${nm(ev.targetRef)}` : '';
      return `${nm(ev.unitRef)}: ${data.actionName || 'azione'}${w}${t}${data.ap != null && data.ap !== '' ? ` [${data.ap} AP]` : ''}`;
    }
    case 'attack': {
      const dice = data.dice && data.dice.text ? ` [${data.dice.text}]` : '';
      return `${nm(ev.unitRef)} attacca ${nm(ev.targetRef)} con ${data.weaponName || 'arma'}${dice}`;
    }
    case 'damage': return damageText(ev, d, nm);
    case 'incapacitated': return `${nm(ev.unitRef)} è incapacitato`;
    case 'score': {
      const p = parseSigned(data.points) ?? 0;
      const who = ev.side != null ? (sideName ? sideName(ev.side) : `Lato ${ev.side + 1}`) : '?';
      return `${who} ${p >= 0 ? '+' : ''}${p} punti${data.reason ? ` (${data.reason})` : ''}`;
    }
    case 'note': return ev.note || 'Nota';
    default: return ev.type;
  }
}

function damageText(ev, d, nm) {
  const data = ev.data || {};
  const amount = Math.max(0, parseCount(data.amount) ?? 0);
  const who = ev.targetRef != null ? nm(ev.targetRef) : '?';
  const left = d.woundsLeft;
  const base = amount === 0 ? `${who}: nessun danno` : `${who} subisce ${woundsText(amount)}`;
  if (left == null) return `${base} (ferite non tracciate)`;
  const clipped = d.applied != null && d.applied < amount ? ` (${woundsText(d.applied)} effettive)` : '';
  return `${base}${clipped}, ${left === 0 ? 'a 0 ferite' : `rimangono ${left}`}`;
}

// Riepilogo testuale copiabile della partita.
export function summarize(match, units, events, rep, { sideName } = {}) {
  const sn = sideName || ((s) => (match.sides && match.sides[s] && (match.sides[s].player || match.sides[s].factionName)) || `Lato ${s + 1}`);
  const byId = new Map(units.map((u) => [u.id, u]));
  const nm = (id) => (id != null && byId.has(id) ? byId.get(id).name : '?');
  const turnLabel = match.turnLabel || 'Turno';
  const head = [];
  const sides = match.sides || [];
  const title = match.name || sides.map((s) => s.player || s.factionName).join(' vs ');
  head.push(`${title}${match.mission ? ' - ' + match.mission : ''}`);
  if (match.gameName) head.push(match.gameName);
  const lines = [head.join(' | '), ''];
  const damageBySource = new Map();
  events.forEach((e, i) => { if (e.type === 'damage' && e.data && e.data.source != null && e.id != null) { const a = damageBySource.get(e.data.source) || []; a.push(i); damageBySource.set(e.data.source, a); } });
  const used = new Set();

  events.forEach((ev, i) => {
    if (used.has(i)) return;
    const data = ev.data || {};
    if (ev.type === 'turn-start') {
      const t = rep.turns.find((x) => x.index === i);
      const ini = data.initiative ? ` - iniziativa: ${initiativeText(data.initiative, sn)}` : '';
      lines.push(`${turnLabel} ${t ? t.n : ''}${ini}`);
      return;
    }
    if (ev.type === 'attack') {
      const dmgs = ev.id != null ? damageBySource.get(ev.id) || [] : [];
      const dice = data.dice && data.dice.text ? ` [${data.dice.text}]` : '';
      let text = `   ${nm(ev.unitRef)} colpisce ${nm(ev.targetRef)} con ${data.weaponName || 'arma'}${dice}`;
      if (dmgs.length) {
        const parts = dmgs.map((k) => { used.add(k); return damageClause(events[k], rep.derived[k]); });
        text += ': ' + parts.join('; ');
      }
      lines.push(text);
      return;
    }
    if (ev.type === 'activation') { lines.push(` ${nm(ev.unitRef)} (${sn(byId.get(ev.unitRef)?.side ?? 0)}) attiva`); return; }
    if (ev.type === 'action') {
      lines.push('   ' + describeEvent(events, i, rep, units, { sideName: sn }));
      return;
    }
    lines.push((ev.type === 'damage' || ev.type === 'incapacitated' ? '   ' : ' ') + describeEvent(events, i, rep, units, { sideName: sn }));
  });
  if (rep.warnings.length) lines.push('', `Avvisi: ${rep.warnings.length}`);
  const sc = rep.score.map((p, s) => `${sn(s)} ${p}`).join(' - ');
  lines.push('', `Punti: ${sc}`);
  return lines.join('\n');
}

function damageClause(ev, d) {
  const amount = Math.max(0, parseCount((ev.data || {}).amount) ?? 0);
  const base = amount === 0 ? 'nessun danno' : woundsText(amount);
  if (d.woundsLeft == null) return base;
  return `${base}, ${d.woundsLeft === 0 ? 'a 0 ferite' : `rimangono ${d.woundsLeft}`}`;
}

// Nome unico nella rosa di un lato: "Intercessor" -> "Intercessor 2" se esiste gia'.
export function uniqueRosterName(existingNames, name) {
  const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
  const have = new Set(existingNames.map(norm));
  if (!have.has(norm(name))) return name;
  for (let k = 2; k < 100; k++) if (!have.has(norm(`${name} ${k}`))) return `${name} ${k}`;
  return `${name} ${Date.now()}`;
}
