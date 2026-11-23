#!/usr/bin/env python3
"""Genera PDF SINTETICI di squadra per tests/pdfteam-test.mjs.

Squadre, operativi, armi e regole sono INVENTATI (nessun testo Games Workshop). Il layout imita solo
l'impianto descritto in SPEC.md (intestazione con 4 statistiche, tabella armi NAME/ATK/HIT/DMG/WR,
abilita' con titolo in grassetto, azioni con costo AP, retro con intestazione ripetuta). NON dimostra che
i PDF veri abbiano questo layout: serve a provare il codice del parser e a rivelare regressioni.

Uso: python3 tests/make-synth-fixtures.py [cartella_uscita]   (predefinita: tests/fixtures-synth)
"""
import io
import os
import sys

from PIL import Image
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), 'fixtures-synth')
os.makedirs(OUT, exist_ok=True)

FD = '/usr/share/fonts/truetype/liberation/'
pdfmetrics.registerFont(TTFont('Narrow', FD + 'LiberationSansNarrow-Regular.ttf'))
pdfmetrics.registerFont(TTFont('Narrow-Bold', FD + 'LiberationSansNarrow-Bold.ttf'))
pdfmetrics.registerFont(TTFont('Narrow-Italic', FD + 'LiberationSansNarrow-Italic.ttf'))

W, H = 595.28, 841.89


def portrait_png(color):
    im = Image.new('RGB', (80, 80), color)
    for i in range(80):
        for j in range(0, 80, 8):
            im.putpixel((i, j), (255, 255, 255))
    b = io.BytesIO()
    im.save(b, 'PNG')
    b.seek(0)
    return ImageReader(b)


LABELS = {
    'en': dict(apl='APL', move='MOVE', save='SAVE', wounds='WOUNDS', name='NAME', atk='ATK', hit='HIT', dmg='DMG', wr='WR',
               cont='RULES CONTINUE ON BACK', factionrule='FACTION RULE', strategy='STRATEGY PLOYS', firefight='FIREFIGHT PLOYS',
               equipment='EQUIPMENT'),
    'it': dict(apl='LPA', move='MOV', save='SALV', wounds='FER', name='NOME', atk='ATT', hit='COLP', dmg='DNN', wr='RdA',
               cont='LE REGOLE CONTINUANO SUL RETRO', factionrule='REGOLA DI FAZIONE', strategy='STRATAGEMMI STRATEGY',
               firefight='STRATAGEMMI FIREFIGHT', equipment='EQUIPAGGIAMENTO'),
}


class Page:
    """Disegno con coordinate dall'alto (y verso il basso)."""

    def __init__(self, c):
        self.c = c

    def text(self, x, y, s, font='Narrow', size=8, align='l'):
        self.c.setFont(font, size)
        yy = H - y
        if align == 'c':
            self.c.drawCentredString(x, yy, s)
        elif align == 'r':
            self.c.drawRightString(x, yy, s)
        else:
            self.c.drawString(x, yy, s)

    def rect(self, x, y, w, h, fill=None, stroke=0):
        c = self.c
        if fill:
            c.setFillColorRGB(*fill)
        c.rect(x, H - y - h, w, h, fill=1 if fill else 0, stroke=stroke)
        c.setFillColorRGB(0, 0, 0)

    def image(self, img, x, y, w, h):
        self.c.drawImage(img, x, H - y - h, w, h)


def wrap(text, font, size, width):
    words, lines, cur = text.split(), [], ''
    for w in words:
        t = (cur + ' ' + w).strip()
        if pdfmetrics.stringWidth(t, font, size) <= width:
            cur = t
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def para(p, x, y, width, title, body, size=8, lh=10):
    """Titolo in grassetto + testo normale sulla stessa riga; ritorna la y dopo il paragrafo."""
    tw = pdfmetrics.stringWidth(title + ' ', 'Narrow-Bold', size)
    first = wrap(body, 'Narrow', size, width - tw)
    # prima riga con titolo; il resto a capo a tutta larghezza
    if first:
        head = first[0]
        rest = body[len(head):].strip()
    else:
        head, rest = '', ''
    p.text(x, y, title, 'Narrow-Bold', size)
    p.text(x + tw, y, head, 'Narrow', size)
    y += lh
    for ln in wrap(rest, 'Narrow', size, width):
        p.text(x, y, ln, 'Narrow', size)
        y += lh
    return y + 3


