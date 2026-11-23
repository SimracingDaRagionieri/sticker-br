#!/usr/bin/env python3
"""Prova dell'interfaccia del Passo 8 (Azioni) in Chrome headless (Playwright), con service worker bloccato.

  python3 tests/ui-azioni-test.py [cartella_screenshot]

Controlla: azioni Kill Team precaricate una volta sola, Importa PNG (nome dal file, byte identici, conferma di
sostituzione, file non validi), Anteprima/Salva/Condividi di un PNG (stessi byte), miniature e recenti in Crea
(anche con tocco lungo), azioni valide per tutti i giochi (gameId null: Libreria, ricerca, Crea, filtro per gioco),
Nuova azione con icona e testo a schermo, spostamento di ambito, nomi doppi, eliminazione (immagini comprese),
azioni create prima del Passo 8 (senza `mode`).
"""
import hashlib
import http.server
import os
import socketserver
import struct
import sys
import tempfile
import threading
import zlib

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SHOTS = sys.argv[1] if len(sys.argv) > 1 else '/tmp/shots-azioni'
os.makedirs(SHOTS, exist_ok=True)
TMP = tempfile.mkdtemp(prefix='sbr-azioni-')


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


def make_png(path, w, h, seed, alpha=True):
    """PNG vero scritto a mano (RGBA, con trasparenza), con zlib al livello 9 e un chunk di testo: i byte sono unici."""
    rows = bytearray()
    for y in range(h):
        rows.append(0)
        for x in range(w):
            a = 0 if (x - w / 2) ** 2 + (y - h / 2) ** 2 > (min(w, h) / 2) ** 2 else 255
            rows += bytes(((x * 7 + seed * 40) % 256, (y * 5 + seed * 90) % 256, (x + y + seed * 13) % 256, a if alpha else 255))

    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)

    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) \
        + chunk(b'tEXt', b'Comment\x00test-' + str(seed).encode()) + chunk(b'IDAT', zlib.compress(bytes(rows), 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(data)
    return hashlib.sha256(data).hexdigest(), len(data)


FILES = {}
for name, (w, h, seed) in {'reposition.png': (300, 120, 1), 'overwatch_alert.png': (360, 140, 2), 'pick_up_marker.png': (280, 100, 3),
                           'global_tag.png': (200, 200, 4), 'icon.png': (64, 64, 5), 'replacement.png': (330, 130, 6)}.items():
    p = os.path.join(TMP, name)
    FILES[name] = (p,) + make_png(p, w, h, seed)
bad = os.path.join(TMP, 'not_a_png.png')   # JPEG con estensione .png
with open(bad, 'wb') as f:
    f.write(b'\xff\xd8\xff\xe0' + b'\x00' * 64)


def js(page, code, arg=None):
    return page.evaluate("async (arg) => { const m = await import('./js/db.js'); await m.ready(); return await (" + code + ")(m, arg); }", arg)


def new_page(ctx):
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.errors = errors
    return page


def sheet_click(page, label):
    page.locator('.sheet button', has_text=label).first.click()


def sha_of_blob_url(page, selector):
    return page.evaluate("""async (sel) => {
      const img = document.querySelector(sel);
      const buf = await (await fetch(img.src)).arrayBuffer();
      const d = await crypto.subtle.digest('SHA-256', buf);
      return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
    }""", selector)


def action_row(page, name, gid='any'):
    return js(page, """async (m, a) => {
      const rows = (await m.db.actions.toArray()).filter((x) => x.name === a.name);
      const r = rows[0]; if (!r) return null;
      const img = r.imageId != null ? await m.db.images.get(r.imageId) : null;
      let sha = null, size = null;
      if (img) { const buf = await img.blob.arrayBuffer(); size = buf.byteLength; const d = await crypto.subtle.digest('SHA-256', buf); sha = [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join(''); }
      return { id: r.id, gameId: r.gameId, mode: r.mode ?? null, label: r.label ?? null, fav: r.fav, imageId: r.imageId, sha, size, type: img && img.blob.type, thumb: !!(img && img.thumb), count: rows.length };
    }""", {'name': name})


with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport={'width': 412, 'height': 900}, device_scale_factor=2, service_workers='block', accept_downloads=True)
    page = new_page(ctx)
    page.goto(BASE + '#/libreria')
    page.wait_for_selector('h1')

    print('1) azioni Kill Team precaricate una volta sola')
    info = js(page, """async (m) => {
      const kt = (await m.db.games.toArray()).find((g) => g.name === 'Kill Team');
      const acts = await m.db.actions.where('gameId').equals(kt.id).toArray();
      return { ktId: kt.id, names: acts.map((a) => a.name).sort(), seeded: await m.getSetting('seededActions'), modes: [...new Set(acts.map((a) => a.mode))] };
    }""")
    KT = info['ktId']
    want = sorted(['Reposition', 'Dash', 'Fall Back', 'Charge', 'Shoot', 'Fight', 'Pick Up Marker', 'Place Marker'])
    check(info['names'] == want, f'8 azioni Kill Team: {info["names"]}')
    check(info['seeded'] == 1 and info['modes'] == ['generated'], 'settings.seededActions = 1, tutte generate')
    wh = js(page, "async (m) => (await m.db.games.toArray()).find((g) => g.name === 'Warhammer 40,000').id")

    print('2) Libreria: sezione Azioni e sezione "valide per tutti i giochi"')
    page.goto(BASE + f'#/libreria/g{KT}')
    page.wait_for_selector('[data-list="action"] .item')
    check(page.locator('[data-list="action"] .item').count() == 8, '8 azioni elencate nel gioco')
    check(page.locator('h2:text-is("Azioni valide per tutti i giochi")').count() == 1, 'titolo della sezione globale')
    check(page.locator('[data-import-png]').count() == 2, 'due pulsanti "Importa PNG" (gioco e globale)')
    page.screenshot(path=f'{SHOTS}/1-gioco.png', full_page=True)

    print('3) Importa PNG: nuova, sostituzione, file non valido')
    js(page, "async (m) => { const a = await m.db.actions.filter((x) => x.name === 'Reposition').first(); await m.db.actions.update(a.id, { fav: 1 }); }")
    repo_id = action_row(page, 'Reposition')['id']
    with page.expect_file_chooser() as fc:
        page.click('[data-import-png="action"]')
    fc.value.set_files([FILES['reposition.png'][0], FILES['overwatch_alert.png'][0], FILES['pick_up_marker.png'][0], bad])
    page.wait_for_selector('.sheet:has-text("Azioni già presenti")')
    txt = page.inner_text('.sheet')
    check('Reposition' in txt and 'Pick Up Marker' in txt, 'la conferma elenca le due azioni già presenti')
    page.screenshot(path=f'{SHOTS}/2-conferma.png')
    sheet_click(page, 'Sostituisci')
    page.wait_for_selector('.sheet:has-text("Alcuni file non sono stati importati")')
    check('not_a_png.png' in page.inner_text('.sheet'), 'il file non valido e\' segnalato')
    sheet_click(page, 'OK')
    page.wait_for_function("document.querySelectorAll('[data-list=\"action\"] .item').length === 9")
    for fname, aname in [('reposition.png', 'Reposition'), ('overwatch_alert.png', 'Overwatch Alert'), ('pick_up_marker.png', 'Pick Up Marker')]:
        r = action_row(page, aname)
        sha, size = FILES[fname][1], FILES[fname][2]
        check(r and r['mode'] == 'png' and r['sha'] == sha and r['size'] == size, f'{aname}: mode png, stessi byte del file ({size} B)')
        check(r['type'] == 'image/png' and r['thumb'] and r['gameId'] == KT, f'{aname}: image/png, miniatura, gioco giusto')
        check(r['count'] == 1, f'{aname}: nessun doppione')
    r = action_row(page, 'Reposition')
    check(r['id'] == repo_id and r['fav'] == 1, 'la sostituzione tiene id e preferito')
    check(js(page, "async (m) => (await m.db.actions.where('gameId').equals(" + str(KT) + ").count())") == 9, 'nessuna azione in piu\' oltre a quella nuova')
    check(page.locator('[data-list="action"] .thumb img').count() == 3, 'tre miniature nell\'elenco (le PNG)')
    page.screenshot(path=f'{SHOTS}/3-importate.png', full_page=True)

    print('4) Anteprima di un\'azione PNG: identica, senza template')
    ow = action_row(page, 'Overwatch Alert')
    page.goto(BASE + f'#/anteprima?action={ow["id"]}')
    page.wait_for_selector('#pv-img:not([hidden])')
    check(page.locator('[data-tpl]').count() == 0 and page.locator('[data-text]').count() == 0, 'niente chip template ne\' campo testo')
    check('originale' in page.inner_text('#view') or 'originale' in page.inner_text('body'), 'nota "file originale"')
    dims = page.evaluate("[document.querySelector('#pv-img').naturalWidth, document.querySelector('#pv-img').naturalHeight]")
    check(dims == [360, 140], f'l\'anteprima mostra il PNG originale, non uno sticker ridisegnato (misura {dims})')
    with page.expect_download() as dl:
        page.click('[data-save]')
    path = dl.value.path()
    data = open(path, 'rb').read()
    check(hashlib.sha256(data).hexdigest() == FILES['overwatch_alert.png'][1] and len(data) == FILES['overwatch_alert.png'][2], 'Salva: file scaricato identico (stessi KB)')
    check(dl.value.suggested_filename.startswith('BR_Overwatch-Alert_') and dl.value.suggested_filename.endswith('.png'), 'nome file ' + dl.value.suggested_filename)
    page.wait_for_timeout(900)
    with page.expect_download() as dl2:
        page.click('[data-share]')   # senza navigator.share il browser ripiega sul download
    check(hashlib.sha256(open(dl2.value.path(), 'rb').read()).hexdigest() == FILES['overwatch_alert.png'][1], 'Condividi: file identico')
    page.click('[data-fav]')
    page.wait_for_function("document.querySelector('[data-fav]').getAttribute('aria-pressed') === 'true'")
    check(page.locator('[data-fav]').inner_text() == '★', 'stella accesa per l\'azione PNG')
    c = js(page, """async (m) => ({ recents: (await m.listRecents()).filter((r) => r.actionId != null).map((r) => ({ a: r.actionId, t: r.templateId })), favs: (await m.getSetting('favCombos', [])).map((f) => ({ a: f.actionId, t: f.templateId, k: f.key })) })""")
    check(any(r['a'] == ow['id'] and r['t'] is None for r in c['recents']), 'recente registrato senza template')
    check(any(f['a'] == ow['id'] and f['t'] is None for f in c['favs']), 'preferito registrato senza template: ' + str(c['favs']))
    page.screenshot(path=f'{SHOTS}/4-anteprima-png.png', full_page=True)

    print('5) Crea: miniature, recenti e preferiti con azioni PNG')
    page.goto(BASE + '#/crea')
    page.wait_for_selector('#crea-q')
    page.wait_for_selector('.stk')
    page.wait_for_function("document.querySelectorAll('.stk img:not([hidden])').length >= 1", timeout=20000)
    shas = page.evaluate("""async () => { const out = []; for (const img of document.querySelectorAll('.stk img:not([hidden])')) {
      const d = await crypto.subtle.digest('SHA-256', await (await fetch(img.src)).arrayBuffer()); out.push([...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')); } return out; }""")
    check(FILES['overwatch_alert.png'][1] in shas, 'la miniatura nei Recenti e\' il PNG originale (stessi byte)')
    # tocco lungo sul recente: salva subito, identico
    btn = page.locator('.stk[aria-label="Overwatch Alert"]').first
    box = btn.bounding_box()
    with page.expect_download() as dl3:
        page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
        page.mouse.down()
        page.wait_for_timeout(800)
        page.mouse.up()
    check(hashlib.sha256(open(dl3.value.path(), 'rb').read()).hexdigest() == FILES['overwatch_alert.png'][1], 'tocco lungo su recente PNG: file identico')
    check(page.locator('#toast').inner_text() == 'Salvato', 'toast "Salvato"')
    page.click('.seg button[data-tab="preferiti"]')
    page.wait_for_function("document.querySelectorAll('.stk img:not([hidden])').length >= 1", timeout=20000)
    check(page.locator('.stk[aria-label="Overwatch Alert"]').count() >= 1, 'combinazione preferita (azione PNG) in Preferiti')
    page.click('.seg button[data-tab="azioni"]')
    page.wait_for_function("document.querySelectorAll('.stk img:not([hidden])').length >= 3", timeout=20000)
    check(page.locator('.stk[aria-label="Overwatch Alert"]').count() == 1, 'Azioni: l\'azione PNG e\' in griglia')
    page.screenshot(path=f'{SHOTS}/5-crea-azioni.png', full_page=True)
    page.locator('.stk[aria-label="Overwatch Alert"]').click()
    page.wait_for_selector('#pv-img:not([hidden])')
    check('action=' in page.url, 'tocco sull\'azione apre l\'Anteprima')

    print('6) sostituzione del PNG: miniature e anteprima si aggiornano')
    page.goto(BASE + f'#/libreria/g{KT}')
    page.wait_for_selector('[data-list="action"] .item')
    page.locator(f'[data-list="action"] [data-menu="{ow["id"]}"]').click()
    check(page.locator('.sheet-menu button', has_text='Sostituisci PNG').count() == 1 and page.locator('.sheet-menu button', has_text='Modifica testo').count() == 0, 'menu di un\'azione PNG: Sostituisci PNG, senza "Modifica testo"')
    with page.expect_file_chooser() as fc:
        sheet_click(page, 'Sostituisci PNG')
    fc.value.set_files([FILES['replacement.png'][0]])
    page.wait_for_function("document.querySelector('#toast').textContent.includes('sostituito')")
    r = action_row(page, 'Overwatch Alert')
    check(r['sha'] == FILES['replacement.png'][1] and r['id'] == ow['id'], 'PNG sostituito, stesso id')
    check(js(page, "async (m) => (await m.db.images.where('kind').equals('action').count())") == 3, 'il vecchio PNG e\' stato eliminato (3 immagini azione)')
    page.goto(BASE + '#/crea')
    page.wait_for_selector('.stk')
    page.click('.seg button[data-tab="azioni"]')
    page.wait_for_function("document.querySelectorAll('.stk img:not([hidden])').length >= 3", timeout=20000)
    shas = page.evaluate("""async () => { const out = []; for (const img of document.querySelectorAll('.stk img:not([hidden])')) {
      const d = await crypto.subtle.digest('SHA-256', await (await fetch(img.src)).arrayBuffer()); out.push([...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')); } return out; }""")
    check(FILES['replacement.png'][1] in shas and FILES['overwatch_alert.png'][1] not in shas, 'Crea mostra il nuovo PNG, non quello vecchio (firma della cache)')

    print('7) Nuova azione disegnata con testo, colore, icona; ambito')
    page.goto(BASE + f'#/libreria/g{KT}')
    page.wait_for_selector('[data-list="action"] .item')
    page.click('[data-add="action"]')
    page.fill('.sheet input[name="name"]', 'Overwatch')
    page.fill('.sheet input[name="label"]', 'OVERWATCH!')
    page.select_option('.sheet select[name="color"]', '#e53935')
    check(page.locator('.sheet select[name="scope"] option').count() == 2, 'scelta ambito: solo il gioco / tutti i giochi')
    with page.expect_file_chooser() as fc:
        page.click('.sheet [data-icon]')
    fc.value.set_files([FILES['icon.png'][0]])
    page.wait_for_function("document.querySelector('.sheet [data-icon-status]').textContent.includes('Icona scelta')")
    page.screenshot(path=f'{SHOTS}/6-nuova.png')
    page.click('.sheet button[type="submit"]')
    page.wait_for_function("document.querySelectorAll('[data-list=\"action\"] .item').length === 10")
    r = action_row(page, 'Overwatch')
    check(r['mode'] == 'generated' and r['label'] == 'OVERWATCH!' and r['gameId'] == KT and r['imageId'] is not None and r['thumb'], 'azione generata con testo, icona e miniatura nel gioco')
    check(r['sha'] is not None and r['type'] == 'image/png', 'icona salvata come PNG')
    page.click('[data-add="action"]')
    page.fill('.sheet input[name="name"]', ' overwatch ')
    page.click('.sheet button[type="submit"]')
    page.wait_for_function("document.querySelector('#toast').textContent.includes('Esiste già')")
    check(js(page, "async (m) => (await m.db.actions.filter((a) => a.name.toLowerCase().trim() === 'overwatch').count())") == 1, 'nome doppio rifiutato nello stesso ambito')

    print('8) Anteprima dell\'azione con icona e testo a schermo')
    ovw = action_row(page, 'Overwatch')
    page.goto(BASE + f'#/anteprima?action={ovw["id"]}')
    page.wait_for_selector('#pv-img:not([hidden])')
    check(page.locator('[data-text="action"]').input_value() == 'OVERWATCH!', 'il campo testo parte dal testo a schermo')
    check(page.locator('[data-toggle="icon"]').is_checked(), 'interruttore "Icona azione" acceso')
    w_with = page.evaluate("document.querySelector('#pv-img').naturalWidth")
    page.uncheck('[data-toggle="icon"]')
    page.wait_for_timeout(500)
    h_without = page.evaluate("document.querySelector('#pv-img').naturalWidth")
    check(w_with > 0 and h_without > 0, f'sticker disegnato con e senza icona ({w_with} / {h_without} px)')
    page.screenshot(path=f'{SHOTS}/7-anteprima-icona.png', full_page=True)
    with page.expect_download() as dl4:
        page.click('[data-save]')
    check(dl4.value.suggested_filename.startswith('BR_OVERWATCH_'), 'nome file dal testo a schermo: ' + dl4.value.suggested_filename)

    print('9) azioni valide per tutti i giochi (gameId null)')
    page.goto(BASE + f'#/libreria/g{KT}')
    page.wait_for_selector('[data-list="action"] .item')
    with page.expect_file_chooser() as fc:
        page.click('[data-import-png="gaction"]')
    fc.value.set_files([FILES['global_tag.png'][0]])
    page.wait_for_selector('[data-list="gaction"] .item')
    g = action_row(page, 'Global Tag')
    check(g['gameId'] is None and g['mode'] == 'png' and g['sha'] == FILES['global_tag.png'][1], 'PNG importato nella sezione globale: gameId null, byte identici')
    page.click('[data-add="gaction"]')
    page.fill('.sheet input[name="name"]', 'Global Text')
    check(page.locator('.sheet select[name="scope"]').input_value() == 'all', 'nella sezione globale l\'ambito parte da "Tutti i giochi"')
    page.click('.sheet button[type="submit"]')
    page.wait_for_function("document.querySelectorAll('[data-list=\"gaction\"] .item').length === 2")
    for gid, nm in [(KT, 'Kill Team'), (wh, 'Warhammer 40,000')]:
        page.goto(BASE + f'#/libreria/g{gid}')
        page.wait_for_selector('[data-list="gaction"] .item')
        check(page.locator('[data-list="gaction"] .item').count() == 2, f'le due azioni globali compaiono in {nm}')
    check(page.locator('[data-list="action"] .item').count() == 0, 'Warhammer non ha azioni sue: la globale non e\' nell\'elenco del gioco')
    page.goto(BASE + '#/libreria')
    page.wait_for_selector('[data-list="gaction"] .item')
    check(page.locator('[data-list="gaction"] .item').count() == 2, 'le globali compaiono anche nella schermata dei giochi')
    lists = js(page, """async (m, a) => ({
      withG: (await m.listActions(a.kt)).map((x) => x.name),
      onlyG: (await m.listActions(a.kt, { includeGlobal: false })).map((x) => x.name),
      wh: (await m.listActions(a.wh)).map((x) => x.name),
      glob: (await m.listGlobalActions()).map((x) => x.name),
      nullArg: (await m.listActions(null)).map((x) => x.name),
      raw: (await m.db.actions.where('gameId').equals(a.kt).toArray()).map((x) => x.name) })""", {'kt': KT, 'wh': wh})
    check('Global Tag' in lists['withG'] and 'Global Text' in lists['withG'] and len(lists['withG']) == 12, 'listActions(gioco) include le globali (12)')
    check('Global Tag' not in lists['onlyG'] and len(lists['onlyG']) == 10, 'includeGlobal:false le esclude (10)')
    check(sorted(lists['wh']) == ['Global Tag', 'Global Text'], 'listActions(altro gioco) = solo le globali')
    check(sorted(lists['glob']) == ['Global Tag', 'Global Text'] and sorted(lists['nullArg']) == sorted(lists['glob']), 'listGlobalActions e listActions(null)')
    check('Global Tag' not in lists['raw'], 'conferma: where(gameId).equals non vede le globali')

    page.goto(BASE + '#/crea')
    page.wait_for_selector('#crea-q')
    page.fill('#crea-q', 'global')
    page.wait_for_selector('#crea-view .item')
    check(page.locator('#crea-view h2:text-is("Azioni") + ul .item').count() == 2, 'ricerca "global": trova le due azioni globali')
    check('Tutti i giochi' in page.inner_text('#crea-view'), 'la riga dice "Tutti i giochi"')
    for gid in (KT, wh):
        page.fill('#crea-q', '')
        page.click(f'.chip[data-game="{gid}"]')
        page.click('.seg button[data-tab="azioni"]')
        page.wait_for_selector('.stk')
        names = page.eval_on_selector_all('.stk', 'els => els.map(e => e.getAttribute("aria-label"))')
        check('Global Tag' in names and 'Global Text' in names, f'scheda Azioni con filtro gioco {gid}: ci sono le globali ({len(names)} azioni)')
    check('Reposition' not in names, 'Warhammer non mostra le azioni di Kill Team')
    page.click('.chip[data-game="all"]')

    print('10) spostamento di ambito e nomi doppi')
    page.goto(BASE + f'#/libreria/g{KT}')
    page.wait_for_selector('[data-list="action"] .item')
    ch = action_row(page, 'Charge')
    page.locator(f'[data-list="action"] [data-menu="{ch["id"]}"]').click()
    sheet_click(page, 'Valida per tutti i giochi')
    page.wait_for_function("document.querySelectorAll('[data-list=\"gaction\"] .item').length === 3")
    check(action_row(page, 'Charge')['gameId'] is None, '"Charge" ora vale per tutti i giochi')
    page.locator(f'[data-list="gaction"] [data-menu="{ch["id"]}"]').click()
    sheet_click(page, 'Limita a Kill Team')
    page.wait_for_function("document.querySelectorAll('[data-list=\"gaction\"] .item').length === 2")
    check(action_row(page, 'Charge')['gameId'] == KT, '"Charge" di nuovo solo di Kill Team')

    print('11) modifica di un\'azione disegnata (testo, icona, rimozione)')
    dash = action_row(page, 'Dash')
    page.locator(f'[data-list="action"] [data-menu="{dash["id"]}"]').click()
    sheet_click(page, 'Modifica testo')
    page.fill('.sheet input[name="label"]', 'DASH NOW')
    with page.expect_file_chooser() as fc:
        page.click('.sheet [data-icon]')
    fc.value.set_files([FILES['icon.png'][0]])
    page.wait_for_function("document.querySelector('.sheet [data-icon-status]').textContent.includes('Icona scelta')")
    page.click('.sheet button[type="submit"]')
    page.wait_for_function("document.querySelector('#toast').textContent.includes('Salvata')")
    d = action_row(page, 'Dash')
    check(d['label'] == 'DASH NOW' and d['imageId'] is not None and d['mode'] in (None, 'generated'), 'Dash: testo e icona salvati, resta disegnata')
    n_img = js(page, "async (m) => await m.db.images.where('kind').equals('action').count()")
    page.locator(f'[data-list="action"] [data-menu="{dash["id"]}"]').click()
    sheet_click(page, 'Modifica testo')
    page.click('.sheet [data-icon-clear]')
    page.click('.sheet button[type="submit"]')
    for _ in range(50):   # il toast "Salvata" e' ancora quello di prima: si aspetta lo stato nel database
        if action_row(page, 'Dash')['imageId'] is None:
            break
        page.wait_for_timeout(100)
    check(action_row(page, 'Dash')['imageId'] is None and js(page, "async (m) => await m.db.images.where('kind').equals('action').count()") == n_img - 1, 'icona rimossa e immagine eliminata')

    print('12) azioni create prima del Passo 8 (senza mode) e immagini orfane')
    old = js(page, """async (m, kt) => { const id = await m.db.actions.add({ gameId: kt, name: 'Vecchia Azione', accentColor: null, fav: 0, lastUsed: 0 });
      return id; }""", KT)
    page.goto(BASE + f'#/anteprima?action={old}')
    page.wait_for_selector('#pv-img:not([hidden])')
    check(page.locator('[data-tpl]').count() >= 1 and page.locator('[data-text="action"]').input_value() == 'Vecchia Azione', 'azione senza mode: disegnata col template')
    before = js(page, "async (m) => await m.db.images.where('kind').equals('action').count()")
    page.goto(BASE + f'#/libreria/g{KT}')
    page.wait_for_selector('[data-list="action"] .item')
    rep = action_row(page, 'Reposition')
    page.locator(f'[data-list="action"] [data-menu="{rep["id"]}"]').click()
    sheet_click(page, 'Elimina')
    sheet_click(page, 'Elimina')
    page.wait_for_function("document.querySelector('#toast').textContent.includes('Eliminata')")
    check(js(page, "async (m) => await m.db.images.where('kind').equals('action').count()") == before - 1, 'eliminare un\'azione PNG elimina anche il suo file')
    # cancellazione del gioco: le sue azioni PNG se ne vanno con le immagini, le globali restano
    gid = js(page, "async (m) => { const g = await m.addGame('Gioco Prova Azioni', {}); await m.addAction(g, 'Solo Qui', null, { mode: 'png', image: { blob: new Blob([new Uint8Array([137,80,78,71,13,10,26,10])], { type: 'image/png' }), width: 1, height: 1, thumb: null } }); return g; }")
    b2 = js(page, "async (m) => await m.db.images.count()")
    js(page, "async (m, g) => { await m.deleteGame(g); }", gid)
    check(js(page, "async (m) => await m.db.images.count()") == b2 - 1, 'eliminare un gioco elimina le immagini delle sue azioni')
    check(len(js(page, "async (m) => await m.listGlobalActions()")) == 2, 'le azioni globali restano')

    print('13) il caricamento iniziale non ricrea le azioni cancellate')
    page.reload()
    page.wait_for_selector('h1')
    names = js(page, "async (m, kt) => (await m.db.actions.where('gameId').equals(kt).toArray()).map((a) => a.name)", KT)
    check('Reposition' not in names, 'Reposition cancellata non torna dopo il riavvio')
    check(js(page, "async (m) => await m.getSetting('seededActions')") == 1, 'settings.seededActions resta 1')

    print('14) errori in console')
    bad_errors = [e for e in page.errors if 'favicon' not in e and 'Failed to load resource' not in e]
    check(not bad_errors, 'nessun errore: ' + str(bad_errors[:3]))

    browser.close()

print('\n' + ('TUTTO OK' if not fails else f'{len(fails)} CONTROLLI FALLITI:\n - ' + '\n - '.join(fails)))
sys.exit(1 if fails else 0)
