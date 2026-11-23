// Router a hash e registrazione del service worker.

const routes = {
  anteprima: () => import('./screens/anteprima.js'),
  carta: () => import('./screens/carta.js'),
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

// Schermate senza voce nella barra in basso: la voce attiva resta quella di provenienza.
const NO_TAB = new Set(['anteprima', 'carta']);

// Legge l'hash: #/anteprima?unit=3&weapon=5 -> { name: 'anteprima', segs: [], query: URLSearchParams }
export function parseHash(hash = location.hash) {
  const raw = hash.replace(/^#\/?/, '');
  const qi = raw.indexOf('?');
  const path = qi < 0 ? raw : raw.slice(0, qi);
  const query = new URLSearchParams(qi < 0 ? '' : raw.slice(qi + 1));
  const [name = '', ...segs] = path.split('/').filter(Boolean);
  return { name, segs, query };
}

// true se in questa sessione si e' navigato almeno una volta dentro l'app (history.back() resta nell'app).
let navCount = 0;
let current = null; // modulo della schermata aperta
export const canGoBack = () => navCount > 0;

async function navigate() {
  const { name } = parseHash();
  const key = routes[name] ? name : 'crea';
  if (!NO_TAB.has(key)) {
    document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.route === key));
  }
  if (current && current.cleanup) current.cleanup(); // le schermate possono liberare memoria quando si esce
  view.innerHTML = '';
  const mod = await routes[key]();
  current = mod;
  mod.render(view);
  window.scrollTo(0, 0);
}

// Apre il database e crea i dati iniziali subito, senza bloccare l'interfaccia.
import('./db.js').then((m) => m.ready()).catch((err) => console.warn('Database non pronto', err));

window.addEventListener('hashchange', () => { navCount++; navigate(); });
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
