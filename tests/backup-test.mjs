// Prova della parte pura del Passo 12 (js/backuplib.js): formato, Blob <-> segnaposto, controlli, ZIP, regola dell'avviso.
//   npm i --no-save jszip   (una volta)   poi   node tests/backup-test.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import * as L from '../js/backuplib.js';

const require = createRequire(import.meta.url);
const JSZip = require('jszip');

let ok = 0;
const fails = [];
function check(cond, msg) { if (cond) ok++; else { fails.push(msg); console.log('  FAIL ' + msg); } }
async function rejects(fn, re, msg) {
  try { await fn(); check(false, msg + ' (non ha lanciato)'); }
  catch (e) { check(e instanceof L.BackupError && re.test(e.message), `${msg}: ${e.message}`); }
}

const png = (n) => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, n, n + 1, n + 2, 0, 255])], { type: 'image/png' });
const bytes = async (b) => Buffer.from(await b.arrayBuffer());

function sample() {
  return {
    games: [{ id: 1, name: 'Kill Team', labels: { faction: 'Squadra', unit: 'Operativo', weapon: 'Arma', turn: 'Turning Point' }, order: 0, fav: 0 }],
    factions: [{ id: 2, gameId: 1, name: 'Exaction Squad' }],
    units: [{ id: 5, factionId: 2, gameId: 1, name: 'Sergeant', imageId: 10, fav: 1, lastUsed: 1700000000000, stats: { apl: '2', move: '6"', save: '3+', wounds: '14' } }],
    weapons: [{ id: 7, factionId: 2, unitIds: [5, 9], name: 'Bolt rifle', imageId: 11 }],
    actions: [{ id: 3, gameId: null, name: 'Dash', mode: 'generated', imageId: null }],
    images: [
      { id: 10, kind: 'unit', blob: png(1), width: 300, height: 300, thumb: png(20), createdAt: 1 },
      { id: 11, kind: 'weapon', blob: png(2), width: 900, height: 160, thumb: null, createdAt: 2 }
    ],
    cards: [],
    templates: [{ id: 1, name: 'Attivazione', kind: 'activation', config: { width: 1080, lines: [{ source: 'unit' }] } }, { id: 4, name: 'Risultato', kind: 'result', config: {} }],
    fonts: [{ id: 3, family: 'Anton', blob: new Blob([new Uint8Array([0, 1, 0, 0, 7, 7])], { type: 'font/woff2' }), format: 'woff2' }],
    rules: [{ id: 1, factionId: 2, kind: 'equipment', name: 'Ammo', text: 'x' }],
    matches: [{ id: 1, gameId: 1, name: 'Partita 1', status: 'done', dismissed: [3] }],
    matchUnits: [{ id: 1, matchId: 1, side: 0, name: 'Sergeant', maxWounds: 14 }],
    matchEvents: [{ id: 1, matchId: 1, seq: 1, type: 'damage', data: { amount: 3, woundsLeft: 11, dice: { text: '3 contro 5' } } }],
    queue: [{ id: 2, key: 'm1-e1', name: 'BR_p_001.png', label: 'x', blob: png(3), createdAt: 5 }, { id: 9, key: 'rnd', name: 'b.png', label: '', blob: png(4), createdAt: 6 }],
    recents: [{ id: 1, key: 'u5-w7-t1', unitId: 5, weaponId: 7, actionId: null, templateId: 1, usedAt: 9 }],
    settings: [
      { key: 'seeded', value: 1 },
      { key: 'defaultTemplates', value: { activation: 1, result: 4 } },
      { key: 'iconTemplates', value: { 1: { ranged: png(30), melee: png(31) } } },
      { key: 'dirHandle', value: { cannotSerialize: true } },
      { key: 'lastBackupAt', value: 5 }
    ]
  };
}

// ---- nomi ----
check(L.backupFilename(new Date(2026, 10, 23, 13, 5)) === 'BR_backup_20261123.zip', 'nome file BR_backup_AAAAMMGG.zip');
check(L.backupFilename(new Date(2026, 0, 2), 'X') === 'X_20260102.zip', 'prefisso personalizzato');
check(L.extFor(new Blob([], { type: 'image/jpeg' }), {}) === 'jpg' && L.extFor(new Blob([], { type: 'font/ttf' }), { format: 'otf' }) === 'otf' && L.extFor(new Blob([], { type: '' }), {}) === 'bin', 'estensioni');

