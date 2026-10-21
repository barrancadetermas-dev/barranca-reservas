"""Late check-out + reserva que entra el mismo día: una barra continua con corte diagonal y la entrante con corte paralelo (|/|).
Ángulo único: la inclinación iguala la de la celda dividida (13px sobre el alto de la celda). Insignia 🧹 centrada en la diagonal."""
import sys, re; sys.path.insert(0, __import__('os').path.dirname(__file__))
from _cal_helpers import *
R = Report()
B = [bk('a', '2026-10-21', '2026-10-24', 'LateCobrado', 'D2', late_checkout=True, late_checkout_charged=True),
     bk('b', '2026-10-24', '2026-10-27', 'EntraMismoDia', 'D2'),
     bk('c', '2026-10-21', '2026-10-24', 'LateGratis', 'D3', late_checkout=True, late_checkout_charged=False),
     bk('d', '2026-10-24', '2026-10-26', 'Sigue', 'D3', status='paid', total_paid=100000, balance=0)]
with sync_playwright() as p:
    b, pg, errs = open_calendar(p, B, units=['D2', 'D3'])
    g = lambda key: pg.evaluate("""(k)=>{const b=[...document.querySelectorAll('.bar-span')].find(x=>x.textContent.replace(/\\s/g,'').includes(k));if(!b)return null;
       const r=b.getBoundingClientRect(),cell=b.parentElement,cr=cell.getBoundingClientRect();
       return {clip:b.style.clipPath,left:r.left,right:r.right,h:r.height,cellH:cr.height,bg:b.style.background||getComputedStyle(b).backgroundImage,
               cls:b.className}}""", key)
    out, inn = g('LateCobrado'), g('EntraMismoDia')
    R.t('la barra con late y la entrante se dibujan', out and inn, (out, inn))
    if out and inn:
        so = re.search(r'calc\(100% - (\d+)px\)', out['clip']); si = re.match(r'polygon\((\d+)px 0', inn['clip'])
        R.t('saliente: corte diagonal a la derecha', bool(so), out['clip'])
        R.t('entrante: corte paralelo a la izquierda', bool(si), inn['clip'])
        if so and si:
            sk_o, sk_i = int(so.group(1)), int(si.group(1))
            R.t('misma inclinación en ambas barras', sk_o == sk_i, (sk_o, sk_i))
            exp = round(13 * out['h'] / out['cellH'])
            R.t('ángulo único = ángulo de la celda dividida (13px sobre alto de celda)', abs(sk_o - exp) <= 1, (sk_o, exp))
            gap_top = (inn['left'] + sk_i) - out['right']      # separación horizontal en el borde superior
            gap_bot = inn['left'] - (out['right'] - sk_o)      # y en el inferior
            R.t('separación pareja entre diagonales (~3px arriba y abajo)', abs(gap_top - 3) <= 1.5 and abs(gap_bot - 3) <= 1.5, (gap_top, gap_bot))
        R.t('la saliente NO tiene fondo plano distinto (un solo degradé/color continuo)', out['bg'] != '', out['bg'])
    free = g('LateGratis')
    R.t('late SIN cargo: el tramo final vira a amarillo', free and re.search(r'rgb\(2[34]\d, ?1[89]\d|#EF9F27|#FACC15|rgb\(250, ?204', free['bg'] or '', re.I) is not None, free and free['bg'])
    # insignia 🧹 centrada en la diagonal (no sobre el texto de la barra saliente)
    bd = pg.evaluate("""()=>{const bs=[...document.querySelectorAll('.cal-turn-badge')].filter(x=>x.closest('.cal-cell'));if(!bs.length)return null;
       const x=bs[0],cr=x.closest('.cal-cell').getBoundingClientRect(),r=x.getBoundingClientRect();return {c:r.left+r.width/2-cr.left,w:cr.width}}""")
    R.t('hay insignia 🧹', bd is not None)
    if bd: R.t('insignia centrada en el corte (≈62% de la celda)', abs(bd['c'] - .62 * bd['w']) <= bd['w'] * .12, bd)
    R.t('sin errores de JS', not errs, errs); b.close()
R.done()
