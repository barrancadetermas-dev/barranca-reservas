"""Late check-out POR DEPTO en el calendario + ajustes con motivo en el tooltip.
Un depto con late y el otro sin: solo la barra del que lo tiene se prolonga en diagonal. Sin datos por depto, manda el de la reserva."""
import sys, re; sys.path.insert(0, __import__('os').path.dirname(__file__))
from _cal_helpers import *
R = Report()
BU = lambda uid, pr, **x: {'unit_id': uid, 'price_per_night': pr, 'segment_check_in': None, 'segment_check_out': None, 'units': UNITS[uid], **x}
def mk(id, units, **kw): return bk(id, '2026-10-21', '2026-10-24', 'Fam', units[0][0], source='family', price_per_night=230000, booking_units=[BU(u, 120000, **x) for u, x in units], **kw)
B = [mk('p', [('D2', dict(late_checkout=False)), ('D3', dict(late_checkout=True, late_checkout_charged=True, late_checkout_amount=55000))], late_checkout=True, late_checkout_charged=True, unit_pricing=True, total_amount=770000),
     bk('q', '2026-10-21', '2026-10-24', 'Vieja', 'D5', late_checkout=True, late_checkout_charged=True)]
with sync_playwright() as p:
    br, pg, errs = open_calendar(p, B, units=['D2', 'D3', 'D5'], height=1100)
    info = pg.evaluate("""()=>[...document.querySelectorAll('.bar-span')].map(b=>({u:b.parentElement.dataset.unitId,late:b.className.includes('bar-late-end'),clip:b.style.clipPath}))""")
    by = {i['u']: i for i in info}
    R.t('D2 (sin late en esta reserva): la barra termina recta', 'D2' in by and not by['D2']['late'] and not by['D2']['clip'], info)
    R.t('D3 (con late): la barra se prolonga en diagonal', 'D3' in by and by['D3']['late'] and 'calc(100%' in by['D3']['clip'], info)
    R.t('reserva VIEJA (late de toda la reserva, sin datos por depto): su barra lleva el late como siempre', 'D5' in by and by['D5']['late'], info)
    R.t('sin errores de JS', not errs, errs); br.close()
    # ajustes con motivo en el tooltip
    Bt = [mk('t', [('D2', {}), ('D3', {})], unit_pricing=True, total_amount=800000,
             booking_adjustments=[{'unit_id': 'D2', 'kind': 'discount', 'mode': 'pct', 'value': 10, 'charged': True, 'reason': 'Atención comercial', 'sort_order': 0},
                                  {'unit_id': None, 'kind': 'surcharge', 'mode': 'amt', 'value': 15000, 'charged': True, 'reason': 'Mascota', 'sort_order': 1},
                                  {'unit_id': 'D3', 'kind': 'late_checkout', 'mode': 'amt', 'value': 55000, 'charged': False, 'reason': 'Salida 16 hs', 'sort_order': 2}])]
    br2, pg2, errs2 = open_calendar(p, Bt, units=['D2', 'D3'], height=900)
    pg2.locator('.bar-span').first.hover(); pg2.wait_for_timeout(1100)
    tip = pg2.evaluate("[...document.querySelectorAll('.cal-tooltip')].pop()?.innerText||''")
    R.t('tooltip: descuento con su depto y motivo', 'DESCUENTO' in tip and 'Atención comercial' in tip, tip)
    R.t('tooltip: recargo de toda la reserva con su motivo', 'RECARGO' in tip and 'Mascota' in tip, tip)
    R.t('tooltip: late check-out de un depto, sin cargo, con su motivo', 'LATE CHECK-OUT' in tip and 'sin cargo' in tip and 'Salida 16 hs' in tip, tip)
    R.t('sin errores de JS (tooltip)', not errs2, errs2); br2.close()
R.done()
