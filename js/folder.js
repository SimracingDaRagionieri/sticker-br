// Cartella dedicata per gli sticker (Passo 13). Esiste solo se il browser offre showDirectoryPicker (Chrome su Android
// di solito NO: li' l'opzione resta nascosta e si salva in Download). L'handle sta in settings.dirHandle e NON entra
// nel backup (DEVICE_SETTINGS in backuplib.js). Se qualcosa non va (permesso negato, cartella sparita, disco pieno)
// si ripiega sul download e lo si dice. Vale solo per gli sticker PNG: backup e PDF del log vanno sempre in Download.

import * as D from './db.js';
import { saveBlob } from './export.js';

export const folderSupported = () => typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';

export async function getFolder() {
  if (!folderSupported()) return null;
  await D.ready();
  const h = await D.getSetting('dirHandle', null);
  return h && h.kind === 'directory' ? h : null;
}

// Chiede la cartella (serve un tocco dell'utente). Annullando il selettore il browser lancia AbortError: lo si ignora.
export async function chooseFolder() {
  try {
    const h = await window.showDirectoryPicker({ id: 'sbr-sticker', mode: 'readwrite' });
    await D.setSetting('dirHandle', h);
    return h;
  } catch (err) {
    if (err && err.name === 'AbortError') return null;
    throw err;
  }
}

export async function clearFolder() {
  await D.ready();
  await D.db.settings.delete('dirHandle');
}

// true se si puo' scrivere. Con ask=true prova anche requestPermission (serve un tocco recente dell'utente).
export async function hasPermission(h, ask) {
  const opts = { mode: 'readwrite' };
  try {
    if (h.queryPermission && (await h.queryPermission(opts)) === 'granted') return true;
    if (ask && h.requestPermission) return (await h.requestPermission(opts)) === 'granted';
  } catch { /* senza tocco recente requestPermission lancia: si ripiega */ }
  return false;
}

async function writeFile(h, blob, filename) {
  const fh = await h.getFileHandle(filename, { create: true });
  const w = await fh.createWritable();
  try { await w.write(blob); await w.close(); } catch (err) { try { await w.abort(); } catch { /* gia' chiuso */ } throw err; }
}

// Salva uno o piu' sticker: nella cartella se c'e' ed e' scrivibile, altrimenti in Download. `gapMs` = pausa tra un
// download e il successivo (Chrome chiede una volta "download multipli"). Ritorna
// { folder: n nella cartella, download: n in Download, folderName, fellBack: true se la cartella era scelta ma non ha funzionato }.
export async function saveStickers(items, { gapMs = 0 } = {}) {
  const out = { folder: 0, download: 0, folderName: null, fellBack: false };
  let h = null;
  try { h = await getFolder(); } catch { h = null; }
  let useFolder = !!h && (await hasPermission(h, true));
  if (h && !useFolder) out.fellBack = true;
  for (let i = 0; i < items.length; i++) {
    const { blob, name } = items[i];
    if (useFolder) {
      try { await writeFile(h, blob, name); out.folder++; out.folderName = h.name; continue; } catch (err) {
        console.warn('Cartella non scrivibile, ripiego sul download', err);
        useFolder = false; out.fellBack = true;
      }
    }
    if (out.download > 0 && gapMs) await new Promise((r) => setTimeout(r, gapMs));
    saveBlob(blob, name);
    out.download++;
  }
  return out;
}

export const saveSticker = (blob, name) => saveStickers([{ blob, name }]);

// Testo per il toast dopo il salvataggio.
export function savedText(r) {
  const n = r.folder + r.download;
  const what = n === 1 ? 'Salvato' : `Salvati ${n} file`;
  if (r.folder && r.download) return `${r.folder} file in «${r.folderName}», ${r.download} in Download (cartella non disponibile)`;
  if (r.folder) return `${what} in «${r.folderName}»`;
  return r.fellBack ? `Cartella non disponibile: ${what.toLowerCase()} in Download` : `${what} in Download`;
}
