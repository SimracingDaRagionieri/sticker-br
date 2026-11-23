// Lettura per coordinate di un PDF squadra (Passo 6). Modulo PURO: nessun DOM, nessun pdf.js, testabile in Node.
//
// parseTeam(pages, { lang, name, title }) -> {
//   faction: { name, nameSource, keywords[] },
//   operatives: [{ name, stats{apl,move,save,wounds}, weapons[{ name, mode, kind, atk, hit, dmg, rules[], suspect[] }],
//                  abilities[{name,text}], actions[{name,cost,text}], keywords[], pages[], boxes }],
//   factionRule: [{ name, text, page }], ploys: [{ kind:'strategy'|'firefight', name, cost, text, page }],
//   equipment: [{ name, text, page }], ignoredPages: [{ page, heading, reason }], warnings: [...], report: {...}
// }
// pages = [{ num, width, height, items:[{str,x,y,w,h,font,bold}], images?:[{x,y,w,h}] }]  (js/pdfread.js li produce)
// Coordinate: punti PDF, origine in alto a sinistra, y = linea di base dall'alto.
//
// REGOLA D'ORO: nessun valore inventato. Cio' che non si riconosce con certezza diventa un avviso
// { code, page, message, text } e, quando serve, un campo `suspect` modificabile nella schermata di revisione.

// ---------- dizionari delle lingue ----------
// 'en' e' la lingua dei PDF veri. 'it' esiste solo per la fixture italiana: le etichette delle statistiche e della tabella
// arrivano dall'analisi del campione, i titoli di pagina e la frase "retro" sono ipotesi non verificate.
export const LANGS = {
  en: {
    stats: { apl: 'APL', move: 'MOVE', save: 'SAVE', wounds: 'WOUNDS' },
    cols: { name: 'NAME', atk: 'ATK', hit: 'HIT', dmg: 'DMG', wr: 'WR' },
    continues: /RULES?\s+CONTINUE[SD]?\s+ON\s+(?:THE\s+)?(?:BACK|OTHER\s+SIDE|REVERSE)/i,
    actionCost: /^(\d+)\s*AP$/i,
    ployCost: /^(\d+)\s*CP$/i,
    pages: {
      factionRule: /FACTION\s+RULES?|TEAM\s+RULES?/i,
      strategy: /STRATEGY\s+PLOYS?/i,
      firefight: /FIREFIGHT\s+PLOYS?/i,
      equipment: /EQUIPMENT/i
    }
  },
  it: {
    stats: { apl: 'LPA', move: 'MOV', save: 'SALV', wounds: 'FER' },
    cols: { name: 'NOME', atk: 'ATT', hit: 'COLP', dmg: 'DNN', wr: 'RdA' },
    continues: /LE\s+REGOLE\s+CONTINUANO\s+SUL\s+RETRO/i,
    actionCost: /^(\d+)\s*(?:AP|PA|LPA)$/i,
    ployCost: /^(\d+)\s*(?:CP|PC)$/i,
    pages: {
      factionRule: /REGOLA\s+DI\s+FAZIONE|REGOLE\s+DI\s+FAZIONE/i,
      strategy: /STRATAGEMMI\s+STRATEGY|STRATEGY/i,
      firefight: /STRATAGEMMI\s+FIREFIGHT|FIREFIGHT/i,
      equipment: /EQUIPAGGIAMENTO/i
    }
  }
};

// Formati dei valori (indipendenti dalla lingua).
export const FORMAT = {
  apl: /^\d+$/,
  move: /^\d+(?:["”″']|\s?in\.?)?$/,
  save: /^\d\+$/,
  wounds: /^\d+$/,
  atk: /^\d+$/,
  hit: /^\d\+$/,
  dmg: /^\d+\/\d+$/
};

// ---------- utilita' ----------

const up = (s) => String(s || '').trim().toUpperCase();
const cx = (it) => it.x + it.w / 2;
const snippet = (s, n = 90) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const normName = (s) => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

export const displayWeaponName = (name, mode) => (mode ? `${name} (${mode})` : name);

function joinItems(items) {
  let out = '';
  let prev = null;
  for (const it of items) {
    if (prev) {
      const gap = it.x - (prev.x + prev.w);
      if (!/\s$/.test(out) && !/^\s/.test(it.str) && gap > 0.12 * (it.h || 8)) out += ' ';
    }
    out += it.str;
    prev = it;
  }
  return out.replace(/\s+/g, ' ').trim();
}

// Raggruppa gli elementi in righe (stessa linea di base) e le ordina dall'alto.
function buildLines(items) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(it.y - last.y) <= 0.4 * Math.min(it.h || 8, last.h || 8)) {
      last.items.push(it);
      last.h = Math.max(last.h, it.h || 0);
    } else {
      lines.push({ y: it.y, h: it.h || 8, items: [it] });
    }
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    l.x0 = l.items[0].x;
    l.x1 = Math.max(...l.items.map((i) => i.x + i.w));
    l.text = joinItems(l.items);
  }
  return lines;
}

// Parte iniziale in grassetto di una riga: { title, rest, titleItems, restItems } oppure null.
function boldStart(items) {
  if (!items.length || !items[0].bold) return null;
  let k = 0;
  while (k < items.length && items[k].bold) k++;
  return { titleItems: items.slice(0, k), restItems: items.slice(k), title: joinItems(items.slice(0, k)), rest: joinItems(items.slice(k)) };
}

const rect = (page, x0, y0, x1, y1) => ({ page, x: x0, y: y0, w: x1 - x0, h: y1 - y0 });

// ---------- intestazioni di carta ----------

function findAnchors(page, D, warn) {
  const labelItems = page.items.filter((it) => [D.stats.apl, D.stats.move, D.stats.save, D.stats.wounds].includes(up(it.str)));
  const anchors = [];
  const used = new Set();
  for (const apl of labelItems.filter((it) => up(it.str) === D.stats.apl)) {
    const sameLine = (it) => Math.abs(it.y - apl.y) <= 0.5 * Math.max(apl.h, it.h);
    const pick = (lab, after) => after && labelItems
      .filter((it) => up(it.str) === lab && sameLine(it) && it.x > after.x && it.x - after.x < 400 && !used.has(it))
      .sort((a, b) => a.x - b.x)[0];
    const move = pick(D.stats.move, apl);
    const save = pick(D.stats.save, move);
    const wounds = pick(D.stats.wounds, save);
    if (!wounds) {
      warn('stat-labels', page.num, `Etichette delle statistiche incomplete accanto a "${D.stats.apl}"`, apl.str);
      continue;
    }
    [apl, move, save, wounds].forEach((i) => used.add(i));
    anchors.push({ page, labels: { apl, move, save, wounds } });
  }
  return anchors;
}

