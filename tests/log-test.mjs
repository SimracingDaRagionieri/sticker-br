// Prove delle parti pure del Passo 10 (js/matchlog.js): ferite rimaste e incapacitati ricostruiti dagli eventi,
// annulla, modifica, inserimento in mezzo, eliminazione a catena, avvisi, riepilogo testuale.
//   node tests/log-test.mjs
import * as ML from '../js/matchlog.js';

let fails = 0;
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) fails++; };
const eq = (a, b, msg) => { const ok = JSON.stringify(a) === JSON.stringify(b); check(ok, `${msg}${ok ? '' : '  -> ' + JSON.stringify(a) + ' invece di ' + JSON.stringify(b)}`); };

// ---------- valori ----------
eq([ML.parseWounds('9'), ML.parseWounds(12), ML.parseWounds('0'), ML.parseWounds(''), ML.parseWounds(null), ML.parseWounds('abc'), ML.parseWounds(' 8 '), ML.parseWounds('-3'), ML.parseWounds('9999')],
  [9, 12, null, null, null, null, 8, null, null], 'parseWounds: stringa del PDF, 0/vuoto/non numerico/negativo -> null');
eq([ML.parseCount('3'), ML.parseCount(''), ML.parseCount('-1'), ML.parseCount('x')], [3, null, null, null], 'parseCount');
eq([ML.parseSigned('-2'), ML.parseSigned('+4'), ML.parseSigned('5'), ML.parseSigned('')], [-2, 4, 5, null], 'parseSigned');

// ---------- una partita di prova ----------
// lato 0: A1 (10 ferite), A2 (8); lato 1: B1 (8 ferite), B2 (senza ferite: non tracciato)
const units = [
  { id: 1, side: 0, name: 'Sergeant A', maxWounds: '10' },
  { id: 2, side: 0, name: 'Gunner A', maxWounds: 8 },
  { id: 3, side: 1, name: 'Warrior B', maxWounds: '8' },
  { id: 4, side: 1, name: 'Custom B', maxWounds: null }
];
let n = 0;
const E = (type, o = {}) => ({ id: 100 + ++n, matchId: 1, seq: n, type, unitRef: null, targetRef: null, actionId: null, weaponId: null, note: '', data: {}, ...o });
const turn1 = E('turn-start', { data: { initiative: { side: 1, how: 'roll', rolls: [3, 5] } } });
const act1 = E('activation', { unitRef: 3 });
const shoot = E('action', { unitRef: 3, data: { actionName: 'Shoot', source: act1.id } });
const atk = E('attack', { unitRef: 3, targetRef: 1, data: { weaponName: 'Bolt rifle', source: shoot.id } });
const dmg = E('damage', { unitRef: 3, targetRef: 1, data: { amount: 4, source: atk.id } });
const act2 = E('activation', { unitRef: 1 });
const atk2 = E('attack', { unitRef: 1, targetRef: 3, data: { weaponName: 'Chainsword' } });
const dmg2 = E('damage', { unitRef: 1, targetRef: 3, data: { amount: 5, source: atk2.id } });
const sc = E('score', { side: 0, data: { points: 2, reason: 'Obiettivo' } });
let events = [turn1, act1, shoot, atk, dmg, act2, atk2, dmg2, sc];

let r = ML.replay(units, events);
eq(r.units.get(1).left, 6, 'Sergeant A: 10 - 4 = 6');
eq(r.units.get(3).left, 3, 'Warrior B: 8 - 5 = 3');
eq([r.derived[4].woundsLeft, r.derived[4].applied, r.derived[7].woundsLeft], [6, 4, 3], 'woundsLeft e applied calcolati sulle voci di danno');
eq(r.turn, 1, 'turno 1');
eq(r.turns[0].initiative.side, 1, 'iniziativa del turno 1: lato 1');
eq(r.derived.map((d) => d.turn), [1, 1, 1, 1, 1, 1, 1, 1, 1], 'ogni voce ha il suo turno');
eq(r.score, [2, 0], 'punti');
eq(r.warnings.length, 0, 'nessun avviso');
eq(r.proposals, [], 'nessuna proposta di incapacitato');

