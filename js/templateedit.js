// Parti pure dell'editor dei template (Passo 9): schema dei controlli, modifica della config, nomi di esempio.
// Nessuna dipendenza dal DOM ne' dal database (testabile in Node: tests/template-test.mjs).
//
// Regola: l'editor scrive nella config SOLO la chiave che l'utente tocca; i valori che mostra per le chiavi
// assenti sono quelli effettivi del motore (normalizeConfig), quindi aprire un template non lo cambia.

export const SAMPLE = {
  activation: { unitName: 'Intercessor Sergeant', weaponName: 'Bolt rifle', factionName: 'Angels of Death', actionName: '' },
  action: { unitName: '', weaponName: '', factionName: '', actionName: 'Reposition' },
  // Risultato (Passo 11): attaccante, arma, bersaglio, danni, ferite rimaste e stato.
  result: {
    unitName: 'Intercessor Sergeant', weaponName: 'Bolt rifle', factionName: 'Angels of Death', actionName: '',
    targetName: 'Hormagaunt', damageText: '-3', woundsLeftText: 'rimangono 5', damageLeftText: '-3 · rimangono 5', statusText: 'INCAPACITATO'
  }
};

export const SOURCE_LABELS = {
  unit: 'Nome miniatura', weapon: 'Nome arma', action: 'Testo azione', faction: 'Nome fazione', text: 'Testo fisso',
  target: 'Nome bersaglio', damage: 'Danni fatti (-3)', woundsLeft: 'Ferite rimaste (rimangono 5)',
  damageLeft: 'Danni e ferite rimaste (-3 · rimangono 5)', status: 'Stato (INCAPACITATO)'
};

// Origini sensate per tipo di template (la origine gia' presente in una riga resta sempre disponibile).
export const sourcesFor = (kind, current) => {
  const base = kind === 'action' ? ['action', 'text']
    : kind === 'result' ? ['target', 'damageLeft', 'damage', 'woundsLeft', 'status', 'unit', 'weapon', 'faction', 'text']
      : ['unit', 'weapon', 'faction', 'text'];
  return current && !base.includes(current) ? [...base, current] : base;
};

export const newLine = (kind) => (kind === 'result'
  ? { source: 'damageLeft', font: 'Oswald', weight: 500, size: 64, minSize: 32, color: '#FFFFFF', stroke: { width: 4, color: '#000000' }, shadow: false, upper: false, align: 'left' }
  : kind === 'action'
  ? { source: 'action', font: 'Bebas Neue', size: 96, minSize: 56, color: '#FFFFFF', stroke: { width: 6, color: '#000000' }, shadow: true, upper: true, align: 'center' }
  : { source: 'text', text: 'Testo', font: 'Oswald', weight: 500, size: 56, minSize: 32, color: '#FFFFFF', stroke: { width: 4, color: '#000000' }, shadow: false, upper: false, align: 'left' });

// ---- accesso per percorso ("plate.border.width") ----
const parts = (p) => (Array.isArray(p) ? p : String(p).split('.'));
export function getAt(obj, path) {
  let v = obj;
  for (const k of parts(path)) { if (v === null || v === undefined) return undefined; v = v[k]; }
  return v;
}
// Imposta un valore creando gli oggetti intermedi; value undefined = toglie la chiave. Modifica `obj` e lo restituisce.
export function setAt(obj, path, value) {
  const ks = parts(path);
  let o = obj;
  for (let i = 0; i < ks.length - 1; i++) {
    if (o[ks[i]] === null || typeof o[ks[i]] !== 'object') o[ks[i]] = {};
    o = o[ks[i]];
  }
  const last = ks[ks.length - 1];
  if (value === undefined) delete o[last]; else o[last] = value;
  return obj;
}

// Sposta l'elemento i di `dir` (-1 su, +1 giu'); restituisce la nuova posizione (o i se non si muove).
export function moveItem(arr, i, dir) {
  const j = i + dir;
  if (i < 0 || i >= arr.length || j < 0 || j >= arr.length) return i;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  return j;
}

