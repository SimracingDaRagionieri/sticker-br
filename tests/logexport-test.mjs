// Prove dell'esportazione del log in PDF (Passo 13): js/pdfwrite.js e js/logexport.js (parti pure) + nome file.
// Il PDF prodotto si RILEGGE con pdf.js e si controlla il testo, pagina per pagina.
//   npm i --no-save pdfjs-dist     (una volta)
//   node tests/logexport-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import * as ML from '../js/matchlog.js';
import * as W from '../js/pdfwrite.js';
import { buildLogPdf, dmy } from '../js/logexport.js';
import { logPdfFilename, fmtBytes } from '../js/export.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let pdfjs;
try {
  const dir = path.dirname(require.resolve('pdfjs-dist/package.json'));
  pdfjs = await import(pathToFileURL(path.join(dir, 'legacy/build/pdf.mjs')).href);
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(dir, 'legacy/build/pdf.worker.mjs')).href;
} catch (e) { console.error('Manca pdfjs-dist: `npm i --no-save pdfjs-dist`'); process.exit(2); }

let fails = 0;
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) fails++; };
const eq = (a, b, msg) => { const ok = JSON.stringify(a) === JSON.stringify(b); check(ok, `${msg}${ok ? '' : '  -> ' + JSON.stringify(a) + ' invece di ' + JSON.stringify(b)}`); };

async function readPdf(bytes) {
  const doc = await pdfjs.getDocument({ data: Uint8Array.from(bytes), verbosity: 0, isEvalSupported: false }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const tc = await (await doc.getPage(n)).getTextContent();
    pages.push(tc.items.map((i) => i.str));
  }
  return { doc, pages, meta: await doc.getMetadata() };
}

// ---------- codifica e misure ----------
eq(W.toWinAnsi('Aèà'), [65, 0xE8, 0xE0], 'toWinAnsi: accenti Latin-1');
eq(W.toWinAnsi('a–b—c…€•'), [97, 0x96, 98, 0x97, 99, 0x85, 0x80, 0x95], 'toWinAnsi: trattini, puntini, euro, punto elenco');
eq(W.toWinAnsi('x中y\n\tz'), [120, 63, 121, 32, 122], 'toWinAnsi: carattere non rappresentabile -> ?, a capo e tab -> spazio');
check(Math.abs(W.textWidth('Hello', 10) - 22.78) < 0.01, 'textWidth Helvetica "Hello" a 10 pt = 22,78');
check(W.textWidth('Hello', 10, true) > W.textWidth('Hello', 10), 'il grassetto e\' piu\' largo');
check(W.textWidth('à', 10) === W.textWidth('a', 10) && W.textWidth('É', 10) === W.textWidth('E', 10), 'lettera accentata = larghezza della lettera base');
const wr = W.wrapText('uno due tre quattro cinque sei sette', 10, false, 60, 40);
check(wr.length >= 3 && wr.every((l, i) => W.textWidth(l, 10) <= (i ? 40 : 60) + 0.01), 'wrapText rispetta prima riga e rientro sospeso: ' + JSON.stringify(wr));
const longWord = W.wrapText('A'.repeat(80), 10, false, 100);
check(longWord.length > 1 && longWord.every((l) => W.textWidth(l, 10) <= 100.01) && longWord.join('') === 'A'.repeat(80), 'una parola piu\' larga della riga si taglia senza perdere lettere');
eq(W.wrapText('', 10, false, 100), [''], 'wrapText di testo vuoto: una riga vuota');

