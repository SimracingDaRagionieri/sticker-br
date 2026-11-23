#!/usr/bin/env python3
"""Prova dell'interfaccia del Passo 7 (schermata Crea) in Chrome headless (Playwright), con service worker bloccato.

  python3 tests/ui-crea-test.py [cartella_screenshot]

Genera i 300 elementi di prova da Altro (come farebbe l'utente) e controlla: ricerca (anche in tempo reale dopo
modifiche al database), schede, pannello miniatura, scelta della miniatura per un'arma, Sfoglia con il tasto indietro,
tocco lungo con il mouse e con tocco vero (CDP), stella in Anteprima, riferimenti eliminati, eliminazione dei dati di prova.
"""
import http.server
import os
import re
import socketserver
import sys
import threading

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SHOTS = sys.argv[1] if len(sys.argv) > 1 else '/tmp/shots-crea'
os.makedirs(SHOTS, exist_ok=True)


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
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{PORT}/'

fails = []


def check(cond, msg):
    print(('  ok   ' if cond else '  FAIL ') + msg)
    if not cond:
        fails.append(msg)


def js(page, code, arg=None):
    """Esegue codice dentro la pagina con accesso al modulo db.js (m)."""
    return page.evaluate(
        "async (arg) => { const m = await import('./js/db.js'); await m.ready(); return await (" + code + ")(m, arg); }", arg)


def rows(page):
    return page.locator('#crea-view .item').count()


def gen(page):
    """Crea i 300 elementi di prova con tests/testdata.js (non fa parte dell'app)."""
    page.evaluate("async () => { const m = await import('./js/db.js'); await m.ready(); const t = await import('/tests/testdata.js'); await t.generateTestData(); }")


def type_query(page, q):
    """Scrive la ricerca come un input e misura quanto passa prima che i risultati siano nel DOM."""
    return page.evaluate("""async (q) => {
      const inp = document.querySelector('#crea-q');
      const t0 = performance.now();
      inp.value = q;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { ms: performance.now() - t0, rows: document.querySelectorAll('#crea-view .item').length };
    }""", q)


def wait_stickers(page, n=4):
    page.wait_for_function(f"document.querySelectorAll('.stk img:not([hidden])').length >= {n}", timeout=30000)


def back_from_preview(page):
    page.wait_for_selector('[data-back]')
    page.go_back()


def new_page(ctx):
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.errors = errors
    return page


