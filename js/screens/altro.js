import { saveBlob, shareBlobs, timestamp } from '../export.js';
import { toast } from '../app.js';
import * as D from '../db.js';
import { confirmSheet, noticeSheet } from '../ui.js';
import * as B from '../backup.js';
import { generateTestData, deleteTestData, testDataStats } from '../testdata.js';
import { queueButtonHTML, bindQueueButton, queueActionsHTML, bindQueueActions } from './coda.js';

// Disegna fuori dal DOM a pixel reali 1080x360, sfondo trasparente.
function drawTestSticker() {
  const W = 1080, H = 360;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.beginPath();
  ctx.roundRect(24, 24, W - 48, H - 48, 40);
  ctx.fill();

  ctx.font = '700 150px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 14;
  ctx.strokeStyle = '#000000';
  ctx.strokeText('TEST STICKER', W / 2, H / 2);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('TEST STICKER', W / 2, H / 2);
  return canvas;
}

function makeBlob() {
  return new Promise((resolve, reject) => {
    drawTestSticker().toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob fallito'))), 'image/png');
  });
}

export function render(el) {
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
    <p class="meta">Salva tutti scarica un file ogni 400 ms in Download (Chrome può chiedere una volta il permesso per più download). Condividi tutti apre un'unica condivisione con tutti i file.</p>
    <h2>Test esportazione</h2>
    <p>Salva il PNG di prova, poi in InShot apri Sticker → personalizzato e controlla che si veda sul video con lo sfondo trasparente.</p>
    <div class="checker"><img id="test-preview" alt="Anteprima sticker di prova"></div>
    <div class="row">
      <button id="btn-save" class="primary" type="button">Salva PNG di prova</button>
      <button id="btn-share" type="button">Condividi PNG di prova</button>
    </div>
    <p class="meta">Il file va nella cartella Download. Per InShot usa la Galleria o Google Foto, non WhatsApp o Telegram (perdono la trasparenza).</p>
    <h2>Archivio immagini</h2>
    <p class="meta" id="img-stats">Calcolo…</p>
    <h2>Dati di prova <span class="meta">(temporaneo)</span></h2>
    <p class="meta">Per controllare Crea con tanti elementi: crea un gioco «Prova» con 100 miniature, 160 armi e 40 azioni inventate, più recenti e preferiti. «Elimina» toglie solo quelli.</p>
    <p class="meta" id="test-stats">Controllo…</p>
    <div class="row">
      <button id="btn-gen" type="button">Genera 300 elementi di prova</button>
      <button id="btn-del" type="button" class="danger">Elimina dati di prova</button>
    </div>
  `;

  bindQueueButton(el);
  bindQueueActions(el);
  bindBackup(el);
  const qinfo = el.querySelector('#q-info');
  const updQ = async () => {
    if (!el.isConnected) { window.removeEventListener('sbr-queue', updQ); return; }
    try { const n = await D.ready().then(() => D.queueCount()); qinfo.textContent = n ? `${n} sticker in coda.` : 'Nessuno sticker in coda.'; } catch { qinfo.textContent = 'Database non disponibile.'; }
  };
  window.addEventListener('sbr-queue', updQ);
  updQ();

  const tstats = el.querySelector('#test-stats');
  const btnGen = el.querySelector('#btn-gen');
  const btnDel = el.querySelector('#btn-del');
  async function refreshTest() {
    try {
      const s = await D.ready().then(testDataStats);
      tstats.textContent = s ? `Presenti: ${s.units} miniature, ${s.weapons} armi, ${s.actions} azioni.` : 'Nessun dato di prova.';
      btnGen.disabled = !!s;
      btnDel.disabled = !s;
    } catch (err) { tstats.textContent = 'Database non disponibile.'; }
  }
  refreshTest();
  btnGen.addEventListener('click', async () => {
    btnGen.disabled = true;
    tstats.textContent = 'Genero…';
    try { await D.ready(); await generateTestData(); toast('Dati di prova creati'); } catch (err) { console.error(err); toast('Errore: ' + err.message); }
    refreshTest();
  });
  btnDel.addEventListener('click', async () => {
    const ok = await confirmSheet({ title: 'Eliminare i dati di prova?', lines: ['Verranno tolti solo il gioco «Prova» con tutto il suo contenuto e i recenti o preferiti che lo riguardano.'], confirmLabel: 'Elimina', danger: true });
    if (!ok) return;
    btnDel.disabled = true;
    try { await deleteTestData(); toast('Dati di prova eliminati'); } catch (err) { console.error(err); toast('Errore: ' + err.message); }
    refreshTest();
  });

  const stats = el.querySelector('#img-stats');
  D.ready().then(() => D.imageStats()).then((s) => {
    stats.textContent = `Immagini: ${s.total} (miniature ${s.unit}, armi ${s.weapon}) · orfane: ${s.orphans}`;
  }).catch(() => { stats.textContent = 'Database non disponibile.'; });

  const img = el.querySelector('#test-preview');
  makeBlob().then((b) => {
    const url = URL.createObjectURL(b);
    img.src = url;
    img.onload = () => URL.revokeObjectURL(url);
  });

  el.querySelector('#btn-save').addEventListener('click', async () => {
    const blob = await makeBlob();
    saveBlob(blob, `BR_test_${timestamp()}.png`);
    toast('Salvato in Download');
  });

  el.querySelector('#btn-share').addEventListener('click', async () => {
    const blob = await makeBlob();
    const r = await shareBlobs([blob], [`BR_test_${timestamp()}.png`]);
    if (r === 'saved') toast('Condivisione non disponibile: salvato in Download');
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
