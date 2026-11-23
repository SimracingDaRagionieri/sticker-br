// Test di js/pdfteam.js (parte pura) su PDF veri e su PDF sintetici.
//
//   npm i --no-save pdfjs-dist          (una volta, nella radice del repository: serve solo ai test, in Node)
//   node tests/pdfteam-test.mjs
//
// 1. PDF SINTETICI (tests/fixtures-synth/, generati da tests/make-synth-fixtures.py, nomi inventati): risultati attesi
//    scritti a mano qui sotto. Provano il codice, NON dimostrano che i PDF Games Workshop abbiano lo stesso layout.
// 2. PDF VERI in tests/fixtures/ (NON committati, copyright Games Workshop): per ogni PDF si stampano operativi, armi e
//    avvisi da confrontare a occhio con le pagine renderizzate (pdftoppm -r 60 -png file.pdf /tmp/pagina). Se esiste
//    tests/fixtures/<nome>.expect.json ({ lang, operatives: [{ name, weapons: n }], warnings: n }) viene anche verificato.
//    Nel file .expect.json usa solo numeri e nomi, mai testi di regole.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { openPdf, extractPages, isBoldName } from '../js/pdfread.js';
import { parseTeam, matchWeaponGroups, splitRules, splitModeFromName, weaponGroups, displayWeaponName, LANGS } from '../js/pdfteam.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const require = createRequire(import.meta.url);

let pdfjs;
try {
  const dir = path.dirname(require.resolve('pdfjs-dist/package.json'));
  pdfjs = await import(pathToFileURL(path.join(dir, 'legacy/build/pdf.mjs')).href);
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(dir, 'legacy/build/pdf.worker.mjs')).href;
} catch (e) {
  console.error('Manca pdfjs-dist per Node: esegui `npm i --no-save pdfjs-dist` nella radice del repository.');
  process.exit(2);
}

let fails = 0, checks = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) { fails++; console.error('  FALLITO:', msg); }
}
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: atteso ${JSON.stringify(b)}, letto ${JSON.stringify(a)}`);

async function load(file, lang = 'en') {
  const doc = await openPdf(pdfjs, fs.readFileSync(file));
  const { pages, title } = await extractPages(pdfjs, doc);
  return { result: parseTeam(pages, { lang, title }), pages };
}

function print(label, r) {
  console.log(`\n=== ${label}`);
  console.log(`Squadra: ${r.faction.name} [${r.faction.nameSource}]  pagine ${r.report.pages}, intestazioni ${r.report.headers}, carte ${r.report.cards}`);
  for (const o of r.operatives) {
    console.log(`- ${o.name}  APL ${o.stats.apl} MOVE ${o.stats.move} SAVE ${o.stats.save} WOUNDS ${o.stats.wounds}  (pag. ${o.pages.join(',')})`);
    for (const w of o.weapons) {
      console.log(`    ${displayWeaponName(w.name, w.mode)}: ATK ${w.atk} HIT ${w.hit} DMG ${w.dmg}  [${w.rules.join('; ')}]${w.suspect.length ? '  DUBBIO: ' + w.suspect.join(',') : ''}`);
    }
    console.log(`    abilita': ${o.abilities.map((a) => a.name).join(', ') || '-'}  azioni: ${o.actions.map((a) => `${a.name} ${a.cost}`).join(', ') || '-'}`);
  }
  console.log(`Regola di fazione: ${r.factionRule.map((x) => x.name).join(', ') || '-'}`);
  console.log(`Stratagemmi: ${r.ploys.map((x) => `${x.kind}:${x.name} ${x.cost || ''}`).join(', ') || '-'}`);
  console.log(`Equipaggiamento: ${r.equipment.map((x) => x.name).join(', ') || '-'}`);
  console.log(`Pagine ignorate: ${r.ignoredPages.map((x) => `p${x.page} "${x.heading}"`).join(', ') || '-'}`);
  console.log(`Avvisi (${r.warnings.length}):`);
  for (const w of r.warnings) console.log(`  [${w.code}] p${w.page}: ${w.message}${w.text ? '  «' + w.text + '»' : ''}`);
}