// ---- pack: Blob -> segnaposto, percorsi ----
const t0 = sample();
const packed = L.packTables(t0);
const paths = [...packed.files.keys()].sort();
check(JSON.stringify(paths) === JSON.stringify(['fonts/3.woff2', 'images/10-thumb.png', 'images/10.png', 'images/11.png', 'queue/2.png', 'queue/9.png',
  'settings/iconTemplates-value-1-melee.png', 'settings/iconTemplates-value-1-ranged.png']), 'percorsi dei file: ' + paths.join(', '));
check(packed.tables.images[0].blob.$blob === 'images/10.png' && packed.tables.images[0].blob.type === 'image/png', 'segnaposto del blob');
check(packed.tables.images[1].thumb === null, 'campo null resta null');
check(!JSON.stringify(packed.tables).includes('cannotSerialize') && !packed.tables.settings.some((r) => r.key === 'dirHandle'), 'dirHandle non salvato');
check(packed.tables.units[0].stats.wounds === '14' && packed.tables.weapons[0].unitIds.join() === '5,9', 'dati annidati e array invariati');
check(JSON.stringify(L.blobPaths(packed.tables).sort()) === JSON.stringify(paths), 'blobPaths = file scritti');
check(t0.images[0].blob instanceof Blob, 'l\'originale non e\' modificato');

// ---- ZIP: giro completo, byte identici ----
const built = await L.buildZip(JSZip, { tables: sample(), schemaVersion: 4, exportedAt: new Date('2026-11-23T12:00:00Z') });
check(built.blob instanceof Blob && built.blob.type === 'application/zip' && built.files === 8, `zip creato (${built.files} file, ${built.blob.size} byte)`);
check(built.manifest.app === 'sticker-br' && built.manifest.schemaVersion === 4 && built.manifest.exportedAt === '2026-11-23T12:00:00.000Z', 'intestazione di data.json');
check(built.manifest.counts.images === 2 && built.manifest.counts.queue === 2 && built.manifest.counts.settings === 4, 'conteggi: ' + JSON.stringify(built.manifest.counts));
const zipCheck = await JSZip.loadAsync(await built.blob.arrayBuffer());
check(zipCheck.file('data.json') && zipCheck.file('images/10.png') && zipCheck.file('fonts/3.woff2') && zipCheck.file('queue/2.png'), 'data.json e cartelle images/fonts/queue nello zip');
check(zipCheck.files['images/10.png']._data.compressedSize === zipCheck.files['images/10.png']._data.uncompressedSize, 'i file binari non sono ricompressi (STORE)');

const parsed = await L.parseZip(JSZip, built.blob, { supportedSchema: 4 });
const orig = sample();
let same = true;
for (const k of ['images', 'fonts', 'queue']) {
  for (let i = 0; i < orig[k].length; i++) {
    const a = await bytes(orig[k][i].blob), b = await bytes(parsed.tables[k][i].blob);
    if (!a.equals(b) || orig[k][i].blob.type !== parsed.tables[k][i].blob.type) same = false;
  }
}
check(same, 'immagini, font e coda tornano identici byte per byte (e col loro tipo)');
check((await bytes(parsed.tables.images[0].thumb)).equals(await bytes(orig.images[0].blob).then(() => bytes(png(20)))), 'anche la miniatura (thumb)');
const ic = parsed.tables.settings.find((r) => r.key === 'iconTemplates').value;
check(ic['1'].ranged instanceof Blob && (await bytes(ic['1'].ranged)).equals(await bytes(png(30))), 'Blob dentro settings (icone di riconoscimento)');
// tutto il resto uguale, a parte i Blob e dirHandle
const strip = (t) => JSON.stringify(Object.fromEntries(Object.entries(t).map(([n, rows]) => [n, rows.map((r) => JSON.parse(JSON.stringify(r)))])));
const origNoBlob = sample(); origNoBlob.settings = origNoBlob.settings.filter((r) => r.key !== 'dirHandle');
const flat = (t) => JSON.stringify(t, (k, v) => (v instanceof Blob ? '<blob>' : v));
check(flat(parsed.tables) === flat(origNoBlob), 'tutte le righe uguali all\'originale (id compresi), tranne dirHandle');
check(parsed.counts.units === 1 && parsed.counts.matchEvents === 1 && parsed.warnings.length === 0, 'riepilogo e nessun avviso');
check(L.summaryLines(parsed.counts).join(', ') === '1 giochi, 1 fazioni, 1 miniature, 1 armi, 1 azioni, 2 immagini, 2 template, 1 font, 1 regole, 1 partite, 2 sticker in coda', 'righe di riepilogo: ' + L.summaryLines(parsed.counts).join(', '));
void strip;

