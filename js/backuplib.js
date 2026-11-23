// Backup e ripristino, parte PURA (Passo 12): nessun accesso al database ne' al DOM, testabile in Node.
// JSZip e' passato come argomento (`JSZip`), cosi' in Node si usa il pacchetto npm e nel browser vendor/jszip.min.js.
//
// Formato del file BR_backup_AAAAMMGG.zip:
//   data.json  = { app: 'sticker-br', schemaVersion, exportedAt (ISO), tables: { <tabella>: [righe] }, counts }
//   <tabella>/<id>.<ext>            Blob del campo `blob` (images/12.png, fonts/3.woff2, queue/7.png)
//   <tabella>/<id>-<campo>.<ext>    altri Blob di una riga (images/12-thumb.png)
//   settings/<chiave>-<percorso>.<ext>  Blob dentro i valori di settings (es. le icone di riconoscimento)
// Nelle righe di data.json ogni Blob e' sostituito da { "$blob": "<percorso nello zip>", "type": "<mime>" }.
// Le carte (`cards`) non si salvano (la tabella resta vuota), ma se ce ne fossero verrebbero incluse allo stesso modo.

export const APP_ID = 'sticker-br';
export const MANIFEST = 'data.json';
export const MARKER = '$blob';

// Tabelle dello schema v4 e loro chiave primaria. Ordine = ordine di scrittura al ripristino.
export const TABLES = [
  ['games', 'id'], ['factions', 'id'], ['units', 'id'], ['weapons', 'id'], ['actions', 'id'], ['images', 'id'],
  ['cards', 'id'], ['templates', 'id'], ['fonts', 'id'], ['rules', 'id'], ['matches', 'id'], ['matchUnits', 'id'],
  ['matchEvents', 'id'], ['queue', 'id'], ['recents', 'id'], ['settings', 'key']
];
export const TABLE_NAMES = TABLES.map((t) => t[0]);
const PK = Object.fromEntries(TABLES);

// Chiavi di settings che non si salvano ne si toccano al ripristino (dipendono dal dispositivo, non sono serializzabili).
export const DEVICE_SETTINGS = ['dirHandle'];
// Campi unici da controllare prima di toccare i dati (indici `&`).
const UNIQUE = { queue: ['key'], recents: ['key'] };

export const DAY_MS = 86400000;
export const BACKUP_WARN_DAYS = 14;

export class BackupError extends Error {
  constructor(message) { super(message); this.name = 'BackupError'; }
}

const isBlob = (v) => typeof Blob !== 'undefined' && v instanceof Blob;
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !isBlob(v);

// ---------- nomi dei file ----------

const MIME_EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'font/ttf': 'ttf', 'font/otf': 'otf', 'font/woff': 'woff', 'font/woff2': 'woff2',
  'application/font-woff': 'woff', 'application/font-woff2': 'woff2', 'application/x-font-ttf': 'ttf', 'application/x-font-opentype': 'otf'
};

export function extFor(blob, row) {
  if (row && typeof row.format === 'string' && /^[a-z0-9]{2,5}$/i.test(row.format)) return row.format.toLowerCase();
  return MIME_EXT[blob.type] || 'bin';
}

const safe = (s) => String(s).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 60) || 'x';

// Nome di backup: BR_backup_AAAAMMGG.zip (ora locale).
export function backupFilename(d = new Date(), prefix = 'BR_backup') {
  const p = (n) => String(n).padStart(2, '0');
  return `${prefix}_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.zip`;
}

// ---------- Blob <-> segnaposto ----------

// Copia `value` sostituendo ogni Blob con un segnaposto e registrando il file con addFile(path, blob).
// `base` = percorso del file senza estensione. Percorsi diversi per Blob diversi della stessa riga.
function packValue(value, base, row, addFile) {
  if (isBlob(value)) {
    const path = `${base}.${extFor(value, row)}`;
    addFile(path, value);
    return { [MARKER]: path, type: value.type || '' };
  }
  if (Array.isArray(value)) return value.map((v, i) => packValue(v, `${base}-${i}`, row, addFile));
  if (isPlain(value)) {
    if (MARKER in value) throw new BackupError('Dati non salvabili: un campo usa il nome riservato $blob');
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = packValue(v, `${base}-${safe(k)}`, row, addFile);
    return out;
  }
  if (typeof value === 'function' || typeof value === 'symbol') throw new BackupError('Dati non salvabili (funzione o simbolo)');
  return value;
}

