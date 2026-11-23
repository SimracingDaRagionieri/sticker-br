// Prove delle parti pure del Passo 11 (js/logsticker.js, js/export.js, origini di riga di js/render.js, editor dei template):
//   node tests/logsticker-test.mjs
import * as ML from '../js/matchlog.js';
import * as LS from '../js/logsticker.js';
import { logStickerFilename, stickerFilename } from '../js/export.js';
import { normalizeConfig, LINE_SOURCES } from '../js/render.js';
import { SAMPLE, sourcesFor, groupsFor, newLine, SOURCE_LABELS } from '../js/templateedit.js';

let fails = 0;
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) fails++; };
const eq = (a, b, msg) => { const ok = JSON.stringify(a) === JSON.stringify(b); check(ok, `${msg}${ok ? '' : '  -> ' + JSON.stringify(a) + ' invece di ' + JSON.stringify(b)}`); };

// ---------- testi di danni e punti ----------
eq(LS.damageTexts({ amount: 3, woundsLeft: 5 }), { damageText: '-3', woundsLeftText: 'rimangono 5', damageLeftText: '-3 · rimangono 5', statusText: '' }, 'danno 3, restano 5');
eq(LS.damageTexts({ amount: 2, woundsLeft: 1 }).woundsLeftText, 'rimane 1', 'una ferita: "rimane 1"');
eq(LS.damageTexts({ amount: 4, woundsLeft: 0, incapacitated: true }), { damageText: '-4', woundsLeftText: 'rimangono 0', damageLeftText: '-4 · rimangono 0', statusText: 'INCAPACITATO' }, 'a 0 ferite incapacitato');
eq(LS.damageTexts({ amount: 3, woundsLeft: null }), { damageText: '-3', woundsLeftText: '', damageLeftText: '-3', statusText: '' }, 'bersaglio senza ferite tracciate: solo "-3"');
eq(LS.damageTexts({ amount: 0, woundsLeft: 6 }).damageText, '0', 'danno 0 senza segno');
eq([LS.scoreTexts(2).damageLeftText, LS.scoreTexts(-1).damageLeftText, LS.scoreTexts('+3').damageLeftText, LS.scoreTexts(1).damageLeftText], ['+2 punti', '-1 punto', '+3 punti', '+1 punto'], 'punti con segno');
eq(LS.joinDamageLeft('-3', 'rimangono 5'), '-3 · rimangono 5', 'joinDamageLeft');
eq([LS.joinDamageLeft('-3', ''), LS.joinDamageLeft('', 'rimangono 5'), LS.joinDamageLeft('', '')], ['-3', 'rimangono 5', ''], 'joinDamageLeft con campi vuoti');

// ---------- nomi file ----------
eq(logStickerFilename('Battle at Fort 7', 12, ['Warrior B', 'dmg4']), 'BR_Battle-at-Fort-7_012_Warrior-B_dmg4.png', 'BR_<partita>_<nnn>_...');
eq(logStickerFilename('', 3, ['x']), 'BR_partita_003_x.png', 'partita senza nome');
eq(logStickerFilename('Àrena', 1234, []), 'BR_Arena_1234.png', 'accenti tolti, numero oltre 999 e senza parti');
const names = [1, 2, 10, 11, 100].map((n) => logStickerFilename('P', n, ['a']));
eq([...names].sort(), names, 'i nomi si ordinano come il log');
check(/^BR_.*_\d{8}-\d{6}\.png$/.test(stickerFilename(['A'])), 'stickerFilename invariato (con data)');

