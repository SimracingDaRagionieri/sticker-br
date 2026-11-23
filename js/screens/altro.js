import { saveBlob, shareBlobs, timestamp } from '../export.js';
import { toast } from '../app.js';

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
    <h1>Altro</h1>
    <h2>Test esportazione</h2>
    <p>Salva il PNG di prova, poi in InShot apri Sticker → personalizzato e controlla che si veda sul video con lo sfondo trasparente.</p>
    <div class="checker"><img id="test-preview" alt="Anteprima sticker di prova"></div>
    <div class="row">
      <button id="btn-save" class="primary" type="button">Salva PNG di prova</button>
      <button id="btn-share" type="button">Condividi PNG di prova</button>
    </div>
    <p class="meta">Il file va nella cartella Download. Per InShot usa la Galleria o Google Foto, non WhatsApp o Telegram (perdono la trasparenza).</p>
  `;

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
