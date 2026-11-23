#!/usr/bin/env python3
"""Prova dell'interfaccia del Passo 6 in Chrome headless (Playwright), con service worker bloccato.

  python3 tests/make-synth-fixtures.py        (una volta)
  python3 tests/ui-pdf-test.py [cartella_screenshot]

Usa i PDF SINTETICI di tests/fixtures-synth/ e, se presenti, anche i PDF veri di tests/fixtures/ (solo lettura e screenshot).
"""
import glob
import http.server
import os
import socketserver
import sys
import threading

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SHOTS = sys.argv[1] if len(sys.argv) > 1 else '/tmp/shots'
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


def js_db(page, expr):
    """Esegue codice con accesso a Dexie 'sticker-br' dentro la pagina."""
    return page.evaluate(f"""async () => {{
      const m = await import('./js/db.js');
      await m.ready();
      return await ({expr})(m.db);
    }}""")


def import_pdf(page, game_name, pdf, lang=None, choice=None):
    page.goto(BASE + '#/libreria')
    page.wait_for_selector('.list .item')
    page.click(f'a.item-main:has-text("{game_name}")')
    page.wait_for_selector('[data-import-pdf]')
    with page.expect_file_chooser() as fc:
        page.click('[data-import-pdf]')
    fc.value.set_files(pdf)
    page.wait_for_selector('.pdf-bar', timeout=60000)
    if lang:
        page.select_option('[data-lang]', lang)
        page.wait_for_selector('.pdf-bar')


