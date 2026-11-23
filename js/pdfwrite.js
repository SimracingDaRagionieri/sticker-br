// Scrittore PDF minimo, PURO (senza DOM, senza librerie): solo testo, font standard Helvetica e Helvetica-Bold
// (non incorporati, quindi nessun file di font da mettere in cache), codifica WinAnsi (accenti italiani ok), pagine A4,
// ritorno a capo automatico, nuova pagina automatica, piè di pagina "pagina n di N". Usato da js/logexport.js.
// Il testo resta selezionabile e si rilegge con pdf.js (tests/logexport-test.mjs).

const W = 595.28, H = 841.89;

// Larghezze dei caratteri 32..126 (millesimi di corpo), dai metrici standard Adobe Helvetica / Helvetica-Bold.
const WIDTHS = {
  reg: [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584],
  bold: [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
    975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
    333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584]
};

// Caratteri fuori da Latin-1 che WinAnsi (cp1252) ha nella zona 0x80-0x9F.
const CP1252 = { '€': 0x80, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97 };

// Testo -> byte WinAnsi (caratteri non rappresentabili diventano '?'). Tabulazioni e a capo diventano spazi.
export function toWinAnsi(text) {
  const out = [];
  for (const ch of String(text ?? '').replace(/[\t\r\n]+/g, ' ')) {
    const c = ch.codePointAt(0);
    if (CP1252[ch] != null) out.push(CP1252[ch]);
    else if (c >= 32 && c < 127) out.push(c);
    else if (c >= 0xA0 && c <= 0xFF) out.push(c);
    else if (c === 0x2009 || c === 0x202F || c === 0x00A0) out.push(32);
    else out.push(63);
  }
  return out;
}

// Larghezze dei byte WinAnsi fuori da 32..126 che non sono lettere accentate (millesimi di corpo).
const SPECIAL = { 0x80: 556, 0x85: 1000, 0x91: 222, 0x92: 222, 0x93: 333, 0x94: 333, 0x95: 350, 0x96: 556, 0x97: 1000, 0xA0: 278, 0xB7: 278 };

function byteWidth(b, bold) {
  const t = bold ? WIDTHS.bold : WIDTHS.reg;
  if (b >= 32 && b <= 126) return t[b - 32];
  if (SPECIAL[b] != null) return SPECIAL[b];
  if (b >= 0xC0) { // lettera accentata di Latin-1: larghezza della lettera base
    const base = String.fromCharCode(b).normalize('NFD').charCodeAt(0);
    if (base >= 65 && base <= 122) return t[base - 32];
  }
  return 556;
}

// Larghezza in punti.
export function textWidth(text, size, bold = false) {
  let w = 0;
  for (const b of toWinAnsi(text)) w += byteWidth(b, bold);
  return (w * size) / 1000;
}

// Spezza `text` in righe alle spaziature: la prima larga al massimo `firstW` punti, le altre `restW` (rientro sospeso).
// Una parola piu' larga della riga si taglia.
export function wrapText(text, size, bold, firstW, restW = firstW) {
  const words = String(text ?? '').replace(/[\t\r\n]+/g, ' ').split(' ').filter((x) => x !== '');
  const lines = [];
  let cur = '';
  const limit = () => (lines.length === 0 ? firstW : restW);
  for (let word of words) {
    while (textWidth(word, size, bold) > limit()) {
      let k = word.length;
      while (k > 1 && textWidth(word.slice(0, k), size, bold) > limit()) k--;
      if (cur !== '') { lines.push(cur); cur = ''; }
      lines.push(word.slice(0, k));
      word = word.slice(k);
    }
    const next = cur === '' ? word : cur + ' ' + word;
    if (textWidth(next, size, bold) <= limit()) cur = next;
    else { lines.push(cur); cur = word; }
  }
  if (cur !== '') lines.push(cur);
  return lines.length ? lines : [''];
}

const esc = (bytes) => bytes.map((b) => (b === 40 || b === 41 || b === 92 ? '\\' + String.fromCharCode(b) : b > 126 || b < 32 ? '\\' + b.toString(8).padStart(3, '0') : String.fromCharCode(b))).join('');
const num = (n) => (Math.round(n * 100) / 100).toString();