// ---- schema dei controlli ----
// type: 'toggle' | 'range' | 'choice' | 'color' | 'border'
// Per 'range': scale (valore mostrato = valore salvato * scale), suffix.
const R = (path, label, min, max, step, extra = {}) => ({ type: 'range', path, label, min, max, step, ...extra });
const T = (path, label, extra = {}) => ({ type: 'toggle', path, label, ...extra });
const C = (path, label, options) => ({ type: 'choice', path, label, options });
const B = (path, label) => ({ type: 'border', path, label });

export function groupsFor(kind) {
  const act = kind === 'action';
  const res = kind === 'result';
  const groups = [
    { id: 'size', title: 'Dimensioni', controls: [
      R('width', 'Larghezza', 540, 2160, 10, { suffix: ' px' }),
      R('padding', 'Margine esterno', 0, 120, 1, { suffix: ' px' }),
      T('trim', 'Taglia i margini trasparenti')
    ] },
    { id: 'plate', title: 'Targa di sfondo', controls: [
      T('plate.show', 'Mostra la targa'),
      { type: 'color', path: 'plate.color', label: 'Colore' },
      R('plate.opacity', 'Opacità', 0, 100, 1, { scale: 100, suffix: ' %' }),
      R('plate.radius', 'Angoli arrotondati', 0, 100, 1, { suffix: ' px' }),
      R('plate.padding', 'Spazio interno', 0, 100, 1, { suffix: ' px' }),
      B('plate.border', 'Bordo' + (act ? ' (spento: se l\'azione ha un colore, è il bordo)' : ''))
    ] },
    { id: 'image', title: act ? 'Icona azione' : res ? 'Immagine bersaglio' : 'Immagine miniatura', controls: [
      T('image.show', act ? 'Mostra l\'icona (partenza: in Anteprima si può spegnere)' : 'Mostra l\'immagine (partenza)'),
      C('image.side', 'Lato', [['left', 'Sinistra'], ['right', 'Destra'], ['top', 'Sopra']]),
      R('image.height', 'Altezza', 40, 600, 2, { suffix: ' px' }),
      R('image.radius', 'Angoli arrotondati', 0, 100, 1, { suffix: ' px' }),
      B('image.border', 'Bordo')
    ] },
    { id: 'lines', title: 'Righe di testo', lines: true }
  ];
  if (!act) {
    groups.push({ id: 'weapon', title: res ? 'Immagine arma usata' : 'Immagine arma', controls: [
      T('weaponImage.show', 'Mostra l\'immagine (partenza)'),
      C('weaponImage.position', 'Posizione', [['below', 'Sotto'], ['right', 'A destra']]),
      R('weaponImage.maxHeight', 'Altezza massima', 40, 600, 2, { suffix: ' px' }),
      T('weaponImage.replaceText', 'Al posto del nome arma scritto'),
      R('weaponImage.radius', 'Angoli arrotondati', 0, 100, 1, { suffix: ' px' }),
      B('weaponImage.border', 'Bordo')
    ] });
  }
  return groups;
}

// Controlli di una riga di testo. Percorsi relativi alla riga: l'editor li prefissa con "lines.<i>.".
export const LINE_CONTROLS = [
  R('size', 'Dimensione', 16, 300, 1, { suffix: ' px' }),
  R('minSize', 'Dimensione minima', 8, 300, 1, { suffix: ' px' }),
  R('weight', 'Peso', 100, 900, 100),
  { type: 'color', path: 'color', label: 'Colore' },
  R('stroke.width', 'Contorno', 0, 30, 1, { suffix: ' px' }),
  { type: 'color', path: 'stroke.color', label: 'Colore contorno' },
  T('shadow', 'Ombra'),
  T('upper', 'Tutto maiuscolo'),
  C('align', 'Allineamento', [['left', 'Sinistra'], ['center', 'Centro'], ['right', 'Destra']])
];

// ---- campi di colore: <input type="color"> vuole #rrggbb ----
export function hex6(c, fallback = '#ffffff') {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c || '').trim());
  if (!m) return fallback;
  let h = m[1].toLowerCase();
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  return '#' + h;
}

// Nome unico: base, poi "base 2", "base 3"... (senza distinguere maiuscole)
export function uniqueName(base, taken) {
  const t = new Set(taken.map((n) => String(n).trim().toLowerCase()));
  let n = base, i = 2;
  while (t.has(n.trim().toLowerCase())) n = `${base} ${i++}`;
  return n;
}