// ---- schemi piu' vecchi: tabelle assenti = vuote ----
{
  const z = new JSZip();
  z.file('data.json', JSON.stringify({ app: 'sticker-br', schemaVersion: 2, exportedAt: '2026-01-01T00:00:00Z', tables: { games: [{ id: 1, name: 'A' }], settings: [{ key: 'seeded', value: 1 }] } }));
  const p = await L.parseZip(JSZip, await z.generateAsync({ type: 'arraybuffer' }), { supportedSchema: 4 });
  check(p.tables.queue.length === 0 && p.tables.matches.length === 0 && p.tables.games.length === 1, 'backup di schema 2: tabelle mancanti vuote');
}

// ---- file non validi: errore, mai altro ----
async function zipOf(files) { const z = new JSZip(); for (const [k, v] of Object.entries(files)) z.file(k, v); return z.generateAsync({ type: 'arraybuffer' }); }
const man = (o) => JSON.stringify({ app: 'sticker-br', schemaVersion: 4, exportedAt: '2026-01-01T00:00:00Z', tables: {}, ...o });
await rejects(() => L.parseZip(JSZip, new TextEncoder().encode('questo non e\' uno zip'), { supportedSchema: 4 }), /zip valido/, 'non e\' uno zip');
await rejects(() => L.parseZip(JSZip, new Uint8Array(0), { supportedSchema: 4 }), /zip valido/, 'file vuoto');
await rejects(async () => L.parseZip(JSZip, await zipOf({ 'altro.txt': 'x' }), { supportedSchema: 4 }), /manca data\.json/, 'zip senza data.json');
await rejects(async () => L.parseZip(JSZip, await zipOf({ 'data.json': '{rotto' }), { supportedSchema: 4 }), /non è leggibile/, 'data.json rotto');
await rejects(async () => L.parseZip(JSZip, await zipOf({ 'data.json': man({ app: 'altra-app' }) }), { supportedSchema: 4 }), /app diversa/, 'app diversa');
await rejects(async () => L.parseZip(JSZip, await zipOf({ 'data.json': JSON.stringify({ schemaVersion: 4, tables: {} }) }), { supportedSchema: 4 }), /app diversa/, 'senza campo app');
await rejects(async () => L.parseZip(JSZip, await zipOf({ 'data.json': man({ schemaVersion: 9 }) }), { supportedSchema: 4 }), /più recente/, 'schema piu\' recente');
await rejects(async () => L.parseZip(JSZip, await zipOf({ 'data.json': man({ schemaVersion: 'x' }) }), { supportedSchema: 4 }), /versione dello schema/, 'schema non numerico');
await rejects(async () => L.parseZip(JSZip, await zipOf({ 'data.json': man({ tables: null }) }), { supportedSchema: 4 }), /senza tabelle/, 'tables nullo');
await rejects(async () => L.parseZip(JSZip, await zipOf({ 'data.json': man({ tables: { pippo: [] } }) }), { supportedSchema: 4 }), /tabella sconosciuta/, 'tabella sconosciuta');
await rejects(async () => L.parseZip(JSZip, await zipOf({ 'data.json': man({ tables: { games: {} } }) }), { supportedSchema: 4 }), /non valida/, 'tabella non array');
await rejects(async () => L.parseZip(JSZip, await zipOf({ 'data.json': man({ tables: { games: [{ name: 'senza id' }] } }) }), { supportedSchema: 4 }), /senza id valido/, 'riga senza id');
await rejects(async () => L.parseZip(JSZip, await zipOf({ 'data.json': man({ tables: { games: [{ id: 1.5 }] } }) }), { supportedSchema: 4 }), /senza id valido/, 'id non intero');
await rejects(async () => L.parseZip(JSZip, await zipOf({ 'data.json': man({ tables: { games: [{ id: 1 }, { id: 1 }] } }) }), { supportedSchema: 4 }), /ripetuto/, 'id ripetuto');
await rejects(async () => L.parseZip(JSZip, await zipOf({ 'data.json': man({ tables: { settings: [{ value: 1 }] } }) }), { supportedSchema: 4 }), /senza key valido/, 'settings senza key');
await rejects(async () => L.parseZip(JSZip, await zipOf({ 'data.json': man({ tables: { queue: [{ id: 1, key: 'a' }, { id: 2, key: 'a' }] } }) }), { supportedSchema: 4 }), /key "a" ripetuto/, 'chiave unica della coda ripetuta');
await rejects(async () => L.parseZip(JSZip, await zipOf({ 'data.json': man({ tables: { recents: [{ id: 1 }] } }) }), { supportedSchema: 4 }), /senza key/, 'recents senza key');
await rejects(async () => L.parseZip(JSZip, await zipOf({ 'data.json': man({ tables: { images: [{ id: 1, blob: { $blob: 'images/1.png', type: 'image/png' } }] } }) }), { supportedSchema: 4 }), /manca il file images\/1\.png/, 'file citato ma assente');
await rejects(async () => L.parseZip(JSZip, await zipOf({ 'data.json': man({ tables: { games: [1, 2] } }) }), { supportedSchema: 4 }), /riga 1 non valida/, 'riga non oggetto');
await rejects(async () => L.parseZip(JSZip, await zipOf({ 'data.json': '[]' }), { supportedSchema: 4 }), /data\.json non valido/, 'data.json non oggetto');

