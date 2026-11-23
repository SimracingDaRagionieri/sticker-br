#!/usr/bin/env python3
"""Prova dell'interfaccia del Passo 9 (Editor dei template e font) in Chrome headless (Playwright), service worker bloccato.

  python3 tests/ui-template-test.py [cartella_screenshot]

Controlla: migrazione dei template (icona azione), icona azione coerente tra template, Anteprima e Crea, elenco template
(Duplica, Rinomina, Imposta predefinito, Elimina, mai l'ultimo del tipo), recenti/preferiti con template eliminato,
editor (anteprima fissa, fisarmonica, salvataggio automatico, righe di testo, PNG dell'Anteprima identico a quello
dell'editor), importazione font (.ttf) con uso anche offline, font non validi.
"""
import hashlib
import http.server
import os
import socketserver
import sys
import tempfile
import threading

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SHOTS = sys.argv[1] if len(sys.argv) > 1 else '/tmp/shots-template'
os.makedirs(SHOTS, exist_ok=True)
TMP = tempfile.mkdtemp(prefix='sbr-template-')


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


PX = """async (img) => {
  const cv = document.createElement('canvas'); cv.width = img.naturalWidth || img.width; cv.height = img.naturalHeight || img.height;
  const x = cv.getContext('2d'); x.drawImage(img, 0, 0);
  const d = await crypto.subtle.digest('SHA-256', x.getImageData(0, 0, cv.width, cv.height).data);
  return cv.width + 'x' + cv.height + ':' + [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}"""


PXBLOB = """async (blob) => {
  const bmp = await createImageBitmap(blob);
  const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
  const x = cv.getContext('2d'); x.drawImage(bmp, 0, 0);
  const d = await crypto.subtle.digest('SHA-256', x.getImageData(0, 0, cv.width, cv.height).data);
  return cv.width + 'x' + cv.height + ':' + [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}"""


def sha_img(page, selector='#pv-img'):
    """Hash dei pixel decodificati dell'immagine mostrata (l'Anteprima revoca l'URL dopo il caricamento: non si puo' rileggere il Blob)."""
    return page.evaluate("async (sel) => await (" + PX + ")(document.querySelector(sel))", selector)


def sha_bytes(page, selector='#pv-img'):
    """Hash dei byte del PNG (solo dove l'URL del Blob e' ancora vivo, come nell'editor)."""
    return page.evaluate("""async (sel) => {
      const buf = await (await fetch(document.querySelector(sel).src)).arrayBuffer();
      const d = await crypto.subtle.digest('SHA-256', buf);
      return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
    }""", selector)


def shown(page):
    page.wait_for_selector('#pv-img:not([hidden])')
    page.wait_for_timeout(900)


def cfg_of(page, tid):
    return js(page, "async (m, id) => (await m.getTemplate(id)).config", tid)


def wait_saved(page):
    page.wait_for_function("document.querySelector('#tpl-saved').textContent === 'Salvato'")


def toast_has(page, text):
    page.wait_for_function("(t) => document.querySelector('#toast').textContent.includes(t) && !document.querySelector('#toast').hidden", arg=text)


def tpl_by_name(page, name):
    return js(page, "async (m, n) => { const r = (await m.db.templates.toArray()).find((t) => t.name === n); return r ? r.id : null; }", name)


def open_group(page, gid):
    page.locator(f'[data-group="{gid}"] > summary').click()
    page.wait_for_timeout(80)