// ---------- 0. helper puri ----------
eq(splitRules('Range 10", Rending, Heavy (Dash only)'), ['Range 10"', 'Rending', 'Heavy (Dash only)'], 'splitRules con parentesi');
eq(splitRules('-'), [], 'splitRules trattino');
eq(splitRules(''), [], 'splitRules vuoto');
eq(splitModeFromName('Bolt rifle (short range)'), { name: 'Bolt rifle', mode: 'short range' }, 'modo tra parentesi');
eq(splitModeFromName('Heavy repeater - overwatch'), { name: 'Heavy repeater - overwatch', mode: '' }, 'trattino resta nel nome');
ok(!/\b(document|window|navigator|import\s)/.test(fs.readFileSync(path.join(root, 'js/pdfteam.js'), 'utf8').replace(/\/\/.*$/gm, '')), 'pdfteam.js deve restare puro (nessun DOM, nessun import)');
ok(LANGS.en && LANGS.it, 'dizionari en e it');
{
  const P = { atk: '4', hit: '3+', dmg: '3/4', rules: ['Piercing 1'], mode: '' };
  const groups = [{ name: 'Bolt', mode: '', profile: P }, { name: 'Bolt', mode: '', profile: { ...P, atk: '5' } }, { name: 'New', mode: 'long', profile: P }];
  const rows = [{ id: 7, name: 'bolt', profile: { ...P, atk: '5' } }, { id: 9, name: 'Bolt', profile: P }];
  eq(matchWeaponGroups(rows, groups), [9, 7, null], 'reimport: stesso nome e profilo -> stessa riga, nome nuovo -> null');
  eq(matchWeaponGroups([{ id: 1, name: 'Bolt' }], [groups[0]]), [1], 'reimport: riga manuale senza profilo adottata');
}

// ---------- 1. PDF sintetici ----------
const synth = path.join(here, 'fixtures-synth');
if (!fs.existsSync(path.join(synth, 'synth-single.pdf'))) {
  console.log('Genero i PDF sintetici…');
  execFileSync('python3', [path.join(here, 'make-synth-fixtures.py')], { stdio: 'inherit' });
}

const names = (r) => r.operatives.map((o) => o.name);
const wnames = (o) => o.weapons.map((w) => displayWeaponName(w.name, w.mode));
const op = (r, n) => r.operatives.find((o) => o.name === n);