def card(p, lang, x0, top, w, op, back=False, layout='inline', portrait=None, show_cont=False, stats=True, header='stacked', tight=False, title_only=False):
    L = LABELS[lang]
    # banda intestazione
    p.rect(x0, top, w, 62, fill=(0.88, 0.88, 0.88))
    if portrait is not None:
        p.image(portrait, x0 + 4, top + 4, 54, 54)
    if header == 'inline':
        p.text(x0 + 66, top + 54, op['name'], 'Narrow-Bold', 15)   # nome sulla stessa linea dei valori
    else:
        p.text(x0 + 66, top + 20, op['name'], 'Narrow-Bold', 15)
    # statistiche: etichette sopra, valori sotto
    cols = [('apl', op['apl']), ('move', op['move']), ('save', op['save']), ('wounds', op['wounds'])]
    sx = x0 + w - 4 * 46
    for i, (k, v) in enumerate(cols):
        cx = sx + i * 46 + 20
        p.text(cx, top + 36, L[k], 'Narrow', 7, 'c')
        if stats:
            p.text(cx, top + 54, v, 'Narrow-Bold', 14, 'c')
    y = top + 80
    if op.get('weapons') and not back:
        # intestazione tabella
        cx = [x0 + 10, x0 + w * 0.50, x0 + w * 0.58, x0 + w * 0.66, x0 + w * 0.76]
        p.text(cx[0], y, L['name'], 'Narrow-Bold', 8)
        for i, k in enumerate(['atk', 'hit', 'dmg']):
            p.text(cx[i + 1], y, L[k], 'Narrow-Bold', 8, 'c')
        p.text(cx[4], y, L['wr'], 'Narrow-Bold', 8)
        y += 14
        for wp in op['weapons']:
            nm = wp['name']
            lines = wrap_name(nm)
            wr_lines = wp.get('wr_lines') or [wp['wr']]
            n = max(len(lines), len(wr_lines))
            if layout == 'centered':
                # numeri a meta' dell'altezza del blocco
                base = y
                for i, ln in enumerate(lines):
                    p.text(cx[0], base + i * 10, ln, 'Narrow-Bold' if i == 0 else 'Narrow', 8)
                mid = base + (n - 1) * 5
                for i, k in enumerate(['atk', 'hit', 'dmg']):
                    p.text(cx[i + 1], mid, wp[k], 'Narrow', 8, 'c')
                for i, ln in enumerate(wr_lines):
                    p.text(cx[4], base + i * 10, ln, 'Narrow', 8)
            else:
                for i, ln in enumerate(lines):
                    p.text(cx[0], y + i * 10, ln, 'Narrow-Bold' if i == 0 else 'Narrow', 8)
                for i, k in enumerate(['atk', 'hit', 'dmg']):
                    p.text(cx[i + 1], y, wp[k], 'Narrow', 8, 'c')
                for i, ln in enumerate(wr_lines):
                    p.text(cx[4], y + i * 10, ln, 'Narrow', 8)
            y += n * 10 + 7
    y += 4 if tight else 12
    for t, b in op.get('abilities_back' if back else 'abilities', []):
        if title_only:
            p.text(x0 + 10, y, t, 'Narrow-Bold', 8)
            y += 10
            for ln in wrap(b, 'Narrow', 8, w - 20):
                p.text(x0 + 10, y, ln, 'Narrow', 8)
                y += 10
            y += 3
        else:
            y = para(p, x0 + 10, y, w - 20, t, b)
    if not back:
        for t, cost, b in op.get('actions', []):
            p.text(x0 + 10, y, t, 'Narrow-Bold', 8.5)
            p.text(x0 + w - 12, y, cost, 'Narrow-Bold', 8.5, 'r')
            y += 10
            for ln in wrap(b, 'Narrow', 8, w - 20):
                p.text(x0 + 10, y, ln, 'Narrow', 8)
                y += 10
            y += 3
    if show_cont:
        p.text(x0 + w - 12, y + 4, L['cont'], 'Narrow-Italic', 7, 'r')
        y += 12
    if op.get('keywords'):
        p.text(x0 + 10, y + 6, op['keywords'], 'Narrow', 7)


