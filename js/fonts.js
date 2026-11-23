// Font importati dall'utente (Passo 9): tabella `fonts` = { family, blob, format }.
// A ogni avvio si registrano con FontFace e si aggiungono a document.fonts, cosi' compaiono nei menu dei font e
// renderSticker li usa anche offline (i dati stanno in IndexedDB, non in rete).

import * as D from './db.js';

export const BUILTIN_FONTS = ['Bebas Neue', 'Oswald', 'Roboto Condensed'];

const loaded = new Map(); // id riga -> FontFace

// Registra un font: lancia se il file non e' un font valido.
async function register(row) {
  const buf = await row.blob.arrayBuffer();
  // weight '100 900': un font statico resta usabile a ogni peso richiesto senza grassetto finto.
  const face = new FontFace(row.family, buf, { weight: '100 900', style: 'normal' });
  await face.load();
  document.fonts.add(face);
  loaded.set(row.id, face);
  return face;
}

// Registra tutti i font salvati. Un file rovinato non blocca gli altri (resta in tabella, si puo' eliminare).
export async function loadUserFonts() {
  const rows = await D.listFonts();
  const bad = [];
  await Promise.all(rows.map(async (r) => {
    if (loaded.has(r.id)) return;
    try { await register(r); } catch (err) { console.warn('Font non caricabile:', r.family, err); bad.push(r.family); }
  }));
  return { count: rows.length, bad };
}

// Nome proposto dal nome del file: "Anton-Regular.ttf" -> "Anton Regular".
export function familyFromFilename(name) {
  const base = String(name || '').replace(/\.[^.]+$/, '').replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').replace(/["\\]/g, '').trim();
  return base || 'Font importato';
}

export function formatFromFilename(name) {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
  const f = m ? m[1].toLowerCase() : '';
  return D.FONT_FORMATS.includes(f) ? f : null;
}

// Importa un file font: lo verifica caricandolo davvero (FontFace), poi lo salva e lo registra.
export async function importFont(file, family) {
  const format = formatFromFilename(file.name);
  if (!format) throw new Error('Formato non supportato: usa .ttf, .otf, .woff2 o .woff');
  const blob = file.slice(0, file.size, 'font/' + (format === 'woff2' ? 'woff2' : format === 'woff' ? 'woff' : format === 'otf' ? 'otf' : 'ttf'));
  const name = String(family || '').replace(/["\\]/g, '').trim();
  if (!name) throw new Error('Il nome non può essere vuoto');
  if (BUILTIN_FONTS.some((b) => b.toLowerCase() === name.toLowerCase())) throw new Error('Questo nome è di un font già incluso');
  const probe = { id: -1, family: name, blob };
  try { await register(probe); } catch { throw new Error('Il file non è un font valido'); }
  document.fonts.delete(loaded.get(-1)); loaded.delete(-1);
  const id = await D.addFont(name, blob, format);
  await register({ id, family: name, blob });
  return id;
}

export async function removeFont(id) {
  const face = loaded.get(id);
  if (face) { document.fonts.delete(face); loaded.delete(id); }
  await D.deleteFont(id);
}

// Elenco per i menu: font inclusi + importati.
export async function fontFamilies() {
  return [...BUILTIN_FONTS, ...(await D.listFonts()).map((f) => f.family)];
}