// danni fino a 0: le ferite non scendono sotto 0, proposta di incapacitato
const killer = E('damage', { unitRef: 1, targetRef: 3, data: { amount: 7, source: atk2.id } });
r = ML.replay(units, [...events, killer]);
eq(r.units.get(3).left, 0, 'ferite non sotto 0');
eq([r.derived[9].applied, r.derived[9].woundsLeft], [3, 0], 'applied limitato alle ferite rimaste (3 su 7)');
eq(r.proposals, [3], 'a 0 ferite -> proposta di incapacitato');
eq(ML.replay(units, [...events, killer], { dismissed: [3] }).proposals, [], 'proposta ignorata se scartata');
const inc = E('incapacitated', { unitRef: 3, data: { source: killer.id } });
r = ML.replay(units, [...events, killer, inc]);
eq([r.units.get(3).incapacitated, r.proposals], [true, []], 'incapacitato confermato: niente piu\' proposta');
eq(r.warnings.length, 0, 'incapacitato a 0 ferite: nessun avviso');

// avviso (non blocco): attivare un incapacitato; incapacitato con ferite; danno su incapacitato
const bad = E('activation', { unitRef: 3 });
r = ML.replay(units, [...events, killer, inc, bad]);
eq(r.warnings.map((w) => w.code), ['activate-incapacitated'], 'attivare un incapacitato: avviso');
r = ML.replay(units, [...events, E('incapacitated', { unitRef: 2 })]);
eq(r.warnings.map((w) => w.code), ['incap-with-wounds'], 'incapacitato con ferite ancora: avviso (a mano e' + ' consentito)');
r = ML.replay(units, [...events, killer, inc, E('damage', { unitRef: 1, targetRef: 3, data: { amount: 1 } })]);
eq(r.warnings.map((w) => w.code), ['damage-incapacitated'], 'danno su incapacitato: avviso');

// bersaglio senza ferite massime: danno registrato, ferite rimaste assenti
const dmgCustom = E('damage', { unitRef: 1, targetRef: 4, data: { amount: 3 } });
r = ML.replay(units, [...events, dmgCustom]);
eq([r.derived[9].woundsLeft, r.derived[9].applied, r.units.get(4).damageTaken, r.proposals], [null, null, 3, []], 'senza maxWounds: danno registrato, niente ferite rimaste, niente proposta');
// ferite 0 o assenti = non tracciato
eq(ML.replay([{ id: 9, side: 0, name: 'Z', maxWounds: '0' }], []).units.get(9).max, null, 'maxWounds 0 -> tracciamento spento');

// bersaglio / unita' non piu' nella rosa
r = ML.replay(units, [E('damage', { unitRef: 1, targetRef: 99, data: { amount: 2 } })]);
eq(r.warnings.map((w) => w.code), ['target-missing'], 'bersaglio mancante: avviso, nessun crash');

// ---------- annulla ----------
const afterUndo = ML.replay(units, events.slice(0, -2)); // toglie punti e ultimo danno
eq(afterUndo.units.get(3).left, 8, 'annulla l\'ultimo danno: Warrior B torna a 8');
eq(ML.replay(units, events.slice(0, -1)).units.get(3).left, 3, 'annulla solo i punti: ferite invariate');

// ---------- modifica: cambio del danno ricalcola le ferite ----------
const edited = events.map((e) => (e.id === dmg.id ? { ...e, data: { ...e.data, amount: 9 } } : e));
r = ML.replay(units, edited);
eq([r.units.get(1).left, r.derived[4].applied, r.derived[4].woundsLeft], [1, 9, 1], 'danno modificato 4 -> 9: ferite ricalcolate (1 rimasta)');
// derivedChanges: scrive solo cio' che e' cambiato
eq(ML.derivedChanges(events.map((e, i) => ({ ...e, turn: r.derived[i].turn, side: r.derived[i].side })), ML.replay(units, events)).length, 2, 'derivedChanges: solo i due danni hanno data da aggiornare');

// ---------- inserimento in mezzo ----------
// inserisco un danno prima dell'azione di Sergeant A (indice 5): le ferite finali non cambiano ma cambia "rimangono"
const early = E('damage', { unitRef: 3, targetRef: 1, data: { amount: 2 } });
const ins = ML.insertEvent(events, 5, early);
eq(ins.map((e) => e.seq), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'seq rinumerati dopo l\'inserimento');
eq(ins[5].id, early.id, 'la voce e\' nella posizione richiesta');
r = ML.replay(units, ins);
eq([r.derived[4].woundsLeft, r.derived[5].woundsLeft, r.units.get(1).left], [6, 4, 4], 'dopo l\'inserimento: 6 poi 4, ferite finali 4');
eq(ML.insertEvent(events, 0, early)[0].id, early.id, 'inserimento in testa');
eq(ML.insertEvent(events, 999, early).at(-1).id, early.id, 'posizione oltre la fine = in coda');
// stato "a quel punto": chi e' incapacitato prima di inserire
const withInc = [...events, killer, inc];
eq(ML.stateAt(units, withInc, 5).units.get(3).incapacitated, false, 'stateAt: prima della morte non e\' incapacitato');
eq(ML.stateAt(units, withInc, withInc.length).units.get(3).incapacitated, true, 'stateAt in fondo: incapacitato');
// inserire una nuova turn-start in mezzo cambia il turno delle voci successive
const t2 = E('turn-start', { data: { initiative: { side: 0, how: 'choice' } } });
r = ML.replay(units, ML.insertEvent(events, 5, t2));
eq(r.derived.map((d) => d.turn), [1, 1, 1, 1, 1, 2, 2, 2, 2, 2], 'turno ricalcolato dopo una turn-start inserita');