// ---------- struttura del file ----------
{
  const pdf = W.createPdf({ title: 'Prova (1) \\ è', footer: 'piè', date: new Date(2026, 10, 23, 15, 30, 5) });
  pdf.text('Ciao mondo (con parentesi) e \\ backslash, perché è già così: ÀÈÌÒÙ àèìòù €', { size: 12 });
  const bytes = pdf.build();
  const s = Buffer.from(bytes).toString('latin1');
  check(s.startsWith('%PDF-1.4') && s.trimEnd().endsWith('%%EOF'), 'intestazione %PDF-1.4 e %%EOF finale');
  // la tabella xref punta davvero agli oggetti
  const xrefAt = Number(s.match(/startxref\n(\d+)\n/)[1]);
  check(s.slice(xrefAt, xrefAt + 4) === 'xref', 'startxref punta a "xref"');
  const entries = [...s.slice(xrefAt).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
  check(entries.length >= 7 && entries.every((off, i) => s.slice(off, off + String(i + 1).length + 6) === `${i + 1} 0 obj`), `offset xref corretti per ${entries.length} oggetti`);
  const lens = [...s.matchAll(/\/Length (\d+) >>\nstream\n/g)];
  check(lens.every((m) => { const start = m.index + m[0].length; return s.slice(start + Number(m[1]), start + Number(m[1]) + 10) === '\nendstream'; }), '/Length dei flussi coincide');
  const { pages, meta } = await readPdf(bytes);
  const t = pages[0].join('');
  check(t.includes('Ciao mondo (con parentesi) e \\ backslash'), 'parentesi e backslash letti da pdf.js');
  check(t.includes('perché è già così: ÀÈÌÒÙ àèìòù €'), 'accenti ed euro letti da pdf.js');
  check(t.includes('Pagina 1 di 1'), 'piè di pagina "Pagina 1 di 1"');
  check(meta.info.Title === 'Prova (1) \\ è', 'titolo nei metadati: ' + meta.info.Title);
}

// ---------- paginazione ----------
{
  const pdf = W.createPdf({ title: 'Lungo' });
  for (let i = 1; i <= 120; i++) pdf.text(`Riga numero ${i} ` + 'parola '.repeat(i % 7 === 0 ? 40 : 3), { size: 10, indent: 10, hang: 8 });
  const { doc, pages } = await readPdf(pdf.build());
  check(doc.numPages >= 3 && pdf.pageCount === doc.numPages, `120 paragrafi su ${doc.numPages} pagine`);
  const all = pages.map((p) => p.join(' '));
  check([1, 60, 120].every((n) => all.join(' ').includes(`Riga numero ${n} `)), 'prima, metà e ultima riga presenti');
  check(pages.every((p, i) => p.join('').includes(`Pagina ${i + 1} di ${doc.numPages}`)), 'ogni pagina ha "Pagina n di N"');
  const inOrder = [...all.join(' ').matchAll(/Riga numero (\d+) /g)].map((m) => Number(m[1]));
  check(inOrder.every((n, i) => n === i + 1), 'le righe restano in ordine');
}

// ---------- nome file e dimensioni ----------
eq(logPdfFilename('Boss vs Sergeant: è finita!', new Date(2026, 10, 3)), 'BR_log_Boss-vs-Sergeant-e-finita_20261103.pdf', 'nome file: BR_log_<partita>_AAAAMMGG.pdf');
eq(logPdfFilename('', new Date(2026, 0, 9)), 'BR_log_partita_20260109.pdf', 'nome file senza nome partita');
eq([fmtBytes(0), fmtBytes(1023), fmtBytes(1536), fmtBytes(5 * 1024 * 1024), fmtBytes(250 * 1024 * 1024), fmtBytes(null), fmtBytes(-1)], ['0 byte', '1023 byte', '1,5 KB', '5,0 MB', '250 MB', '—', '—'], 'fmtBytes');
eq([dmy(new Date(2026, 10, 23).getTime()), dmy(null)], ['23/11/2026', ''], 'dmy');

// ---------- il log completo ----------
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
const atk2 = E('attack', { unitRef: 1, targetRef: 3, data: { weaponName: 'Chainsword', dice: { text: '3 colpi, 2 parate' } } });
atk2.data.source = null;
const dmg2 = E('damage', { unitRef: 1, targetRef: 3, data: { amount: 9, source: atk2.id } });
const inc = E('incapacitated', { unitRef: 3 });
const sc = E('score', { side: 0, data: { points: 2, reason: 'Obiettivo' } });
const note = E('note', { note: 'Perché è così: nota con (parentesi)' });
const turn2 = E('turn-start', { data: { initiative: { side: 0, how: 'choice' } } });
const act3 = E('activation', { unitRef: 2 });
const atk3 = E('attack', { unitRef: 2, targetRef: 4, data: { weaponName: 'Plasma pistol' } });
const dmg3 = E('damage', { unitRef: 2, targetRef: 4, data: { amount: 3, source: atk3.id } });
const events = [turn1, act1, shoot, atk, dmg, act2, atk2, dmg2, inc, sc, note, turn2, act3, atk3, dmg3];
const match = {
  id: 1, gameName: 'Kill Team', name: 'Finale (è) \\ prova', mission: 'Recupera i dati', status: 'done', turnLabel: 'Turning Point',
  startedAt: new Date(2026, 10, 22, 20, 0).getTime(), endedAt: new Date(2026, 10, 23, 1, 0).getTime(), notes: 'Partita di prova a casa',
  sides: [{ player: 'Manu', factionName: 'Exaction Squad' }, { player: 'Vando', factionName: 'Hearthkyn' }]
};
const rep = ML.replay(units, events);
const sideName = (s) => match.sides[s].player;
const bytes = buildLogPdf(match, units, events, rep, { sideName, now: new Date(2026, 10, 23, 12, 0, 0) });
const { doc, pages, meta } = await readPdf(bytes);
const full = pages.map((p) => p.join(' ')).join('\n');
fs.writeFileSync(path.join(os.tmpdir(), 'sbr-log-test.pdf'), bytes);
console.log(`   (${bytes.length} byte, ${doc.numPages} pagina/e, copia in ${path.join(os.tmpdir(), 'sbr-log-test.pdf')})`);
const squash = (x) => x.replace(/\s+/g, ' ');
const has = (s, msg) => check(squash(full).includes(squash(s)), msg || `contiene «${s}»`);
check(meta.info.Title === 'Finale (è) \\ prova', 'titolo del PDF = nome della partita');
has('Finale (è) \\ prova', 'titolo con parentesi, accento e backslash');
has('Kill Team · Recupera i dati · 22/11/2026 - 23/11/2026', 'sottotitolo: gioco, missione, date');
has('1. Manu (Exaction Squad)'); has('2. Vando (Hearthkyn)');
has('Punti: Manu 2  –  Vando 0', 'punti');
has('Partita di prova a casa', 'note della partita');
has('Rose a fine partita');
has('Sergeant A'); has('6/10 ferite'); has('Gunner A'); has('8/8 ferite');
has('Warrior B'); has('incapacitato', 'operativo incapacitato nelle rose');
has('Custom B'); has('ferite non tracciate', 'riga senza ferite massime');
has('Cronologia');
has('Turning Point 1'); has('Iniziativa: Vando (tiro 3 contro 5)', 'iniziativa con tiro');
has('Turning Point 2'); has('Iniziativa: Manu (scelta)');
has('Warrior B (Vando) attiva', 'attivazione');
has('Warrior B colpisce Sergeant A con Bolt rifle', 'attacco');
has('rimangono 6', 'ferite rimaste dopo il primo danno');
has('Sergeant A colpisce Warrior B con Chainsword [3 colpi, 2 parate]', 'attacco con tiri');
has('Warrior B è incapacitato', 'evento incapacitato');
has('Manu +2 punti (Obiettivo)', 'punti con motivo');
has('Perché è così: nota con (parentesi)', 'nota con accenti e parentesi');
has('Gunner A colpisce Custom B con Plasma pistol: 3 ferite', 'danno a bersaglio senza ferite tracciate');
has('Pagina 1 di');
// ordine: il turno 1 viene prima del turno 2 e le rose prima della cronologia
const ix = (s) => full.indexOf(s);
check(ix('Rose a fine partita') < ix('Cronologia') && ix('Turning Point 1') < ix('Warrior B (Vando) attiva') && ix('Warrior B (Vando) attiva') < ix('Turning Point 2'), 'ordine: rose, cronologia, turno 1, turno 2');
// stesso contenuto del riepilogo testuale
const summ = ML.summarize(match, units, events, rep, { sideName });
const norm = (s) => s.replace(/\s+/g, ' ');
for (const line of summ.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('Finale') && !l.startsWith('Punti:') && !l.startsWith('Turning Point'))) {
  if (!norm(full).includes(norm(line))) check(false, `riga del riepilogo assente dal PDF: «${line}»`);
}
check(true, 'ogni riga del riepilogo testuale e\' anche nel PDF');

