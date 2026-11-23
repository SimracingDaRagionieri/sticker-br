// Rilegge un file di diagnostica (salvato dall'app: "Salva file di diagnostica") e stampa cosa ne esce dal parser.
//   node tests/replay-dump.mjs tests/fixtures/diagnostica-pdf.json [en|it]
// Il file contiene testo Games Workshop: tienilo in tests/fixtures/ (ignorata da git), mai nel repository.
import fs from 'node:fs';
import { parseTeam, displayWeaponName } from '../js/pdfteam.js';

const [file, lang = 'en'] = process.argv.slice(2);
if (!file) { console.error('Uso: node tests/replay-dump.mjs <diagnostica.json> [en|it]'); process.exit(2); }
const d = JSON.parse(fs.readFileSync(file, 'utf8'));
const r = parseTeam(d.pages, { lang, title: d.title || '' });
console.log(`Squadra: ${r.faction.name}  carte ${r.report.cards}, avvisi ${r.warnings.length} (nell'app: ${(d.warnings || []).length})`);
for (const o of r.operatives) {
  console.log(`- ${o.name} pag.${o.pages.join(',')} ${JSON.stringify(o.stats)}`);
  for (const w of o.weapons) console.log(`    ${displayWeaponName(w.name, w.mode)} ${w.atk}/${w.hit}/${w.dmg} [${w.rules.join('; ')}]`);
  for (const a of o.abilities) console.log(`    ABILITA ${a.name}: ${a.text.slice(0, 70)}`);
}
for (const w of r.warnings) console.log(`AVVISO p.${w.page} ${w.code}: ${w.message} «${w.text}»`);
for (const p of r.ignoredPages) console.log(`IGNORATA p.${p.page}: ${p.heading} (${p.reason})`);