// ---------- eliminazione a catena ----------
eq(ML.cascadeIds(events, shoot.id).sort(), [shoot.id, atk.id, dmg.id].sort(), 'eliminare un\'azione toglie attacco e danno collegati');
eq(ML.cascadeIds(events, dmg.id), [dmg.id], 'eliminare un danno toglie solo lui');
eq(ML.cascadeIds([...events, killer, inc], killer.id).sort(), [killer.id, inc.id].sort(), 'eliminare un danno toglie l\'incapacitato che ne e\' nato');
const removed = ML.removeEvents(events, ML.cascadeIds(events, shoot.id));
eq(removed.map((e) => e.seq), [1, 2, 3, 4, 5, 6], 'seq rinumerati dopo l\'eliminazione');
eq(ML.replay(units, removed).units.get(1).left, 10, 'tolto l\'attacco di B, Sergeant A torna a 10');

// ---------- completeEvent ----------
const ce = ML.completeEvent({ type: 'activation', unitRef: 3 }, units);
eq([ce.side, ce.data, ce.note, ce.targetRef], [1, {}, '', null], 'completeEvent: lato dell\'attore e predefiniti');

// ---------- riepilogo ----------
const match = { name: 'Prova', mission: 'Recover', gameName: 'Kill Team', turnLabel: 'Turning Point', sides: [{ player: 'Vando', factionName: 'Exaction' }, { player: 'Manu', factionName: 'Orks' }] };
r = ML.replay(units, events);
const txt = ML.summarize(match, units, events, r);
console.log('\n' + txt + '\n');
check(txt.includes('Turning Point 1 - iniziativa: Manu (tiro 3 contro 5)'), 'riepilogo: turno e iniziativa col tiro');
check(txt.includes('Warrior B colpisce Sergeant A con Bolt rifle: 4 ferite, rimangono 6'), 'riepilogo: attacco con danno e ferite rimaste');
check(txt.includes('Sergeant A colpisce Warrior B con Chainsword: 5 ferite, rimangono 3'), 'riepilogo: secondo attacco');
check(txt.includes('Vando +2 punti (Obiettivo)'), 'riepilogo: punti con motivo');
check(txt.trimEnd().endsWith('Punti: Vando 2 - Manu 0'), 'riepilogo: totale punti');
const txt2 = ML.summarize(match, units, [...events, killer, inc], ML.replay(units, [...events, killer, inc]));
check(txt2.includes('Warrior B è incapacitato'), 'riepilogo: incapacitato');
check(txt2.includes('3 ferite effettive') || txt2.includes('a 0 ferite'), 'riepilogo: a 0 ferite');
const d0 = ML.describeEvent([E('damage', { unitRef: 1, targetRef: 4, data: { amount: 1 } })], 0, ML.replay(units, [E('damage', { unitRef: 1, targetRef: 4, data: { amount: 1 } })]), units);
check(d0.includes('1 ferita') && d0.includes('ferite non tracciate'), 'descrizione: singolare e ferite non tracciate');
eq(ML.initiativeText({ side: 0, how: 'other', text: 'Dado del nemico' }, (s) => 'P' + s), 'P0 (Dado del nemico)', 'iniziativa altro');

// ---------- nomi unici in rosa ----------
eq(ML.uniqueRosterName(['Intercessor', 'Intercessor 2'], 'Intercessor'), 'Intercessor 3', 'uniqueRosterName');
eq(ML.uniqueRosterName(['a'], 'b'), 'b', 'uniqueRosterName: nome libero invariato');

console.log(fails ? `\n${fails} controlli falliti` : '\nTutti i controlli passati');
process.exit(fails ? 1 : 0);
