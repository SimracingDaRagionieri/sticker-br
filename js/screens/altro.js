import { fmtBytes } from '../export.js';
import { toast } from '../app.js';
import * as D from '../db.js';
import { confirmSheet, noticeSheet } from '../ui.js';
import * as B from '../backup.js';
import * as F from '../folder.js';
import { queueButtonHTML, bindQueueButton, queueActionsHTML, bindQueueActions } from './coda.js';

// Versione dell'app = CACHE_VERSION del service worker che controlla la pagina (che e' anche quello che ha in cache i file).
function appVersion() {
  return new Promise((resolve) => {
    const c = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (!c) { resolve(null); return; }
    const ch = new MessageChannel();
    const t = setTimeout(() => resolve(null), 2000);
    ch.port1.onmessage = (e) => { clearTimeout(t); resolve(typeof e.data === 'string' ? e.data : null); };
    c.postMessage('GET_VERSION', [ch.port2]);
  });
}

export function render(el) {
  const dirOk = F.folderSupported();
  el.innerHTML = `
    <div class="title-row"><h1>Altro</h1>${queueButtonHTML()}</div>
    <h2>Backup</h2>
    <p class="meta" id="bk-info">Controllo…</p>
    <div class="row">
      <button id="bk-save" class="primary" type="button">Salva backup</button>
      <button id="bk-share" type="button">Condividi backup</button>
    </div>
    <div class="row">
      <button id="bk-restore" class="danger" type="button">Ripristina da un backup…</button>
    </div>
    <input id="bk-file" type="file" accept=".zip,application/zip,application/x-zip-compressed" hidden>
    <p class="meta" id="bk-msg" role="status"></p>
    <p class="meta">Il file BR_backup_AAAAMMGG.zip contiene tutti i dati (giochi, squadre, miniature, armi, azioni, template, font, regole, partite e coda) con le immagini. Le carte importate non si salvano. Ripristinare SOSTITUISCE tutti i dati attuali, dopo aver scaricato un backup di quelli di adesso. Il backup serve se si svuotano i dati del sito o si cambia telefono.</p>
    <h2>Coda sticker</h2>
    <p class="meta" id="q-info">Controllo…</p>
    ${queueActionsHTML()}
    <div class="row"><a class="btn btn-link" href="#/coda">Apri la coda</a></div>
    <p class="meta">Salva tutti scarica un file ogni 400 ms in Download (Chrome può chiedere una volta il permesso per più download). Condividi tutti apre un'unica condivisione con tutti i file. Per InShot prendi gli sticker dalla Galleria o da Google Foto, non da WhatsApp o Telegram (perdono la trasparenza).</p>
    ${dirOk ? `<h2>Cartella di salvataggio</h2>
    <p class="meta" id="dir-info" role="status">Controllo…</p>
    <div class="row">
      <button id="dir-pick" type="button">Scegli la cartella…</button>
      <button id="dir-clear" type="button" hidden>Usa Download</button>
    </div>
    <p class="meta">Gli sticker PNG vanno in questa cartella invece che in Download. Se il permesso manca o la cartella non è più scrivibile, l'app salva in Download e lo dice. Backup e PDF del log vanno sempre in Download.</p>` : ''}
    <h2>Spazio e memoria</h2>
    <p class="meta" id="st-usage">Calcolo…</p>
    <p class="meta" id="st-persist">Controllo…</p>
    <div class="row"><button id="st-persist-btn" type="button" hidden>Richiedi la memoria persistente</button></div>
    <p class="meta" id="img-stats">Calcolo…</p>
    <h2>App</h2>
    <p class="meta" id="app-version">Controllo…</p>
    <div class="row"><button id="app-update" type="button">Cerca aggiornamenti</button></div>
  `;

  bindQueueButton(el);
  bindQueueActions(el);
  bindBackup(el);
  if (dirOk) bindFolder(el);
  bindStorage(el);
  const qinfo = el.querySelector('#q-info');
  const updQ = async () => {
    if (!el.isConnected) { window.removeEventListener('sbr-queue', updQ); return; }
    try { const n = await D.ready().then(() => D.queueCount()); qinfo.textContent = n ? `${n} sticker in coda.` : 'Nessuno sticker in coda.'; } catch { qinfo.textContent = 'Database non disponibile.'; }
  };
  window.addEventListener('sbr-queue', updQ);
  updQ();
}

// ---------- cartella dedicata (Passo 13) ----------

function bindFolder(el) {
  const info = el.querySelector('#dir-info');
  const pick = el.querySelector('#dir-pick');
  const clear = el.querySelector('#dir-clear');
  async function refresh() {
    let h = null;
    try { h = await F.getFolder(); } catch { /* database non pronto */ }
    clear.hidden = !h;
    pick.textContent = h ? 'Cambia cartella…' : 'Scegli la cartella…';
    if (!h) { info.textContent = 'Nessuna cartella scelta: gli sticker vanno in Download.'; return; }
    const ok = await F.hasPermission(h, false);
    info.textContent = `Cartella: «${h.name}». ` + (ok ? 'Permesso attivo.' : 'Il browser chiederà il permesso al prossimo salvataggio.');
  }
  refresh();
  pick.addEventListener('click', async () => {
    try {
      const h = await F.chooseFolder();
      if (h) toast(`Cartella scelta: «${h.name}»`);
    } catch (err) {
      console.error(err);
      await noticeSheet({ title: 'Cartella non disponibile', lines: [err.message || String(err), 'Gli sticker restano in Download.'] });
    }
    refresh();
  });
  clear.addEventListener('click', async () => {
    await F.clearFolder();
    toast('Gli sticker vanno di nuovo in Download');
    refresh();
  });
}

// ---------- spazio, memoria persistente, versione (Passo 13) ----------

function bindStorage(el) {
  const usage = el.querySelector('#st-usage');
  const persist = el.querySelector('#st-persist');
  const pbtn = el.querySelector('#st-persist-btn');
  const stats = el.querySelector('#img-stats');
  const ver = el.querySelector('#app-version');

  async function refreshUsage() {
    try {
      const e = await navigator.storage.estimate();
      usage.textContent = `Spazio usato dall'app: ${fmtBytes(e.usage)}` + (e.quota ? ` su ${fmtBytes(e.quota)} disponibili.` : '.');
    } catch { usage.textContent = 'Spazio usato: non disponibile su questo browser.'; }
  }
  async function refreshPersist() {
    try {
      const yes = await navigator.storage.persisted();
      persist.textContent = yes ? 'Memoria persistente: sì (Android non cancella i dati se lo spazio scarseggia).'
        : 'Memoria persistente: no (con poco spazio Android potrebbe cancellare i dati: fai un backup).';
      pbtn.hidden = yes;
    } catch { persist.textContent = 'Memoria persistente: non disponibile su questo browser.'; pbtn.hidden = true; }
  }
  refreshUsage();
  refreshPersist();
  pbtn.addEventListener('click', async () => {
    try {
      const ok = await navigator.storage.persist();
      toast(ok ? 'Memoria persistente attivata' : 'Il browser non l\'ha concessa: fai un backup ogni tanto');
    } catch (err) { toast('Errore: ' + err.message); }
    refreshPersist();
  });

  D.ready().then(() => D.imageStats()).then((s) => {
    stats.textContent = `Immagini salvate: ${s.total} (miniature ${s.unit}, armi ${s.weapon}) · orfane: ${s.orphans}`;
  }).catch(() => { stats.textContent = 'Database non disponibile.'; });

  appVersion().then((v) => {
    ver.textContent = v ? `Versione dell'app: ${v}.` : 'Versione dell\'app: non disponibile (il servizio offline non è ancora attivo: riapri l\'app).';
  });
  el.querySelector('#app-update').addEventListener('click', async () => {
    try {
      const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
      if (!reg) { toast('Il servizio offline non è attivo'); return; }
      await reg.update();
      if (reg.waiting || reg.installing) toast('Nuova versione trovata: tocca «Aggiorna» nella barra in alto');
      else toast('L\'app è già aggiornata');
    } catch (err) { toast('Controllo non riuscito: ' + (err.message || err)); }
  });
}