// log vuoto, partita in corso, una sola squadra, tanti turni (più pagine)
{
  const m2 = { id: 2, name: '', status: 'live', sides: [{ player: 'A', factionName: '' }, { player: 'B', factionName: '' }], turnLabel: 'Turno', startedAt: Date.now() };
  const { pages: p2 } = await readPdf(buildLogPdf(m2, [], [], ML.replay([], []), { now: new Date() }));
  const t2 = p2.map((p) => p.join(' ')).join(' ');
  check(t2.includes('A vs B') && t2.includes('Nessuna voce registrata.') && t2.includes('partita in corso') && !t2.includes('Rose a fine partita'), 'log vuoto: titolo "A vs B", "Nessuna voce registrata.", in corso, niente rose');

  const evs = [];
  let k = 0;
  const mk = (type, o = {}) => ({ id: 1000 + ++k, matchId: 3, seq: k, type, unitRef: null, targetRef: null, actionId: null, weaponId: null, note: '', data: {}, ...o });
  for (let t = 1; t <= 12; t++) {
    evs.push(mk('turn-start', { data: { initiative: { side: t % 2, how: 'choice' } } }));
    for (let a = 0; a < 6; a++) {
      const act = mk('activation', { unitRef: a % 2 ? 1 : 3 });
      evs.push(act, mk('attack', { unitRef: a % 2 ? 1 : 3, targetRef: a % 2 ? 3 : 1, data: { weaponName: 'Arma ' + a } }));
    }
  }
  const m3 = { ...match, id: 3 };
  const rep3 = ML.replay(units, evs);
  const { doc: d3, pages: p3 } = await readPdf(buildLogPdf(m3, units, evs, rep3, { sideName }));
  const t3 = p3.map((p) => p.join(' ')).join(' ');
  check(d3.numPages >= 3, `12 turni su ${d3.numPages} pagine`);
  check([1, 6, 12].every((t) => t3.includes(`Turning Point ${t}`)), 'primo, sesto e ultimo turno presenti');
  // un titolo di turno non resta solo in fondo a una pagina: la pagina dopo comincia con attivazioni dello stesso turno
  const lastOfPage = p3.slice(0, -1).map((p) => p.filter((x) => x.trim() && !/^Pagina \d+ di \d+$/.test(x.trim())).pop() || '');
  check(lastOfPage.every((l) => !/^Turning Point \d+$/.test(l.trim()) && !/^Iniziativa:/.test(l.trim())), 'nessun titolo di turno orfano a fondo pagina');
}

console.log(fails ? `\n${fails} controlli FALLITI` : '\nTutti i controlli passati');
process.exit(fails ? 1 : 0);
