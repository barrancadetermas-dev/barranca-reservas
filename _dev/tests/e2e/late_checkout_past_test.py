"""Late check-out (reservas pasadas y futuras): la barra se prolonga SOLA dentro de la celda de salida.
Ya no existe la tira aparte (.bar-lco-ext): causaba el texto fantasma y la 'costura' de color.
Verifica: un solo elemento, sin nombre repetido, sin blur, opacidad pareja y que invada la celda de salida."""
import sys; sys.path.insert(0, __import__('os').path.dirname(__file__))
from _cal_helpers import *
R = Report()
B = [bk('p1', '2026-10-05', '2026-10-08', 'PastCobrado', 'D2', late_checkout=True, late_checkout_charged=True),
     bk('p2', '2026-10-10', '2026-10-13', 'PastGratis', 'D2', late_checkout=True, late_checkout_charged=False),
     bk('p3', '2026-10-01', '2026-10-04', 'PastSinLate', 'D2'),
     bk('p4', '2026-10-05', '2026-10-08', 'PastGratisPaga', 'D3', late_checkout=True, late_checkout_charged=False, status='paid', total_paid=150000, balance=0),
     bk('f1', '2026-10-22', '2026-10-26', 'FutLate', 'D2', late_checkout=True, late_checkout_charged=True),
     bk('f2', '2026-10-27', '2026-10-30', 'FutGratis', 'D3', late_checkout=True, late_checkout_charged=False)]
with sync_playwright() as p:
    b, pg, errs = open_calendar(p, B, start='2026-10-01', units=['D2', 'D3'])
    R.t('no existe la tira aparte .bar-lco-ext', pg.locator('.bar-lco-ext, .cal-late-strip').count() == 0)
    info = pg.evaluate("""()=>[...document.querySelectorAll('.bar-span')].map(b=>{const cell=b.parentElement;const br=b.getBoundingClientRect();
      const cr=cell.getBoundingClientRect();const cs=getComputedStyle(b);
      return {name:b.textContent.trim(),late:b.classList.contains('bar-late-end'),clip:b.style.clipPath,op:+cs.opacity,
        blur:/blur/.test(cs.filter+cs.backdropFilter),cellW:cr.width,w:br.width,right:br.right,cellLeft:cr.left,
        names:[...cell.querySelectorAll('*')].filter(e=>e.children.length===0&&/Past|Fut/.test(e.textContent)).length}})""")
    by = {i['name']: i for i in info}
    def get(key): return next((v for k, v in by.items() if key in k.replace(' ', '')), None)
    for key, label, late in [('PastCobrado', 'pasada con late PAGO', True), ('PastGratis', 'pasada con late GRATIS', True), ('PastSinLate', 'pasada sin late (control)', False), ('FutLate', 'futura con late', True), ('FutGratis', 'futura con late GRATIS', True)]:
        i = get(key)
        if not i: R.t(f'{label}: se dibuja', False, list(by)); continue
        R.t(f'{label}: {"termina en diagonal" if late else "termina recta"}', bool(i['clip']) == late, i['clip'])
        R.t(f'{label}: ningún blur', not i['blur'])
        R.t(f'{label}: nombre UNA sola vez en la celda', i['names'] == 1, i['names'])
        if late: R.t(f'{label}: opacidad pareja (≥.9 o apagada de pasada)', i['op'] >= .38, i['op'])
    # la barra debe invadir la celda de salida: 3 noches → ancho ≈ 3 celdas + 62% de otra
    i = get('FutLate'); n = 4
    R.t('futura con late: invade ~62% de la celda de salida', i and abs(i['w'] - (n * i['cellW'] + .62 * i['cellW'])) < i['cellW'] * .2, i and (i['w'], i['cellW']))
    R.t('sin errores de JS', not errs, errs); b.close()
R.done()