export function createPdf({ title = '', author = '', footer = '', margin = 48, date = new Date() } = {}) {
  const pages = [[]]; // per pagina: operazioni di contenuto (stringhe)
  let y = H - margin; // posizione verticale corrente (dall'alto della pagina verso il basso)
  const bottom = margin + 14; // sotto: piè di pagina
  const innerW = W - 2 * margin;

  const newPage = () => { pages.push([]); y = H - margin; };
  const ensure = (h) => { if (y - h < bottom) newPage(); };
  const op = (s) => pages[pages.length - 1].push(s);
  const color = (c) => (c ? `${c.map(num).join(' ')} rg` : '0 g');
  const drawAt = (x, baseY, text, size, bold, c) => op(`BT /${bold ? 'F2' : 'F1'} ${num(size)} Tf ${color(c)} ${num(x)} ${num(baseY)} Td (${esc(toWinAnsi(text))}) Tj ET`);

  const api = {
    // Paragrafo con ritorno a capo. indent = rientro in punti; hang = rientro in piu' delle righe successive.
    text(text, { size = 10, bold = false, indent = 0, hang = 0, color: c = null, gap = 2, keepWithNext = 0, bar = null } = {}) {
      const lh = size * 1.3;
      const lines2 = wrapText(text, size, bold, innerW - indent, innerW - indent - hang);
      ensure(Math.min(lines2.length, 2) * lh + keepWithNext);
      lines2.forEach((l, i) => {
        ensure(lh);
        y -= lh;
        if (bar) op(`${bar.map(num).join(' ')} rg ${num(margin + indent - 8)} ${num(y)} 3 ${num(lh)} re f`); // barra colorata a sinistra
        drawAt(margin + indent + (i ? hang : 0), y + size * 0.28, l, size, bold, c);
      });
      y -= gap;
      return api;
    },
    // Una riga con celle a posizioni fisse: [{ text, x (dal margine), align: 'left'|'right', bold, color }]. Non va a capo.
    row(cells, { size = 10, gap = 2 } = {}) {
      const lh = size * 1.3;
      ensure(lh);
      y -= lh;
      for (const c of cells) {
        const bold = !!c.bold;
        let x = margin + (c.x || 0);
        if (c.align === 'right') x = margin + innerW - (c.right || 0) - textWidth(c.text, size, bold);
        drawAt(x, y + size * 0.28, c.text, size, bold, c.color || null);
      }
      y -= gap;
      return api;
    },
    rule({ gap = 4, color: c = [0.75, 0.75, 0.75] } = {}) {
      ensure(gap * 2);
      y -= gap;
      op(`${c.map(num).join(' ')} RG 0.6 w ${num(margin)} ${num(y)} m ${num(margin + innerW)} ${num(y)} l S`);
      y -= gap;
      return api;
    },
    space(h) { y -= h; if (y < bottom) newPage(); return api; },
    // Spazio rimasto nella pagina (punti), per decidere se iniziare un blocco qui o in una pagina nuova.
    remaining() { return y - bottom; },
    pageBreak() { newPage(); return api; },
    get pageCount() { return pages.length; },

    // Costruisce il file: ritorna Uint8Array.
    build() {
      const total = pages.length;
      const objs = []; // stringhe "latin1" (un carattere = un byte)
      const add = (s) => { objs.push(s); return objs.length; };
      add('<< /Type /Catalog /Pages 2 0 R >>');
      add(''); // 2: Pages, riempito dopo
      add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
      add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
      const p2 = (n) => String(n).padStart(2, '0');
      const d = `D:${date.getFullYear()}${p2(date.getMonth() + 1)}${p2(date.getDate())}${p2(date.getHours())}${p2(date.getMinutes())}${p2(date.getSeconds())}`;
      add(`<< /Title (${esc(toWinAnsi(title))}) /Author (${esc(toWinAnsi(author))}) /Producer (Sticker Battle Report) /CreationDate (${d}) >>`);
      const pageIds = [];
      pages.forEach((ops, i) => {
        const foot = `BT /F1 8 Tf 0.45 g ${num(margin)} ${num(margin - 4)} Td (${esc(toWinAnsi(footer))}) Tj ET `
          + `BT /F1 8 Tf 0.45 g ${num(W - margin - textWidth(`Pagina ${i + 1} di ${total}`, 8))} ${num(margin - 4)} Td (${esc(toWinAnsi(`Pagina ${i + 1} di ${total}`))}) Tj ET`;
        const stream = ops.join('\n') + '\n' + foot;
        const cid = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
        const pid = add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(W)} ${num(H)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${cid} 0 R >>`);
        pageIds.push(pid);
      });
      objs[1] = `<< /Type /Pages /Count ${total} /Kids [${pageIds.map((n) => n + ' 0 R').join(' ')}] >>`;
      let out = '%PDF-1.4\n%âãÏÓ\n';
      const offsets = [];
      objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
      const xref = out.length;
      out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
      for (const off of offsets) out += String(off).padStart(10, '0') + ' 00000 n \n';
      out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
      const bytes = new Uint8Array(out.length);
      for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
      return bytes;
    }
  };
  return api;
}
