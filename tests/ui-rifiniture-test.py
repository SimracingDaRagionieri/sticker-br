#!/usr/bin/env python3
"""Prova dell'interfaccia del Passo 13 (Rifiniture) in Chrome headless (Playwright).

  python3 tests/ui-rifiniture-test.py [cartella_screenshot]

Controlla: Altro senza test di esportazione e dati di prova; spazio usato, memoria persistente e versione; cartella dedicata
(finta cartella OPFS: scelta, salvataggio dalla coda e da Anteprima, ripiego sul download se il permesso manca o la cartella
sparisce, "Usa Download", opzione nascosta senza showDirectoryPicker, dirHandle fuori dal backup e conservato al ripristino);
esportazione PDF del log dal menu della partita (Salva, Condividi, log vuoto; il file si rilegge con pdftotext); prova
offline con il service worker; aree di tocco (>= 48 px) e contrasti (>= 4,5:1) su tutte le schermate e sui pannelli.
"""
import http.server
import os
import re
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading
import datetime

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SHOTS = sys.argv[1] if len(sys.argv) > 1 else '/tmp/shots-rifiniture'
os.makedirs(SHOTS, exist_ok=True)
TMP = tempfile.mkdtemp(prefix='sbr-rif-')
AUDIT = open(os.path.join(HERE, 'audit-ui.js'), encoding='utf-8').read()
AUDIT = AUDIT[AUDIT.index('() => {'):]  # via il commento in testa: Playwright vuole l'espressione