// ---------- una partita di prova ----------
const match = { id: 1, name: 'Fort 7', gameName: 'Kill Team', sides: [{ player: 'Vando', factionName: 'Exaction Squad' }, { player: 'Manu', factionName: 'Foes' }] };
const units = [
  { id: 1, side: 0, name: 'Sergeant A', maxWounds: '10', unitId: 11 },
  { id: 2, side: 0, name: 'Gunner A', maxWounds: 8, unitId: null },
  { id: 3, side: 1, name: 'Warrior B', maxWounds: '8', unitId: 33 },
  { id: 4, side: 1, name: 'Custom B', maxWounds: null, unitId: null }
];
let n = 0;
const E = (type, o = {}) => ({ id: 100 + ++n, matchId: 1, seq: n, type, unitRef: null, targetRef: null, actionId: null, weaponId: null, note: '', data: {}, ...o });
const turn1 = E('turn-start', { data: { initiative: { side: 1, how: 'roll', rolls: [3, 5] } } });
const act1 = E('activation', { unitRef: 3 });
const shoot = E('action', { unitRef: 3, actionId: 7, data: { actionName: 'Shoot', source: act1.id } });
const atk = E('attack', { unitRef: 3, targetRef: 1, weaponId: 55, data: { weaponName: 'Bolt rifle', source: shoot.id } });
const dmg = E('damage', { unitRef: 3, targetRef: 1, data: { amount: 4, source: atk.id } });
const act2 = E('activation', { unitRef: 1 });
const dash = E('action', { unitRef: 1, actionId: null, data: { actionName: 'Altra mossa', source: act2.id } });
const atk2 = E('attack', { unitRef: 1, targetRef: 3, weaponId: null, data: { weaponName: 'Chainsword', source: dash.id } });
const dmg2 = E('damage', { unitRef: 1, targetRef: 3, data: { amount: 9, source: atk2.id } });
const inc = E('incapacitated', { unitRef: 3, data: { source: dmg2.id } });
const act3 = E('activation', { unitRef: 2 });
const note = E('note', { note: 'ciao' });
const sc = E('score', { side: 0, data: { points: 2, reason: 'Obiettivo' } });
const sc2 = E('score', { side: 1, data: { points: -1 } });
const events = [turn1, act1, shoot, atk, dmg, act2, dash, atk2, dmg2, inc, act3, note, sc, sc2];
const rep = ML.replay(units, events);

eq(LS.countByType(events), { activation: 3, action: 2, result: 2, score: 2 }, 'countByType: turn-start, attack, incapacitated e note non hanno sticker');
const all = LS.buildItems(match, units, events, rep);
eq(all.map((i) => i.seq), [2, 3, 5, 6, 7, 9, 11, 13, 14], 'voci nell\'ordine del log (seq)');
eq(all.map((i) => i.type), ['activation', 'action', 'result', 'activation', 'action', 'result', 'activation', 'score', 'score'], 'tipi nell\'ordine del log');
eq(LS.buildItems(match, units, events, rep, ['result']).map((i) => i.seq), [5, 9], 'solo i risultati');
eq(LS.buildItems(match, units, events, rep, ['score', 'action']).map((i) => i.seq), [3, 7, 13, 14], 'punti e azioni, sempre in ordine di log');
eq(LS.buildItems(match, units, events, rep, []).length, 0, 'nessun tipo, nessuno sticker');

const [a1, ac1, r1, a2, ac2, r2, a3, s1, s2] = all;
eq([a1.unitName, a1.weaponName, a1.weaponLibId, a1.unitLibId, a1.templateKind], ['Warrior B', 'Bolt rifle', 55, 33, 'activation'], 'attivazione: attaccante e arma dell\'attacco');
eq([a3.unitName, a3.weaponName], ['Gunner A', ''], 'attivazione senza attacchi: solo il nome');
eq([ac1.actionName, ac1.actionLibId, ac1.unitName, ac1.templateKind], ['Shoot', 7, 'Warrior B', 'action'], 'azione: nome copiato e id di Libreria');
eq([ac2.actionName, ac2.actionLibId], ['Altra mossa', null], 'azione scritta a mano: nessun id');
eq([r1.targetName, r1.unitName, r1.weaponName, r1.damageText, r1.woundsLeftText, r1.damageLeftText, r1.statusText, r1.templateKind],
  ['Sergeant A', 'Warrior B', 'Bolt rifle', '-4', 'rimangono 6', '-4 · rimangono 6', '', 'result'], 'risultato: bersaglio, danni, ferite rimaste');
eq([r1.targetLibId, r1.weaponLibId], [11, 55], 'risultato: immagine del BERSAGLIO e arma usata');
eq([r2.targetName, r2.damageText, r2.woundsLeftText, r2.statusText], ['Warrior B', '-9', 'rimangono 0', 'INCAPACITATO'], 'risultato: danno oltre le ferite, applicate 8 -> 0, INCAPACITATO confermato');
check(r2.damageText === '-9', 'il danno mostrato e\' quello inflitto, non quello applicato');
eq([r2.weaponName, r2.weaponLibId], ['Chainsword', null], 'arma scritta a mano: solo il nome');
eq([s1.targetName, s1.damageLeftText, s1.templateKind, s1.unitName], ['Vando: Obiettivo', '+2 punti', 'result', ''], 'punti: lato e motivo, template result');
eq([s2.targetName, s2.damageLeftText], ['Manu', '-1 punto'], 'punti negativi senza motivo');