// tables: { nome: [righe con Blob] } -> { tables: { nome: [righe JSON] }, files: Map(percorso -> Blob) }
export function packTables(tables) {
  const files = new Map();
  const addFile = (path, blob) => {
    if (files.has(path)) throw new BackupError(`Due file con lo stesso percorso: ${path}`);
    files.set(path, blob);
  };
  const out = {};
  for (const [name, pk] of TABLES) {
    let rows = tables[name] || [];
    if (name === 'settings') rows = rows.filter((r) => !DEVICE_SETTINGS.includes(r.key));
    out[name] = rows.map((row) => {
      const id = row[pk];
      const o = {};
      for (const [k, v] of Object.entries(row)) {
        // blob e' il campo principale: <tabella>/<id>.<ext>; gli altri aggiungono -<campo>; settings usa chiave-percorso
        const base = name === 'settings' ? `settings/${safe(id)}-${safe(k)}`
          : (k === 'blob' ? `${name}/${safe(id)}` : `${name}/${safe(id)}-${safe(k)}`);
        o[k] = packValue(v, base, row, addFile);
      }
      return o;
    });
  }
  return { tables: out, files };
}

// Percorsi dei file citati da data.json.
export function blobPaths(tables) {
  const paths = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (isPlain(v)) {
      if (MARKER in v) paths.push(v[MARKER]);
      else Object.values(v).forEach(walk);
    }
  };
  for (const rows of Object.values(tables)) walk(rows);
  return paths;
}

// Rimette i Blob al posto dei segnaposto. getBlob(path, type) -> Promise<Blob>.
export async function unpackTables(tables, getBlob) {
  const walk = async (v) => {
    if (Array.isArray(v)) return Promise.all(v.map(walk));
    if (isPlain(v)) {
      if (MARKER in v) return getBlob(v[MARKER], v.type || '');
      const out = {};
      for (const [k, x] of Object.entries(v)) out[k] = await walk(x);
      return out;
    }
    return v;
  };
  const out = {};
  for (const name of TABLE_NAMES) {
    const rows = tables[name];
    out[name] = Array.isArray(rows) ? await Promise.all(rows.map(walk)) : [];
  }
  return out;
}

// ---------- controllo del file ----------

// Controlla data.json PRIMA di toccare qualsiasi cosa. Restituisce l'oggetto (con tutte le tabelle presenti) o lancia BackupError.
export function validateManifest(m, { supportedSchema }) {
  if (!isPlain(m)) throw new BackupError('Il file non è un backup di Sticker Battle Report (data.json non valido).');
  if (m.app !== APP_ID) throw new BackupError('Il file non è un backup di Sticker Battle Report (app diversa).');
  if (!Number.isInteger(m.schemaVersion) || m.schemaVersion < 1) throw new BackupError('Backup senza versione dello schema valida.');
  if (m.schemaVersion > supportedSchema) {
    throw new BackupError(`Backup creato da una versione più recente dell'app (schema ${m.schemaVersion}, questa app arriva a ${supportedSchema}). Aggiorna l'app e riprova.`);
  }
  if (!isPlain(m.tables)) throw new BackupError('Backup senza tabelle.');
  for (const k of Object.keys(m.tables)) {
    if (!PK[k]) throw new BackupError(`Backup con una tabella sconosciuta: ${k}.`);
  }
  for (const [name, pk] of TABLES) {
    const rows = m.tables[name];
    if (rows === undefined) continue; // backup di uno schema più vecchio: tabella assente = vuota
    if (!Array.isArray(rows)) throw new BackupError(`Tabella ${name} non valida.`);
    const seen = new Set();
    const uniq = (UNIQUE[name] || []).map((f) => [f, new Set()]);
    rows.forEach((r, i) => {
      if (!isPlain(r)) throw new BackupError(`Tabella ${name}: riga ${i + 1} non valida.`);
      const id = r[pk];
      if (pk === 'id' ? !(Number.isInteger(id) && id > 0) : !(typeof id === 'string' && id)) {
        throw new BackupError(`Tabella ${name}: riga ${i + 1} senza ${pk} valido.`);
      }
      if (seen.has(id)) throw new BackupError(`Tabella ${name}: ${pk} ${id} ripetuto.`);
      seen.add(id);
      for (const [f, set] of uniq) {
        if (typeof r[f] !== 'string' || !r[f]) throw new BackupError(`Tabella ${name}: riga ${i + 1} senza ${f}.`);
        if (set.has(r[f])) throw new BackupError(`Tabella ${name}: ${f} "${r[f]}" ripetuto.`);
        set.add(r[f]);
      }
    });
  }
  return m;
}

// Controlli di coerenza sui riferimenti principali (solo avvisi, non bloccano): restituisce l'elenco dei problemi.
export function referenceWarnings(m) {
  const t = (n) => m.tables[n] || [];
  const ids = (n) => new Set(t(n).map((r) => r.id));
  const images = ids('images');
  const out = [];
  let missing = 0;
  for (const n of ['units', 'weapons', 'actions']) for (const r of t(n)) if (r.imageId != null && !images.has(r.imageId)) missing++;
  if (missing) out.push(`${missing} immagini citate ma assenti`);
  return out;
}

