// Rilegge un file di diagnostica (salvato dall'app: "Salva file di diagnostica") e stampa cosa ne esce dal parser.
//   node tests/replay-dump.mjs tests/fixtures/diagnostica-pdf.json [en|it] [--full]
// Il file contiene testo Games Workshop: tienilo in tests/fixtures/ (ignorata da git), mai nel repository.
import fs from 'node:fs';
import { parseTeam, displayWeaponName } from '../js/pdfteam.js';
import { isBoldName } from '../js/pdfread.js';

const args = process.argv.slice(2);
const full = args.includes('--full');
const [file, lang = 'en'] = args.filter((a) => !a.startsWith('--'));
if (!file) { console.error('Uso: node tests/replay-dump.mjs <diagnostica.json> [en|it] [--full]'); process.exit(2); }
const d = JSON.parse(fs.readFileSync(file, 'utf8'));
// il grassetto si ricalcola dal nome del font: cosi' le correzioni a isBoldName valgono anche per file vecchi
for (const p of d.pages) for (const i of p.items) i.bold = isBoldName(i.font);
const r = parseTeam(d.pages, { lang, title: d.title || '' });
const cut = (s, n = 70) => (full ? s : String(s).slice(0, n));
console.log(`Squadra: ${r.faction.name} [${r.faction.nameSource}]  carte ${r.report.cards}, avvisi ${r.warnings.length} (nell'app: ${(d.warnings || []).length})`);
for (const o of r.operatives) {
  console.log(`- ${o.name} pag.${o.pages.join(',')} ${JSON.stringify(o.stats)} kw=${o.keywords.join('|')}`);
  for (const w of o.weapons) console.log(`    ${displayWeaponName(w.name, w.mode)} ${w.atk}/${w.hit}/${w.dmg} [${w.rules.join('; ')}]`);
  for (const a of o.abilities) console.log(`    ABILITA ${a.name}: ${cut(a.text)}`);
  for (const a of o.actions) console.log(`    AZIONE ${a.name} ${a.cost}: ${cut(a.text)}`);
}
const rl = (t, rows) => rows.forEach((x) => console.log(`${t} p.${x.page} ${x.kind || ''} ${x.name}${x.cards ? ' (carte ' + x.cards.join('+') + ')' : ''}: ${cut(x.text)}`));
rl('FAZIONE', r.factionRule); rl('PLOY', r.ploys); rl('EQUIP', r.equipment);
for (const w of r.warnings) console.log(`AVVISO p.${w.page} ${w.code}: ${w.message} «${w.text}»`);
for (const p of r.ignoredPages) console.log(`IGNORATA p.${p.page}: ${p.heading} (${p.reason})`);