// incapacitato non confermato: nessuno stato
const noInc = ML.replay(units, events.filter((e) => e !== inc));
eq(LS.itemFor(match, units, events.filter((e) => e !== inc), noInc, 8).statusText, '', 'a 0 ferite ma incapacitato non confermato: niente "INCAPACITATO"');
// bersaglio senza ferite tracciate
const free = [E('activation', { unitRef: 1 }), E('damage', { unitRef: 1, targetRef: 4, data: { amount: 2 } })];
const fr = ML.replay(units, free);
const fi = LS.itemFor(match, units, free, fr, 1);
eq([fi.woundsLeftText, fi.damageLeftText], ['', '-2'], 'bersaglio senza ferite: "-2" senza "rimangono"');
// riferimenti mancanti nella rosa: solo il nome, nessun errore
const ghost = [E('damage', { unitRef: 99, targetRef: 98, data: { amount: 1 } })];
const gi = LS.itemFor(match, units, ghost, ML.replay(units, ghost), 0);
eq([gi.targetName, gi.unitName, gi.targetLibId], ['', '', null], 'riferimenti a unita\' non in rosa: nomi vuoti, nessuna eccezione');
eq(LS.itemFor(match, units, events, rep, 0), null, 'turn-start: nessuno sticker');
eq(LS.itemFor(match, units, events, rep, 3), null, 'attack: nessuno sticker');

// nomi file e descrizioni delle voci
eq(all.map((i) => LS.itemFilename(match, i)), [
  'BR_Fort-7_002_Warrior-B_Bolt-rifle.png', 'BR_Fort-7_003_Warrior-B_Shoot.png', 'BR_Fort-7_005_Sergeant-A_dmg4.png',
  'BR_Fort-7_006_Sergeant-A_Chainsword.png', 'BR_Fort-7_007_Sergeant-A_Altra-mossa.png', 'BR_Fort-7_009_Warrior-B_dmg9.png',
  'BR_Fort-7_011_Gunner-A.png', 'BR_Fort-7_013_punti_Vando_pt2.png', 'BR_Fort-7_014_punti_Manu_pt-1.png'], 'nomi file BR_<partita>_<nnn>_...');
const fn = all.map((i) => LS.itemFilename(match, i));
eq([...fn].sort(), fn, 'i nomi file si ordinano come il log');
eq(new Set(fn).size, fn.length, 'nomi file tutti diversi');
check(LS.itemLabel(r2).includes('INCAPACITATO') && LS.itemLabel(r2).includes('Warrior B'), 'etichetta della coda: ' + LS.itemLabel(r2));

// ---------- origini di riga del motore ----------
for (const s of ['target', 'damage', 'woundsLeft', 'damageLeft', 'status']) {
  check(LINE_SOURCES.includes(s), `origine "${s}" nel motore`);
  eq(normalizeConfig({ lines: [{ source: s }] }).lines[0].source, s, `normalizeConfig conserva "${s}"`);
}
eq(normalizeConfig({ lines: [{ source: 'boh' }] }).lines[0].source, 'text', 'origine sconosciuta -> text');
eq(normalizeConfig({ lines: [{ source: 'unit' }, { source: 'faction' }] }).lines.map((l) => l.source), ['unit', 'faction'], 'origini vecchie invariate');

// ---------- editor dei template ----------
check(sourcesFor('result').includes('target') && sourcesFor('result').includes('status') && sourcesFor('result').includes('text'), 'origini del tipo result');
check(!sourcesFor('activation').includes('target') && !sourcesFor('action').includes('damage'), 'gli altri tipi non cambiano');
eq(sourcesFor('activation'), ['unit', 'weapon', 'faction', 'text'], 'origini Attivazione invariate');
eq(sourcesFor('action'), ['action', 'text'], 'origini Azione invariate');
check(Object.keys(SOURCE_LABELS).every((k) => LINE_SOURCES.includes(k)), 'ogni origine con etichetta esiste nel motore');
check(LINE_SOURCES.every((k) => SOURCE_LABELS[k]), 'ogni origine del motore ha un\'etichetta nell\'editor');
const gr = groupsFor('result');
eq(gr.map((g) => g.id), ['size', 'plate', 'image', 'lines', 'weapon'], 'gruppi dell\'editor Risultato');
eq(gr.find((g) => g.id === 'image').title, 'Immagine bersaglio', 'immagine = bersaglio');
eq(groupsFor('activation').map((g) => g.id), ['size', 'plate', 'image', 'lines', 'weapon'], 'gruppi Attivazione invariati');
eq(groupsFor('action').map((g) => g.id), ['size', 'plate', 'image', 'lines'], 'gruppi Azione invariati');
check(SAMPLE.result.targetName && SAMPLE.result.damageLeftText && SAMPLE.result.statusText, 'SAMPLE.result completo');
eq(newLine('result').source, 'damageLeft', 'nuova riga di un template Risultato');
eq(newLine('activation').source, 'text', 'nuova riga degli altri tipi invariata');

console.log(fails ? `\n${fails} controlli falliti` : '\nTutti i controlli passati');
process.exit(fails ? 1 : 0);
