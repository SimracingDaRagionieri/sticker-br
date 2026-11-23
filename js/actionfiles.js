// Parti pure (senza DOM, testabili in Node) dell'importazione dei PNG delle azioni (Passo 8).

// reposition.png -> Reposition, pick_up_marker.png -> Pick Up Marker, fall-back (1).png -> Fall Back.
// Ogni parola comincia maiuscola; il resto della parola resta com'e' (PNG, UAV, ecc. non si toccano).
export function nameFromFile(filename) {
  const base = String(filename ?? '').replace(/^.*[\\/]/, '').replace(/\.[A-Za-z0-9]{1,5}$/, '');
  const clean = base
    .replace(/\s*\(\d+\)\s*$/, '')   // "(1)" aggiunto dal browser ai nomi doppi
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.replace(/(^|\s)(\p{L})/gu, (m, sp, ch) => sp + ch.toUpperCase());
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// I primi 8 byte di un vero PNG (bytes = Uint8Array o ArrayBuffer).
export function isPngBytes(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return b.length >= 8 && PNG_SIGNATURE.every((v, i) => b[i] === v);
}

const key = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// items: [{ name, ... }] da importare; existing: righe gia' presenti nello stesso ambito ({ id, name }).
// Restituisce { fresh, replace, dupInBatch }: nuove, da sostituire (con la riga esistente) e doppioni dentro la selezione
// (la prima ha la precedenza, le altre vanno saltate).
export function planImport(items, existing) {
  const byKey = new Map(existing.map((e) => [key(e.name), e]));
  const seen = new Set();
  const out = { fresh: [], replace: [], dupInBatch: [] };
  for (const it of items) {
    const k = key(it.name);
    if (!k) continue;
    if (seen.has(k)) { out.dupInBatch.push(it); continue; }
    seen.add(k);
    const old = byKey.get(k);
    if (old) out.replace.push({ item: it, existing: old });
    else out.fresh.push(it);
  }
  return out;
}
