// Esportazione file. Nessuna ricompressione: il Blob esce identico.

export function timestamp(d = new Date()) {
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// Pezzo di nome file sicuro: senza accenti, spazi in trattini, solo lettere/cifre/trattini, max 40 caratteri.
export function slug(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-').replace(/[^A-Za-z0-9_-]/g, '').replace(/-{2,}/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 40);
}

// BR_<miniatura>_<arma>_<AAAAMMGG-HHMMSS>.png (le parti vuote vengono saltate).
export function stickerFilename(parts, d = new Date()) {
  const body = parts.map(slug).filter(Boolean);
  return ['BR', ...(body.length ? body : ['sticker']), timestamp(d)].join('_') + '.png';
}

// Sticker generati dal log (Passo 11): BR_<partita>_<nnn>_<parti>.png. `nnn` = numero della voce nel log (3 cifre),
// cosi' i file si ordinano come il log. Niente data nel nome: lo stesso sticker rigenerato ha lo stesso nome.
export function logStickerFilename(matchName, seq, parts) {
  const body = parts.map(slug).filter(Boolean);
  const n = String(Math.max(0, Math.floor(Number(seq) || 0))).padStart(3, '0');
  return ['BR', slug(matchName) || 'partita', n, ...body].join('_') + '.png';
}

// Dimensione leggibile: 1,5 MB (virgola italiana).
export function fmtBytes(n) {
  if (n == null || n === '') return '—';
  n = Number(n);
  if (!Number.isFinite(n) || n < 0) return '—';
  const u = ['byte', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  const v = i === 0 ? String(Math.round(n)) : n.toFixed(n >= 100 ? 0 : 1).replace('.', ',');
  return `${v} ${u[i]}`;
}

// Log della partita in PDF (Passo 13): BR_log_<partita>_AAAAMMGG.pdf (data = giorno dell'esportazione).
export function logPdfFilename(matchName, d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `BR_log_${slug(matchName) || 'partita'}_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.pdf`;
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Condivide uno o piu' file con la share sheet di Android; se non disponibile scarica.
export async function shareBlobs(blobs, filenames) {
  const files = blobs.map((b, i) => new File([b], filenames[i], { type: b.type || 'image/png' }));
  if (navigator.canShare && navigator.canShare({ files })) {
    try {
      await navigator.share({ files });
      return 'shared';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
      // altri errori: ripiego sul download
    }
  }
  blobs.forEach((b, i) => saveBlob(b, filenames[i]));
  return 'saved';
}
