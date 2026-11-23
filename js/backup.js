// Backup e ripristino (Passo 12), parte con database e JSZip. La logica pura (formato, controlli, ZIP, regola dell'avviso)
// sta in js/backuplib.js. JSZip (vendor/jszip.min.js) si carica solo quando serve.

import * as D from './db.js';
import * as L from './backuplib.js';
import { saveBlob, shareBlobs, timestamp } from './export.js';

export { BackupError, backupWarning, warningText, agoText, summaryLines, backupFilename } from './backuplib.js';

// ---------- JSZip ----------

let jszipPromise = null;
export function loadJSZip() {
  if (globalThis.JSZip) return Promise.resolve(globalThis.JSZip);
  if (!jszipPromise) {
    jszipPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL('../vendor/jszip.min.js', import.meta.url).href;
      s.onload = () => (globalThis.JSZip ? resolve(globalThis.JSZip) : reject(new Error('JSZip non disponibile')));
      s.onerror = () => { jszipPromise = null; reject(new Error('Impossibile caricare vendor/jszip.min.js')); };
      document.head.appendChild(s);
    });
  }
  return jszipPromise;
}

// ---------- esportazione ----------

// Legge TUTTE le tabelle in una sola transazione di sola lettura (istantanea coerente).
export async function readAllTables() {
  await D.ready();
  const tables = L.TABLE_NAMES.map((n) => D.db[n]);
  const out = {};
  await D.db.transaction('r', tables, async () => {
    for (const n of L.TABLE_NAMES) out[n] = await D.db[n].toArray();
  });
  return out;
}

// Costruisce lo zip dei dati attuali. Non salva nulla e non tocca lastBackupAt.
export async function exportBackup({ now = new Date(), prefix } = {}) {
  const [JSZip, tables] = await Promise.all([loadJSZip(), readAllTables()]);
  const r = await L.buildZip(JSZip, { tables, schemaVersion: D.db.verno, exportedAt: now });
  return { blob: r.blob, manifest: r.manifest, counts: r.manifest.counts, files: r.files, exportedAt: now.getTime(),
    filename: L.backupFilename(now, prefix) };
}

async function markBackedUp(ms) {
  await D.setSetting('lastBackupAt', ms);
}

// "Salva backup": costruisce, scarica e ricorda la data (quella dell'istantanea, non quella della fine).
export async function saveBackup() {
  const r = await exportBackup();
  saveBlob(r.blob, r.filename);
  await markBackedUp(r.exportedAt);
  return r;
}

// "Condividi backup": share sheet di Android, altrimenti scarica. Se si annulla non si segna nulla.
export async function shareBackup() {
  const r = await exportBackup();
  const how = await shareBlobs([r.blob], [r.filename]);
  if (how !== 'cancelled') await markBackedUp(r.exportedAt);
  return { ...r, how };
}

// ---------- stato per l'avviso ----------

export async function backupState() {
  await D.ready();
  await D.changeSettled();
  const [lastBackupAt, lastChangeAt, firstChangeAt] = await Promise.all(
    ['lastBackupAt', 'lastChangeAt', 'firstChangeAt'].map((k) => D.getSetting(k, null)));
  return { lastBackupAt, lastChangeAt, firstChangeAt };
}

export async function backupStatus(now = Date.now()) {
  const state = await backupState();
  return { ...state, warning: L.backupWarning(state, now) };
}

// ---------- ripristino ----------

// Legge e controlla il file senza toccare nulla. Lancia BackupError con un messaggio in italiano.
export async function readBackup(file) {
  const JSZip = await loadJSZip();
  return L.parseZip(JSZip, file, { supportedSchema: D.db.verno });
}

// Sostituisce TUTTI i dati con quelli del backup letto da readBackup.
// 1) scarica un backup dei dati attuali (se non riesce, si ferma senza toccare nulla);
// 2) in UNA transazione svuota tutte le tabelle e reimporta le righe con i loro id (ogni errore annulla tutto);
// 3) la data dell'ultimo backup diventa quella del file ripristinato (i dati ora coincidono con lui).
// Dopo il ripristino la schermata va ricaricata (indice di ricerca, font, cache dei template).
export async function restoreBackup(parsed, { autoBackup = true, onStep = () => {} } = {}) {
  await D.ready();
  const { manifest, tables } = parsed;
  let autoName = null;
  if (autoBackup) {
    onStep('auto');
    try {
      const cur = await exportBackup({ now: new Date() });
      autoName = `BR_backup_prima-del-ripristino_${timestamp()}.zip`;
      saveBlob(cur.blob, autoName);
    } catch (err) {
      throw new L.BackupError(`Non riesco a salvare il backup dei dati attuali (${err.message}). Il ripristino è annullato e non è stato toccato nulla.`);
    }
  }
  onStep('restore');
  await D.changeSettled(); // scritture di lastChangeAt gia' avviate: dopo il ripristino non devono sovrascrivere la data
  const exportedMs = Date.parse(manifest.exportedAt) || Date.now();
  const names = L.TABLE_NAMES;
  try {
    await D.withoutChangeTracking(() => D.db.transaction('rw', names.map((n) => D.db[n]), async () => {
      const keep = (await D.db.settings.bulkGet(L.DEVICE_SETTINGS)).filter(Boolean);
      for (const n of names) await D.db[n].clear();
      for (const n of names) {
        let rows = tables[n];
        if (n === 'settings') {
          rows = rows.filter((r) => !L.DEVICE_SETTINGS.includes(r.key) && !['lastBackupAt', 'lastChangeAt'].includes(r.key));
          const first = tables.settings.find((r) => r.key === 'firstChangeAt');
          rows.push({ key: 'lastBackupAt', value: exportedMs }, { key: 'lastChangeAt', value: exportedMs });
          if (!first) rows.push({ key: 'firstChangeAt', value: exportedMs });
          await D.db.settings.bulkPut(rows.concat(keep));
        } else if (rows.length) {
          await D.db[n].bulkAdd(rows); // con la chiave primaria presente mantiene gli id
        }
      }
    }));
  } catch (err) {
    console.error(err);
    throw new L.BackupError(`Ripristino non riuscito: ${err && err.message ? err.message : err}. I dati attuali non sono stati toccati.`);
  }
  return { autoName, counts: parsed.counts };
}