// Valore di una statistica: l'elemento corto piu' vicino sotto/sopra l'etichetta (stessa colonna) o subito a destra.
function findStatValue(page, label, exclude) {
  const lc = cx(label);
  const reach = Math.max(label.w, 12);
  let best = null, bestD = Infinity;
  for (const it of page.items) {
    if (exclude.has(it)) continue;
    const t = it.str.trim();
    if (!/^[\d]+(?:["”″'+]|\s?in\.?)?$/.test(t)) continue;
    const dy = it.y - label.y;
    let d = Infinity;
    if (Math.abs(cx(it) - lc) <= reach && Math.abs(dy) <= 4 * label.h + 10 && Math.abs(dy) > 0.3 * label.h) d = Math.abs(dy);
    else if (Math.abs(dy) <= 0.5 * label.h && it.x >= label.x + label.w - 1 && it.x - (label.x + label.w) <= 40) d = it.x - (label.x + label.w);
    if (d < bestD) { bestD = d; best = it; }
  }
  return best;
}

// ---------- tabella armi ----------

const COLS = ['name', 'atk', 'hit', 'dmg', 'wr'];

function findTableHeader(lines, D) {
  const out = [];
  lines.forEach((l, idx) => {
    const labs = {};
    for (const it of l.items) {
      for (const k of COLS) if (up(it.str) === D.cols[k] && !labs[k]) labs[k] = it;
    }
    if (labs.name && labs.atk && labs.hit && labs.dmg) out.push({ idx, labs, complete: !!labs.wr });
  });
  return out;
}

// Confini delle colonne: a meta' tra la fine di un'etichetta e l'inizio della successiva.
function columnBounds(labs, rx0, rx1) {
  const seq = COLS.filter((k) => labs[k]).map((k) => ({ k, it: labs[k] })).sort((a, b) => a.it.x - b.it.x);
  const b = {};
  for (let i = 0; i < seq.length; i++) {
    const left = i === 0 ? rx0 : seq[i - 1].k === 'name' ? seq[i].it.x - 3 : (seq[i - 1].it.x + seq[i - 1].it.w + seq[i].it.x) / 2;
    // La colonna del nome e' allineata a sinistra e puo' essere piu' larga dell'etichetta: arriva fino all'etichetta successiva.
    const right = i === seq.length - 1 ? rx1
      : seq[i].k === 'name' ? seq[i + 1].it.x - 3
        : (seq[i].it.x + seq[i].it.w + seq[i + 1].it.x) / 2;
    b[seq[i].k] = [left, right];
  }
  return b;
}

function colOf(it, bounds) {
  const c = cx(it);
  for (const k of COLS) if (bounds[k] && c >= bounds[k][0] && c < bounds[k][1]) return k;
  return null;
}

const KIND_GLYPHS = { ranged: /[⌖◎⊕✛⦿]/, melee: /[⚔†‡🗡]/ };
function kindFromGlyph(text) {
  for (const k of Object.keys(KIND_GLYPHS)) if (KIND_GLYPHS[k].test(text)) return k;
  return null;
}

// Divide "Range 10", Rending, Heavy (Dash only)" in regole, ignorando le virgole tra parentesi.
export function splitRules(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t || /^[-–—]$/.test(t)) return [];
  const out = [];
  let depth = 0, cur = '';
  for (const ch of t) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

// "Nome (modo)" -> { name, mode }. Solo la forma con parentesi finale: un trattino puo' far parte del nome.
export function splitModeFromName(full) {
  const m = /^(.*\S)\s*\(([^()]+)\)\s*$/.exec(full.trim());
  return m ? { name: m[1].trim(), mode: m[2].trim() } : { name: full.trim(), mode: '' };
}

// Legge una tabella armi a partire dalla riga d'intestazione `h`. Restituisce { weapons, endIdx, usedIdx:Set, box }.
function readTable(lines, h, region, ctx) {
  const { page, D, warn } = ctx;
  if (!h.complete) {
    warn('table-header', page.num, `Intestazione della tabella armi senza la colonna ${D.cols.wr}: tabella non letta`, lines[h.idx].text);
    return { weapons: [], endIdx: h.idx + 1, used: new Set([h.idx]) };
  }
  const bounds = columnBounds(h.labs, region.x0, region.x1);
  const hdr = lines[h.idx];
  const lineH = hdr.h || 8;
  const used = new Set([h.idx]);
  const nameLines = [];   // { y, text, items, lineIdx }
  const wrLines = [];
  const rows = [];        // { y, cells{atk,hit,dmg}, items, lineIdx, icon }
  let lastY = hdr.y;
  let pitch = 0;
  let i = h.idx + 1;

  for (; i < lines.length; i++) {
    const l = lines[i];
    if (findTableHeader([l], D).length) break;                       // inizia un'altra tabella
    const gapLimit = 1.8 * (pitch || 1.9 * lineH);
    if (l.y - lastY > gapLimit) break;                               // troppo lontana: non e' piu' tabella
    if (l.items.some((it) => D.actionCost.test(it.str.trim()))) break; // barra azione
    // un elemento di testo lungo che esce dalla propria colonna e' un paragrafo, non una cella
    const cols = l.items.map((it) => ({ it, col: colOf(it, bounds) }));
    const crossing = cols.some(({ it, col }) => !col || (col !== 'wr' && it.x + it.w > bounds[col][1] + 2 && col !== 'name') ||
      (col === 'name' && it.x + it.w > bounds.name[1] + 2));
    if (crossing) break;
    const mid = cols.filter((c) => c.col === 'atk' || c.col === 'hit' || c.col === 'dmg');
    const nameItems = cols.filter((c) => c.col === 'name').map((c) => c.it);
    const wrItems = cols.filter((c) => c.col === 'wr').map((c) => c.it);
    // nome in grassetto seguito da testo normale sulla stessa riga = abilita': fine tabella
    if (nameItems.length > 1 && nameItems[0].bold && nameItems.slice(1).some((x) => !x.bold) && !mid.length) break;
    if (mid.some(({ it }) => it.str.trim().length > 6 || it.w > 40)) break;
    if (mid.length) {
      const cells = {};
      for (const { it, col } of mid) cells[col] = (cells[col] ? cells[col] + ' ' : '') + it.str.trim();
      const iconItems = nameItems.filter((it) => !/[A-Za-z0-9]/.test(it.str));
      const textItems = nameItems.filter((it) => /[A-Za-z0-9]/.test(it.str));
      rows.push({ y: l.y, cells, lineIdx: i, items: l.items, icon: iconItems.length ? kindFromGlyph(iconItems.map((x) => x.str).join('')) : null });
      if (textItems.length) nameLines.push({ y: l.y, text: joinItems(textItems), items: textItems, lineIdx: i, own: true });
      if (wrItems.length) wrLines.push({ y: l.y, text: joinItems(wrItems), items: wrItems, lineIdx: i });
      if (rows.length > 1) pitch = median(rows.slice(1).map((r, k) => r.y - rows[k].y));
    } else {
      if (!nameItems.length && !wrItems.length) break;
      if (nameItems.length) nameLines.push({ y: l.y, text: joinItems(nameItems), items: nameItems, lineIdx: i });
      if (wrItems.length) wrLines.push({ y: l.y, text: joinItems(wrItems), items: wrItems, lineIdx: i });
    }
    used.add(i);
    lastY = l.y;
  }

  // Le righe di solo testo che non sono vicine a nessuna riga numerica non appartengono alla tabella.
  const near = (y) => {
    if (!rows.length) return null;
    const lim = 1.2 * (pitch || 1.9 * lineH);
    let best = null, bd = Infinity, tie = false;
    for (const r of rows) {
      const d = Math.abs(r.y - y);
      if (d < bd - 0.01) { bd = d; best = r; tie = false; } else if (Math.abs(d - bd) <= 0.01) tie = true;
    }
    return bd <= lim ? { row: best, tie } : null;
  };

  const assigned = rows.map(() => ({ names: [], wrs: [] }));
  const dropIdx = new Set();
  const place = (arr, key) => {
    for (const t of arr) {
      const n = near(t.y);
      if (!n) { dropIdx.add(t.lineIdx); continue; }
      if (n.tie) warn('ambiguous-row', page.num, 'Riga arma ambigua: il testo è a pari distanza da due righe', t.text);
      assigned[rows.indexOf(n.row)][key].push(t);
    }
  };
  place(nameLines, 'names');
  place(wrLines, 'wrs');
  // righe scartate: tornano disponibili per il resto della carta (abilita' ecc.)
  for (const idx of dropIdx) used.delete(idx);
  // se ho scartato le ultime righe, la tabella finisce prima
  let endIdx = Math.max(...used) + 1;

  const weapons = rows.map((r, k) => {
    const names = assigned[k].names.sort((a, b) => a.y - b.y);
    const wrs = assigned[k].wrs.sort((a, b) => a.y - b.y);
    const full = names.map((n) => n.text).join(' ').replace(/\s+/g, ' ').trim();
    const { name, mode } = splitModeFromName(full);
    const suspect = [];
    const get = (c) => (r.cells[c] != null ? r.cells[c] : null);
    const w = { name, mode, kind: r.icon || 'other', atk: get('atk'), hit: get('hit'), dmg: get('dmg'), rules: splitRules(wrs.map((x) => x.text).join(' ')), suspect };
    const rowText = [full, w.atk, w.hit, w.dmg, wrs.map((x) => x.text).join(' ')].filter((x) => x != null && x !== '').join(' | ');
    if (!name) { suspect.push('name'); warn('weapon-name', page.num, 'Riga arma senza nome', rowText); }
    for (const c of ['atk', 'hit', 'dmg']) {
      if (w[c] == null) { suspect.push(c); warn('weapon-missing', page.num, `Arma "${name || '?'}": valore ${D.cols[c]} mancante`, rowText); }
      else if (!FORMAT[c].test(w[c])) { suspect.push(c); warn('weapon-format', page.num, `Arma "${name || '?'}": ${D.cols[c]} "${w[c]}" non è nel formato atteso`, rowText); }
    }
    // riquadro della riga (punti PDF)
    const its = [...r.items, ...names.flatMap((n) => n.items), ...wrs.flatMap((n) => n.items)];
    w._items = its;
    return w;
  });

  // riquadri: intestazione e righe, a larghezza della tabella
  const hItems = hdr.items;
  const allItems = [...hItems, ...weapons.flatMap((w) => w._items)];
  const tx0 = Math.max(region.x0, Math.min(...allItems.map((i) => i.x)) - 6);
  const tx1 = Math.min(region.x1, Math.max(...allItems.map((i) => i.x + i.w)) + 6);
  const spans = weapons.map((w) => ({ top: Math.min(...w._items.map((i) => i.y - 0.95 * (i.h || 8))), bot: Math.max(...w._items.map((i) => i.y + 0.3 * (i.h || 8))) }));
  const header = rect(page.num, tx0, Math.min(...hItems.map((i) => i.y - 0.95 * (i.h || 8))) - 2, tx1, Math.max(...hItems.map((i) => i.y + 0.3 * (i.h || 8))) + 2);
  const boxes = weapons.map((w, k) => {
    const prevBot = k > 0 ? spans[k - 1].bot : header.y + header.h;
    const nextTop = k < weapons.length - 1 ? spans[k + 1].top : Infinity;
    const top = Math.max(spans[k].top - 2, (prevBot + spans[k].top) / 2);
    const bot = Math.min(spans[k].bot + 2, (spans[k].bot + nextTop) / 2);
    return { header, row: rect(page.num, tx0, top, tx1, bot) };
  });
  weapons.forEach((w, k) => { w.box = boxes[k]; delete w._items; });

  if (!rows.length) warn('table-empty', page.num, 'Tabella armi senza righe riconosciute', hdr.text);
  return { weapons, endIdx, used };
}

// ---------- blocchi di testo (abilita', azioni, stratagemmi, equipaggiamento) ----------

// Fine frase: punteggiatura finale, anche chiusa da virgolette/parentesi. Un `"` dopo una cifra e' un pollice (3"), non una fine frase.
// "Warrior Instincts: ..." = al massimo 5 parole che iniziano per maiuscola (o articoli minuscoli), poi due punti.
const TITLE_COLON = /^((?:[A-Z][\w'’-]*)(?:\s+(?:[A-Z][\w'’-]*|of|the|and|to|a|in|on|for)){0,4}):(?:\s+|$)/;
const SENTENCE_END = /[.!?:;]$|[.!?]["”)]$/;

// lines = righe gia' filtrate; opts.cost(item) -> costo se l'elemento e' un costo. Restituisce { blocks, orphans, continues }.
function readBlocks(lines, D, { costRe, pageNum, onContinue }) {
  const blocks = [];
  const orphans = [];
  let cur = null;
  const flush = () => { if (cur) { blocks.push(cur); cur = null; } };
  for (const l of lines) {
    if (D.continues.test(l.text)) { if (onContinue) onContinue(); continue; }
    // costo (AP/CP) ovunque nella riga
    let cost = null;
    let items = l.items;
    if (costRe) {
      const ci = items.find((it) => costRe.test(it.str.trim()));
      if (ci) { cost = ci.str.trim().replace(/\s+/g, '').toUpperCase(); items = items.filter((it) => it !== ci); }
    }
    let bs = boldStart(items);
    // Titoli non in grassetto (font non riconosciuto): riga con costo = azione; "Titolo Maiuscolo: testo" a inizio frase = abilita'.
    if (!bs && (!cur || !cur.text || SENTENCE_END.test(cur.text.trim()))) {
      const full = joinItems(items);
      const m = TITLE_COLON.exec(full);
      if (cost != null && full) bs = { title: full, rest: '' };
      else if (m) bs = { title: m[1], rest: full.slice(m[0].length).trim() };
    }
    // Una parola chiave in grassetto a inizio riga seguita da ")" "," "." (es. "BEACON) would...") e' dentro una frase, non un titolo.
    const inlineKeyword = bs && cost == null && cur && /^[),.;\]]/.test(bs.rest.trim());
    const waitingText = cur && !cur.text && cost == null && bs && !/:\s*$/.test(bs.title);
    const startsBlock = bs && !inlineKeyword && !waitingText && (cost != null || !cur || !cur.text || SENTENCE_END.test(cur.text.trim()));
    if (startsBlock) {
      flush();
      cur = { title: bs.title.replace(/[:\s]+$/, ''), cost, text: bs.rest, page: pageNum, y: l.y };
    } else if (cur) {
      const t = joinItems(items);
      cur.text = cur.text ? (/-$/.test(cur.text) && /^[a-z]/.test(t) ? cur.text.slice(0, -1) + t : cur.text + ' ' + t) : t;
    } else {
      orphans.push(l);
    }
  }
  flush();
  return { blocks, orphans };
}

// Riga tutta maiuscola con virgole; in coda puo' esserci la dimensione della base (es. "... SWARMGUARD 28" o "40mm").
const stripBase = (t) => t.replace(/\s+\d{2,3}\s?(?:mm)?$/i, '');
// Due colonne di testo affiancate nella stessa carta (es. "Grenadier:" a sinistra, "Melta Mine:" a destra): si cerca un vuoto
// verticale tra gli elementi; se c'e' si legge prima tutta la colonna sinistra e poi la destra.
function splitColumns(lines, costRe) {
  const items = lines.filter((l) => !l.items.some((i) => costRe && costRe.test(i.str.trim()))).flatMap((l) => l.items);
  if (items.length < 6) return lines;
  const iv = items.map((i) => [i.x, i.x + i.w]).sort((a, b) => a[0] - b[0]);
  let edge = iv[0][1], cut = null;
  for (let k = 1; k < iv.length; k++) {
    if (iv[k][0] - edge >= 8) {
      const x = (edge + iv[k][0]) / 2;
      if (items.filter((i) => i.x + i.w / 2 < x).length >= 3 && items.filter((i) => i.x + i.w / 2 >= x).length >= 3) { cut = x; break; }
    }
    edge = Math.max(edge, iv[k][1]);
  }
  if (cut == null) return lines;
  const all = lines.flatMap((l) => l.items);
  return [...buildLines(all.filter((i) => i.x + i.w / 2 < cut)), ...buildLines(all.filter((i) => i.x + i.w / 2 >= cut))];
}

const isKeywordLine = (t) => { const k = stripBase(t); return k.includes(',') && k === k.toUpperCase() && /[A-Z]/.test(k) && !/\d/.test(k) && k.length < 200; };

// ---------- parser ----------

export function parseTeam(rawPages, { lang = 'en', name = null, title = '' } = {}) {
  const raw = LANGS[lang];
  if (!raw) throw new Error(`Lingua non supportata: ${lang}`);
  // Etichette in maiuscolo: i testi del PDF si confrontano sempre in maiuscolo ("RdA" -> "RDA").
  const D = { ...raw, stats: Object.fromEntries(Object.entries(raw.stats).map(([k, v]) => [k, up(v)])), cols: Object.fromEntries(Object.entries(raw.cols).map(([k, v]) => [k, up(v)])) };
  const warnings = [];
  const warn = (code, page, message, text = '') => warnings.push({ code, page, message, text: snippet(text) });
  const pages = rawPages.map((p, k) => (Array.isArray(p) ? { num: k + 1, width: 595, height: 842, items: p, images: [] } : { num: p.num ?? k + 1, images: [], ...p }));

  const cards = [];
  const ignoredPages = [];
  const factionRule = [];
  const ploys = [];
  const equipment = [];
  let headerCount = 0;
  let anyBold = false;

  for (const page of pages) {
    if (page.items.some((i) => i.bold)) anyBold = true;
    const anchors = findAnchors(page, D, warn);
    if (anchors.length) {
      headerCount += anchors.length;
      readCardPage(page, anchors, D, cards, warn);
      continue;
    }
    if (!readRuleSheet(page, D, { factionRule, ploys, equipment, ignoredPages }, warn)) {
      readRulesPage(page, D, { factionRule, ploys, equipment, ignoredPages }, warn);
    }
  }
  mergeCards(factionRule); mergeCards(equipment); mergeCards(ploys);

  // ----- unione fronte/retro per nome -----
  const byName = new Map();
  for (const c of cards) {
    const key = normName(c.name);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(c);
  }
  const operatives = [];
  for (const [key, group] of byName) {
    const first = group[0];
    const op = { name: first.name, stats: { ...first.stats }, weapons: [], abilities: [], actions: [], keywords: [], pages: [], boxes: { header: first.box, portrait: first.portrait || null }, continues: group.some((g) => g.continues), hadTable: group.some((g) => g.hadTable) };
    if (group.length > 2) warn('card-count', first.page, `"${first.name}" compare su ${group.length} carte (attese 1 o 2: fronte e retro)`, first.name);
    for (const g of group) {
      if (!op.pages.includes(g.page)) op.pages.push(g.page);
      for (const k of ['apl', 'move', 'save', 'wounds']) {
        if (op.stats[k] == null && g.stats[k] != null) op.stats[k] = g.stats[k];
        else if (g.stats[k] != null && g.stats[k] !== op.stats[k]) warn('stats-differ', g.page, `"${first.name}": ${D.stats[k]} diverso tra fronte e retro (${op.stats[k]} / ${g.stats[k]})`, first.name);
      }
      for (const w of g.weapons) {
        const dup = op.weapons.find((x) => x.name === w.name && x.mode === w.mode && x.atk === w.atk && x.hit === w.hit && x.dmg === w.dmg && x.rules.join(',') === w.rules.join(','));
        if (!dup) op.weapons.push(w);
      }
      for (const a of g.abilities) if (!op.abilities.some((x) => normName(x.name) === normName(a.name))) op.abilities.push(a);
      for (const a of g.actions) if (!op.actions.some((x) => normName(x.name) === normName(a.name))) op.actions.push(a);
      for (const kw of g.keywords) if (!op.keywords.includes(kw)) op.keywords.push(kw);
      if (!op.boxes.portrait && g.portrait) op.boxes.portrait = g.portrait;
    }
    op.boxes.header = first.box;
    // controlli di coerenza per operativo
    for (const k of ['apl', 'move', 'save', 'wounds']) {
      if (op.stats[k] == null) warn('stat-missing', first.page, `"${op.name}": statistica ${D.stats[k]} non trovata`, op.name);
      else if (!FORMAT[k].test(op.stats[k])) warn('stat-format', first.page, `"${op.name}": ${D.stats[k]} "${op.stats[k]}" non è nel formato atteso`, op.name);
    }
    if (!op.weapons.length && op.hadTable) warn('no-weapons', first.page, `"${op.name}": nessuna arma trovata`, op.name);
    const seen = new Set();
    for (const w of op.weapons) {
      const kk = normName(displayWeaponName(w.name, w.mode));
      if (seen.has(kk)) warn('weapon-dup', first.page, `"${op.name}": arma "${displayWeaponName(w.name, w.mode)}" ripetuta`, displayWeaponName(w.name, w.mode));
      seen.add(kk);
    }
    if (op.continues && group.length < 2) warn('back-missing', first.page, `"${op.name}": la carta indica che le regole continuano sul retro, ma il retro non è stato trovato`, op.name);
    operatives.push(op);
  }

  // ----- squadra -----
  const common = operatives.length ? operatives.map((o) => o.keywords).reduce((a, b) => a.filter((k) => b.includes(k))) : [];
  let fname = name && name.trim() ? name.trim() : null, nameSource = fname ? 'manuale' : null;
  if (!fname && common.length) { fname = common[0]; nameSource = 'parole chiave'; }
  if (!fname && title && title.trim()) { fname = title.trim(); nameSource = 'titolo del PDF'; }
  if (!fname) warn('faction-name', 0, 'Nome della squadra non rilevato: scrivilo nella revisione', '');

  // ----- controlli globali -----
  if (cards.length && !anyBold) warn('no-bold', 0, 'Nessun testo in grassetto rilevato nel PDF: titoli di abilità e azioni non riconoscibili', '');
  if (operatives.length && headerCount !== cards.length) warn('header-count', 0, `Intestazioni trovate ${headerCount}, carte lette ${cards.length}`, '');
  if (operatives.length) {
    if (!factionRule.length) warn('no-faction-rule', 0, 'Nessuna regola di fazione trovata', '');
    if (!ploys.some((p) => p.kind === 'strategy')) warn('no-strategy', 0, 'Nessuno stratagemma Strategy trovato', '');
    if (!ploys.some((p) => p.kind === 'firefight')) warn('no-firefight', 0, 'Nessuno stratagemma Firefight trovato', '');
    if (!equipment.length) warn('no-equipment', 0, 'Nessun equipaggiamento trovato', '');
  } else {
    warn('no-operatives', 0, 'Nessun operativo riconosciuto: il PDF non sembra una squadra in questa lingua', '');
  }

  return {
    faction: { name: fname, nameSource, keywords: common },
    operatives, factionRule, ploys, equipment, ignoredPages, warnings,
    report: { pages: pages.length, headers: headerCount, cards: cards.length, lang }
  };
}

// ---------- pagina di carte ----------

function readCardPage(page, anchors, D, cards, warn) {
  // 1. valori delle statistiche e riquadro dell'intestazione
  const labelSet = new Set(anchors.flatMap((a) => Object.values(a.labels)));
  const taken = new Set(labelSet);
  for (const a of anchors) {
    a.vals = {};
    for (const k of ['apl', 'move', 'save', 'wounds']) {
      const v = findStatValue(page, a.labels[k], taken);
      a.vals[k] = v || null;
      if (v) taken.add(v);
    }
    const lab = Object.values(a.labels);
    a.labelH = Math.max(...lab.map((l) => l.h));
    a.top = Math.min(...lab.map((l) => l.y - l.h));
    const valItems = Object.values(a.vals).filter(Boolean);
    a.bottomBaseline = Math.max(...lab.map((l) => l.y), ...valItems.map((v) => v.y));
    a.x0 = Math.min(...lab.map((l) => l.x));
    a.x1 = Math.max(...lab.map((l) => l.x + l.w));
    a.cx = (a.x0 + a.x1) / 2;
  }

  // 2. colonne: gli intervalli x delle intestazioni che si sovrappongono stanno nella stessa colonna
  anchors.sort((a, b) => a.cx - b.cx);
  const cols = [];
  for (const a of anchors) {
    const c = cols.find((col) => Math.min(col.x1, a.x1) - Math.max(col.x0, a.x0) > 0.5 * Math.min(col.x1 - col.x0, a.x1 - a.x0));
    if (c) { c.anchors.push(a); c.x0 = Math.min(c.x0, a.x0); c.x1 = Math.max(c.x1, a.x1); } else cols.push({ x0: a.x0, x1: a.x1, anchors: [a] });
  }
  cols.sort((a, b) => a.x0 - b.x0);
  // confini tra colonne = centro del vuoto piu' largo senza testo, cercato tra i due gruppi di intestazioni
  const bounds = [0];
  const topMost = Math.min(...anchors.map((a) => a.top)) - 80;
  const narrow = page.items.filter((i) => i.y >= topMost && i.w < 0.6 * page.width);
  for (let k = 0; k + 1 < cols.length; k++) {
    const lo = (cols[k].x0 + cols[k].x1) / 2, hi = (cols[k + 1].x0 + cols[k + 1].x1) / 2;
    const iv = narrow.filter((i) => i.x + i.w > lo && i.x < hi).map((i) => [Math.max(i.x, lo), Math.min(i.x + i.w, hi)]).sort((a, b) => a[0] - b[0]);
    let best = null, edge = lo;
    for (const [s, e] of iv) { if (s - edge > (best ? best[1] - best[0] : 0)) best = [edge, s]; edge = Math.max(edge, e); }
    if (hi - edge > (best ? best[1] - best[0] : 0)) best = [edge, hi];
    if (!best || best[1] - best[0] < 6) {
      warn('columns', page.num, 'Colonne di carte non separabili con certezza: uso il punto di mezzo', '');
      bounds.push((lo + hi) / 2);
    } else bounds.push((best[0] + best[1]) / 2);
  }
  bounds.push(page.width + 1);
  cols.forEach((c, k) => { c.rx0 = bounds[k]; c.rx1 = bounds[k + 1]; });

  // 3. per ogni colonna, carte dall'alto in basso: nome e area di competenza
  for (const col of cols) {
    col.anchors.sort((a, b) => a.top - b.top);
    col.anchors.forEach((a, idx) => {
      const prev = col.anchors[idx - 1];
      const zoneTop = Math.max(a.top - 70, prev ? prev.bottomBaseline + 2 : -Infinity);
      const inZone = page.items.filter((it) => cx(it) >= col.rx0 && cx(it) < col.rx1 && it.y > zoneTop && it.y <= a.bottomBaseline + 1 &&
        !taken.has(it) && it.h >= 1.25 * a.labelH);
      let nameItems = [];
      if (inZone.length) {
        const maxH = Math.max(...inZone.map((i) => i.h));
        const big = inZone.filter((i) => i.h >= 0.9 * maxH);
        // le righe del nome piu' vicine all'intestazione
        const lines = buildLines(big);
        let chosen = [lines[lines.length - 1]];
        for (let k = lines.length - 2; k >= 0; k--) {
          if (chosen[0].y - lines[k].y <= 1.6 * lines[k].h) chosen.unshift(lines[k]); else break;
        }
        nameItems = chosen.flatMap((l) => l.items);
        a.nameLines = chosen;
      }
      a.name = nameItems.length ? joinItems(nameItems.sort((x, y) => x.y - y.y || x.x - y.x)).replace(/\s+/g, ' ') : null;
      a.nameTop = nameItems.length ? Math.min(...nameItems.map((i) => i.y - i.h)) : a.top;
      a.col = col;
    });
    col.anchors.forEach((a, idx) => {
      const next = col.anchors[idx + 1];
      a.areaTop = a.nameTop - 2;
      a.areaBottom = next ? next.nameTop - 2 : Infinity;
    });
  }

  // 4. lettura di ogni carta
  for (const a of anchors) {
    const stats = {};
    for (const k of ['apl', 'move', 'save', 'wounds']) {
      stats[k] = a.vals[k] ? a.vals[k].str.trim() : null; // i valori mancanti o strani si segnalano dopo l'unione fronte/retro
    }
    if (!a.name) warn('name-missing', page.num, 'Nome dell\'operativo non trovato sopra le statistiche', Object.values(a.labels).map((l) => l.str).join(' '));

    const region = { x0: a.col.rx0, x1: Math.min(a.col.rx1, page.width) };
    const bodyItems = page.items.filter((it) => cx(it) >= region.x0 && cx(it) < region.x1 && it.y > a.bottomBaseline + 1 && it.y <= a.areaBottom &&
      !taken.has(it) && !(it.y > page.height - 36 && /^\d{1,3}$/.test(it.str.trim())));
    const lines = buildLines(bodyItems);
    const card = { name: a.name || '(senza nome)', stats, page: page.num, weapons: [], abilities: [], actions: [], keywords: [], continues: false };

    // ritratto: immagine che si sovrappone di piu' alla banda dell'intestazione, dentro la colonna
    const bandTop = a.nameTop, bandBot = a.bottomBaseline + 4;
    let portrait = null, bestOv = 0;
    for (const im of page.images || []) {
      const ox = Math.min(im.x + im.w, region.x1) - Math.max(im.x, region.x0);
      const oy = Math.min(im.y + im.h, bandBot) - Math.max(im.y, bandTop - 12);
      if (ox <= 0 || oy <= 0) continue;
      const frac = (ox * oy) / (im.w * im.h);
      if (im.w * im.h > 0.35 * page.width * page.height) continue; // sfondo a pagina intera: non e' un ritratto
      if (frac > 0.6 && ox * oy > bestOv) { bestOv = ox * oy; portrait = rect(page.num, im.x, im.y, im.x + im.w, im.y + im.h); }
    }
    card.portrait = portrait;
    const hx0 = Math.min(a.x0, a.labels.apl.x), hx1 = Math.max(a.x1, region.x1 > a.x1 ? a.x1 : region.x1);
    card.box = rect(page.num, Math.max(region.x0, Math.min(hx0, ...(a.nameLines ? a.nameLines.map((l) => l.x0) : [hx0])) - 6), a.nameTop - 4, Math.min(region.x1, hx1 + 6), a.bottomBaseline + 6);

    // tabelle armi
    const used = new Set();
    card.hadTable = findTableHeader(lines, D).length > 0;
    for (const h of findTableHeader(lines, D)) {
      if (used.has(h.idx)) continue;
      const t = readTable(lines, h, region, { page, D, warn });
      card.weapons.push(...t.weapons);
      for (const u of t.used) used.add(u);
    }
    const rest = lines.filter((_, idx) => !used.has(idx));

    // parole chiave: riga tutta maiuscola con virgole
    const kwLines = rest.filter((l) => isKeywordLine(l.text));
    for (const l of kwLines) card.keywords.push(...stripBase(l.text).split(',').map((s) => s.trim()).filter(Boolean));
    const body = rest.filter((l) => !kwLines.includes(l));

    const { blocks, orphans } = readBlocks(splitColumns(body, D.actionCost), D, { costRe: D.actionCost, pageNum: page.num, onContinue: () => { card.continues = true; } });
    for (const b of blocks) {
      if (!b.text && !b.cost && /^NOTES?$/i.test(b.title)) continue;
      if (b.cost) card.actions.push({ name: b.title, cost: b.cost, text: b.text });
      else card.abilities.push({ name: b.title, text: b.text });
      if (!b.text && !b.cost) warn('empty-block', page.num, `"${card.name}": "${b.title}" senza testo`, b.title);
    }
    for (const o of orphans) warn('orphan-text', page.num, `"${card.name}": testo non attribuito`, o.text);
    cards.push(card);
  }
}

// ---------- pagine di regole ----------

function readRulesPage(page, D, out, warn) {
  const lines = buildLines(page.items);
  if (!lines.length) { out.ignoredPages.push({ page: page.num, heading: '', reason: 'pagina vuota' }); return; }
  // titolo = riga piu' grande nel quarto superiore
  const topLines = lines.filter((l) => l.y < 0.28 * page.height);
  const titleLine = (topLines.length ? topLines : lines).reduce((a, b) => (b.h > a.h ? b : a));
  const heading = titleLine.text;
  let kind = null;
  for (const k of ['strategy', 'firefight', 'equipment', 'factionRule']) if (D.pages[k].test(heading)) { kind = k; break; }
  if (!kind) { out.ignoredPages.push({ page: page.num, heading: snippet(heading, 60), reason: 'titolo non riconosciuto (lore, errata o riepilogo)' }); return; }

  const body = lines.filter((l) => l !== titleLine);
  const { blocks, orphans } = readBlocks(body, D, { costRe: D.ployCost, pageNum: page.num });
  const entries = blocks.map((b) => ({ name: b.title, cost: b.cost, text: b.text, page: page.num }));
  if (orphans.length) {
    // testo prima del primo titolo: resta, con il titolo della pagina come nome
    const text = orphans.map((o) => o.text).join(' ');
    entries.unshift({ name: snippet(heading, 60), cost: null, text, page: page.num });
  }
  // intestazione di colonna ripetuta ("A B A B", tutta maiuscola, senza testo ne' costo): non e' una voce
  const repeated = (n) => { const w = String(n).trim().split(/\s+/); const h = w.length / 2; return w.length >= 2 && w.length % 2 === 0 && w.slice(0, h).join(' ') === w.slice(h).join(' ') && n === n.toUpperCase(); };
  for (let k = entries.length - 1; k >= 0; k--) if (!entries[k].text && !entries[k].cost && repeated(entries[k].name)) entries.splice(k, 1);
  for (const e of entries) if (!e.text) warn('empty-rule', page.num, `Voce "${e.name}" senza testo`, e.name);
  if (!entries.length) warn('rules-empty', page.num, `Pagina "${snippet(heading, 40)}" riconosciuta ma senza voci`, heading);
  for (const e of entries) {
    if (kind === 'factionRule') out.factionRule.push({ name: e.name, text: e.text, page: e.page });
    else if (kind === 'equipment') out.equipment.push({ name: e.name, text: e.text, page: e.page });
    else out.ploys.push({ kind, name: e.name, cost: e.cost, text: e.text, page: e.page });
  }
}

// ---------- fogli di carte regola (stratagemmi, regole di fazione, equipaggiamento: piu' carte per pagina) ----------

const CARD_NO = /\(\s*CARD\s+(\d+)\s*\/\s*(\d+)\s*\)/i;

function cardCells(page) {
  const big = (page.images || []).filter((im) => im.w > 150 && im.w < 260 && im.h > 300 && im.h < 400)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const cells = [];
  for (const im of big) if (!cells.some((c) => Math.abs(c.x - im.x) < 6 && Math.abs(c.y - im.y) < 6)) cells.push({ x: im.x, y: im.y, w: im.w, h: im.h });
  if (cells.length < 2) return null;
  const rows = [];
  for (const c of cells) {
    let r = rows.find((q) => Math.abs(q.y - c.y) < 30);
    if (!r) { r = { y: c.y, cells: [] }; rows.push(r); }
    r.cells.push(c);
  }
  rows.sort((a, b) => a.y - b.y);
  return rows.flatMap((r) => r.cells.sort((a, b) => a.x - b.x));
}

const avgH = (lines) => lines.reduce((s, l) => s + l.h, 0) / (lines.length || 1);

// Legge un foglio di carte regola. Restituisce true se la pagina e' un foglio (anche se nessuna carta e' riconosciuta).
function readRuleSheet(page, D, out, warn) {
  const cells = cardCells(page);
  if (!cells) return false;
  const buckets = cells.map(() => []);
  for (const it of page.items) {
    const x = cx(it), y = it.y - (it.h || 8) / 2;
    let best = -1, bd = Infinity;
    cells.forEach((c, k) => {
      if (x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h) {
        const d = Math.abs(x - (c.x + c.w / 2));
        if (d < bd) { bd = d; best = k; }
      }
    });
    if (best >= 0) buckets[best].push(it);
  }
  let found = 0, prev = null;
  buckets.forEach((items) => {
    if (!items.length) { prev = null; return; }
    let lines = buildLines(items);
    let continues = false;
    lines = lines.filter((l) => { if (D.continues.test(l.text)) { continues = true; return false; } return true; });
    const labelIdx = lines.findIndex((l) => l.h >= 12 && ['strategy', 'firefight', 'equipment', 'factionRule'].some((k) => D.pages[k].test(l.text)));
    if (labelIdx < 0) {
      // senza etichetta: retro della carta precedente (se quella dichiarava "continua sull'altro lato"), altrimenti non e' una regola
      if (prev && prev.continues) {
        prev.entry.text = joinLines(prev.entry.text, lines);
        prev.continues = continues;
      } else prev = null;
      return;
    }
    const kind = ['strategy', 'firefight', 'equipment', 'factionRule'].find((k) => D.pages[k].test(lines[labelIdx].text));
    const rest = lines.slice(labelIdx + 1);
    if (!rest.length) { warn('rules-empty', page.num, 'Carta regola senza titolo e senza testo', lines[labelIdx].text); prev = null; return; }
    // titolo: righe grandi subito dopo l'etichetta (puo' andare a capo)
    const bodyH = median(rest.slice(1).map((l) => l.h)) || rest[0].h / 2;
    let n = 1;
    while (n < rest.length && rest[n].h >= 0.95 * rest[0].h && rest[n].y - rest[n - 1].y <= 1.6 * rest[n - 1].h) n++;
    const titleLines = rest[0].h >= 1.2 * bodyH || rest.length === 1 ? rest.slice(0, n) : [];
    let cost = null;
    const titleItems = titleLines.flatMap((l) => l.items).filter((i) => { if (D.ployCost.test(i.str.trim())) { cost = i.str.trim().replace(/\s+/g, '').toUpperCase(); return false; } return true; });
    let name = titleItems.length ? joinItems(titleItems) : '';
    if (!name) warn('rule-name', page.num, 'Carta regola senza titolo riconoscibile', rest[0].text);
    const body = rest.slice(titleLines.length);
    // paragrafi: salto di riga maggiore del passo normale; il primo paragrafo piu' grande degli altri = testo narrativo
    const dys = body.slice(1).map((l, k) => l.y - body[k].y).filter((d) => d > 0).sort((a, b) => a - b);
    const pitch = dys.length ? dys[Math.floor(0.25 * (dys.length - 1))] : 11;   // 1o quartile: le tabelle allungano la mediana
    const paras = [];
    body.forEach((l, k) => { if (!k || l.y - body[k - 1].y > 1.35 * pitch) paras.push([l]); else paras[paras.length - 1].push(l); });
    let flavor = '';
    if (paras.length >= 2 && avgH(paras[0]) >= avgH(paras[1]) + 0.3) flavor = joinLines('', paras.shift());
    const text = paras.reduce((acc, p) => joinLines(acc, p), '');
    const entry = { name: name.replace(/\s+/g, ' ').trim(), cost, text, flavor, page: page.num };
    const m = CARD_NO.exec(entry.name);
    if (m) { entry.card = { k: Number(m[1]), n: Number(m[2]) }; entry.name = entry.name.replace(CARD_NO, '').replace(/\s+/g, ' ').trim(); }
    if (kind === 'factionRule') out.factionRule.push(entry);
    else if (kind === 'equipment') out.equipment.push(entry);
    else out.ploys.push({ ...entry, kind });
    found++;
    prev = { entry, continues };
  });
  if (!found) out.ignoredPages.push({ page: page.num, heading: snippet(page.items.find((i) => i.h >= 12)?.str || '', 60), reason: 'foglio senza carte regola riconosciute (lista squadra, lore o riepilogo)' });
  return true;
}

// Aggiunge righe di testo a un testo gia' scritto (a capo con trattino unito, altrimenti uno spazio).
function joinLines(base, lines) {
  let t = base || '';
  for (const l of lines) {
    const s = l.text;
    t = t ? (/-$/.test(t) && /^[a-z]/.test(s) ? t.slice(0, -1) + s : t + ' ' + s) : s;
  }
  return t.replace(/\s+/g, ' ').trim();
}

// Carte "(CARD 1/3)", "(CARD 2/3)"...: stessa regola su piu' carte, unita in ordine.
function mergeCards(arr) {
  const groups = new Map();
  arr.forEach((e, idx) => { if (e.card) { const key = `${e.kind || ''}|${normName(e.name)}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(idx); } });
  const drop = new Set();
  for (const idxs of groups.values()) {
    if (idxs.length < 2) continue;
    const parts = idxs.map((i) => arr[i]).sort((a, b) => a.card.k - b.card.k);
    const first = arr[idxs[0]];
    first.text = parts.map((p) => p.text).filter(Boolean).join(' ');
    first.flavor = parts.map((p) => p.flavor).filter(Boolean).join(' ');
    first.page = Math.min(...parts.map((p) => p.page));
    first.cards = parts.map((p) => p.card.k);
    idxs.slice(1).forEach((i) => drop.add(i));
  }
  for (let i = arr.length - 1; i >= 0; i--) if (drop.has(i)) arr.splice(i, 1);
}

// ---------- raggruppamento armi per il salvataggio ----------

export const profileOf = (w) => ({ atk: w.atk, hit: w.hit, dmg: w.dmg, rules: [...w.rules], mode: w.mode || '' });
export const sameProfile = (a, b) => !!a && !!b && a.atk === b.atk && a.hit === b.hit && a.dmg === b.dmg && (a.mode || '') === (b.mode || '') &&
  (a.rules || []).join('|') === (b.rules || []).join('|');

// Stessa arma (nome, modo, profilo) su piu' operativi = un solo gruppo. Stesso nome con profili diversi = gruppi distinti.
export function weaponGroups(operatives) {
  const groups = [];
  for (const op of operatives) {
    for (const w of op.weapons) {
      const profile = profileOf(w);
      let g = groups.find((x) => x.name === w.name && x.mode === (w.mode || '') && sameProfile(x.profile, profile));
      if (!g) { g = { name: w.name, mode: w.mode || '', kind: w.kind, profile, operatives: [], box: w.box }; groups.push(g); }
      if (!g.operatives.includes(op.name)) g.operatives.push(op.name);
    }
  }
  return groups;
}

// ---------- collegamento con le armi gia' presenti (reimport senza duplicati) ----------

const keyName = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// existing = righe weapons della fazione ({ id, name, profile? }); groups = weaponGroups(...).
// Ritorna un array parallelo a groups: id della riga esistente da aggiornare, oppure null (arma nuova).
// 1) stesso nome visualizzato e stesso profilo; 2) stesso nome e riga ancora libera (senza profilo oppure di un import precedente).
export function matchWeaponGroups(existing, groups) {
  const taken = new Set();
  const result = groups.map(() => null);
  const dn = (g) => keyName(displayWeaponName(g.name, g.mode));
  groups.forEach((g, i) => {
    const row = existing.find((r) => !taken.has(r.id) && keyName(r.name) === dn(g) && sameProfile(r.profile, g.profile));
    if (row) { result[i] = row.id; taken.add(row.id); }
  });
  groups.forEach((g, i) => {
    if (result[i] != null) return;
    const row = existing.find((r) => !taken.has(r.id) && keyName(r.name) === dn(g));
    if (row) { result[i] = row.id; taken.add(row.id); }
  });
  return result;
}
