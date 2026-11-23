import { saveBlob, shareBlobs, timestamp } from '../export.js';
import { toast } from '../app.js';
import * as D from '../db.js';
import { confirmSheet } from '../ui.js';
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