def wrap_name(nm):
    """'Nome (modo)' -> due righe: 'Nome' e '(modo)'."""
    if nm.endswith(')') and ' (' in nm:
        i = nm.rindex(' (')
        return [nm[:i], nm[i + 1:]]
    return [nm]


def rules_page(p, lang, title_key, entries, size=8):
    L = LABELS[lang]
    p.text(40, 60, L[title_key], 'Narrow-Bold', 24)
    y = 100
    for e in entries:
        t = e[0]
        cost = e[1]
        body = e[2]
        if cost:
            p.text(W - 50, y, cost, 'Narrow-Bold', 9, 'r')
        y = para(p, 40, y, W - 120, t, body, 9, 11.5) + 6


def lore_page(p, text):
    p.text(40, 60, 'BACKGROUND', 'Narrow', 22)
    y = 100
    for ln in wrap(text, 'Narrow', 9, W - 80):
        p.text(40, y, ln, 'Narrow', 9)
        y += 12


# ---------- dati inventati ----------

def op(name, apl, move, save, wounds, weapons, abilities, actions, keywords, abilities_back=None):
    return dict(name=name, apl=apl, move=move, save=save, wounds=wounds, weapons=weapons, abilities=abilities,
                actions=actions, keywords=keywords, abilities_back=abilities_back or [])


def w(name, atk, hit, dmg, wr, wr_lines=None):
    return dict(name=name, atk=atk, hit=hit, dmg=dmg, wr=wr, wr_lines=wr_lines)


CAPTAIN = op('WARDEN CAPTAIN', '3', '6"', '3+', '12', [
    w('Arc pistol', '4', '3+', '3/4', 'Range 8", Piercing 1'),
    w('Duty blade', '5', '3+', '4/5', '-'),
], [('Command Voice', 'Once per turning point, this operative can issue a rallying order to a nearby friendly operative.'),
    ('Steadfast', 'This operative cannot be moved by enemy rules.')],
    [('Rally', '1AP', 'Select one friendly WARDEN operative within 3". It regains 2 wounds.')],
    'BRASS WARDENS, IMPERIAL, LEADER, CAPTAIN')

TROOPER = op('WARDEN TROOPER', '2', '6"', '4+', '8', [
    w('Scatter carbine (short range)', '5', '4+', '2/3', 'Range 6"'),
    w('Scatter carbine (long range)', '4', '4+', '2/2', 'Range 12", Saturate'),
    w('Truncheon', '3', '4+', '2/3', '-'),
], [('Disciplined', 'Each time this operative is shooting, it can retain one extra defence die.')],
    [('Brace', '0AP', 'Until the end of the turning point this operative has a 4+ save.')],
    'BRASS WARDENS, IMPERIAL, TROOPER')

SHIELD = op('WARDEN SHIELDBEARER', '2', '5"', '3+', '10', [
    w('Riot hammer', '4', '3+', '4/5', 'Stun'),
    w('Flare-launcher', '4', '4+', '3/3', 'Range 8", Blast 2"', ['Range 8",', 'Blast 2"']),
], [('Interposing Shield', 'While this operative is within 2" of a friendly operative, that operative cannot be targeted by shooting attacks from further than 6".'),
    ('Heavy Frame', 'This operative treats Hazard rules as one step lower.')],
    [('Plant Shield', '1AP', 'Place a shield marker within 1" of this operative.'),
     ('Shove', '1AP', 'Push one enemy operative within 1" by up to 2".')],
    'BRASS WARDENS, IMPERIAL, SHIELDBEARER',
    [('Shield Wall', 'Markers placed by Plant Shield remain until this operative is incapacitated or moves.')])

