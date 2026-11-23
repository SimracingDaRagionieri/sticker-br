// Controllo automatico dell'interfaccia (Passo 13): da incollare in page.evaluate (restituisce un oggetto).
// - aree di tocco: ogni controllo visibile deve essere almeno 48 x 48 px (CSS); sono esclusi i collegamenti dentro un
//   paragrafo/etichetta di testo, i campi spuntabili la cui etichetta e' abbastanza grande e gli elementi nascosti.
// - contrasto: il testo visibile deve avere un rapporto di almeno 4,5:1 (3:1 se grande) col fondo effettivo; sono esclusi
//   i testi sopra immagini o canvas (sticker, scacchi) perche' il fondo non e' un colore.
() => {
  const MIN = 48, EPS = 0.6;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
      if (e.hasAttribute && e.hasAttribute('hidden')) return false;
    }
    return true;
  };
  const label = (el) => {
    const t = (el.getAttribute('aria-label') || el.textContent || el.value || el.placeholder || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const cls = (el.className && typeof el.className === 'string') ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${cls} «${t}»`;
  };
  const taps = [];
  const sel = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [data-tap]';
  document.querySelectorAll(sel).forEach((el) => {
    if (!visible(el)) return;
    if (el.tagName === 'A' && el.closest('p, li > span, .meta')) return; // collegamento dentro un testo
    if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) {
      const lb = el.closest('label');
      if (lb) { const r = lb.getBoundingClientRect(); if (r.height >= MIN - EPS) return; }
    }
    if (el.tagName === 'INPUT' && el.type === 'file') return;
    const r = el.getBoundingClientRect();
    if (r.height < MIN - EPS || r.width < MIN - EPS) taps.push({ el: label(el), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 });
  });

  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const blend = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const bgOf = (el) => {
    const stack = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null; // gradiente/immagine: non valutabile
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; }
    }
    let base = { r: 17, g: 17, b: 17, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) base = blend(stack[i], base);
    return base;
  };
  const contrasts = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    if (!el || seen.has(el) || !visible(el)) continue;
    if (el.closest('canvas, svg, textarea, option, script, style, [data-skip-contrast]')) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    const fg = parse(cs.color); const bg = bgOf(el);
    if (!fg || !bg) continue;
    if (el.closest('button:disabled, [disabled]')) continue; // i controlli spenti sono esenti
    const f = blend(fg, bg);
    const l1 = lum([f.r, f.g, f.b]), l2 = lum([bg.r, bg.g, bg.b]);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const px = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
    const large = px >= 24 || (bold && px >= 18.66);
    if (ratio < (large ? 3 : 4.5)) contrasts.push({ el: label(el), ratio: Math.round(ratio * 100) / 100, fg: cs.color, bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})` });
  }
  return { taps, contrasts };
}
