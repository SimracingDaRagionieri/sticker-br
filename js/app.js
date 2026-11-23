// Router a hash e registrazione del service worker.

const routes = {
  crea: () => import('./screens/crea.js'),
  libreria: () => import('./screens/libreria.js'),
  template: () => import('./screens/template.js'),
  altro: () => import('./screens/altro.js')
};

const view = document.getElementById('view');
const toastEl = document.getElementById('toast');
let toastTimer;

export function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2500);
}

async function navigate() {
  const name = (location.hash.replace(/^#\//, '').split(/[/?]/)[0]) || 'crea';
  const key = routes[name] ? name : 'crea';
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.route === key));
  view.innerHTML = '';
  const mod = await routes[key]();
  mod.render(view);
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', navigate);
if (!location.hash) location.hash = '#/crea';
navigate();

// --- Service worker e barra "Aggiorna" ---
const bar = document.getElementById('update-bar');
const btn = document.getElementById('update-btn');

function showUpdate(worker) {
  bar.hidden = false;
  btn.onclick = () => worker.postMessage('SKIP_WAITING');
}

if ('serviceWorker' in navigator) {
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdate(w);
      });
    });
  }).catch((err) => console.warn('Service worker non registrato', err));
}