MK = "(w, h, c) => new Promise((r) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const x = cv.getContext('2d'); x.fillStyle = c; x.fillRect(0, 0, w, h); x.fillStyle = '#fff'; x.fillRect(w / 4, h / 4, w / 2, h / 2); cv.toBlob(r, 'image/png'); })"

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport={'width': 412, 'height': 900}, device_scale_factor=2, service_workers='block', accept_downloads=True)
    page = new_page(ctx)
    page.goto(BASE + '#/template')
    page.wait_for_selector('h1')

    print('1) template predefiniti e migrazione (icona azione)')
    page.wait_for_selector('[data-kind="action"] .item')
    info = js(page, """async (m) => {
      const rows = await m.db.templates.toArray();
      return { names: rows.map((r) => r.name).sort(), rev: await m.getSetting('templatesRev'),
               actionShow: rows.find((r) => r.kind === 'action').config.image.show };
    }""")
    check(info['names'] == ['Attivazione', 'Azione', 'Risultato', 'Solo testo'] and info['rev'] == 3, f'4 template (con Risultato dal Passo 11), templatesRev 3: {info}')
    check(info['actionShow'] is True, 'il template Azione ha image.show true (l\'icona si vede se esiste, come prima)')
    AZ = tpl_by_name(page, 'Azione')
    AT = tpl_by_name(page, 'Attivazione')
    ST = tpl_by_name(page, 'Solo testo')
    # DB "vecchio" (rev 2, Azione con show false): la migrazione porta show a true; con rev 3 e show false resta com'e'
    js(page, "async (m, id) => { const t = await m.getTemplate(id); t.config.image.show = false; await m.setTemplateConfig(id, t.config); await m.setSetting('templatesRev', 2); }", AZ)
    page.reload()
    page.wait_for_selector('h1')
    check(cfg_of(page, AZ)['image']['show'] is True and js(page, "async (m) => await m.getSetting('templatesRev')") == 3, 'rev 2 -> 3: image.show torna true')
    js(page, "async (m, id) => { const t = await m.getTemplate(id); t.config.image.show = false; await m.setTemplateConfig(id, t.config); }", AZ)
    page.reload()
    page.wait_for_selector('h1')
    check(cfg_of(page, AZ)['image']['show'] is False, 'con rev 3 una scelta dell\'utente (show false) non viene toccata')
    js(page, "async (m, id) => { const t = await m.getTemplate(id); t.config.image.show = true; await m.setTemplateConfig(id, t.config); }", AZ)

    print('2) dati di prova: miniatura e arma con immagini, azione con icona')
    ids = page.evaluate("""async (mk) => {
      const m = await import('./js/db.js'); await m.ready();
      const make = eval(mk);
      const g = await m.addGame('Gioco Template', { faction: 'Squadra', unit: 'Operativo', weapon: 'Arma' });
      const f = await m.addFaction(g, 'Squadra Prova');
      const u = await m.addUnit(f, 'Unit A');
      const w = await m.addWeapon({ factionId: f, unitId: u, name: 'Weapon A' });
      await m.setUnitImage(u, await make(300, 240, '#3a6'), 300, 240, null);
      await m.setWeaponImage(w, await make(700, 120, '#a63'), 700, 120, null);
      const a = await m.addAction(g, 'Icon Test', null, {});
      await m.setActionImage(a, await make(200, 200, '#c22'), 200, 200, null);
      const b = await m.addAction(g, 'No Icon', null, {});
      return { g, f, u, w, a, b };
    }""", MK)
    U, W, A, B = ids['u'], ids['w'], ids['a'], ids['b']

    print('3) icona azione: il template decide, Anteprima e Crea partono uguali')
    refs = page.evaluate("""async ([a, tid]) => {
      const m = await import('./js/db.js'); const r = await import('./js/render.js'); const s = await import('./js/stickerinput.js');
      const sha = """ + PXBLOB + """;
      const src = await m.getStickerSource({ actionId: a });
      const tpl = await m.getTemplate(tid);
      const { data, cfg } = s.buildStickerInput(src, tpl);
      const withIcon = await r.renderSticker(data, { ...cfg, image: { ...cfg.image, show: true } });
      const without = await r.renderSticker(data, { ...cfg, image: { ...cfg.image, show: false } });
      return { now: await sha(await s.renderStickerFor(src, tpl)), withIcon: await sha(withIcon), without: await sha(without) };
    }""", [A, AZ])
    check(refs['now'] == refs['withIcon'] and refs['now'] != refs['without'], 'template Azione (show true): lo sticker con icona e\' identico a quello di prima del Passo 9')
    js(page, "async (m, a) => { await m.recordUse({ unitId: null, weaponId: null, actionId: a, templateId: null }); }", A)
    page.goto(BASE + f'#/anteprima?action={A}')
    shown(page)
    check(page.is_checked('[data-toggle="icon"]'), 'Anteprima: "Icona azione" acceso (template show true)')
    check(sha_img(page) == refs['withIcon'], 'Anteprima: PNG uguale a quello di prima')
    page.goto(BASE + '#/crea?tab=recenti')
    page.wait_for_selector('.stk-img img:not([hidden])')
    page.wait_for_timeout(300)
    check(sha_img(page, '.stk-img img') == refs['withIcon'], 'Crea (miniatura del recente): identica all\'Anteprima')
    # il template la nasconde di default
    js(page, "async (m, id) => { const t = await m.getTemplate(id); t.config.image.show = false; await m.setTemplateConfig(id, t.config); }", AZ)
    page.goto(BASE + f'#/anteprima?action={A}')
    shown(page)
    check(not page.is_checked('[data-toggle="icon"]'), 'template show false: l\'Anteprima parte con l\'icona spenta')
    check(sha_img(page) == refs['without'], 'Anteprima senza icona = disegno senza icona')
    page.check('[data-toggle="icon"]')
    page.wait_for_timeout(1500)
    _h = sha_img(page)
    check(_h == refs['withIcon'], 'l\'interruttore in Anteprima la riaccende sul singolo sticker')
    if _h != refs['withIcon']:
        print('     ', _h, refs['withIcon'], refs['without'])
    page.goto(BASE + '#/crea?tab=recenti')
    page.wait_for_selector('.stk-img img:not([hidden])')
    page.wait_for_timeout(300)
    check(sha_img(page, '.stk-img img') == refs['without'], 'Crea (miniatura) parte come l\'Anteprima senza modifiche: icona spenta')
    # tocco lungo: salva lo stesso PNG che darebbe l'Anteprima
    src_sha = page.evaluate("""async ([a, tid]) => {
      const m = await import('./js/db.js'); const s = await import('./js/stickerinput.js');
      const sha = """ + PXBLOB + """;
      const src = await m.getStickerSource({ actionId: a }); const tpl = await m.getTemplate(tid);
      return await sha(await s.renderStickerFor(src, tpl));
    }""", [A, AZ])
    check(src_sha == refs['without'], 'renderStickerFor (usato dal tocco lungo) = Anteprima senza modifiche')
    # azione senza icona: nessun cambiamento con show true o false
    js(page, "async (m, id) => { const t = await m.getTemplate(id); t.config.image.show = true; await m.setTemplateConfig(id, t.config); }", AZ)
    page.goto(BASE + f'#/anteprima?action={B}')
    shown(page)
    check(page.locator('[data-toggle="icon"]').count() == 0, 'azione senza icona: nessun interruttore')

    print('4) elenco template')
    page.goto(BASE + '#/template')
    page.wait_for_selector('[data-kind="activation"] .item')
    check(page.locator('[data-kind="activation"] .item').count() == 2 and page.locator('[data-kind="action"] .item').count() == 1, 'Attivazione: 2, Azione: 1')
    check(page.locator('.item-meta:has-text("Predefinito")').count() == 3, 'un predefinito per tipo (Attivazione, Azione, Risultato)')
    page.screenshot(path=f'{SHOTS}/1-elenco.png', full_page=True)
    page.locator('[data-kind="action"] [data-menu]').click()
    check(page.locator('.sheet button', has_text='Elimina').count() == 0, 'l\'ultimo template del tipo non si puo\' eliminare')
    page.locator('.sheet-cancel').click()
    # duplica
    page.locator(f'[data-menu="{AT}"]').click()
    sheet_click(page, 'Duplica')
    page.wait_for_selector('.item-name:text-is("Attivazione (copia)")')
    page.locator(f'[data-menu="{AT}"]').click()
    sheet_click(page, 'Duplica')
    page.wait_for_selector('.item-name:text-is("Attivazione (copia 2)")')
    c1 = tpl_by_name(page, 'Attivazione (copia)')
    check(cfg_of(page, c1) == cfg_of(page, AT), 'la copia ha la stessa config')
    # rinomina (e nome doppio)
    page.locator(f'[data-menu="{c1}"]').click()
    sheet_click(page, 'Rinomina')
    page.fill('.sheet input[name="name"]', 'attivazione')
    sheet_click(page, 'Salva')
    toast_has(page, 'Esiste')
    check(tpl_by_name(page, 'attivazione') is None, 'nome doppio (senza maiuscole) rifiutato')
    page.locator(f'[data-menu="{c1}"]').click()
    sheet_click(page, 'Rinomina')
    page.fill('.sheet input[name="name"]', 'Mio template')
    sheet_click(page, 'Salva')
    page.wait_for_selector('.item-name:text-is("Mio template")')
    # predefinito
    page.locator(f'[data-menu="{c1}"]').click()
    sheet_click(page, 'Imposta predefinito')
    page.locator('[data-kind="activation"] li:has-text("Mio template") .item-meta').wait_for()
    check(js(page, "async (m) => (await m.getSetting('defaultTemplates')).activation") == c1, 'settings.defaultTemplates.activation aggiornato')
    check(page.locator('li:has-text("Mio template") .item-meta:has-text("Predefinito")').count() == 1, 'la stella e\' sul nuovo predefinito')

    print('5) recenti e preferiti con un template eliminato')
    c2 = tpl_by_name(page, 'Attivazione (copia 2)')
    js(page, "async (m, a) => { await m.recordUse({ unitId: a.u, weaponId: a.w, actionId: null, templateId: a.t }); await m.toggleFavCombo({ unitId: a.u, weaponId: a.w, actionId: null, templateId: a.t }); }", {'u': U, 'w': W, 't': c2})
    page.locator(f'[data-menu="{c2}"]').click()
    sheet_click(page, 'Elimina')
    page.wait_for_selector('.sheet:has-text("recenti e preferiti")')
    sheet_click(page, 'Elimina')
    toast_has(page, 'eliminato')
    check(tpl_by_name(page, 'Attivazione (copia 2)') is None, 'template eliminato')
    page.goto(BASE + '#/crea?tab=recenti')
    page.wait_for_selector('.stk-img img:not([hidden])')
    page.wait_for_timeout(500)
    check(page.locator('.stk').count() >= 2 and page.locator('.stk-img img:not([hidden])').count() >= 2, 'Crea: i recenti con template eliminato si disegnano (predefinito)')
    page.goto(BASE + '#/crea?tab=preferiti')
    page.wait_for_selector('.stk-img img:not([hidden])')
    check(page.locator('.stk-img img:not([hidden])').count() >= 1, 'Crea: il preferito con template eliminato si disegna')
    page.goto(BASE + f'#/anteprima?unit={U}&weapon={W}&template={c2}')
    shown(page)
    check(page.locator('[data-tpl][aria-pressed="true"]').inner_text() == 'Mio template', 'Anteprima con template eliminato: usa il predefinito')
    # elimina il predefinito: il predefinito passa al primo rimasto
    page.goto(BASE + '#/template')
    page.wait_for_selector('[data-kind="activation"] .item')
    page.locator(f'[data-menu="{c1}"]').click()
    sheet_click(page, 'Elimina')
    sheet_click(page, 'Elimina')
    toast_has(page, 'eliminato')
    d = js(page, "async (m) => (await m.getSetting('defaultTemplates'))")
    check(d['activation'] == min(AT, ST) and d['action'] == AZ, f'eliminando il predefinito, il primo rimasto lo diventa: {d}')
    check(js(page, "async (m, id) => { try { await m.deleteTemplate(id); return 'ok'; } catch (e) { return e.message; } }", AZ).startswith('Non si puo'), 'deleteTemplate rifiuta l\'ultimo del tipo')
    js(page, "async (m, id) => { await m.setDefaultTemplate(id); }", AT)

    print('6) editor: anteprima fissa, fisarmonica, salvataggio automatico')
    before = cfg_of(page, AT)
    page.goto(BASE + f'#/template?id={AT}')
    shown(page)
    page.wait_for_timeout(700)
    check(cfg_of(page, AT) == before, 'aprire l\'editor non cambia il template')
    check('Unit A' in page.inner_text('.tpl-sample'), 'esempio: i dati dell\'ultimo recente')
    page.screenshot(path=f'{SHOTS}/2-editor.png')
    ed_sha = sha_img(page)
    page.goto(BASE + f'#/anteprima?unit={U}&weapon={W}&template={AT}')
    shown(page)
    check(sha_img(page) == ed_sha, 'PNG dell\'Anteprima identico all\'anteprima dell\'editor (stessi dati)')
    with page.expect_download() as dl:
        page.click('[data-save]')
    dpath = dl.value.path()
    dsha = hashlib.sha256(open(dpath, 'rb').read()).hexdigest()
    page.goto(BASE + f'#/template?id={AT}')
    shown(page)
    check(sha_bytes(page) == dsha, 'il file salvato (Download) ha gli stessi byte dell\'anteprima dell\'editor')
    page.goto(BASE + f'#/template?id={AT}')
    shown(page)
    # fisarmonica
    open_group(page, 'plate')
    open_group(page, 'image')
    check(page.locator('.tpl-group[open]').count() == 1 and page.locator('[data-group="image"][open]').count() == 1, 'un solo gruppo aperto alla volta')
    # anteprima fissa: resta in vista scorrendo
    open_group(page, 'lines')
    page.evaluate("window.scrollTo(0, 700)")
    page.wait_for_timeout(150)
    box = page.evaluate("(() => { const r = document.querySelector('.tpl-preview').getBoundingClientRect(); return [r.top, r.height, innerHeight]; })()")
    check(box[0] >= 0 and box[0] < 60 and 0.25 * box[2] < box[1] < 0.45 * box[2], f'anteprima fissa in cima (top {box[0]:.0f}, altezza {box[1]:.0f} su {box[2]})')
    page.screenshot(path=f'{SHOTS}/3-editor-righe.png')
    page.evaluate("window.scrollTo(0, 0)")
    # modifiche e salvataggio
    open_group(page, 'plate')
    pre = sha_img(page)
    page.check('[data-p="plate.show"]')
    wait_saved(page)
    shown(page)
    check(cfg_of(page, AT)['plate']['show'] is True and sha_img(page) != pre, 'targa accesa: salvata e anteprima cambiata')
    page.fill('[data-pn="plate.opacity"]', '50')
    wait_saved(page)
    check(abs(cfg_of(page, AT)['plate']['opacity'] - 0.5) < 1e-9, 'opacita\' 50 % salvata come 0.5')
    # bordo: acceso/spento
    box_on = page.locator('[data-border="plate.border"] [data-bd-on]')
    check(box_on.is_checked(), 'il bordo del template Attivazione e\' acceso')
    box_on.uncheck()
    wait_saved(page)
    check('border' not in cfg_of(page, AT)['plate'], 'bordo spento: chiave tolta')
    box_on.check()
    wait_saved(page)
    check(cfg_of(page, AT)['plate']['border']['width'] >= 1, 'bordo riacceso')
    page.fill('[data-p="plate.border.color"]', '#ff0000')
    wait_saved(page)
    check(cfg_of(page, AT)['plate']['border']['color'].lower() == '#ff0000', 'colore del bordo')
    # dopo la modifica: Anteprima = editor
    shown(page)
    ed2 = sha_img(page)
    open_group(page, 'size')
    page.fill('[data-pn="width"]', '720')
    wait_saved(page)
    shown(page)
    ed3 = sha_img(page)
    check(cfg_of(page, AT)['width'] == 720 and ed3 != ed2, 'larghezza 720 salvata, anteprima ridisegnata')
    page.goto(BASE + f'#/anteprima?unit={U}&weapon={W}&template={AT}')
    shown(page)
    check(sha_img(page) == ed3, 'dopo le modifiche l\'Anteprima esce identica all\'editor')
    page.goto(BASE + f'#/template?id={AT}')
    shown(page)
    check(page.input_value('[data-pn="width"]') == '720', 'dopo il riavvio della schermata la larghezza e\' 720')
    page.reload()
    page.wait_for_selector('#pv-img:not([hidden])')
    check(page.input_value('[data-pn="width"]') == '720', 'dopo il ricaricamento della pagina la larghezza e\' ancora 720')

    print('7) righe di testo')
    open_group(page, 'lines')
    check(page.locator('.tpl-line').count() == 2, 'due righe')
    page.click('[data-line-add]')
    page.wait_for_selector('.tpl-line[data-line="2"]')
    page.fill('[data-p="lines.2.text"]', 'Hello Rows')
    wait_saved(page)
    l = cfg_of(page, AT)['lines']
    check(len(l) == 3 and l[2]['source'] == 'text' and l[2]['text'] == 'Hello Rows', 'riga di testo fisso aggiunta')
    page.locator('.tpl-line[data-line="2"] [data-line-up]').click()
    wait_saved(page)
    l = cfg_of(page, AT)['lines']
    check(l[1]['text'] == 'Hello Rows' and l[2]['source'] == 'weapon', 'riga spostata su')
    page.select_option('[data-p="lines.1.font"]', 'Bebas Neue')
    page.fill('[data-pn="lines.1.size"]', '70')
    page.locator('[data-choice="lines.1.align"][data-v="right"]').click()
    page.check('[data-p="lines.1.upper"]')
    wait_saved(page)
    l1 = cfg_of(page, AT)['lines'][1]
    check(l1['font'] == 'Bebas Neue' and l1['size'] == 70 and l1['align'] == 'right' and l1['upper'] is True, 'font, dimensione, allineamento, maiuscolo')
    page.fill('[data-pn="lines.1.stroke.width"]', '0')
    wait_saved(page)
    check(cfg_of(page, AT)['lines'][1]['stroke']['width'] == 0, 'contorno 0 salvato')
    page.screenshot(path=f'{SHOTS}/4-righe.png', full_page=True)
    page.locator('.tpl-line[data-line="1"] [data-line-del]').click()
    wait_saved(page)
    check(len(cfg_of(page, AT)['lines']) == 2, 'riga rimossa')

    print('8) editor del template Azione: "Icona azione", niente immagine arma')
    page.goto(BASE + f'#/template?id={AZ}')
    shown(page)
    titles = page.locator('.tpl-group > summary').all_inner_texts()
    check('Icona azione' in titles and 'Immagine arma' not in titles and 'Immagine miniatura' not in titles, f'gruppi: {titles}')
    check('Icon Test' in page.inner_text('.tpl-sample'), 'esempio: l\'ultima azione usata')
    open_group(page, 'image')
    s_on = sha_img(page)
    page.uncheck('[data-p="image.show"]')
    wait_saved(page)
    shown(page)
    check(cfg_of(page, AZ)['image']['show'] is False and sha_img(page) != s_on, 'Icona azione spenta nel template: salvata, anteprima cambiata')
    for p, v in [('image.height', '100'), ('image.radius', '30')]:
        page.fill(f'[data-pn="{p}"]', v)
    page.locator('[data-choice="image.side"][data-v="right"]').click()
    wait_saved(page)
    ci = cfg_of(page, AZ)['image']
    check(ci['height'] == 100 and ci['radius'] == 30 and ci['side'] == 'right', 'altezza, raggio, lato dell\'icona')
    page.screenshot(path=f'{SHOTS}/5-editor-azione.png')
    page.goto(BASE + f'#/anteprima?action={A}')
    shown(page)
    check(not page.is_checked('[data-toggle="icon"]'), 'Anteprima azione: icona spenta, come dice il template')
    js(page, "async (m, id) => { const t = await m.getTemplate(id); t.config.image.show = true; await m.setTemplateConfig(id, t.config); }", AZ)

    print('9) importa font (.ttf)')
    ttf = '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'
    page.goto(BASE + '#/template')
    page.wait_for_selector('[data-import-font]')
    with page.expect_file_chooser() as fc:
        page.click('[data-import-font]')
    fc.value.set_files(ttf)
    page.wait_for_selector('.sheet:has-text("Nome del font")')
    check(page.input_value('.sheet input[name="name"]') == 'DejaVuSerif Bold', 'nome proposto dal nome del file')
    page.fill('.sheet input[name="name"]', 'Oswald')
    sheet_click(page, 'Salva')
    toast_has(page, 'gia\' incluso')
    page.wait_for_selector('.sheet:has-text("Nome del font")')
    page.fill('.sheet input[name="name"]', 'Prova Serif')
    sheet_click(page, 'Salva')
    toast_has(page, 'Font importato')
    page.wait_for_selector('[data-fonts] .item-name:text-is("Prova Serif")')
    row = js(page, "async (m) => { const f = (await m.listFonts())[0]; return { family: f.family, format: f.format, size: f.blob.size, n: (await m.listFonts()).length }; }")
    check(row == {'family': 'Prova Serif', 'format': 'ttf', 'size': os.path.getsize(ttf), 'n': 1}, f'font salvato con gli stessi byte: {row}')
    check(page.evaluate("[...document.fonts].some((f) => f.family.includes('Prova Serif') && f.status === 'loaded')"), 'registrato con FontFace')
    # file non valido, nome doppio, estensione sbagliata
    bad = os.path.join(TMP, 'rotto.ttf')
    with open(bad, 'wb') as f:
        f.write(b'questo non e\' un font' * 20)
    txt = os.path.join(TMP, 'nota.txt')
    with open(txt, 'w') as f:
        f.write('ciao')
    for path, nm, msg in [(bad, 'Rotto', 'non e\' un font valido'), (txt, 'Nota', 'Formato non supportato'), (ttf, 'prova serif', 'Esiste')]:
        with page.expect_file_chooser() as fc:
            page.click('[data-import-font]')
        fc.value.set_files(path)
        page.wait_for_selector('.sheet:has-text("Nome del font")')
        page.fill('.sheet input[name="name"]', nm)
        sheet_click(page, 'Salva')
        toast_has(page, msg)
        page.wait_for_selector('.sheet:has-text("Nome del font")')
        sheet_click(page, 'Annulla')
    check(js(page, "async (m) => (await m.listFonts()).length") == 1, 'file non validi o doppi: nessun font in piu\'')

    print('10) il font importato nel template, nel PNG, anche dopo il riavvio e offline')
    page.goto(BASE + f'#/template?id={AT}')
    shown(page)
    open_group(page, 'lines')
    opts = page.locator('[data-p="lines.0.font"] option').all_inner_texts()
    check('Prova Serif' in opts and 'Oswald' in opts, f'il font compare nel menu: {opts}')
    s_before = sha_img(page)
    page.select_option('[data-p="lines.0.font"]', 'Prova Serif')
    wait_saved(page)
    shown(page)
    s_font = sha_img(page)
    check(cfg_of(page, AT)['lines'][0]['font'] == 'Prova Serif' and s_font != s_before, 'font scelto: salvato e anteprima cambiata')
    page.screenshot(path=f'{SHOTS}/6-font.png')
    page.goto(BASE + f'#/anteprima?unit={U}&weapon={W}&template={AT}')
    shown(page)
    a_font = sha_img(page)
    check(a_font == s_font, 'Anteprima col font importato = editor')
    # riavvio: la pagina riparte da zero, i font si registrano da IndexedDB; poi si toglie la rete
    page.reload()
    page.wait_for_selector('#pv-img:not([hidden])')
    page.wait_for_timeout(500)
    page.evaluate("Promise.all([import('./js/screens/anteprima.js'), import('./js/screens/template.js'), import('./js/render.js')])")
    ctx.set_offline(True)
    off = page.evaluate("fetch('/js/db.js?x=' + Date.now()).then(() => 'online', () => 'offline')")
    check(off == 'offline', 'la rete e\' davvero spenta')
    page.evaluate("location.hash = '#/anteprima?unit=%d&weapon=%d&template=%d'" % (U, W, AT))
    page.wait_for_function("document.querySelector('#pv-img') && !document.querySelector('#pv-img').hidden")
    page.wait_for_timeout(600)
    check(sha_img(page) == a_font, 'dopo il riavvio e senza rete il PNG ha ancora il font importato (stessi byte)')
    ctx.set_offline(False)

    print('11) eliminare un font')
    page.goto(BASE + '#/template')
    page.wait_for_selector('[data-fonts] .item')
    page.locator('[data-font-menu]').click()
    sheet_click(page, 'Elimina font')
    page.wait_for_selector('.sheet:has-text("Roboto Condensed")')
    sheet_click(page, 'Elimina')
    page.wait_for_selector('[data-fonts] .empty')
    check(js(page, "async (m) => (await m.listFonts()).length") == 0, 'font eliminato')
    page.goto(BASE + f'#/template?id={AT}')
    shown(page)
    open_group(page, 'lines')
    check('non trovato' in page.locator('[data-p="lines.0.font"] option:checked').inner_text(), 'la riga col font eliminato lo segnala "(non trovato)"')
    page.goto(BASE + f'#/anteprima?unit={U}&weapon={W}&template={AT}')
    shown(page)
    check(page.locator('#pv-img').is_visible(), 'lo sticker si disegna lo stesso (font di riserva)')

    print('12) errori in console')
    bad_errors = [e for e in page.errors if 'favicon' not in e and 'Failed to load resource' not in e]
    check(not bad_errors, 'nessun errore: ' + str(bad_errors[:3]))

    browser.close()

print('\n' + ('TUTTO OK' if not fails else f'{len(fails)} CONTROLLI FALLITI:\n - ' + '\n - '.join(fails)))
sys.exit(1 if fails else 0)