const FACTION = { rule: ['Brass Discipline', 'Order Dice'], strategy: ['Hold The Line', 'Forced March'], firefight: ['Volley Fire', 'Close Ranks'], equipment: ['Signal Flares', 'Ablative Plates'] };
function factionChecks(r, tag) {
  eq(r.factionRule.map((x) => x.name), FACTION.rule, `${tag}: regola di fazione`);
  eq(r.ploys.filter((p) => p.kind === 'strategy').map((p) => p.name), FACTION.strategy, `${tag}: Strategy`);
  eq(r.ploys.filter((p) => p.kind === 'firefight').map((p) => `${p.name} ${p.cost}`), ['Volley Fire 1CP', 'Close Ranks 2CP'], `${tag}: Firefight e costi`);
  eq(r.equipment.map((x) => x.name), FACTION.equipment, `${tag}: equipaggiamento`);
}
const CAPTAIN = (r, tag) => {
  const o = op(r, 'WARDEN CAPTAIN');
  ok(!!o, `${tag}: WARDEN CAPTAIN presente`);
  if (!o) return;
  eq(o.stats, { apl: '3', move: '6"', save: '3+', wounds: '12' }, `${tag}: statistiche capitano`);
  eq(wnames(o), ['Arc pistol', 'Duty blade'], `${tag}: armi capitano`);
  eq([o.weapons[0].atk, o.weapons[0].hit, o.weapons[0].dmg, o.weapons[0].rules], ['4', '3+', '3/4', ['Range 8"', 'Piercing 1']], `${tag}: profilo Arc pistol`);
  eq(o.weapons[1].rules, [], `${tag}: Duty blade senza regole`);
  eq(o.abilities.map((a) => a.name), ['Command Voice', 'Steadfast'], `${tag}: abilita' capitano`);
  eq(o.actions.map((a) => `${a.name}/${a.cost}`), ['Rally/1AP'], `${tag}: azioni capitano`);
  eq(o.keywords, ['BRASS WARDENS', 'IMPERIAL', 'LEADER', 'CAPTAIN'], `${tag}: parole chiave capitano`);
};
const TROOPER = (r, tag) => {
  const o = op(r, 'WARDEN TROOPER');
  ok(!!o, `${tag}: WARDEN TROOPER presente`);
  if (!o) return;
  eq(o.stats, { apl: '2', move: '6"', save: '4+', wounds: '8' }, `${tag}: statistiche soldato`);
  eq(wnames(o), ['Scatter carbine (short range)', 'Scatter carbine (long range)', 'Truncheon'], `${tag}: doppio profilo`);
  eq(o.weapons.slice(0, 2).map((w) => [w.name, w.mode, w.atk, w.hit, w.dmg, w.rules]),
    [['Scatter carbine', 'short range', '5', '4+', '2/3', ['Range 6"']], ['Scatter carbine', 'long range', '4', '4+', '2/2', ['Range 12"', 'Saturate']]], `${tag}: profili del doppio profilo`);
  eq(o.actions.map((a) => `${a.name}/${a.cost}`), ['Brace/0AP'], `${tag}: azione a costo 0`);
};
const GUNNER = (r, tag) => {
  const o = op(r, 'WARDEN GUNNER');
  ok(!!o, `${tag}: WARDEN GUNNER presente`);
  if (!o) return;
  eq(wnames(o), ['Heavy repeater - overwatch', 'Heavy repeater - sustained', 'Gun butt'], `${tag}: armi artigliere`);
  eq(o.weapons[0].rules, ['Range 10"', 'Rending', 'Heavy (Dash only)'], `${tag}: regole su due righe`);
  eq(o.abilities.map((a) => a.name), ['Suppressing Volley'], `${tag}: abilita' artigliere (nessuna riga di tabella finita tra le abilita')`);
};
const SHIELD = (r, tag) => {
  const o = op(r, 'WARDEN SHIELDBEARER');
  ok(!!o, `${tag}: WARDEN SHIELDBEARER presente`);
  if (!o) return;
  eq(wnames(o), ['Riot hammer', 'Flare-launcher'], `${tag}: armi scudiero`);
  eq(o.weapons[1].rules, ['Range 8"', 'Blast 2"'], `${tag}: regole arma su due righe`);
  eq(o.actions.map((a) => a.name), ['Plant Shield', 'Shove'], `${tag}: azioni scudiero`);
};