// zip troncato (backup scaricato a meta')
{
  const arr = new Uint8Array(await built.blob.arrayBuffer());
  await rejects(() => L.parseZip(JSZip, arr.slice(0, Math.floor(arr.length / 2)), { supportedSchema: 4 }), /./, 'zip troncato');
}
// un campo che usa il nome riservato non si salva (si perderebbe al ripristino)
{
  const bad = sample(); bad.games[0].extra = { $blob: 'x' };
  await rejects(() => L.buildZip(JSZip, { tables: bad, schemaVersion: 4 }), /riservato/, 'campo $blob riservato');
}
// avvisi di coerenza: immagine citata e assente (non blocca)
{
  const t = sample(); t.images = [];
  const p = await L.parseZip(JSZip, (await L.buildZip(JSZip, { tables: t, schemaVersion: 4 })).blob, { supportedSchema: 4 });
  check(p.warnings.length === 1 && /2 immagini citate ma assenti/.test(p.warnings[0]), 'avviso immagini mancanti: ' + p.warnings.join());
}

// ---- regola dell'avviso (decisione 23/11/2026) ----
const DAY = 86400000, NOW = Date.UTC(2026, 10, 23, 12);
const W = (s) => L.backupWarning(s, NOW);
check(W({}) === null && W(null) === null, 'nessun dato registrato: nessun avviso');
check(W({ lastBackupAt: NOW - 20 * DAY, lastChangeAt: null }) === null, 'backup vecchio ma nessuna modifica registrata: nessun avviso');
check(W({ lastBackupAt: NOW - 20 * DAY, lastChangeAt: NOW - 25 * DAY }) === null, 'ultima modifica PRIMA del backup: nessun avviso');
check(W({ lastBackupAt: NOW - 20 * DAY, lastChangeAt: NOW - 20 * DAY }) === null, 'modifica nello stesso istante del backup: nessun avviso');
const w1 = W({ lastBackupAt: NOW - 20 * DAY, lastChangeAt: NOW - 19 * DAY });
check(w1 && w1.kind === 'old' && w1.days === 20, 'backup di 20 giorni + modifiche dopo: avviso: ' + JSON.stringify(w1));
check(W({ lastBackupAt: NOW - 13 * DAY, lastChangeAt: NOW - 1 * DAY }) === null, '13 giorni: ancora niente');
check(W({ lastBackupAt: NOW - 14 * DAY, lastChangeAt: NOW - 1 * DAY })?.days === 14, '14 giorni esatti: avviso');
check(W({ lastBackupAt: NOW - 30 * DAY, lastChangeAt: NOW - 29 * DAY + 1000 })?.days === 30, 'grande ritardo');
const w2 = W({ lastBackupAt: null, firstChangeAt: NOW - 15 * DAY, lastChangeAt: NOW - 2 * DAY });
check(w2 && w2.kind === 'never' && w2.days === 15, 'mai fatto un backup, dati da 15 giorni: avviso "never"');
check(W({ lastBackupAt: null, firstChangeAt: NOW - 3 * DAY, lastChangeAt: NOW - 1 * DAY }) === null, 'mai fatto un backup ma dati da 3 giorni: niente');
check(/Non hai ancora fatto nessun backup/.test(L.warningText(w2)) && /20 giorni fa/.test(L.warningText(w1)) && L.warningText(null) === '', 'testi dell\'avviso');
check(L.agoText(null) === 'mai' && /\(oggi\)/.test(L.agoText(NOW - 1000, NOW)) && /\(ieri\)/.test(L.agoText(NOW - DAY, NOW)) && /\(5 giorni fa\)/.test(L.agoText(NOW - 5 * DAY, NOW)), 'agoText');

console.log(`\nbackup-test: ${ok} controlli ok, ${fails.length} falliti`);
if (fails.length) { console.log(fails.map((f) => ' - ' + f).join('\n')); process.exit(1); }
void assert;