// ---------- backup e ripristino (Passo 12) ----------

function bindBackup(el) {
  const info = el.querySelector('#bk-info');
  const msg = el.querySelector('#bk-msg');
  const btnSave = el.querySelector('#bk-save');
  const btnShare = el.querySelector('#bk-share');
  const btnRestore = el.querySelector('#bk-restore');
  const btns = [btnSave, btnShare, btnRestore];
  const file = el.querySelector('#bk-file');
  const busy = (on, text = '') => { btns.forEach((b) => { b.disabled = on; }); msg.textContent = text; };

  async function refresh() {
    try {
      const st = await B.backupStatus();
      const pending = st.lastChangeAt != null && (st.lastBackupAt == null || st.lastChangeAt > st.lastBackupAt);
      info.textContent = `Ultimo backup: ${B.agoText(st.lastBackupAt)}.` + (pending ? ' Ci sono modifiche successive.' : '');
    } catch (err) { info.textContent = 'Database non disponibile.'; }
  }
  refresh();

  async function run(fn, doneText) {
    busy(true, 'Preparo il backup…');
    try {
      toast(doneText(await fn()));
    } catch (err) {
      console.error(err);
      await noticeSheet({ title: 'Backup non riuscito', lines: [err.message || String(err)] });
    }
    busy(false);
    refresh();
  }
  btnSave.addEventListener('click', () => run(() => B.saveBackup(), (r) => `Salvato ${r.filename} in Download`));
  btnShare.addEventListener('click', () => run(() => B.shareBackup(), (r) => (r.how === 'shared' ? 'Backup condiviso'
    : r.how === 'saved' ? `Condivisione non disponibile: salvato ${r.filename}` : 'Condivisione annullata')));

  btnRestore.addEventListener('click', () => { file.value = ''; file.click(); });
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    file.value = ''; // si puo' scegliere di nuovo lo stesso file (il File gia' letto resta valido)
    if (!f) return;
    busy(true, 'Controllo il file…');
    let parsed;
    try {
      parsed = await B.readBackup(f);
    } catch (err) {
      busy(false);
      await noticeSheet({ title: 'File non valido', lines: [err.message || String(err), 'Non è stato toccato nessun dato.'] });
      return;
    }
    busy(false);
    const day = B.agoText(Date.parse(parsed.manifest.exportedAt)).replace(/ \(.*\)$/, '');
    const lines = [
      `Backup del ${day}: ${B.summaryLines(parsed.counts).join(', ')}.`,
      'Sostituisce tutti i dati attuali. Prima scarico in automatico un backup dei dati di adesso.'
    ];
    if (parsed.warnings.length) lines.push('Attenzione: ' + parsed.warnings.join('; ') + '.');
    const ok = await confirmSheet({ title: 'Ripristinare questo backup?', lines, confirmLabel: 'Sostituisci tutto', danger: true });
    if (!ok) return;
    busy(true, 'Ripristino…');
    try {
      await B.restoreBackup(parsed, { onStep: (s) => { msg.textContent = s === 'auto' ? 'Salvo i dati attuali…' : 'Ripristino…'; } });
      toast('Ripristinato: riapro l\'app…');
      // Ricarica la pagina: indice di ricerca, font importati e cache dei template ripartono dai dati ripristinati.
      setTimeout(() => { location.hash = '#/crea'; location.reload(); }, 600);
    } catch (err) {
      busy(false);
      await noticeSheet({ title: 'Ripristino non riuscito', lines: [err.message || String(err)] });
      refresh();
    }
  });
}