// pagina singola
{
  const { result: r } = await load(path.join(synth, 'synth-single.pdf'));
  print('synth-single (pagina singola, una carta per pagina)', r);
  eq(names(r), ['WARDEN CAPTAIN', 'WARDEN TROOPER', 'WARDEN GUNNER'], 'single: operativi');
  CAPTAIN(r, 'single'); TROOPER(r, 'single'); GUNNER(r, 'single'); factionChecks(r, 'single');
  eq(r.ignoredPages.map((x) => x.page), [8], 'single: pagina di lore ignorata');
  eq(r.warnings.length, 0, 'single: zero avvisi');
  ok(r.operatives.every((o) => o.boxes.portrait === null || o.boxes.portrait.w > 40), 'single: ritratto trovato o assente');
  ok(!!op(r, 'WARDEN CAPTAIN').boxes.portrait, 'single: ritratto del capitano ricavato dall\'immagine in pagina');
}
// fronte e retro, due carte per pagina
{
  const { result: r } = await load(path.join(synth, 'synth-frontback.pdf'));
  print('synth-frontback (fronte/retro, carte impilate)', r);
  eq(names(r), ['WARDEN CAPTAIN', 'WARDEN SHIELDBEARER'], 'frontback: operativi (4 intestazioni -> 2 operativi)');
  eq(r.report.headers, 4, 'frontback: 4 intestazioni');
  CAPTAIN(r, 'frontback'); SHIELD(r, 'frontback'); factionChecks(r, 'frontback');
  eq(op(r, 'WARDEN CAPTAIN').pages, [1, 2], 'frontback: pagine capitano');
  eq(op(r, 'WARDEN SHIELDBEARER').abilities.map((a) => a.name), ['Interposing Shield', 'Heavy Frame', 'Shield Wall'], 'frontback: abilita\' del retro unite');
  eq(r.warnings.length, 0, 'frontback: zero avvisi');
}
// doppio profilo, numeri centrati, due colonne
{
  const { result: r } = await load(path.join(synth, 'synth-dual.pdf'));
  print('synth-dual (doppio profilo, numeri centrati, colonne affiancate)', r);
  eq(names(r), ['WARDEN TROOPER', 'WARDEN GUNNER'], 'dual: operativi');
  TROOPER(r, 'dual'); GUNNER(r, 'dual'); factionChecks(r, 'dual');
  eq(r.warnings.length, 0, 'dual: zero avvisi');
  const g = weaponGroups(r.operatives);
  eq(g.filter((x) => x.name === 'Scatter carbine').map((x) => x.mode), ['short range', 'long range'], 'dual: due gruppi per lo stesso nome con modo diverso');
}
// italiano
{
  const { result: r } = await load(path.join(synth, 'synth-italian.pdf'), 'it');
  print('synth-italian (etichette italiane)', r);
  eq(names(r), ['WARDEN CAPTAIN', 'WARDEN TROOPER'], 'italiano: operativi');
  CAPTAIN(r, 'italiano'); TROOPER(r, 'italiano'); factionChecks(r, 'italiano');
  eq(r.warnings.length, 0, 'italiano: zero avvisi');
  const wrong = await load(path.join(synth, 'synth-italian.pdf'), 'en');
  ok(wrong.result.operatives.length === 0 && wrong.result.warnings.some((w) => w.code === 'no-operatives'), 'italiano letto come inglese: nessun operativo e avviso, nessun valore inventato');
}
// varianti di layout
{
  const { result: r } = await load(path.join(synth, 'synth-variants.pdf'));
  print('synth-variants (nome sulla linea dei valori, tabella senza spazio, titoli su riga propria, griglia 2x2)', r);
  eq(names(r), ['WARDEN CAPTAIN', 'WARDEN SHIELDBEARER', 'WARDEN TROOPER', 'WARDEN GUNNER'], 'varianti: operativi');
  CAPTAIN(r, 'varianti'); SHIELD(r, 'varianti'); TROOPER(r, 'varianti'); GUNNER(r, 'varianti'); factionChecks(r, 'varianti');
  eq(r.warnings.length, 0, 'varianti: zero avvisi');
}
// errori voluti: devono produrre avvisi e MAI valori inventati
{
  const { result: r } = await load(path.join(synth, 'synth-broken.pdf'));
  print('synth-broken (errori voluti)', r);
  const scout = op(r, 'WARDEN SCOUT'), medic = op(r, 'WARDEN MEDIC');
  eq(scout.weapons.map((w) => w.name), ['Sling', '', 'Knife'], 'broken: armi lette, anche con nome mancante');
  eq(scout.weapons[0].suspect, ['hit'], 'broken: HIT non valido segnalato come dubbio');
  eq(scout.weapons[0].hit, 'x', 'broken: HIT non valido conservato cosi\' com\'e\', non corretto');
  eq(scout.weapons[1].suspect, ['name'], 'broken: nome mancante segnalato');
  eq(medic.stats, { apl: null, move: null, save: null, wounds: null }, 'broken: statistiche mancanti restano null');
  const codes = r.warnings.map((w) => w.code);
  for (const c of ['weapon-format', 'weapon-name', 'stat-missing', 'no-faction-rule', 'no-strategy', 'no-firefight', 'no-equipment']) ok(codes.includes(c), `broken: avviso ${c}`);
  ok(r.warnings.every((w) => w.message), 'broken: ogni avviso ha un messaggio');
}

// riquadri per i ritagli: dentro la pagina, con altezza e larghezza positive, ordinati
{
  const { result: r, pages } = await load(path.join(synth, 'synth-variants.pdf'));
  for (const o of r.operatives) {
    const pg = pages[o.boxes.header.page - 1];
    const inside = (b) => b.x >= -1 && b.y >= -1 && b.x + b.w <= pg.width + 1 && b.y + b.h <= pg.height + 1 && b.w > 20 && b.h > 5;
    ok(inside(o.boxes.header), `riquadri: intestazione di ${o.name}`);
    for (const w of o.weapons) {
      const pgw = pages[w.box.row.page - 1];
      ok(w.box.row.y >= w.box.header.y + w.box.header.h - 1 && w.box.row.x + w.box.row.w <= pgw.width + 1 && w.box.row.h > 5 && w.box.row.w > 20, `riquadri: riga ${w.name} di ${o.name}`);
    }
  }
}

