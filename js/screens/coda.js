// Coda degli sticker (Passo 11): #/coda = elenco con miniature, rimozione di un singolo sticker, Salva tutti,
// Condividi tutti, Svuota coda. Gli sticker (PNG gia' disegnati) stanno in IndexedDB, tabella `queue`, quindi
// sopravvivono se Android chiude l'app. Qui anche i pezzi condivisi con Altro e con le schermate che mostrano
// l'icona con il contatore.

import * as D from '../db.js';
import { shareBlobs } from '../export.js';
import { saveStickers, savedText } from '../folder.js';
import { toast, canGoBack } from '../app.js';
import { esc, confirmSheet } from '../ui.js';

export const SAVE_GAP_MS = 400; // pausa tra un download e il successivo (Chrome chiede una volta "download multipli")

// ---- icona con contatore ----
export const queueButtonHTML = () =>
  '<a class="q-btn" href="#/coda" data-q-btn aria-label="Coda sticker"><span class="q-ico" aria-hidden="true">⇩</span><b class="q-count" data-q-count hidden>0</b></a>';

// Aggiorna ogni [data-q-btn] dentro `root` ora e a ogni modifica della coda, finche' `root` e' nella pagina.
// Richiamarla piu' volte sullo stesso `root` (la schermata si ridisegna) non aggiunge ascoltatori.
const bound = new WeakMap();
export function bindQueueButton(root) {
  let upd = bound.get(root);
  if (!upd) {
    upd = async () => {
      if (!root.isConnected) { window.removeEventListener('sbr-queue', upd); bound.delete(root); return; }
      let n = 0;
      try { n = await D.queueCount(); } catch { /* database non pronto */ }
      root.querySelectorAll('[data-q-btn]').forEach((b) => {
        b.setAttribute('aria-label', `Coda sticker: ${n}`);
        const c = b.querySelector('[data-q-count]');
        c.textContent = String(n);
        c.hidden = n === 0;
      });
    };
    bound.set(root, upd);
    window.addEventListener('sbr-queue', upd);
  }
  upd();
}

// ---- azioni su tutta la coda ----
export async function saveAll() {
  const items = await D.queueList();
  if (!items.length) { toast('La coda è vuota'); return 0; }
  const r = await saveStickers(items.map((i) => ({ blob: i.blob, name: i.name })), { gapMs: SAVE_GAP_MS });
  toast(savedText(r));
  return items.length;
}

export async function shareAll() {
  const items = await D.queueList();
  if (!items.length) { toast('La coda è vuota'); return 0; }
  const r = await shareBlobs(items.map((i) => i.blob), items.map((i) => i.name));
  if (r === 'saved') toast('Condivisione non disponibile: salvati in Download');
  return r === 'cancelled' ? 0 : items.length;
}

export async function clearAll() {
  const n = await D.queueCount();
  if (!n) { toast('La coda è già vuota'); return false; }
  const ok = await confirmSheet({ title: 'Svuotare la coda?', lines: [`Verranno tolti ${n} sticker dalla coda. I file già salvati restano dove sono.`], confirmLabel: 'Svuota', danger: true });
  if (!ok) return false;
  await D.queueClear();
  toast('Coda svuotata');
  return true;
}

// Pulsanti Salva tutti / Condividi tutti / Svuota coda dentro `root` (attributi data-q-save, data-q-share, data-q-clear).
export const queueActionsHTML = () => `
  <div class="row">
    <button type="button" class="primary" data-q-save>Salva tutti</button>
    <button type="button" data-q-share>Condividi tutti</button>
  </div>
  <div class="row"><button type="button" class="danger" data-q-clear>Svuota coda</button></div>`;

export function bindQueueActions(root) {
  let busy = false;
  const guard = (fn) => async () => {
    if (busy) return;
    busy = true;
    try { await fn(); } catch (err) { console.error(err); toast('Errore: ' + err.message); } finally { busy = false; }
  };
  const on = (sel, fn) => { const b = root.querySelector(sel); if (b) b.addEventListener('click', guard(fn)); };
  on('[data-q-save]', saveAll);
  on('[data-q-share]', shareAll);
  on('[data-q-clear]', clearAll);
}

// ---------- schermata #/coda ----------

let urls = [];
let token = 0;
const revokeAll = () => { urls.forEach((u) => URL.revokeObjectURL(u)); urls = []; };
export function cleanup() { token++; revokeAll(); }

export async function render(el) {
  const my = ++token;
  const alive = () => my === token && el.isConnected;
  try { await D.ready(); } catch (err) { el.innerHTML = '<h1>Coda</h1><p class="empty">Impossibile aprire il database.</p>'; return; }

  const back = () => { if (canGoBack()) history.back(); else location.replace('#/altro'); };

  async function draw() {
    const items = await D.queueList();
    if (!alive()) return;
    revokeAll();
    el.innerHTML = `
      <div class="title-row">
        <div class="title-left"><button type="button" class="back" data-back aria-label="Indietro">‹</button><h1>Coda</h1></div>
      </div>
      <p class="meta" data-q-info>${items.length ? `${items.length} sticker pronti, nell'ordine in cui li salvi o condividi.` : 'Nessuno sticker in coda.'}</p>
      ${items.length ? `<ul class="q-list">${items.map((it) => {
        const url = URL.createObjectURL(it.blob);
        urls.push(url);
        return `<li class="q-item" data-qid="${it.id}">
          <span class="q-thumb checker-bg"><img src="${url}" alt="" loading="lazy"></span>
          <span class="q-txt"><b>${esc(it.label || it.name)}</b><small>${esc(it.name)}</small></span>
          <button type="button" class="kebab" data-q-del="${it.id}" aria-label="Togli dalla coda">✕</button>
        </li>`;
      }).join('')}</ul>${queueActionsHTML()}` : '<p class="empty">Aggiungi sticker dall\'Anteprima ("Aggiungi alla coda") o dal menu di una partita del Log ("Genera sticker della partita").</p>'}`;
    el.querySelector('[data-back]').addEventListener('click', back);
    bindQueueActions(el);
    el.querySelectorAll('[data-q-del]').forEach((b) => b.addEventListener('click', () => D.queueRemove(Number(b.dataset.qDel))));
  }
  // Ogni modifica della coda (anche Svuota o un'altra scheda) ridisegna l'elenco finche' la schermata e' aperta.
  const onChange = () => { if (!alive()) { window.removeEventListener('sbr-queue', onChange); return; } draw(); };
  window.addEventListener('sbr-queue', onChange);
  await draw();
}