class Quiet(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


class Srv(socketserver.ThreadingTCPServer):
    allow_reuse_address = True


srv = Srv(('127.0.0.1', 0), Quiet)
BASE = f'http://127.0.0.1:{srv.server_address[1]}/'
threading.Thread(target=srv.serve_forever, daemon=True).start()

fails = []


def check(cond, msg):
    print(('  ok   ' if cond else '  FAIL ') + msg)
    if not cond:
        fails.append(msg)


def js(page, code, arg=None):
    return page.evaluate(
        "async (arg) => { const m = await import('./js/db.js'); await m.ready(); return await (" + code + ")(m, arg); }", arg)


def new_page(ctx):
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.errors = errors
    return page


# finta cartella: una sottocartella dell'archivio privato del sito (OPFS), che ha createWritable come quella vera
OPFS_STUB = """
window.showDirectoryPicker = async () => {
  const root = await navigator.storage.getDirectory();
  window.__dirName = 'sbr-' + Math.random().toString(36).slice(2, 7);
  return root.getDirectoryHandle(window.__dirName, { create: true });
};
"""
NO_PICKER = "delete window.showDirectoryPicker;"


def opfs_files(page):
    return page.evaluate("""async () => {
      const root = await navigator.storage.getDirectory();
      const out = {};
      for await (const [name, h] of root.entries()) {
        if (h.kind !== 'directory' || !name.startsWith('sbr-')) continue;
        for await (const [fn, fh] of h.entries()) { const f = await fh.getFile(); out[name + '/' + fn] = [f.size, f.type]; }
      }
      return out;
    }""")


def png_blob_js():
    return "(w, h, c) => new Promise((r) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const x = cv.getContext('2d'); x.fillStyle = c; x.fillRect(0, 0, w, h); cv.toBlob(r, 'image/png'); })"


def add_queue(page, n):
    return js(page, """async (m, n) => {
      const mk = """ + png_blob_js() + """;
      await m.queueClear();
      for (let i = 1; i <= n; i++) await m.queueAdd({ key: 'rif-' + i, name: `BR_prova_${String(i).padStart(3, '0')}.png`, label: 'Prova ' + i, blob: await mk(60 + i, 40, '#c80') });
      return await m.queueCount();
    }""", n)


def toast_text(page, prefix=None, timeout=8000):
    """Testo del toast; con `prefix` attende che il toast (anche uno nuovo dopo uno vecchio ancora visibile) cominci cosi'."""
    cond = "document.querySelector('#toast') && !document.querySelector('#toast').hidden"
    if prefix:
        cond += f" && document.querySelector('#toast').textContent.startsWith({prefix!r})"
    try:
        page.wait_for_function(cond, timeout=timeout)
    except Exception:
        pass
    return page.inner_text('#toast')


with sync_playwright() as pw:
    browser = pw.chromium.launch()

    # ------------------------------------------------------------------ 1) Altro
    print('1) Altro: niente test di esportazione ne\' dati di prova; spazio, memoria persistente, versione')
    ctx = browser.new_context(viewport={'width': 412, 'height': 900}, service_workers='block', accept_downloads=True)
    ctx.add_init_script(OPFS_STUB)
    page = new_page(ctx)
    page.goto(BASE + '#/altro')
    page.wait_for_selector('#bk-save')
    body = page.inner_text('#view')
    for old in ['Test esportazione', 'Salva PNG di prova', 'Dati di prova', 'Genera 300', 'Elimina dati di prova']:
        check(old not in body, f'«{old}» non c\'e\' piu\'')
    check(page.locator('#btn-save, #btn-share, #btn-gen, #btn-del, #test-preview').count() == 0, 'nessun pulsante del test di esportazione o dei dati di prova')
    page.wait_for_function("!document.querySelector('#st-usage').textContent.includes('Calcolo')")
    usage = page.inner_text('#st-usage')
    check(re.search(r"Spazio usato dall'app: [\d,.]+ (byte|KB|MB|GB)( su [\d,.]+ (KB|MB|GB|TB) disponibili)?\.", usage) is not None, 'spazio usato: ' + usage)
    page.wait_for_function("!document.querySelector('#st-persist').textContent.includes('Controllo')")
    persist = page.inner_text('#st-persist')
    check(persist.startswith('Memoria persistente: sì') or persist.startswith('Memoria persistente: no'), 'stato memoria persistente: ' + persist[:40])
    check(page.locator('#st-persist-btn').is_hidden() == persist.startswith('Memoria persistente: sì'), 'il pulsante "Richiedi" compare solo se non e\' persistente')
    page.wait_for_function("document.querySelector('#img-stats').textContent.startsWith('Immagini salvate')")
    check('orfane: 0' in page.inner_text('#img-stats'), 'conteggio immagini: ' + page.inner_text('#img-stats'))
    page.wait_for_function("!document.querySelector('#app-version').textContent.includes('Controllo')")
    check('non disponibile' in page.inner_text('#app-version'), 'senza service worker la versione risulta non disponibile (non inventata)')
    check(page.locator('#dir-pick').count() == 1, 'con showDirectoryPicker compare la sezione "Cartella di salvataggio"')
    check('Nessuna cartella scelta' in page.inner_text('#dir-info'), 'all\'inizio nessuna cartella: ' + page.inner_text('#dir-info'))
    page.screenshot(path=f'{SHOTS}/1-altro.png', full_page=True)

    # ------------------------------------------------------------------ 2) cartella dedicata
    print('2) cartella dedicata: scelta, salvataggio dalla coda e da Anteprima')
    downloads = []
    page.on('download', lambda d: downloads.append(d.suggested_filename))
    page.click('#dir-pick')
    page.wait_for_function("document.querySelector('#dir-info').textContent.includes('Cartella: «')")
    info = page.inner_text('#dir-info')
    check('Permesso attivo' in info, 'cartella scelta con permesso attivo: ' + info)
    check(page.locator('#dir-clear').is_visible(), '"Usa Download" compare dopo la scelta')
    check(js(page, "async (m) => (await m.getSetting('dirHandle')) && (await m.getSetting('dirHandle')).kind") == 'directory', 'settings.dirHandle e\' un handle di cartella')
    check(add_queue(page, 3) == 3, '3 sticker in coda')
    page.goto(BASE + '#/coda')
    page.wait_for_selector('[data-q-save]')
    page.click('[data-q-save]')
    t = toast_text(page, 'Salvati 3')
    check(t.startswith('Salvati 3 file in «sbr-'), 'toast: ' + t)
    files = opfs_files(page)
    names = sorted(k.split('/')[1] for k in files)
    check(names == ['BR_prova_001.png', 'BR_prova_002.png', 'BR_prova_003.png'], f'i 3 file sono nella cartella: {names}')
    check(all(v[0] > 50 and v[1] == 'image/png' for v in files.values()), 'file PNG non vuoti')
    check(downloads == [], 'nessun download: ' + str(downloads))
    # Anteprima: Salva
    page.goto(BASE + '#/anteprima?action=' + str(js(page, "async (m) => { const kt = (await m.db.games.toArray()).find((g) => g.name === 'Kill Team'); return (await m.listActions(kt.id))[0].id; }")))
    page.wait_for_selector('[data-save]')
    page.wait_for_function("document.querySelector('#view img, #view canvas')")
    page.click('[data-save]')
    t = toast_text(page, 'Salvato in')
    check(t.startswith('Salvato in «sbr-'), 'Anteprima > Salva nella cartella: ' + t)
    check(len(opfs_files(page)) == 4 and downloads == [], 'quarto file nella cartella, ancora nessun download')

    print('2b) ripiego sul download: permesso negato, cartella sparita, "Usa Download"')
    add_queue(page, 2)
    page.goto(BASE + '#/coda')
    page.wait_for_selector('[data-q-save]')
    page.evaluate("""() => { const P = FileSystemHandle.prototype;
      Object.defineProperty(P, 'queryPermission', { value: async () => 'denied', configurable: true });
      Object.defineProperty(P, 'requestPermission', { value: async () => 'denied', configurable: true }); }""")
    page.click('[data-q-save]')
    t = toast_text(page, 'Cartella non')
    check(t.startswith('Cartella non disponibile: salvati 2 file in Download'), 'permesso negato: ' + t)
    page.wait_for_timeout(1200)
    check(sorted(downloads) == ['BR_prova_001.png', 'BR_prova_002.png'], 'i 2 file sono stati scaricati: ' + str(downloads))
    check(len(opfs_files(page)) == 4, 'nella cartella non e\' stato scritto altro')
    page.goto(BASE + '#/altro')
    page.wait_for_selector('#dir-info')
    page.wait_for_function("document.querySelector('#dir-info').textContent.includes('Cartella: «')")
    check('chiederà il permesso' in page.inner_text('#dir-info'), 'Altro dice che il permesso va richiesto: ' + page.inner_text('#dir-info'))
    page.evaluate("""() => { const P = FileSystemHandle.prototype; delete P.queryPermission; delete P.requestPermission; }""")
    page.reload()
    page.wait_for_function("document.querySelector('#dir-info') && document.querySelector('#dir-info').textContent.includes('Permesso attivo')")
    # cartella sparita (cancellata dall'utente)
    downloads.clear()
    page.evaluate("""async () => { const root = await navigator.storage.getDirectory(); await root.removeEntry(window.__dirName || [...(await (async () => { const a = []; for await (const [n] of root.entries()) if (n.startsWith('sbr-')) a.push(n); return a; })())][0], { recursive: true }); }""")
    add_queue(page, 1)
    page.goto(BASE + '#/coda')
    page.wait_for_selector('[data-q-save]')
    page.click('[data-q-save]')
    t = toast_text(page, 'Cartella non')
    check(t.startswith('Cartella non disponibile: salvato in Download'), 'cartella sparita: ' + t)
    page.wait_for_timeout(800)
    check(downloads == ['BR_prova_001.png'], 'ripiego sul download: ' + str(downloads))
    # Usa Download
    page.goto(BASE + '#/altro')
    page.wait_for_selector('#dir-clear')
    page.click('#dir-clear')
    page.wait_for_function("document.querySelector('#dir-info').textContent.includes('Nessuna cartella')")
    check(js(page, "async (m) => await m.getSetting('dirHandle', 'nessuno')") == 'nessuno', 'settings.dirHandle rimosso')
    downloads.clear()
    page.goto(BASE + '#/coda')
    page.wait_for_selector('[data-q-save]')
    page.click('[data-q-save]')
    t = toast_text(page, 'Salvato in')
    check(t == 'Salvato in Download', 'senza cartella: ' + t)
    page.wait_for_timeout(600)
    check(downloads == ['BR_prova_001.png'], 'senza cartella: download normale')

    print('2c) dirHandle fuori dal backup e conservato al ripristino')
    page.goto(BASE + '#/altro')
    page.wait_for_selector('#dir-pick')
    page.click('#dir-pick')
    page.wait_for_function("document.querySelector('#dir-info').textContent.includes('Cartella: «')")
    res = js(page, """async (m) => {
      const B = await import('./js/backup.js');
      const r = await B.exportBackup();
      const JSZip = await (await import('./js/backup.js')).loadJSZip();
      const zip = await JSZip.loadAsync(r.blob);
      const data = JSON.parse(await zip.file('data.json').async('string'));
      const keys = data.tables.settings.map((s) => s.key);
      const parsed = await B.readBackup(new File([r.blob], 'b.zip', { type: 'application/zip' }));
      const before = (await m.getSetting('dirHandle')).name;
      await B.restoreBackup(parsed, { autoBackup: false });
      const after = await m.getSetting('dirHandle', null);
      return { hasKey: keys.includes('dirHandle'), n: keys.length, before, after: after && after.name };
    }""")
    check(res['hasKey'] is False and res['n'] > 0, f'il backup non contiene dirHandle ({res["n"]} impostazioni)')
    check(res['after'] == res['before'], f'dopo il ripristino resta la cartella attuale: {res["before"]} -> {res["after"]}')
    check(not page.errors, 'nessun errore in console: %r' % page.errors)
    ctx.close()

    print('2d) senza showDirectoryPicker l\'opzione e\' nascosta e si salva in Download')
    ctx = browser.new_context(viewport={'width': 412, 'height': 900}, service_workers='block', accept_downloads=True)
    ctx.add_init_script(NO_PICKER)
    page = new_page(ctx)
    dl2 = []
    page.on('download', lambda d: dl2.append(d.suggested_filename))
    page.goto(BASE + '#/altro')
    page.wait_for_selector('#bk-save')
    check(page.evaluate("typeof window.showDirectoryPicker") == 'undefined', 'showDirectoryPicker assente')
    check(page.locator('#dir-pick, #dir-info, #dir-clear').count() == 0 and 'Cartella di salvataggio' not in page.inner_text('#view'), 'sezione cartella nascosta')
    add_queue(page, 2)
    page.goto(BASE + '#/coda')
    page.wait_for_selector('[data-q-save]')
    page.click('[data-q-save]')
    check(toast_text(page, 'Salvati 2') == 'Salvati 2 file in Download', 'toast: ' + page.inner_text('#toast'))
    page.wait_for_timeout(1200)
    check(sorted(dl2) == ['BR_prova_001.png', 'BR_prova_002.png'], 'download normale: ' + str(dl2))
    ctx.close()

    # ------------------------------------------------------------------ 3) PDF del log
    print('3) esportazione del log in PDF dal menu della partita')
    ctx = browser.new_context(viewport={'width': 412, 'height': 900}, service_workers='block', accept_downloads=True)
    page = new_page(ctx)
    page.goto(BASE + '#/crea')
    page.wait_for_selector('#crea-q')
    ids = js(page, """async (m) => {
      const kt = (await m.db.games.toArray()).find((g) => g.name === 'Kill Team');
      const fa = await m.addFaction(kt.id, 'Exaction Squad'), fb = await m.addFaction(kt.id, 'Foes');
      const uS = await m.addUnit(fa, 'Sergeant'), uB = await m.addUnit(fb, 'Boss');
      await m.patch('units', uS, { stats: { apl: '3', move: '6"', save: '3+', wounds: '10' } });
      await m.patch('units', uB, { stats: { apl: '3', move: '6"', save: '3+', wounds: '12' } });
      const mid = await m.createMatch({ gameId: kt.id, name: 'Finale è (prova)', mission: 'Recover Cargo',
        sides: [{ player: 'Vando', factionId: fa, factionName: 'Exaction Squad' }, { player: 'Manu', factionId: fb, factionName: 'Foes' }] });
      const [a] = await m.addMatchUnitsFromFaction(mid, 0, [uS]);
      const [b] = await m.addMatchUnitsFromFaction(mid, 1, [uB]);
      const empty = await m.createMatch({ gameId: kt.id, name: 'Vuota', sides: [{ player: 'A' }, { player: 'B' }] });
      await m.addMatchEvent(mid, { type: 'turn-start', side: 1, data: { initiative: { side: 1, how: 'roll', rolls: [3, 5] } } });
      const act = await m.addMatchEvent(mid, { type: 'activation', unitRef: b });
      const atk = await m.addMatchEvent(mid, { type: 'attack', unitRef: b, targetRef: a, data: { weaponName: 'Power claw', source: act } });
      await m.addMatchEvent(mid, { type: 'damage', unitRef: b, targetRef: a, data: { amount: 4, source: atk } });
      await m.addMatchEvent(mid, { type: 'score', side: 1, data: { points: 2, reason: 'Obiettivo' } });
      await m.addMatchEvent(mid, { type: 'activation', unitRef: a });
      return { mid, empty };
    }""")

    def open_menu_item(pg, label):
        pg.wait_for_selector('[data-act="match-menu"]')
        pg.click('[data-act="match-menu"]')
        pg.wait_for_selector('.sheet', state='visible')
        pg.locator('.sheet button', has_text=label).click()

    page.goto(BASE + f"#/log?m={ids['mid']}")
    page.wait_for_selector('.lg-top')
    page.click('[data-act="match-menu"]')
    page.wait_for_selector('.sheet', state='visible')
    labels = page.locator('.sheet button').all_inner_texts()
    ix = [i for i, t in enumerate(labels) if 'Copia riepilogo' in t]
    check(ix and labels[ix[0] + 1].strip() == 'Esporta PDF…', 'nel menu "Esporta PDF…" e\' subito dopo "Copia riepilogo": ' + str([t.strip() for t in labels]))
    page.screenshot(path=f'{SHOTS}/2-menu-partita.png')
    page.locator('.sheet button', has_text='Esporta PDF…').click()
    page.wait_for_selector('.sheet [data-pick="save"]')
    hint = page.inner_text('.sheet .sheet-text')
    today = datetime.date.today().strftime('%Y%m%d')
    check(hint.startswith(f'BR_log_Finale-e-prova_{today}.pdf · '), 'nome file e dimensione nel pannello: ' + hint)
    check(page.locator('.sheet [data-pick="share"]').count() == 1, 'ci sono Salva e Condividi')
    page.screenshot(path=f'{SHOTS}/3-esporta-pdf.png')
    with page.expect_download() as dl:
        page.locator('.sheet [data-pick="save"]').click()
    d = dl.value
    check(d.suggested_filename == f'BR_log_Finale-e-prova_{today}.pdf', 'download: ' + d.suggested_filename)
    path = os.path.join(TMP, d.suggested_filename)
    d.save_as(path)
    check(open(path, 'rb').read(5) == b'%PDF-', 'il file e\' un PDF')
    check('Salvato BR_log_' in toast_text(page, 'Salvato BR_log_'), 'toast: ' + page.inner_text('#toast'))
    txt = subprocess.run(['pdftotext', '-layout', path, '-'], capture_output=True, text=True).stdout
    for s in ['Finale è (prova)', 'Kill Team · Recover Cargo', 'Punti: Vando 0 – Manu 2', 'Turning Point 1', 'Iniziativa: Manu (tiro 3 contro 5)',
              'Boss (Manu) attiva', 'Boss colpisce Sergeant con Power claw: 4 ferite, rimangono 6', 'Manu +2 punti (Obiettivo)', '6/10 ferite', '12/12 ferite']:
        check(re.sub(r'\s+', ' ', s) in re.sub(r'\s+', ' ', txt), f'nel PDF: «{s}»')
    info = subprocess.run(['pdfinfo', path], capture_output=True, text=True).stdout
    check('Title:' in info and 'Finale è (prova)' in info, 'metadati: titolo nel PDF')
    shutil.copy(path, f'{SHOTS}/log.pdf')
    subprocess.run(['pdftoppm', '-r', '60', '-png', '-f', '1', '-l', '1', path, f'{SHOTS}/4-pdf'], check=False)

    # Condividi: share sheet finta che registra i file
    page.evaluate("""() => { window.__shared = null;
      navigator.canShare = (d) => !!(d && d.files && d.files.length);
      navigator.share = async (d) => { window.__shared = d.files.map((f) => [f.name, f.type, f.size]); }; }""")
    open_menu_item(page, 'Esporta PDF…')
    page.locator('.sheet [data-pick="share"]').click()
    page.wait_for_function("window.__shared")
    sh = page.evaluate("window.__shared")
    check(len(sh) == 1 and sh[0][0] == f'BR_log_Finale-e-prova_{today}.pdf' and sh[0][1] == 'application/pdf' and sh[0][2] > 1000, f'condivisione: {sh}')
    check(toast_text(page, 'PDF condiviso') == 'PDF condiviso', 'toast: ' + page.inner_text('#toast'))
    # condivisione annullata: nessun errore
    page.evaluate("""() => { navigator.share = async () => { const e = new Error('annullato'); e.name = 'AbortError'; throw e; }; }""")
    open_menu_item(page, 'Esporta PDF…')
    page.locator('.sheet [data-pick="share"]').click()
    page.wait_for_selector('.sheet', state='detached')
    # senza share sheet: ripiego sul download
    page.evaluate("() => { navigator.canShare = undefined; }")
    open_menu_item(page, 'Esporta PDF…')
    with page.expect_download() as dl2:
        page.locator('.sheet [data-pick="share"]').click()
    check(dl2.value.suggested_filename.endswith('.pdf'), 'senza condivisione: scarica il PDF')
    check('salvato' in toast_text(page, 'Condivisione non').lower(), 'toast: ' + page.inner_text('#toast'))
    # annulla il pannello: niente
    open_menu_item(page, 'Esporta PDF…')
    page.locator('.sheet [data-cancel]').click()
    page.wait_for_selector('.sheet', state='detached')
    # colori dei team (Passo 14)
    print('3b) colori dei team: predefiniti, scelta per partita, lista, PDF')
    page.goto(BASE + f"#/log?m={ids['mid']}")
    page.wait_for_selector('.lg-top')
    vars0 = page.evaluate("[getComputedStyle(document.documentElement).getPropertyValue('--t0').trim(), getComputedStyle(document.documentElement).getPropertyValue('--t1').trim()]")
    check(vars0 == ['#4da3ff', '#ff9040'], 'predefiniti: blu e arancione: %r' % vars0)
    sc = page.evaluate("[...document.querySelectorAll('.lg-side')].map((e) => [e.className, getComputedStyle(e.querySelector('b')).color])")
    check(sc[0][0].endswith('tm0') and sc[1][0].endswith('tm1') and sc[0][1] != sc[1][1], 'punti dei due team in colori diversi: %r' % sc)
    check(page.locator('.lg-roster-side.tm0 h3.team-h').count() == 1 and page.locator('.lg-roster-side.tm1 h3.team-h').count() == 1, 'rosa: intestazioni dei due team colorate')
    page.click('[data-view="cron"]')
    page.wait_for_selector('button.lg-ev')
    n0 = page.locator('button.lg-ev.tm0').count(); n1 = page.locator('button.lg-ev.tm1').count()
    check(n0 >= 1 and n1 >= 1 and page.locator('button.lg-ev .tmark').count() == n0 + n1, f'cronologia: {n0} voci del team 1, {n1} del team 2, tutte con il segno')
    cols = page.evaluate("[...document.querySelectorAll('button.lg-ev')].map((e) => [e.className.match(/tm[01]/)?.[0], getComputedStyle(e).borderLeftColor])")
    check(len({c[1] for c in cols if c[0] == 'tm0'}) == 1 and len({c[1] for c in cols if c[0] == 'tm1'}) == 1 and {c[1] for c in cols if c[0] == 'tm0'} != {c[1] for c in cols if c[0] == 'tm1'}, 'cronologia: stessa barra per lo stesso team, diversa tra team')
    page.screenshot(path=f'{SHOTS}/6-colori-cronologia.png')
    # scelta dei colori dal menu partita
    def set_colors(c0, c1):
        open_menu_item(page, 'Modifica dati partita…')
        page.wait_for_selector('.sheet [name="c0"]')
        page.locator('.sheet [name="c0"]').select_option(c0)
        page.locator('.sheet [name="c1"]').select_option(c1)
        page.locator('.sheet button[type=submit]').click()
    set_colors('verde', 'verde')
    check('colori diversi' in toast_text(page, 'I due team'), 'stesso colore rifiutato: ' + page.inner_text('#toast'))
    page.wait_for_selector('.sheet', state='detached')
    set_colors('verde', 'viola')
    page.wait_for_selector('.sheet', state='detached')
    page.wait_for_function("getComputedStyle(document.documentElement).getPropertyValue('--t0').trim() === '#4cd37b'")
    check(page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--t1').trim()") == '#b794ff', 'colori scelti applicati: verde e viola')
    saved = js(page, "async (m, id) => (await m.getMatch(id)).sides.map((s) => s.color)", ids['mid'])
    check(saved == ['verde', 'viola'], 'salvati nella partita: %r' % saved)
    page.reload()
    page.wait_for_selector('.lg-top')
    check(page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--t0').trim()") == '#4cd37b', 'dopo il ricaricamento i colori restano')
    # correggere i dati inseriti all'inizio: fazione e gioco
    print('3c) correzione di fazione e gioco dal menu partita')
    open_menu_item(page, 'Modifica dati partita…')
    page.wait_for_selector('.sheet [name="f0"]')
    opts = page.locator('.sheet [name="f0"] option').all_inner_texts()
    check('Exaction Squad' in opts and 'Foes' in opts and '(scrivo il nome)' in opts, 'fazioni del gioco nel modulo: %r' % opts)
    page.locator('.sheet [name="f0"]').select_option(label='Foes')
    page.locator('.sheet [name="f1"]').select_option(label='(scrivo il nome)')
    page.locator('.sheet [name="n1"]').fill('Fazione scritta a mano')
    page.locator('.sheet button[type=submit]').click()
    page.wait_for_selector('.sheet', state='detached')
    fs = js(page, "async (m, id) => (await m.getMatch(id)).sides.map((s) => [s.factionName, s.factionId != null])", ids['mid'])
    check(fs == [['Foes', True], ['Fazione scritta a mano', False]], 'fazioni corrette e salvate: %r' % fs)
    page.click('[data-view="tavolo"]')
    page.wait_for_selector('.lg-roster-side.tm0')
    check('FOES' in page.inner_text('.lg-roster-side.tm0').upper(), 'rosa: nuova fazione mostrata')
    open_menu_item(page, 'Modifica dati partita…')
    page.wait_for_selector('.sheet [name="f0"]')
    check(page.locator('.sheet [name="f0"]').input_value() != '' and page.locator('.sheet [name="n1"]').input_value() == 'Fazione scritta a mano', 'il modulo si riapre con i valori salvati')
    page.locator('.sheet [data-cancel]').click()
    page.wait_for_selector('.sheet', state='detached')
    g2 = js(page, "async (m) => m.addGame('Altro gioco', { turn: 'Round' })")
    open_menu_item(page, 'Cambia gioco…')
    page.wait_for_selector('.sheet [data-pick]')
    page.locator('.sheet [data-pick]', has_text='Altro gioco').click()
    page.get_by_role('button', name='Cambia', exact=True).click()
    page.wait_for_function("() => !document.querySelector('.sheet')")
    page.wait_for_function("() => document.querySelector('.lg-top')")
    page.wait_for_timeout(300)
    mg = js(page, "async (m, id) => { const x = await m.getMatch(id); return [x.gameName, x.turnLabel, x.sides.map((s) => s.factionId), x.sides.map((s) => s.factionName)]; }", ids['mid'])
    check(mg[0] == 'Altro gioco' and mg[1] == 'Round' and mg[2] == [None, None] and mg[3] == ['Foes', 'Fazione scritta a mano'], 'gioco cambiato, fazioni restano come testo: %r' % mg)
    check(page.locator('.lg-roster-side').count() == 2, 'la schermata si ridisegna con il nuovo gioco')
    # il pannello di scelta usa gli stessi colori
    page.click('[data-view="tavolo"]')
    page.click('[data-act="activate"]')
    page.wait_for_selector('.sheet [data-pick]')
    pk = page.evaluate("[...document.querySelectorAll('.sheet .pick')].map((e) => [e.className.match(/tm[01]/)?.[0], getComputedStyle(e).borderLeftColor])")
    check(all(c[0] in ('tm0', 'tm1') for c in pk) and len({c[1] for c in pk}) == 2, 'scelta operativo: barra del colore del team: %r' % pk)
    page.screenshot(path=f'{SHOTS}/7-colori-scelta.png')
    page.locator('.sheet [data-cancel]').click()
    page.wait_for_selector('.sheet', state='detached')
    # lista partite
    page.goto(BASE + '#/log')
    page.wait_for_selector('.lg-teams')
    lt = page.evaluate("[...document.querySelectorAll('[data-list=match] li')].find((li) => li.textContent.includes('Finale')).querySelector('.lg-teams').innerHTML")
    check('#4cd37b' in lt.lower() or 'rgb(76, 211, 123)' in lt, 'lista: giocatori nei colori della partita')
    # PDF con i colori scelti
    page.goto(BASE + f"#/log?m={ids['mid']}")
    open_menu_item(page, 'Esporta PDF…')
    with page.expect_download() as dlc:
        page.locator('.sheet [data-pick="save"]').click()
    raw = open(dlc.value.path(), 'rb').read().decode('latin1')
    check('0.05 0.5 0.2 rg' in raw and '0.4 0.25 0.75 rg' in raw, 'PDF: colori verde e viola della partita')
    # nuova partita dal form: colori predefiniti e controllo dei colori uguali
    page.goto(BASE + '#/log')
    page.wait_for_selector('[data-new]')
    page.locator('[data-new]').click()
    page.wait_for_selector('.sheet [data-pick]')
    page.locator('.sheet [data-pick]').first.click()
    page.wait_for_selector('.sheet [name="c0"]')
    check(page.locator('.sheet [name="c0"]').input_value() == 'blu' and page.locator('.sheet [name="c1"]').input_value() == 'arancione', 'nuova partita: blu e arancione precompilati')
    page.locator('.sheet [name="c1"]').select_option('blu')
    page.locator('.sheet button[type=submit]').click()
    check('colori diversi' in toast_text(page, 'I due team'), 'nuova partita: stesso colore rifiutato')
    page.wait_for_selector('.sheet', state='detached')
    page.locator('[data-new]').click()
    page.wait_for_selector('.sheet [data-pick]')
    page.locator('.sheet [data-pick]').first.click()
    page.wait_for_selector('.sheet [name="c0"]')
    page.locator('.sheet [name="c0"]').select_option('arancione')
    page.locator('.sheet [name="c1"]').select_option('viola')
    page.locator('.sheet [name="p0"]').fill('Maik')
    page.locator('.sheet [name="p1"]').fill('Leo')
    page.locator('.sheet button[type=submit]').click()
    page.wait_for_selector('.lg-top')
    check(page.evaluate("[getComputedStyle(document.documentElement).getPropertyValue('--t0').trim(), getComputedStyle(document.documentElement).getPropertyValue('--t1').trim()]") == ['#ff9040', '#b794ff'], 'nuova partita con colori scelti (Maik arancione, Leo viola): applicati subito')
    page.reload()
    page.wait_for_selector('.lg-top')
    check(page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--t1').trim()") == '#b794ff', 'nuova partita: colori scelti restano dopo il ricaricamento')
    page.reload()
    # log vuoto
    page.goto(BASE + f"#/log?m={ids['empty']}")
    open_menu_item(page, 'Esporta PDF…')
    check('vuoto' in toast_text(page, 'Il log è vuoto'), 'log vuoto: ' + page.inner_text('#toast'))
    check(page.locator('.sheet').count() == 0, 'log vuoto: nessun pannello')
    check(not page.errors, 'nessun errore in console: %r' % page.errors)
    ctx.close()

    # ------------------------------------------------------------------ 4) service worker: versione e offline
    print('4) service worker: versione dell\'app e prova offline')
    sw = open(os.path.join(ROOT, 'sw.js'), encoding='utf-8').read()
    version = re.search(r"const CACHE_VERSION = '([^']+)'", sw).group(1)
    ctx = browser.new_context(viewport={'width': 412, 'height': 900}, accept_downloads=True)
    page = new_page(ctx)
    page.goto(BASE + '#/crea')
    page.wait_for_selector('#crea-q')
    page.evaluate("async () => { await navigator.serviceWorker.ready; }")
    page.wait_for_function("navigator.serviceWorker.controller", timeout=20000)
    page.wait_for_function("caches.keys().then((k) => k.length > 0)")
    page.wait_for_timeout(1500)
    page.goto(BASE + '#/altro')
    page.wait_for_selector('#bk-save')
    page.wait_for_function("!document.querySelector('#app-version').textContent.includes('Controllo')")
    v = page.inner_text('#app-version')
    check(v == f"Versione dell'app: {version}.", f'versione letta dal service worker: {v}')
    page.click('#app-update')
    t = toast_text(page, "L'app")
    check("già aggiornata" in t, 'cerca aggiornamenti: ' + t)
    # tutti i file elencati sono nella cache
    cached = page.evaluate("""async () => { const k = (await caches.keys()).find((n) => n.startsWith('sbr-')); const c = await caches.open(k);
      return { name: k, urls: (await c.keys()).map((r) => new URL(r.url).pathname) }; }""")
    assets = re.findall(r"'\./([^']*)'", sw.split('const ASSETS = [')[1].split(']')[0])
    missing = [a for a in assets if a and '/' + a not in cached['urls']]
    check(cached['name'] == 'sbr-' + version and not missing, f'cache {cached["name"]} con tutti i {len(assets)} file; mancanti: {missing}')
    check('/js/testdata.js' not in cached['urls'], 'js/testdata.js non e\' piu\' in cache')
    # offline
    ctx.set_offline(True)
    page.reload()
    page.wait_for_selector('#bk-save', timeout=20000)
    check(True, 'offline: la pagina si ricarica dalla cache')
    errs_before = len(page.errors)
    for route, sel in [('#/crea', '#crea-q'), ('#/libreria', 'h1'), ('#/template', 'h1'), ('#/log', 'h1'), ('#/coda', 'h1'), ('#/altro', '#bk-save')]:
        page.goto(BASE + route)
        page.wait_for_selector(sel, timeout=15000)
    check(len(page.errors) == errs_before, 'offline: tutte le schermate si aprono senza errori: %r' % page.errors[errs_before:])
    # un modulo caricato solo quando serve (PDF del log, JSZip) funziona offline
    out = page.evaluate("""async () => { const m = await import('./js/logexport.js'); const w = await import('./js/pdfwrite.js');
      const b = w.createPdf({ title: 'x' }).text('ciao').build(); const B = await import('./js/backup.js'); const J = await B.loadJSZip();
      return [typeof m.buildLogPdf, b.length > 200, typeof J]; }""")
    check(out[0] == 'function' and out[1] is True and out[2] == 'function', 'offline: PDF del log e JSZip si caricano: %r' % out)
    page.goto(BASE + '#/altro')
    page.wait_for_selector('#bk-save')
    page.wait_for_function("!document.querySelector('#st-usage').textContent.includes('Calcolo')")
    check(page.inner_text('#app-version') == f"Versione dell'app: {version}.", 'offline: la versione si legge lo stesso')
    ctx.set_offline(False)
    ctx.close()

    # ------------------------------------------------------------------ 5) aree di tocco e contrasti
    print('5) aree di tocco (>= 48 px) e contrasti (>= 4,5:1) su tutte le schermate e i pannelli')
    ctx = browser.new_context(viewport={'width': 360, 'height': 780}, device_scale_factor=2, service_workers='block', accept_downloads=True)
    page = new_page(ctx)
    page.goto(BASE + '#/crea')
    page.wait_for_selector('#crea-q')
    page.evaluate("async () => { const m = await import('./js/db.js'); await m.ready(); const t = await import('/tests/testdata.js'); await t.generateTestData(); }")
    seed = js(page, """async (m) => {
      const g = (await m.db.games.toArray()).find((x) => x.test === 1);
      const f = (await m.db.factions.toArray()).find((x) => x.gameId === g.id);
      const u = (await m.db.units.toArray()).find((x) => x.factionId === f.id);
      const w = (await m.db.weapons.toArray()).find((x) => x.factionId === f.id);
      const kt = (await m.db.games.toArray()).find((x) => x.name === 'Kill Team');
      const fa = await m.addFaction(kt.id, 'Exaction Squad');
      const us = await m.addUnit(fa, 'Sergeant');
      await m.patch('units', us, { stats: { apl: '3', move: '6"', save: '3+', wounds: '10' } });
      const mid = await m.createMatch({ gameId: kt.id, name: 'Partita', sides: [{ player: 'Vando', factionId: fa, factionName: 'Exaction Squad' }, { player: 'Manu' }] });
      const [a] = await m.addMatchUnitsFromFaction(mid, 0, [us]);
      const b = await m.addMatchUnit(mid, { side: 1, name: 'Boss', maxWounds: 12 });
      await m.addMatchEvent(mid, { type: 'turn-start', side: 0, data: { initiative: { side: 0, how: 'choice' } } });
      const act = await m.addMatchEvent(mid, { type: 'activation', unitRef: b });
      const atk = await m.addMatchEvent(mid, { type: 'attack', unitRef: b, targetRef: a, data: { weaponName: 'Claw', source: act } });
      await m.addMatchEvent(mid, { type: 'damage', unitRef: b, targetRef: a, data: { amount: 4, source: atk } });
      const tpl = (await m.db.templates.toArray())[0];
      const act0 = (await m.listActions(null))[0];
      return { g: g.id, f: f.id, u: u.id, w: w.id, mid, tpl: tpl.id, act: act0 ? act0.id : null, ktId: kt.id };
    }""")
    states = [
        ('crea-recenti', '#/crea', None), ('crea-azioni', '#/crea', '[data-tab="azioni"]'), ('crea-preferiti', '#/crea', '[data-tab="preferiti"]'),
        ('crea-sfoglia', '#/crea', '[data-tab="sfoglia"]'),
        ('libreria', '#/libreria', None), ('libreria-gioco', f"#/libreria/g{seed['g']}", None), ('libreria-fazione', f"#/libreria/g{seed['g']}/f{seed['f']}", None),
        ('libreria-miniatura', f"#/libreria/g{seed['g']}/f{seed['f']}/u{seed['u']}", None),
        ('template', '#/template', None), ('template-editor', f"#/template?id={seed['tpl']}", None),
        ('log', '#/log', None), ('log-tavolo', f"#/log?m={seed['mid']}", None), ('log-cronologia', f"#/log?m={seed['mid']}&v=cron", None),
        ('anteprima', f"#/anteprima?unit={seed['u']}&weapon={seed['w']}", None),
        ('coda', '#/coda', None), ('altro', '#/altro', None),
    ]
    problems = []
    total_taps = total_con = 0

    def audit(name):
        global total_taps, total_con
        res = page.evaluate(AUDIT)
        for t in res['taps']:
            problems.append(f"[{name}] tocco {t['w']}x{t['h']}: {t['el']}")
        for c in res['contrasts']:
            problems.append(f"[{name}] contrasto {c['ratio']}: {c['el']} ({c['fg']} su {c['bg']})")
        return res

    for name, route, click in states:
        page.goto(BASE + route)
        page.wait_for_timeout(500)
        if click:
            page.click(click)
            page.wait_for_timeout(300)
        audit(name)
    # coda con elementi, barra di aggiornamento e pannelli
    add_queue(page, 2)
    page.goto(BASE + '#/coda')
    page.wait_for_selector('.q-item')
    audit('coda-con-elementi')
    page.goto(BASE + '#/altro')
    page.wait_for_selector('#bk-save')
    page.evaluate("document.getElementById('update-bar').hidden = false")
    audit('barra-aggiornamento')
    page.evaluate("document.getElementById('update-bar').hidden = true")
    page.evaluate("() => { const t = document.getElementById('toast'); t.textContent = 'Salvato in Download'; t.hidden = false; }")
    audit('toast')
    page.evaluate("document.getElementById('toast').hidden = true")
    page.goto(BASE + f"#/log?m={seed['mid']}")
    page.wait_for_selector('.lg-top')
    page.click('[data-act="match-menu"]')
    page.wait_for_selector('.sheet', state='visible')
    audit('log-menu-partita')
    page.keyboard.press('Escape')
    page.evaluate("() => { const b = document.querySelector('.sheet-backdrop'); if (b) b.click(); }")
    page.wait_for_selector('.sheet', state='detached')
    page.click('[data-act="activate"]')
    page.wait_for_selector('.sheet [data-pick]')
    audit('log-scelta-operativo')
    page.locator('.sheet [data-pick]').first.click()
    page.wait_for_selector('.sheet [data-pick]')
    audit('log-scelta-azione')
    page.locator('.sheet [data-cancel]').click()
    page.wait_for_selector('.sheet', state='detached')
    page.goto(BASE + f"#/log?m={seed['mid']}")
    page.wait_for_selector('.lg-top')
    page.click('[data-act="score"]')
    page.wait_for_selector('.sheet', state='visible')
    audit('log-punti')
    page.locator('.sheet [data-cancel]').click()
    page.wait_for_selector('.sheet', state='detached')
    # un controllo spento di proposito: il controllo di contrasto deve accorgersi di un testo debole
    page.evaluate("() => { const p = document.createElement('p'); p.id = 'zz-debole'; p.style.color = '#444'; p.textContent = 'testo debole'; document.getElementById('view').appendChild(p); const b = document.createElement('button'); b.id = 'zz-piccolo'; b.style.minHeight = '30px'; b.textContent = 'x'; document.getElementById('view').appendChild(b); }")
    res = page.evaluate(AUDIT)
    check(any('zz-debole' in c['el'] for c in res['contrasts']) and any('zz-piccolo' in t['el'] for t in res['taps']), 'il controllo riconosce un testo debole e un tasto piccolo (autoverifica)')
    page.evaluate("() => { document.getElementById('zz-debole').remove(); document.getElementById('zz-piccolo').remove(); }")
    for p in problems:
        print('  ', p)
    check(not problems, f'{len(states) + 7} schermate/pannelli controllati: {len(problems)} problemi')
    page.goto(BASE + '#/altro')
    page.wait_for_selector('#bk-save')
    page.screenshot(path=f'{SHOTS}/5-altro-mobile.png', full_page=True)
    check(not page.errors, 'nessun errore in console: %r' % page.errors)
    ctx.close()
    browser.close()

print()
print('TUTTO OK' if not fails else f'{len(fails)} CONTROLLI FALLITI')
sys.exit(1 if fails else 0)