// ---------- 2. PDF veri (tests/fixtures, non committati) ----------
const real = path.join(here, 'fixtures');
const realFiles = fs.existsSync(real) ? fs.readdirSync(real).filter((f) => /\.pdf$/i.test(f)) : [];
if (!realFiles.length) console.log('\n[!] tests/fixtures/ non contiene PDF veri: la verifica sul formato Games Workshop reale NON e\' stata eseguita.');
for (const f of realFiles) {
  const expFile = path.join(real, f.replace(/\.pdf$/i, '.expect.json'));
  const exp = fs.existsSync(expFile) ? JSON.parse(fs.readFileSync(expFile, 'utf8')) : null;
  const { result: r } = await load(path.join(real, f), (exp && exp.lang) || 'en');
  print(`REALE ${f}`, r);
  if (exp) {
    if (exp.operatives) eq(r.operatives.map((o) => [o.name, o.weapons.length]), exp.operatives.map((o) => [o.name, o.weapons]), `${f}: operativi e numero di armi`);
    if (exp.warnings != null) eq(r.warnings.length, exp.warnings, `${f}: numero di avvisi`);
  } else console.log('  (nessun .expect.json: confronta a occhio con pdftoppm)');
}

// Regressione: riga che finisce con i pollici (3") + parola chiave in grassetto a inizio riga = stessa frase, non un nuovo titolo.
{
  const t = (str, x, y, bold = false, h = 8) => ({ str, x, y, w: str.length * 4, h, font: bold ? 'F-Bold' : 'F', bold });
  const items = [
    t('TESTUNIT', 40, 60, true, 20), t('APL', 40, 80), t('MOVE', 100, 80), t('SAVE', 160, 80), t('WOUNDS', 220, 80),
    t('2', 42, 94, true, 12), t('6"', 102, 94, true, 12), t('5+', 162, 94, true, 12), t('8', 222, 94, true, 12),
    t('Field Thing', 40, 120, true), t('Whenever a friendly operative within 3"', 40, 132),
    t('BEACON', 40, 144, true), t(') would be incapacitated, you can use this.', 70, 144),
    t('Second Thing', 40, 160, true), t('Does something else.', 110, 160)
  ];
  const ab = parseTeam([{ num: 1, width: 400, height: 600, items, images: [] }], { title: 'X' }).operatives[0].abilities;
  eq(ab.map((a) => a.name), ['Field Thing', 'Second Thing'], 'inline: titoli abilita\'');
  ok(/within 3" BEACON \) would be incapacitated/.test(ab[0].text), 'inline: la frase resta intera');
}

// Regressione dal primo PDF vero: titoli NON riconosciuti come grassetto, riga parole chiave con base (28), "OTHER SIDE".
{
  const t = (str, x, y, bold = false, h = 8) => ({ str, x, y, w: str.length * 4, h, font: bold ? 'F-Bold' : 'F', bold });
  const items = [
    t('TESTUNIT', 40, 60, true, 20), t('APL', 40, 80), t('MOVE', 100, 80), t('SAVE', 160, 80), t('WOUNDS', 220, 80),
    t('2', 42, 94, true, 12), t('6"', 102, 94, true, 12), t('5+', 162, 94, true, 12), t('8', 222, 94, true, 12),
    t('Warrior Instincts: Whenever this operative is shooting, if you', 40, 120),
    t("don't spend points during that sequence.", 40, 132),
    t('Evasive Drone: AERIAL GUIDANCE', 40, 158), t('1AP', 160, 158),
    t('This operative cannot perform any actions.', 40, 170),
    t('RULES CONTINUE ON OTHER SIDE', 40, 184, true),
    t('TESTFACTION , OTHER EMPIRE, TESTUNIT 28', 40, 198, true)
  ];
  const r = parseTeam([{ num: 1, width: 400, height: 600, items, images: [] }], { title: 'X' });
  const o = r.operatives[0];
  eq(o.abilities.map((a) => a.name), ['Warrior Instincts'], 'senza grassetto: abilita\'');
  eq(o.actions.map((a) => `${a.name} ${a.cost}`), ['Evasive Drone: AERIAL GUIDANCE 1AP'], 'senza grassetto: azione con costo');
  eq(o.keywords, ['TESTFACTION', 'OTHER EMPIRE', 'TESTUNIT'], 'parole chiave senza la base');
  ok(o.continues, '"OTHER SIDE" riconosciuto come continua');
  ok(!r.warnings.some((w) => ['orphan-text', 'empty-block'].includes(w.code)), 'nessun avviso di testo non attribuito o blocco vuoto');
}

// Regressione dal secondo giro sul PDF vero: font "-BdCn", abilita' su due colonne, fogli di carte regola 2x2 con regola in piu' carte.
{
  ok(isBoldName('ZZ+TradeGothicNextLTPro-BdCn') && isBoldName('X-Bd') && !isBoldName('X-Cn') && !isBoldName('X-Rg'), 'isBoldName: -BdCn è grassetto');
  const t = (str, x, y, bold = false, h = 8, w = null) => ({ str, x, y, w: w ?? str.length * 3.5, h, font: bold ? 'F-Bold' : 'F', bold });
  const head = [t('TESTUNIT', 40, 60, true, 20), t('APL', 40, 80), t('MOVE', 100, 80), t('SAVE', 160, 80), t('WOUNDS', 220, 80),
    t('2', 42, 94, true, 12), t('6"', 102, 94, true, 12), t('5+', 162, 94, true, 12), t('8', 222, 94, true, 12)];
  // due colonne: sinistra x=40..140, destra x=170..270, stesse righe
  const two = [...head,
    t('Left Thing: first words of the left', 40, 120, false, 8, 100), t('rule text goes on here a bit', 40, 130, false, 8, 100), t('and ends here.', 40, 140, false, 8, 60),
    t('Right Thing: other words on the right', 170, 120, false, 8, 100), t('side with more text on it now', 170, 130, false, 8, 100), t('and ends there too.', 170, 140, false, 8, 60)];
  const r2 = parseTeam([{ num: 1, width: 400, height: 600, items: two, images: [] }], { title: 'X' }).operatives[0];
  eq(r2.abilities.map((a) => a.name), ['Left Thing', 'Right Thing'], 'due colonne: titoli');
  ok(!/Right/.test(r2.abilities[0].text) && !/Left/.test(r2.abilities[1].text), 'due colonne: testi non mescolati');
  // foglio 2x2: carta 1/2 a sinistra con "continua", retro senza etichetta a destra, carta 2/2 sotto
  const img = (x, y) => ({ x, y, w: 217, h: 362 });
  const cell = (x0, y0, label, name, lines) => [t('TESTUNIT', x0, y0 + 20, true, 12), t(label, x0 + 5, y0 + 40, false, 20), t(name, x0, y0 + 60, false, 14),
    ...lines.map((l, k) => t(l, x0, y0 + 80 + 11 * k, false, 8.5, 150))];
  const sheet = { num: 5, width: 595, height: 841, images: [img(90, 60), img(288, 60), img(90, 410), img(288, 410)], items: [
    ...cell(107, 90, 'FACTION RULE', 'BIG RULE (CARD 1/2)', ['First part of the rule.', 'RULE CONTINUES ON OTHER SIDE']),
    ...[t('Back side of the first card.', 306, 100, false, 8.5, 120)],
    ...cell(107, 440, 'FACTION RULE', 'BIG RULE (CARD 2/2)', ['Last part of the rule.']),
    ...cell(306, 440, 'STRATEGY PLOY', 'SMALL PLOY', ['Flavor text here', 'in two lines.', 'Do the thing now.'].map((x) => x))
  ] };
  const r3 = parseTeam([{ num: 1, width: 400, height: 600, items: two, images: [] }, sheet], { title: 'X' });
  eq(r3.factionRule.map((f) => f.name), ['BIG RULE'], 'foglio: carte 1/2 e 2/2 unite');
  eq(r3.factionRule[0].text, 'First part of the rule. Back side of the first card. Last part of the rule.', 'foglio: testo unito in ordine, con il retro');
  eq(r3.ploys.map((p) => `${p.kind}:${p.name}`), ['strategy:SMALL PLOY'], 'foglio: stratagemma in cella separata');
}

console.log(`\n${checks - fails}/${checks} controlli superati${fails ? `, ${fails} FALLITI` : ''}.`);
process.exit(fails ? 1 : 0);