GUNNER = op('WARDEN GUNNER', '2', '6"', '4+', '9', [
    w('Heavy repeater - overwatch', '6', '4+', '3/4', 'Range 10", Rending, Heavy (Dash only)',
      ['Range 10", Rending,', 'Heavy (Dash only)']),
    w('Heavy repeater - sustained', '4', '3+', '3/3', 'Range 10", Ceaseless'),
    w('Gun butt', '3', '4+', '2/3', '-'),
], [('Suppressing Volley', 'Enemy operatives within 4" of this operative treat their move as one lower.')],
    [('Set Up', '1AP', 'This operative becomes Ready and Concealed until it moves.')],
    'BRASS WARDENS, IMPERIAL, GUNNER')

FACTION_RULE = [('Brass Discipline', '', 'Once per turning point, when a friendly WARDEN operative would be incapacitated, it can make a free Dash action before being removed.'),
                ('Order Dice', '', 'Each friendly operative starts the battle with one order die.')]
STRATEGY = [('Hold The Line', '1CP', 'Use this strategic ploy in the Strategy phase. Until the end of the turning point, friendly WARDEN operatives are Obscured while within 3" of a marker.'),
            ('Forced March', '1CP', 'Until the end of the turning point, add 1" to the Move stat of friendly WARDEN operatives.')]
FIREFIGHT = [('Volley Fire', '1CP', 'Use this firefight ploy when a friendly operative is shooting. Improve the Piercing of its ranged weapon by 1.'),
             ('Close Ranks', '2CP', 'Use this firefight ploy after a friendly operative completes an action. Another friendly operative within 3" can perform a free Reposition.')]
EQUIPMENT = [('Signal Flares', '', 'Once per battle, a friendly operative can use this equipment to remove the Concealed state from an enemy operative within 6".'),
             ('Ablative Plates', '', 'Once per battle, when an attack dice would be retained against this operative, it can be discarded instead.')]
LORE = 'Invented background text for tests only. The wardens of the brass order patrol the lower decks and keep the peace by every means at their disposal. ' * 3


def build(name, lang, builder, meta_title=None):
    path = os.path.join(OUT, name)
    c = canvas.Canvas(path, pagesize=(W, H))
    c.setTitle(meta_title or name)
    p = Page(c)
    builder(c, p)
    c.save()
    print('scritto', path)


def ensure_lang(operative, lang):
    return operative


def f_single(c, p):
    pt = portrait_png((200, 150, 60))
    for o in (CAPTAIN, TROOPER, GUNNER):
        card(p, 'en', 40, 40, W - 80, o, portrait=pt)
        c.showPage()
    rules_page(p, 'en', 'factionrule', FACTION_RULE); c.showPage()
    rules_page(p, 'en', 'strategy', STRATEGY); c.showPage()
    rules_page(p, 'en', 'firefight', FIREFIGHT); c.showPage()
    rules_page(p, 'en', 'equipment', EQUIPMENT); c.showPage()
    lore_page(p, LORE); c.showPage()


def f_frontback(c, p):
    # p1: due carte fronte (griglia 2 righe); p2: retri (intestazione ripetuta, abilita' che continuano)
    cw, ch = W - 80, 360
    card(p, 'en', 40, 30, cw, CAPTAIN, show_cont=False)
    card(p, 'en', 40, 30 + ch + 20, cw, SHIELD, show_cont=True)
    c.showPage()
    card(p, 'en', 40, 30, cw, CAPTAIN, back=True)
    card(p, 'en', 40, 30 + ch + 20, cw, SHIELD, back=True)
    c.showPage()
    rules_page(p, 'en', 'factionrule', FACTION_RULE); c.showPage()
    rules_page(p, 'en', 'strategy', STRATEGY); c.showPage()
    rules_page(p, 'en', 'firefight', FIREFIGHT); c.showPage()
    rules_page(p, 'en', 'equipment', EQUIPMENT); c.showPage()