// Conteggi per il riepilogo prima del ripristino (etichette in italiano).
export const SUMMARY_LABELS = [
  ['games', 'giochi'], ['factions', 'fazioni'], ['units', 'miniature'], ['weapons', 'armi'], ['actions', 'azioni'],
  ['images', 'immagini'], ['templates', 'template'], ['fonts', 'font'], ['rules', 'regole'], ['matches', 'partite'],
  ['queue', 'sticker in coda']
];

export function summarize(tables) {
  const counts = {};
  for (const [n] of TABLES) counts[n] = (tables[n] || []).length;
  return counts;
}

export function summaryLines(counts, { skipZero = false } = {}) {
  return SUMMARY_LABELS.filter(([n]) => !skipZero || counts[n]).map(([n, label]) => `${counts[n] ?? 0} ${label}`);
}

// ---------- ZIP ----------

// Costruisce lo zip: data.json compresso, file binari senza ricompressione (i PNG escono identici byte per byte).
export async function buildZip(JSZip, { tables, schemaVersion, exportedAt = new Date() }) {
  const packed = packTables(tables);
  const manifest = {
    app: APP_ID, schemaVersion, exportedAt: exportedAt.toISOString(),
    counts: summarize(packed.tables), tables: packed.tables
  };
  const zip = new JSZip();
  zip.file(MANIFEST, JSON.stringify(manifest), { compression: 'DEFLATE', compressionOptions: { level: 6 } });
  // Blob -> ArrayBuffer: JSZip legge i Blob con FileReader (assente in Node); cosi' i byte sono gli stessi ovunque.
  for (const [path, blob] of packed.files) zip.file(path, await blob.arrayBuffer(), { compression: 'STORE', binary: true });
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/zip', compression: 'STORE' });
  return { blob, manifest, files: packed.files.size };
}

// Legge e controlla uno zip. Non tocca nulla: restituisce { manifest, tables (con Blob), counts } o lancia BackupError.
export async function parseZip(JSZip, data, { supportedSchema }) {
  let zip;
  if (data && typeof data.arrayBuffer === 'function') data = await data.arrayBuffer();
  try { zip = await JSZip.loadAsync(data); } catch { throw new BackupError('Il file non è uno zip valido.'); }
  const entry = zip.file(MANIFEST);
  if (!entry) throw new BackupError('Il file non è un backup di Sticker Battle Report (manca data.json).');
  let manifest;
  try { manifest = JSON.parse(await entry.async('string')); } catch { throw new BackupError('data.json non è leggibile.'); }
  validateManifest(manifest, { supportedSchema });
  for (const p of blobPaths(manifest.tables)) {
    if (typeof p !== 'string' || !zip.file(p)) throw new BackupError(`Nel backup manca il file ${String(p)}.`);
  }
  const tables = await unpackTables(manifest.tables, async (path, type) => {
    const b = await zip.file(path).async('blob');
    return type && b.type !== type ? b.slice(0, b.size, type) : b;
  });
  return { manifest, tables, counts: summarize(tables), warnings: referenceWarnings(manifest) };
}

// ---------- avviso di backup in Crea ----------

// state = { lastBackupAt, lastChangeAt, firstChangeAt } (millisecondi, o null). Restituisce null (nessun avviso)
// oppure { kind: 'never'|'old', days }.
// Regola (decisione 23/11/2026): avviso se ci sono modifiche DOPO l'ultimo backup (o nessun backup mai fatto) e il riferimento
// (ultimo backup, o prima modifica registrata se non c'e' backup) ha piu' di 14 giorni.
export function backupWarning(state, now = Date.now(), days = BACKUP_WARN_DAYS) {
  const { lastBackupAt = null, lastChangeAt = null, firstChangeAt = null } = state || {};
  if (lastChangeAt == null) return null; // nessuna modifica registrata: niente da salvare
  if (lastBackupAt != null && lastChangeAt <= lastBackupAt) return null;
  const ref = lastBackupAt ?? firstChangeAt ?? lastChangeAt;
  const age = Math.floor((now - ref) / DAY_MS);
  if (age < days) return null;
  return { kind: lastBackupAt == null ? 'never' : 'old', days: age };
}

export function warningText(w) {
  if (!w) return '';
  return w.kind === 'never'
    ? `Non hai ancora fatto nessun backup (primi dati da ${w.days} giorni).`
    : `L'ultimo backup è di ${w.days} giorni fa e da allora hai fatto modifiche.`;
}

export function agoText(ms, now = Date.now()) {
  if (ms == null) return 'mai';
  const d = Math.floor((now - ms) / DAY_MS);
  const date = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  const when = `${p(date.getDate())}/${p(date.getMonth() + 1)}/${date.getFullYear()} ${p(date.getHours())}:${p(date.getMinutes())}`;
  return d <= 0 ? `${when} (oggi)` : d === 1 ? `${when} (ieri)` : `${when} (${d} giorni fa)`;
}