with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport={'width': 412, 'height': 900}, device_scale_factor=2, service_workers='block')
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.goto(BASE)
    page.wait_for_selector('#view')

    synth = os.path.join(HERE, 'fixtures-synth')

    print('1) PDF fronte-retro -> revisione')
    import_pdf(page, 'Kill Team', os.path.join(synth, 'synth-frontback.pdf'))
    check(page.locator('.pdf-ok').count() == 1, 'nessun avviso sul PDF sintetico')
    check(page.locator('details.pdf-op:has(.pdf-op-name:text-is("WARDEN CAPTAIN"))').count() == 1, 'operativo WARDEN CAPTAIN in revisione')
    check('2 operativi' in page.inner_text('#view p.meta'), 'riepilogo: 2 operativi')
    page.click('details.pdf-op >> nth=0 >> summary')
    page.screenshot(path=f'{SHOTS}/1-revisione.png', full_page=True)
    page.click('[data-save]')
    page.wait_for_url('**#/libreria/g*/f*', timeout=60000)
    page.wait_for_selector('.list .item')
    page.wait_for_timeout(300)
    page.screenshot(path=f'{SHOTS}/2-fazione.png', full_page=True)

    counts = js_db(page, """async (db) => ({
      factions: await db.factions.count(), units: await db.units.count(), weapons: await db.weapons.count(),
      rules: await db.rules.count(), images: await db.images.count(),
      weaponsWithImage: await db.weapons.filter(w => w.imageId != null).count(),
      unitsWithImage: await db.units.filter(u => u.imageId != null).count(),
      withProfile: await db.weapons.filter(w => w.profile && w.profile.hit).count()
    })""")
    print('  ', counts)
    check(counts['factions'] == 1 and counts['units'] == 2 and counts['weapons'] == 4, 'creati 1 squadra, 2 operativi, 4 armi')
    check(counts['rules'] == 8, 'salvate 8 regole (2 fazione + 4 stratagemmi + 2 equipaggiamento)')
    check(counts['weaponsWithImage'] == 4, 'profili arma ritagliati dal PDF per tutte le armi')
    check(counts['withProfile'] == 4, 'tutte le armi hanno il profilo testuale')
    check('Hold The Line' in page.inner_text('#view') or page.locator('details.pdf-op').count() >= 3, 'pagina fazione mostra le Regole')

    print('2) scheda miniatura')
    page.click('a.item-main:has-text("WARDEN CAPTAIN")')
    page.wait_for_selector('.unit-stats')
    txt = page.inner_text('#view')
    check('Arc pistol' in txt and 'ATK 4' in txt and 'Piercing 1' in txt, 'scheda: armi con profilo')
    check('Command Voice' in txt and 'Rally' in txt, "scheda: abilita' e azioni")
    page.screenshot(path=f'{SHOTS}/3-scheda.png', full_page=True)

    print('3) reimport dello stesso PDF: niente doppioni, immagini mantenute')
    import_pdf(page, 'Kill Team', os.path.join(synth, 'synth-frontback.pdf'))
    check('Squadra già presente' in page.inner_text('[data-summary]') or page.wait_for_function("document.querySelector('[data-summary]').textContent.includes('già presente')", timeout=5000), 'riepilogo: squadra gia\' presente')
    page.click('[data-save]')
    page.wait_for_selector('.sheet')
    check('Profili arma già presenti' in page.inner_text('.sheet'), 'chiede prima di sostituire i profili esistenti')
    page.screenshot(path=f'{SHOTS}/4-conferma.png')
    page.click('.sheet button:has-text("Tieni quelli esistenti")')
    page.wait_for_timeout(300)
    if page.locator('.sheet').count():
        page.click('.sheet button:has-text("Tieni quelli esistenti")')
    page.wait_for_url('**#/libreria/g*/f*', timeout=60000)
    page.wait_for_selector('.list .item')
    c2 = js_db(page, """async (db) => ({ factions: await db.factions.count(), units: await db.units.count(), weapons: await db.weapons.count(),
      rules: await db.rules.count(), images: await db.images.count() })""")
    print('  ', c2)
    check(c2['factions'] == 1 and c2['units'] == 2 and c2['weapons'] == 4 and c2['rules'] == 8, 'nessun duplicato dopo il reimport')
    check(c2['images'] == counts['images'], 'le immagini esistenti non sono state toccate')

    print('4) un secondo PDF (doppio profilo) nello stesso gioco: armi condivise unite')
    import_pdf(page, 'Kill Team', os.path.join(synth, 'synth-dual.pdf'))
    page.click('[data-save]')
    page.wait_for_url('**#/libreria/g*/f*', timeout=60000)
    c3 = js_db(page, """async (db) => ({ factions: await db.factions.count(), units: await db.units.count(), weapons: await db.weapons.count(),
      names: (await db.weapons.toArray()).map(w => w.name).sort() })""")
    print('  ', c3)
    check(c3['units'] == 4, 'operativi: 2 + 2 nuovi (il nome-squadra del PDF e\' diverso: nuova squadra)')

    print('5) PDF con errori voluti: avvisi in cima, campi rossi')
    import_pdf(page, 'Kill Team', os.path.join(synth, 'synth-broken.pdf'))
    check(page.locator('.pdf-warn').count() == 1, 'riquadro avvisi presente')
    check(page.locator('.pdf-f input.invalid').count() >= 3, 'campi dubbi in rosso')
    page.screenshot(path=f'{SHOTS}/5-avvisi.png', full_page=True)
    page.click('[data-save]')
    page.wait_for_selector('#toast:not([hidden])')
    check('non ha nome' in page.inner_text('#toast'), 'blocca il salvataggio con un\'arma senza nome')
    page.click('details.pdf-op >> nth=0 >> summary')
    n_bad = page.locator('.pdf-f input.invalid').count()
    page.fill('[data-k="op.0.w.1.name"]', 'Dagger')
    page.fill('[data-k="op.0.w.0.hit"]', '4+')
    check(page.locator('.pdf-f input.invalid').count() == n_bad - 2, 'correggendo i campi il bordo rosso sparisce')
    page.click('[data-save]')
    page.wait_for_selector('.sheet')
    check('avvisi' in page.inner_text('.sheet'), 'chiede conferma prima di salvare con avvisi')
    page.click('.sheet button:has-text("Annulla")')

    print('6) PDF italiano di prova con lingua it')
    import_pdf(page, 'Kill Team', os.path.join(synth, 'synth-italian.pdf'), lang='it')
    check(page.locator('.pdf-ok').count() == 1, 'italiano: nessun avviso')

    reals = sorted(glob.glob(os.path.join(HERE, 'fixtures', '*.pdf')))
    for i, f in enumerate(reals):
        print('REALE', os.path.basename(f))
        import_pdf(page, 'Kill Team', f)
        page.screenshot(path=f'{SHOTS}/reale-{i}.png', full_page=True)
        print('   avvisi:', page.locator('.pdf-warn li').count())

    check(not [e for e in errors if 'favicon' not in e], 'nessun errore in console: ' + '; '.join(errors)[:300])
    browser.close()

print('\nFALLITI:' if fails else '\nTutto ok.', fails if fails else '')
sys.exit(1 if fails else 0)
