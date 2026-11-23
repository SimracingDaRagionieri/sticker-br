// Esportazione del log di una partita in PDF (Passo 13). PURO (senza DOM e senza database, testato in Node con
// tests/logexport-test.mjs): prende partita, rosa, eventi e il risultato di `replay` (gli stessi dati di "Copia riepilogo")
// e produce i byte del PDF con js/pdfwrite.js. Contenuto: intestazione (partita, gioco, missione, date, giocatori), punti,
// rose a fine partita (ferite rimaste/massime, incapacitati), cronologia per turno (iniziativa e come, attivazioni,
// azioni, attacchi con danni e ferite rimaste, incapacitati, punti, note) e numero di avvisi di coerenza.

import { createPdf, textWidth } from './pdfwrite.js';
import { summaryEntries, teamColors } from './matchlog.js';

const GRAY = [0.4, 0.4, 0.4];
const RED = [0.7, 0.12, 0.12];

const p2 = (n) => String(n).padStart(2, '0');
export const dmy = (ms) => {
  if (ms == null || !Number.isFinite(Number(ms))) return '';
  const d = new Date(Number(ms));
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
};

export function buildLogPdf(match, units, events, rep, { sideName, now = new Date() } = {}) {
  const { entries, sn } = summaryEntries(match, units, events, rep, { sideName });
  const sides = match.sides || [];
  const title = match.name || sides.map((s) => s.player || s.factionName).join(' vs ') || 'Partita';
  const tc = teamColors(match).map((c) => c.pdf); // colori dei due team (versione per carta bianca)
  const pdf = createPdf({ title, footer: `${title} - Sticker Battle Report`, date: now });

  // Intestazione
  pdf.text(title, { size: 20, bold: true, gap: 3 });
  const dates = match.endedAt && dmy(match.endedAt) !== dmy(match.startedAt) ? `${dmy(match.startedAt)} - ${dmy(match.endedAt)}` : dmy(match.startedAt);
  const sub = [match.gameName, match.mission, dates, match.status === 'live' ? 'partita in corso' : ''].filter(Boolean).join(' · ');
  if (sub) pdf.text(sub, { size: 10, color: GRAY, gap: 4 });
  pdf.rule();
  for (let s = 0; s < Math.max(2, sides.length); s++) {
    const sd = sides[s] || {};
    const who = [sd.player, sd.factionName ? `(${sd.factionName})` : ''].filter(Boolean).join(' ') || `Lato ${s + 1}`;
    pdf.text(`${s + 1}. ${who}`, { size: 11, bold: true, gap: 1, color: tc[s] || null });
  }
  pdf.space(4);
  // "Punti: Lato A 2 – Lato B 0" con ogni lato nel suo colore
  const cells = [{ text: 'Punti:', x: 0, bold: true }];
  let px = textWidth('Punti: ', 14, true);
  rep.score.forEach((p, s) => {
    if (s) { cells.push({ text: '–', x: px, bold: true }); px += textWidth('– ', 14, true); }
    const t = `${sn(s)} ${p}`;
    cells.push({ text: t, x: px, bold: true, color: tc[s] || null });
    px += textWidth(t + ' ', 14, true);
  });
  pdf.row(cells, { size: 14, gap: 6 });
  if (match.notes) pdf.text(match.notes, { size: 9.5, color: GRAY, gap: 4 });

  // Rose a fine partita
  const ids = new Set(units.map((u) => u.id));
  const state = (u) => rep.units.get(u.id);
  if (ids.size) {
    pdf.text('Rose a fine partita', { size: 12, bold: true, gap: 2, keepWithNext: 40 });
    const nSides = Math.max(2, sides.length);
    for (let s = 0; s < nSides; s++) {
      const mine = units.filter((u) => u.side === s);
      if (!mine.length) continue;
      pdf.text(sn(s), { size: 10.5, bold: true, gap: 1, keepWithNext: 30, color: tc[s] || null });
      for (const u of mine) {
        const st = state(u);
        let right = 'ferite non tracciate';
        if (st && st.incapacitated) right = 'incapacitato';
        else if (st && st.max != null) right = `${st.left}/${st.max} ferite`;
        pdf.row([{ text: u.name, x: 12 }, { text: right, align: 'right', bold: !!(st && st.incapacitated), color: st && st.incapacitated ? RED : null }], { size: 10, gap: 0.5 });
      }
      pdf.space(4);
    }
  }

  // Cronologia
  pdf.rule({ gap: 5 });
  pdf.text('Cronologia', { size: 14, bold: true, gap: 3, keepWithNext: 50 });
  if (!entries.length) pdf.text('Nessuna voce registrata.', { size: 10, color: GRAY });
  const sideOf = (e) => {
    const d = rep.derived[e.index];
    const v = d && d.side != null ? d.side : events[e.index] && events[e.index].side;
    return v === 0 || v === 1 ? v : null;
  };
  for (const e of entries) {
    const sd = e.kind === 'turn' ? null : sideOf(e);
    const bar = sd != null ? tc[sd] : null;
    switch (e.kind) {
      case 'turn':
        pdf.space(6);
        pdf.text(e.label.trim(), { size: 12, bold: true, gap: 0, keepWithNext: 40 });
        if (e.ini) pdf.text(`Iniziativa: ${e.ini}`, { size: 10, color: GRAY, gap: 3, keepWithNext: 24 });
        else pdf.space(3);
        break;
      case 'activation':
        pdf.text(e.text, { size: 10.5, bold: true, indent: 8, gap: 1, keepWithNext: 14, color: bar, bar });
        break;
      case 'incapacitated':
        pdf.text(e.text, { size: 10, bold: true, indent: 24, hang: 10, color: RED, gap: 1, bar });
        break;
      case 'score':
        pdf.text(e.text, { size: 10, bold: true, indent: 8, gap: 1, color: bar, bar });
        break;
      case 'note':
        pdf.text(e.text, { size: 9.5, indent: 8, hang: 10, color: GRAY, gap: 1, bar });
        break;
      default:
        pdf.text(e.text, { size: 10, indent: 24, hang: 10, gap: 1, bar });
    }
  }
  if (rep.warnings.length) {
    pdf.space(8);
    pdf.text(`Nel log ci sono ${rep.warnings.length} avvisi di coerenza (ad esempio azioni di un operativo già incapacitato): controllali nell'app.`, { size: 9, color: GRAY });
  }
  return pdf.build();
}
