// Log della partita (Passo 10): elenco delle partite e creazione. La partita aperta vive in logmatch.js.
// Route: #/log (elenco), #/log?m=<id> (partita; &v=cron = cronologia).

import * as D from '../db.js';
import { parseHash, toast } from '../app.js';
import { esc, menuSheet, confirmSheet, formSheet, pickSheet } from '../ui.js';

let child = null; // modulo logmatch.js mentre una partita e' aperta

export function cleanup() {
  if (child && child.cleanup) child.cleanup();
  child = null;
}

export async function render(el) {
  const { query } = parseHash();
  const m = Number(query.get('m'));
  if (m) {
    child = await import('./logmatch.js');
    await child.renderMatch(el, m, query);
    return;
  }
  await listScreen(el);
}

const sideLabel = (s, i) => (s && (s.player || s.factionName)) || `Lato ${i + 1}`;
const vsText = (m) => (m.name || (m.sides || []).map(sideLabel).join(' vs '));

function dateText(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function listScreen(el) {
  await D.ready();
  const matches = await D.listMatches();
  const counts = await Promise.all(matches.map(async (m) => {
    const ev = await D.listMatchEvents(m.id);
    return { turns: ev.filter((e) => e.type === 'turn-start').length, events: ev.length };
  }));
  const labelOf = (m, c) => `${m.gameName || 'Gioco eliminato'} · ${m.status === 'done' ? 'terminata' : 'in corso'} · ${c.turns} ${m.turnLabel || 'Turno'} · ${c.events} voci${m.startedAt ? ' · ' + dateText(m.startedAt) : ''}`;

  el.innerHTML = `
    <div class="section-head"><h1>Log</h1>
      <button type="button" class="add" data-new aria-label="Nuova partita">+</button></div>
    <p class="meta">Registra la partita mentre giochi, o ricostruiscila dopo a mano: il battle report si ricava da qui.</p>
    ${matches.length ? `<ul class="list" data-list="match">${matches.map((m, i) => `
      <li class="item">
        <a class="item-main" href="#/log?m=${m.id}">
          <span class="item-name">${esc(vsText(m))}${m.mission ? ` <span class="meta">· ${esc(m.mission)}</span>` : ''}</span>
          <span class="item-meta">${esc(labelOf(m, counts[i]))}</span>
          <span class="chev">›</span>
        </a>
        <button type="button" class="kebab" data-menu="${m.id}" aria-label="Menu di ${esc(vsText(m))}">⋮</button>
      </li>`).join('')}</ul>`
    : '<p class="empty">Nessuna partita. Tocca + per iniziarne una.</p>'}`;

  el.querySelector('[data-new]').addEventListener('click', () => newMatch());
  el.querySelectorAll('[data-menu]').forEach((b) => b.addEventListener('click', () => {
    const m = matches.find((x) => x.id === Number(b.dataset.menu));
    menuSheet(vsText(m), [
      { label: 'Apri', run: () => { location.hash = `#/log?m=${m.id}`; } },
      { label: 'Nuova partita con la stessa rosa', run: async () => {
        try { const id = await D.duplicateMatchRoster(m.id); toast('Rosa duplicata'); location.hash = `#/log?m=${id}`; } catch (err) { console.error(err); toast('Errore: ' + err.message); }
      } },
      { label: 'Elimina partita', danger: true, run: async () => {
        const ev = await D.listMatchEvents(m.id);
        const ok = await confirmSheet({ title: `Eliminare «${vsText(m)}»?`, lines: [`Verranno eliminate ${ev.length} voci del log e la rosa. Non si può annullare.`], confirmLabel: 'Elimina', danger: true });
        if (!ok) return;
        await D.deleteMatch(m.id);
        toast('Partita eliminata');
        listScreen(el);
      } }
    ]);
  }));
}

async function newMatch() {
  const games = await D.listGames();
  if (!games.length) { toast('Aggiungi prima un gioco in Libreria'); return; }
  const last = await D.getSetting('lastLogGameId', null);
  const ordered = [...games].sort((a, b) => (b.id === last) - (a.id === last));
  const gid = await pickSheet({ title: 'Che gioco?', options: ordered.map((g) => ({ value: String(g.id), label: g.name, sub: g.id === last ? 'ultimo usato' : '' })) });
  if (gid == null) return;
  const game = games.find((g) => g.id === Number(gid));
  const factions = await D.listFactions(game.id);
  const fOptions = [{ value: '', label: '(scrivo il nome)' }, ...factions.map((f) => ({ value: String(f.id), label: f.name }))];
  const L = game.labels || {};
  const v = await formSheet({
    title: `Nuova partita - ${game.name}`,
    submitLabel: 'Crea',
    fields: [
      { name: 'name', label: 'Nome della partita (facoltativo)', type: 'text', value: '' },
      { name: 'mission', label: 'Missione (facoltativo)', type: 'text', value: '' },
      { name: 'mode', label: 'Modalità', type: 'select', value: 'live', options: [{ value: 'live', label: 'In diretta (al tavolo)' }, { value: 'rebuild', label: 'Ricostruzione (dopo, a mano)' }] },
      { name: 'p0', label: 'Giocatore 1', type: 'text', value: '' },
      { name: 'f0', label: `${L.faction || 'Fazione'} del giocatore 1`, type: 'select', value: '', options: fOptions },
      { name: 'n0', label: `Nome ${String(L.faction || 'fazione').toLowerCase()} 1 (solo se «scrivo il nome»)`, type: 'text', value: '' },
      { name: 'p1', label: 'Giocatore 2', type: 'text', value: '' },
      { name: 'f1', label: `${L.faction || 'Fazione'} del giocatore 2`, type: 'select', value: '', options: fOptions },
      { name: 'n1', label: `Nome ${String(L.faction || 'fazione').toLowerCase()} 2 (solo se «scrivo il nome»)`, type: 'text', value: '' }
    ]
  });
  if (!v) return;
  try {
    const side = (i) => {
      const f = factions.find((x) => String(x.id) === v['f' + i]);
      return { player: v['p' + i], factionId: f ? f.id : null, factionName: f ? f.name : v['n' + i] };
    };
    const id = await D.createMatch({ gameId: game.id, name: v.name, mission: v.mission, mode: v.mode, sides: [side(0), side(1)] });
    await D.setSetting('lastLogGameId', game.id);
    location.hash = `#/log?m=${id}`;
  } catch (err) { console.error(err); toast('Errore: ' + err.message); }
}