def f_dual(c, p):
    # doppio profilo, numeri centrati, nomi su due righe, WR su due righe; due colonne di carte nella stessa pagina
    cw = (W - 100) / 2
    card(p, 'en', 40, 40, cw, TROOPER, layout='centered')
    card(p, 'en', 60 + cw, 40, cw, GUNNER, layout='centered')
    c.showPage()
    card(p, 'en', 40, 40, W - 80, GUNNER, layout='centered')
    c.showPage()
    rules_page(p, 'en', 'factionrule', FACTION_RULE); c.showPage()
    rules_page(p, 'en', 'strategy', STRATEGY); c.showPage()
    rules_page(p, 'en', 'firefight', FIREFIGHT); c.showPage()
    rules_page(p, 'en', 'equipment', EQUIPMENT); c.showPage()


def f_italian(c, p):
    for o in (CAPTAIN, TROOPER):
        card(p, 'it', 40, 40, W - 80, o)
        c.showPage()
    rules_page(p, 'it', 'factionrule', FACTION_RULE); c.showPage()
    rules_page(p, 'it', 'strategy', STRATEGY); c.showPage()
    rules_page(p, 'it', 'firefight', FIREFIGHT); c.showPage()
    rules_page(p, 'it', 'equipment', EQUIPMENT); c.showPage()


def f_broken(c, p):
    """Errori voluti: HIT non valido, riga arma senza nome, statistica mancante."""
    bad = op('WARDEN SCOUT', '2', '7"', '5+', '7', [
        w('Sling', '3', 'x', '2/3', 'Range 6"'),
        w('', '4', '4+', '2/2', '-'),
        w('Knife', '3', '4+', '2/3', '-'),
    ], [('Light Step', 'This operative can move through other operatives.')], [], 'BRASS WARDENS, IMPERIAL, SCOUT')
    card(p, 'en', 40, 40, W - 80, bad, stats=True)
    c.showPage()
    nostat = op('WARDEN MEDIC', '2', '6"', '4+', '8', [w('Syringe', '3', '4+', '2/2', '-')], [], [], 'BRASS WARDENS, IMPERIAL, MEDIC')
    card(p, 'en', 40, 40, W - 80, nostat, stats=False)
    c.showPage()


def f_variants(c, p):
    # 1: nome sulla linea dei valori + abilita' attaccate alla tabella (spazio minimo)
    card(p, 'en', 40, 40, W - 80, CAPTAIN, header='inline', tight=True)
    c.showPage()
    # 2: titoli di abilita' su riga propria
    card(p, 'en', 40, 40, W - 80, SHIELD, title_only=True)
    c.showPage()
    # 3: griglia 2x2 di carte piccole
    cw, ch = (W - 100) / 2, 380
    card(p, 'en', 40, 30, cw, CAPTAIN)
    card(p, 'en', 60 + cw, 30, cw, TROOPER, layout='centered')
    card(p, 'en', 40, 30 + ch + 20, cw, SHIELD)
    card(p, 'en', 60 + cw, 30 + ch + 20, cw, GUNNER, layout='centered')
    c.showPage()
    rules_page(p, 'en', 'factionrule', FACTION_RULE); c.showPage()
    rules_page(p, 'en', 'strategy', STRATEGY); c.showPage()
    rules_page(p, 'en', 'firefight', FIREFIGHT); c.showPage()
    rules_page(p, 'en', 'equipment', EQUIPMENT); c.showPage()


build('synth-variants.pdf', 'en', f_variants, 'Synthetic Brass Wardens (variants)')
build('synth-single.pdf', 'en', f_single, 'Synthetic Brass Wardens (single)')
build('synth-frontback.pdf', 'en', f_frontback, 'Synthetic Brass Wardens (front-back)')
build('synth-dual.pdf', 'en', f_dual, 'Synthetic Brass Wardens (dual)')
build('synth-italian.pdf', 'it', f_italian, 'Squadra sintetica')
build('synth-broken.pdf', 'en', f_broken, 'Synthetic broken')
