// Esportazione file. Nessuna ricompressione: il Blob esce identico.

export function timestamp(d = new Date()) {
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
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