with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport={'width': 412, 'height': 900}, device_scale_factor=2, service_workers='block', accept_downloads=True)
    page = new_page(ctx)
    page.goto(BASE + '#/altro')
    page.wait_for_selector('#bk-save')
    check(page.locator('#btn-gen').count() == 0 and page.locator('#btn-save').count() == 0, 'in Altro non ci sono piu\' i dati di prova ne\' il test di esportazione')

    print('1) dati di prova creati dal test (tests/testdata.js)')
    gen(page)
    txt = js(page, "async (m) => { const t = await import('/tests/testdata.js'); const s = await t.testDataStats(); return s ? `${s.units} miniature, ${s.weapons} armi, ${s.actions} azioni` : ''; }")
    check('100 miniature, 160 armi, 40 azioni' in txt, 'generati 100 miniature, 160 armi, 40 azioni: ' + txt)
    c = js(page, """async (m) => ({ recents: await m.db.recents.count(), favs: (await m.getSetting('favCombos', [])).length,
      games: (await m.db.games.toArray()).filter(g => g.test === 1).length, images: await m.db.images.count() })""")
    print('  ', c)
    check(c['recents'] == 28 and c['favs'] == 4 and c['games'] == 1, '28 recenti, 4 combinazioni preferite, 1 gioco di prova')

    print('2) Crea: recenti disegnati')
    page.goto(BASE + '#/crea')
    page.wait_for_selector('#crea-q')
    page.wait_for_selector('.stk')
    check(page.locator('.stk').count() == 28, '28 recenti in griglia')
    wait_stickers(page, 6)
    check(page.locator('.seg button[aria-selected="true"]').inner_text() == 'Recenti', 'scheda Recenti attiva all\'inizio')
    check(page.locator('.chip[data-game="all"]').get_attribute('aria-pressed') == 'true', 'chip "Tutti" attivo all\'inizio')
    page.screenshot(path=f'{SHOTS}/1-recenti.png')

    print('3) ricerca')
    r = type_query(page, 'warden cap')
    print('   ', r)
    check(r['rows'] >= 1 and r['ms'] < 250, f'"warden cap" trova risultati in {r["ms"]:.0f} ms')
    check(page.locator('#crea-view h2:text-is("Miniature")').count() == 1, 'gruppo Miniature')
    check('Warden Captain' in page.inner_text('#crea-view'), 'trova Warden Captain')
    page.screenshot(path=f'{SHOTS}/2-ricerca.png')
    r = type_query(page, 'bolt')
    check(page.locator('#crea-view h2:text-is("Armi")').count() == 1, 'gruppo Armi per "bolt"')
    n_w = page.locator('#crea-view h2:text-is("Armi") + ul .item').count()
    check(n_w == 8, f'massimo 8 armi mostrate (trovate {n_w})')
    check('altri: scrivi di più' in page.inner_text('#crea-view'), 'nota "+N altri"')
    check(' · ' in page.locator('#crea-view h2:text-is("Armi") + ul .item-name').first.inner_text(), 'arma mostrata come "Arma · Miniatura"')
    r = type_query(page, 'zzzzqq')
    check('Nessun risultato' in page.inner_text('#crea-view'), 'nessun risultato: messaggio')
    r = type_query(page, '')
    check(page.locator('.seg').count() == 1 and page.locator('.stk').count() == 28, 'ricerca svuotata: tornano le schede')
    # velocita' digitando lettera per lettera
    worst = 0
    for q in ['w', 'wa', 'war', 'ward', 'warde', 'warden', 'warden ', 'warden h', 'warden he', 'warden hea']:
        worst = max(worst, type_query(page, q)['ms'])
    check(worst < 250, f'peggior ritardo digitando su 300 elementi: {worst:.0f} ms')
    type_query(page, '')

    print('4) indice aggiornato da solo dopo modifiche al database')
    uid = js(page, """async (m) => { const f = await m.db.factions.toCollection().first();
      return await m.addUnit(f.id, 'Éclaireur Provvisorio'); }""")
    r = type_query(page, 'eclai')
    check('Éclaireur Provvisorio' in page.inner_text('#crea-view'), 'nuova miniatura trovata senza ricaricare (senza accenti)')
    js(page, "async (m, id) => { await m.patch('units', id, { name: 'Rinominato Provvisorio' }); }", uid)
    r = type_query(page, 'eclai')
    check('Éclaireur' not in page.inner_text('#crea-view'), 'vecchio nome non piu\' trovato dopo la rinomina')
    r = type_query(page, 'rinom')
    check('Rinominato Provvisorio' in page.inner_text('#crea-view'), 'nuovo nome trovato')
    js(page, "async (m, id) => { await m.deleteUnit(id); }", uid)
    r = type_query(page, 'rinom')
    check('Nessun risultato' in page.inner_text('#crea-view'), 'miniatura eliminata sparisce dai risultati')
    type_query(page, '')

    print('5) miniatura -> pannello -> Anteprima -> indietro')
    type_query(page, 'warden cap')
    page.click('#crea-view [data-res^="unit:"] >> nth=0')
    page.wait_for_selector('.sheet')
    sheet = page.inner_text('.sheet')
    check('Solo operativo' in sheet, 'pannello con "Solo operativo"')
    n_btn = page.locator('.sheet .sheet-weapon').count()
    check(n_btn >= 1, f'pannello con {n_btn} armi collegate')
    page.screenshot(path=f'{SHOTS}/3-pannello.png')
    page.click('.sheet .sheet-weapon >> nth=0')
    page.wait_for_url(re.compile(r'#/anteprima\?unit=\d+&weapon=\d+'))
    page.wait_for_selector('#pv-img:not([hidden])', timeout=20000)
    check(page.locator('.sheet').count() == 0, 'il pannello si chiude andando in Anteprima')
    back_from_preview(page)
    page.wait_for_selector('#crea-q')
    page.wait_for_selector('#crea-view .item')
    check(page.input_value('#crea-q') == 'warden cap', 'tornando indietro la ricerca e\' ancora li\'')
    check('Warden Captain' in page.inner_text('#crea-view'), 'tornando indietro i risultati sono ancora li\'')
    page.click('#crea-view [data-res^="unit:"] >> nth=0')
    page.wait_for_selector('.sheet')
    page.click('.sheet [data-solo]')
    page.wait_for_url(re.compile(r'#/anteprima\?unit=\d+$'))
    back_from_preview(page)
    page.wait_for_selector('#crea-q')
    type_query(page, '')

    print('6) arma con piu\' miniature: chiede quale')
    multi = js(page, """async (m) => { const ws = (await m.db.weapons.toArray()).filter(w => w.unitIds.length > 1);
      const w = ws[0]; const us = []; for (const id of w.unitIds) us.push((await m.db.units.get(id)).name);
      return { id: w.id, name: w.name, unitIds: w.unitIds, units: us }; }""")
    print('   ', multi)
    type_query(page, multi['name'])
    check(page.locator('#crea-view [data-res^="weapon:"]').count() >= 1, 'arma trovata per nome')
    check('altr' in page.locator('#crea-view [data-res^="weapon:"] >> nth=0').inner_text(), 'segnala le altre miniature')
    page.click('#crea-view [data-res^="weapon:"] >> nth=0')
    page.wait_for_selector('.sheet')
    check('Con quale operativo?' in page.inner_text('.sheet'), 'chiede con quale operativo')
    n_u = page.locator('.sheet [data-u]').count()
    check(n_u == len(multi['unitIds']), f'elenca le {n_u} miniature dell\'arma')
    second = multi['unitIds'][1]
    page.click(f'.sheet [data-u="{second}"]')
    page.wait_for_url(re.compile(rf'#/anteprima\?unit={second}&weapon={multi["id"]}$'))
    back_from_preview(page)
    page.wait_for_selector('#crea-q')
    # arma trovata con una parola della miniatura: la miniatura cercata passa avanti
    one = js(page, """async (m) => { const w = (await m.db.weapons.toArray()).find(x => x.unitIds.length > 1);
      const u = await m.db.units.get(w.unitIds[1]); return { weapon: w.name.split(' ')[0], unit: u.name.split(' ')[0], full: u.name }; }""")
    type_query(page, '')

    print('7) azioni')
    type_query(page, 'test action 05')
    check(page.locator('#crea-view [data-res^="action:"]').count() == 1, 'una sola azione per "test action 05"')
    page.click('#crea-view [data-res^="action:"]')
    page.wait_for_url(re.compile(r'#/anteprima\?action=\d+$'))
    page.wait_for_selector('#pv-img:not([hidden])', timeout=20000)
    back_from_preview(page)
    page.wait_for_selector('#crea-q')
    type_query(page, '')

    print('8) schede Preferiti, Azioni, Sfoglia')
    page.click('[data-tab="preferiti"]')
    page.wait_for_function("document.querySelector('.seg [aria-selected=true]').dataset.tab === 'preferiti' && document.querySelectorAll('#crea-view .stk').length === 4", timeout=15000)
    check(page.locator('#crea-view .stk').count() == 4, '4 combinazioni preferite')
    check('Miniature' in page.inner_text('#crea-view') and 'Armi' in page.inner_text('#crea-view') and 'Azioni' in page.inner_text('#crea-view'), 'liste di miniature, armi e azioni preferite')
    wait_stickers(page, 2)
    page.screenshot(path=f'{SHOTS}/4-preferiti.png')
    page.click('[data-tab="azioni"]')
    page.wait_for_function("document.querySelectorAll('#crea-view .stk').length === 48")
    wait_stickers(page, 4)
    # 40 di prova + le 8 azioni Kill Team precaricate dal Passo 8
    check(page.locator('#crea-view .stk').count() == 48, '48 azioni in griglia (40 di prova + 8 di Kill Team)')
    page.screenshot(path=f'{SHOTS}/5-azioni.png')
    page.click('#crea-view .stk >> nth=0')
    page.wait_for_url(re.compile(r'#/anteprima\?action=\d+$'))
    back_from_preview(page)
    page.wait_for_selector('#crea-q')
    check(page.locator('.seg button[aria-selected="true"]').inner_text() == 'Azioni', 'tornando indietro resta la scheda Azioni')
    page.click('[data-tab="sfoglia"]')
    page.wait_for_selector('#crea-view .item')
    check(rows(page) == 10, '10 fazioni in Sfoglia')
    page.screenshot(path=f'{SHOTS}/6-sfoglia.png')
    page.click('#crea-view a.item-main >> nth=0')
    page.wait_for_url(re.compile(r'#/crea\?tab=sfoglia&f=\d+$'))
    page.wait_for_selector('.unit-tile')
    check(page.locator('.unit-tile').count() == 10, '10 miniature nella fazione')
    page.wait_for_function("document.querySelectorAll('.unit-pic img:not([hidden])').length >= 3", timeout=20000)
    check(True, 'immagini delle miniature caricate')
    page.screenshot(path=f'{SHOTS}/7-fazione.png')
    page.click('.unit-tile >> nth=0')
    page.wait_for_selector('.sheet')
    page.click('.sheet [data-cancel]')
    page.go_back()
    page.wait_for_selector('#crea-view .item')
    check(page.url.endswith('#/crea?tab=sfoglia') and rows(page) == 10, '"indietro" dalla fazione torna all\'elenco delle fazioni')
    page.click('#crea-view a.item-main >> nth=0')
    page.wait_for_selector('.unit-tile')
    page.click('[data-browse-back]')
    page.wait_for_selector('#crea-view a.item-main')
    check(rows(page) == 10, 'freccia a schermo torna all\'elenco')

    print('9) chip del gioco')
    page.click('.chip[data-game]:has-text("Warhammer")')
    page.click('[data-tab="recenti"]')
    page.wait_for_selector('#crea-view .empty')
    check(page.locator('.stk').count() == 0, 'con un altro gioco attivo i recenti di prova non compaiono')
    page.click('.chip[data-game]:has-text("Prova")')
    pressed = page.evaluate("[...document.querySelectorAll('.chip[data-game]')].filter(c => c.getAttribute('aria-pressed') === 'true').map(c => c.textContent)")
    print('   ', pressed)
    saved = js(page, "async (m) => await m.getSetting('lastGameId')")
    check(isinstance(saved, int), 'lastGameId salvato: %r' % (saved,))
    page.reload()
    page.wait_for_selector('#crea-q')
    page.wait_for_function("[...document.querySelectorAll('.chip[data-game]')].some(c => c.getAttribute('aria-pressed') === 'true' && c.textContent.includes('Prova'))")
    check(True, 'il gioco scelto torna dopo il riavvio')
    page.click('[data-tab="recenti"]')
    wait_stickers(page, 4)
    check(page.locator('.stk').count() == 28, 'con il gioco di prova attivo restano tutti i 28 recenti')
    page.click('.chip[data-game="all"]')
    check(js(page, "async (m) => await m.getSetting('lastGameId')") == 'all', '"Tutti" salvato')

    print('10) recenti: tocco e posizione')
    wait_stickers(page, 4)
    page.wait_for_timeout(500)
    page.evaluate("window.scrollTo(0, 500)")
    page.wait_for_timeout(300)
    page.locator('.stk >> nth=10').click()
    y0 = page.evaluate('window.scrollY')
    page.wait_for_url(re.compile(r'#/anteprima\?.*template=\d+'))
    back_from_preview(page)
    page.wait_for_selector('.stk')
    page.wait_for_timeout(500)
    y1 = page.evaluate('window.scrollY')
    check(y0 > 300 and abs(y1 - y0) < 60, f'tornando dall\'Anteprima la posizione e\' ripristinata (prima {y0:.0f}, dopo {y1:.0f})')
    page.evaluate("window.scrollTo(0, 0)")

    print('11) tocco lungo con il mouse')
    caps = page.evaluate("[...document.querySelectorAll('.stk .stk-cap')].map(c => c.textContent)")
    target = page.locator('.stk >> nth=2')
    box = target.bounding_box()
    page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
    with page.expect_download(timeout=8000) as dl:
        page.mouse.down()
        page.wait_for_timeout(750)
        page.mouse.up()
    d = dl.value
    path = d.path()
    data = open(path, 'rb').read()
    check(re.match(r'^BR_.+_\d{8}-\d{6}\.png$', d.suggested_filename) is not None, 'nome file BR_..._AAAAMMGG-HHMMSS.png: ' + d.suggested_filename)
    check(data[:8] == b'\x89PNG\r\n\x1a\n', 'il file e\' un PNG')
    check(data[25] == 6, 'PNG con canale alfa (trasparente)')
    page.wait_for_function("document.querySelector('#toast') && document.querySelector('#toast').textContent === 'Salvato'")
    check('#/anteprima' not in page.url, 'il tocco lungo non apre anche l\'Anteprima')
    page.wait_for_timeout(500)
    caps2 = page.evaluate("[...document.querySelectorAll('.stk .stk-cap')].map(c => c.textContent)")
    check(caps2[0] == caps[2], 'lo sticker salvato sale in cima ai recenti')
    recent_count = js(page, "async (m) => await m.db.recents.count()")
    check(recent_count == 28, 'i recenti restano 28 (stessa chiave, nessun doppione)')
    # tocco breve subito dopo: apre l'Anteprima
    page.locator('.stk >> nth=1').click()
    page.wait_for_url(re.compile(r'#/anteprima\?'))
    back_from_preview(page)
    page.wait_for_selector('.stk')

    print('12) tocco lungo con tocco vero (CDP) e annullamento con lo scorrimento')
    tctx = browser.new_context(viewport={'width': 412, 'height': 900}, device_scale_factor=2, service_workers='block',
                               accept_downloads=True, has_touch=True, is_mobile=True)
    tp = new_page(tctx)
    downloads = []
    tp.on('download', lambda d: downloads.append(d))
    tp.goto(BASE + '#/altro')
    tp.wait_for_selector('#bk-save')
    gen(tp)
    tp.goto(BASE + '#/crea')
    tp.wait_for_selector('.stk')
    wait_stickers(tp, 4)
    cdp = tctx.new_cdp_session(tp)

    def touch(pt, hold=0, move_to=None):
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [pt]})
        if move_to:
            for k in range(1, 6):
                cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': pt['x'], 'y': pt['y'] + (move_to - pt['y']) * k / 5}]})
                tp.wait_for_timeout(30)
        tp.wait_for_timeout(hold)
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})

    b = tp.locator('.stk >> nth=3').bounding_box()
    pt = {'x': b['x'] + b['width'] / 2, 'y': b['y'] + b['height'] / 2}
    n0 = len(downloads)
    touch(pt, hold=800)
    tp.wait_for_timeout(1500)
    check(len(downloads) == n0 + 1, 'tocco lungo vero: un download')
    check('#/anteprima' not in tp.url, 'tocco lungo vero: nessuna navigazione')
    n1 = len(downloads)
    touch(pt, hold=800, move_to=pt['y'] + 60)
    tp.wait_for_timeout(1200)
    check(len(downloads) == n1, 'scorrendo col dito il tocco lungo si annulla')
    b = tp.locator('.stk >> nth=3').bounding_box()
    touch({'x': b['x'] + b['width'] / 2, 'y': b['y'] + b['height'] / 2}, hold=60)
    tp.wait_for_timeout(800)
    check('#/anteprima' in tp.url, 'tocco breve vero: apre l\'Anteprima')
    check(len(downloads) == n1, 'tocco breve: nessun download')
    check(not tp.errors, 'nessun errore in console (tocco): %r' % tp.errors)
    tctx.close()

    print('13) stella in Anteprima')
    info = js(page, """async (m) => { const w = (await m.db.weapons.toArray()).filter(x => x.unitIds.length > 0)[50];
      const t = await m.getDefaultTemplate('activation'); return { u: w.unitIds[0], w: w.id, t: t.id }; }""")
    favs0 = js(page, "async (m) => (await m.getSetting('favCombos', [])).length")
    page.goto(BASE + f'#/anteprima?unit={info["u"]}&weapon={info["w"]}')
    page.wait_for_selector('[data-fav]')
    page.wait_for_selector('#pv-img:not([hidden])', timeout=20000)
    check(page.get_attribute('[data-fav]', 'aria-pressed') == 'false', 'stella spenta all\'inizio')
    page.click('[data-fav]')
    page.wait_for_function("document.querySelector('[data-fav]').getAttribute('aria-pressed') === 'true'")
    check(page.inner_text('[data-fav]') == '★', 'stella piena')
    favs1 = js(page, "async (m) => (await m.getSetting('favCombos', []))")
    check(len(favs1) == favs0 + 1 and favs1[-1]['unitId'] == info['u'] and favs1[-1]['weaponId'] == info['w'], 'combinazione salvata in settings.favCombos')
    page.reload()
    page.wait_for_selector('[data-fav]')
    page.wait_for_function("document.querySelector('[data-fav]').getAttribute('aria-pressed') === 'true'")
    check(True, 'la stella resta accesa dopo il riavvio')
    page.click('[data-tpl]:not([aria-pressed="true"])')
    page.wait_for_function("document.querySelector('[data-fav]').getAttribute('aria-pressed') === 'false'")
    check(True, 'con un altro template la stella e\' spenta (combinazione diversa)')
    page.click('[data-tpl][aria-pressed="false"]')
    page.goto(BASE + '#/crea')
    page.wait_for_selector('#crea-q')
    page.click('[data-tab="preferiti"]')
    page.wait_for_function(f"document.querySelectorAll('#crea-view .stk').length === {favs0 + 1}")
    check(True, 'la nuova combinazione compare in Preferiti')
    # la stella toglie
    page.goto(BASE + f'#/anteprima?unit={info["u"]}&weapon={info["w"]}&template={info["t"]}')
    page.wait_for_selector('[data-fav]')
    page.wait_for_function("document.querySelector('[data-fav]').getAttribute('aria-pressed') === 'true'")
    page.click('[data-fav]')
    page.wait_for_function("document.querySelector('[data-fav]').getAttribute('aria-pressed') === 'false'")
    check(js(page, "async (m) => (await m.getSetting('favCombos', [])).length") == favs0, 'la stella toglie la combinazione')

    print('14) riferimenti eliminati ignorati')
    page.goto(BASE + '#/crea')
    page.wait_for_selector('#crea-q')
    page.click('[data-tab="recenti"]')
    wait_stickers(page, 2)
    gone = js(page, """async (m) => { const r = (await m.listRecents())[0]; const id = r.unitId;
      await m.deleteUnit(id); return id; }""")
    page.click('[data-tab="azioni"]')
    page.click('[data-tab="recenti"]')
    page.wait_for_selector('.stk')
    n = page.locator('.stk').count()
    check(n < 28, f'recente con miniatura eliminata non compare piu\' ({n} invece di 28)')
    check(not page.errors, 'nessun errore in console finora: %r' % page.errors)

    print('15) elimina dati di prova (deleteTestData del test)')
    page.goto(BASE + '#/altro')
    page.wait_for_selector('#bk-save')
    page.evaluate("async () => { const m = await import('./js/db.js'); await m.ready(); const t = await import('/tests/testdata.js'); await t.deleteTestData(); }")
    c = js(page, """async (m) => ({ games: (await m.db.games.toArray()).filter(g => g.test === 1).length,
      units: await m.db.units.count(), weapons: await m.db.weapons.count(), actions: await m.db.actions.count(),
      images: await m.db.images.count(), recents: await m.db.recents.count(),
      favs: (await m.getSetting('favCombos', [])).length })""")
    print('   ', c)
    check(c['games'] == 0 and c['units'] == 0 and c['weapons'] == 0 and c['images'] == 0, 'gioco di prova, miniature, armi e immagini eliminati')
    check(c['recents'] == 0 and c['favs'] == 0, 'recenti e preferiti di prova ripuliti')
    page.goto(BASE + '#/crea')
    page.wait_for_selector('#crea-q')
    page.click('[data-tab="recenti"]')
    page.wait_for_selector('#crea-view .empty')
    check('Ancora nessuno sticker' in page.inner_text('#crea-view'), 'stato vuoto con istruzioni')
    page.screenshot(path=f'{SHOTS}/8-vuoto.png')
    check(not page.errors, 'nessun errore in console: %r' % page.errors)
    browser.close()

print('\nFALLITI: %d' % len(fails) if fails else '\nTutto ok.')
sys.exit(1 if fails else 0)
