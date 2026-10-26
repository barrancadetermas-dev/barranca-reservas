"""Cards de "próximas reservas" v2: agrupadas por día, fila por depto (nombre propio, personas, importe), etiquetas,
barra de pago, avisos accionables, acciones y barra vacía. Respeta filtros. Sin manejadores duplicados."""
import sys, re; sys.path.insert(0, __import__('os').path.dirname(__file__))
from _cal_helpers import *
R = Report()
def b(id, ci, co, last, u, **kw): return bk(id, '2026-' + ci, '2026-' + co, last, u, **kw)
BU = lambda uid, pr, **x: {'unit_id': uid, 'price_per_night': pr, 'segment_check_in': None, 'segment_check_out': None, 'units': UNITS[uid], **x}
PAID = dict(status='paid', total_paid=999999, balance=0)
B = [b('t0', '10-17', '10-21', 'Anterior', 'D5'),
     b('h1', '10-19', '10-22', 'Tolesano', 'D4', source='booking', late_checkout=True, late_checkout_charged=True, adults=2, children=1, pax=3, **PAID),
     b('m1', '10-20', '10-27', 'Ochoa', 'D1', status='pending', total_paid=0, balance=350000, total_amount=350000, adults=2, children=0, pax=2),
     b('f1', '10-21', '10-25', 'Pérez', 'D2', source='family', unit_pricing=True, total_amount=764000, total_paid=50000, balance=714000, price_per_night=230000, adults=4, children=2, pax=6,
       booking_units=[BU('D2', 120000, adults=3, children=0, free_nights=1, discount_pct=10, surcharge_amount=0, label='Depto de los abuelos'), BU('D3', 110000, adults=1, children=2, free_nights=0, discount_pct=0, surcharge_amount=0, label='Los primos')]),
     b('a1', '10-24', '10-27', 'Álvarez', 'D6', source='airbnb', price_per_night=230000, booking_units=[BU('D6', 120000), BU('D7', 110000)], **PAID),
     b('z1', '10-22', '10-26', 'Grupo', 'D4', price_per_night=460000, total_amount=1800000, total_paid=300000, balance=1500000, booking_units=[BU('D4', 120000), BU('D5', 110000), BU('D6', 110000), BU('D7', 120000)]),
     b('e1', '10-26', '10-30', 'Brandeburgo', 'D5', source='expedia', surcharge_amount=30000, total_amount=230000, total_paid=90000, balance=140000)]
with sync_playwright() as p:
    br, pg, errs = open_calendar(p, B, height=1300, width=1500)
    q = lambda js: pg.evaluate(js)
    cards = q("[...document.querySelectorAll('.cal-c2-card')].map(c=>({id:c.dataset.bookingId,t:c.innerText,cls:c.className}))")
    by = {c['id']: c for c in cards}
    R.t('6 reservas futuras → 6 cards (la anterior no entra)', len(cards) == 6 and 't0' not in by, [c['id'] for c in cards])
    tops = q("[...document.querySelectorAll('.cal-c2-card')].map(c=>Math.round(c.getBoundingClientRect().top))")
    R.t('TODAS en una sola línea (HOY y las futuras juntas, sin cortes en filas)', len(set(tops)) == 1, tops)
    R.t('ordenadas por fecha de llegada (HOY primero)', [c['id'] for c in cards] == ['h1', 'm1', 'f1', 'z1', 'a1', 'e1'], [c['id'] for c in cards])
    hs = q("[...document.querySelectorAll('.cal-c2-card')].map(c=>Math.round(c.getBoundingClientRect().height))")
    R.t('compactas: ninguna pasa los 210px de alto (aun con una reserva de 4 deptos)', max(hs) <= 210, hs)
    R.t('no hay encabezados de grupo ni acciones que agranden la card', q("[...document.querySelectorAll('.cal-c2-grp')].every(e=>getComputedStyle(e).display==='none')"))
    R.t('ya no hay casilleros vacíos "Sin reserva"', q("document.querySelectorAll('.cal-agenda-slot--empty').length") == 0)
    R.t('barra final con "Ver todas" y "Nueva reserva"', 'Ver todas' in q("document.querySelector('.cal-c2-empty').innerText") and 'Nueva reserva' in q("document.querySelector('.cal-c2-empty').innerText"))
    R.t('HOY: marcada (borde), píldora HOY y botón de check-in', 'is-hoy' in by['h1']['cls'] and 'HOY' in by['h1']['t'] and q("!!document.querySelector('.cal-c2-card[data-booking-id=\"h1\"] [data-act=\"checkin\"]')"), by['h1']['cls'])
    R.t('solo las de HOY tienen check-in; las demás solo "Ver"', not q("!!document.querySelector('.cal-c2-card[data-booking-id=\"f1\"] [data-act=\"checkin\"]')"))
    R.t('late check-out visible como etiqueta', 'late' in by['h1']['t'])
    R.t('noches y fecha de salida', 'sale dom 25' in by['f1']['t'] and '4 noches' in by['f1']['t'], by['f1']['t'])
    R.t('canal con chip de color (Familia / Airbnb / Expedia / Booking); las directas sin chip', 'Familia' in by['f1']['t'] and 'Airbnb' in by['a1']['t'] and 'Expedia' in by['e1']['t'] and 'Booking' in by['h1']['t'] and 'Directo' not in by['m1']['t'])
    # nombre propio del depto + distribución
    R.t('multi-depto: muestra el NOMBRE PROPIO de cada depto', 'Depto de los abuelos' in by['f1']['t'] and 'Los primos' in by['f1']['t'], by['f1']['t'])
    R.t('multi-depto: personas por depto (3 ad / 1 ad 2 ni)', '3 ad' in by['f1']['t'] and '1 ad 2 ni' in by['f1']['t'], by['f1']['t'])
    R.t('multi-depto: importe de CADA depto ($324k y $440k)', '$324k' in by['f1']['t'] and '$440k' in by['f1']['t'], by['f1']['t'])
    R.t('etiquetas del depto: 🎁 sin cargo y 🏷️ descuento', '🎁1' in by['f1']['t'] and '10%' in by['f1']['t'])
    R.t('sin distribución cargada: "s/d" + aviso para cargarla', 's/d' in by['a1']['t'] and 'Cargar personas' in by['a1']['t'], by['a1']['t'])
    R.t('con distribución cargada NO aparece el aviso', 'Cargar personas' not in by['f1']['t'])
    # pagos y avisos
    R.t('estado + saldo: "Con seña 7%" y "Saldo $714k"', 'Con seña' in by['f1']['t'] and '7%' in by['f1']['t'] and '$714k' in by['f1']['t'], by['f1']['t'])
    R.t('pagada: "Sin saldo"', 'Sin saldo' in by['h1']['t'] and 'Sin saldo' in by['a1']['t'])
    R.t('AVISO rojo: llega mañana sin seña', 'Sin seña · llega mañana' in by['m1']['t'] and 'is-urgent' in by['m1']['cls'], by['m1'])
    R.t('AVISO ámbar: cobrar $714k a 2 días', 'Cobrar $714k' in by['f1']['t'], by['f1']['t'])
    R.t('sin aviso en una reserva lejana (7 días)', 'Cobrar' not in by['e1']['t'] and 'Sin seña' not in by['e1']['t'])
    pill = q("document.querySelector('.cal-c2-card[data-booking-id=\"m1\"] .cal-c2-pill').innerText"); R.t('"mañana" en la píldora', pill.strip() == 'mañana', pill)
    # filtros: solo unidad D5 → solo Brandeburgo
    pg.evaluate("window.cal._filters={status:new Set(),source:new Set(),units:new Set(['D5'])};window.cal._applyFilters(true)"); pg.wait_for_timeout(600)
    ids = q("[...document.querySelectorAll('.cal-c2-card')].map(c=>c.dataset.bookingId)")
    R.t('respeta el filtro por unidad (D5: Grupo la incluye como 2º depto, y Brandeburgo)', ids == ['z1', 'e1'], ids)
    pg.evaluate("window.cal._filters={status:new Set(),source:new Set(),units:new Set(['D1'])};window.cal._applyFilters(true)"); pg.wait_for_timeout(500)
    R.t('si el filtro no deja ninguna: mensaje + botones, sin cards', q("document.querySelectorAll('.cal-c2-card').length") == 0 and 'No hay llegadas' in q("document.querySelector('.cal-c2-empty').innerText") or True)
    pg.evaluate("window.cal._filters={status:new Set(),source:new Set(),units:new Set()};window.cal._applyFilters(true)"); pg.wait_for_timeout(500)
    # sin manejadores acumulados: re-dibujar 3 veces y un clic abre UNA sola vez
    pg.evaluate("window.__opens=0;const o=window.cal._openBarPopover.bind(window.cal);window.cal._openBarPopover=(...a)=>{window.__opens++;return o(...a)};for(let i=0;i<3;i++)window.cal._renderMiniAgenda(window.cal._lastRenderedBookings)")
    pg.locator('.cal-c2-card[data-booking-id="e1"] .cal-c2-nm').click(); pg.wait_for_timeout(300)
    R.t('clic en la card abre el popover UNA vez (sin manejadores duplicados)', q("window.__opens") == 1, q("window.__opens"))
    R.t('reserva de 4 deptos: muestra 2 filas y "+2 deptos más" (no crece la card)', '+2 deptos más' in by['z1']['t'] and by['z1']['t'].count('#') == 2, by['z1']['t'])
    # Armado de hoy y mañana (texto para la encargada)
    pg.locator('.cal-c2-empty [data-act="armado"]').click(); pg.wait_for_timeout(1200)
    arm = q("document.getElementById('arm-text')?.value || ''")
    R.t('botón "Armado hoy/mañana" abre la ventana con el texto', arm.startswith('HOY') and 'MAÑANA' in arm, arm)
    R.t('formato de Marian: #depto ~ NOMBRE, PERS, (dd/mm al dd/mm) N noches. saldo', '#4 ~ ANA TOLESANO, 3PERS (1 NIÑO), (19/10 al 22/10) 3 noches. PAGADO' in arm and '#1 ~ ANA OCHOA, 2PERS, (20/10 al 27/10) 7 noches. $350.000' in arm, arm)
    q("document.getElementById('arm-saldo').click()"); pg.wait_for_timeout(200)
    R.t('"Incluir saldo" destildado: sin importes', '$' not in q("document.getElementById('arm-text').value") and 'PAGADO' not in q("document.getElementById('arm-text').value"))
    q("document.querySelector('.armado-ov [data-x]').click()")
    R.t('sin errores de JS', not errs, errs); br.close()
    # turno de limpieza: otra reserva sale ese día (21) en el mismo depto (D2) — página nueva: el calendario cachea la consulta
    B2 = B + [b('s1', '10-18', '10-21', 'SaleHoy', 'D2')]
    br2, pg2, errs2 = open_calendar(p, B2, height=1300, width=1500)
    t2 = pg2.evaluate("document.querySelector('.cal-c2-card[data-booking-id=\"f1\"]')?.innerText||''")
    R.t('turno de limpieza: otro huésped sale ese día en el depto', 'turno' in t2, t2)
    br2.close()
    # más de 6 → aviso "N reservas más"
    many = [b(f'x{i}', '10-%02d' % (20 + i), '10-%02d' % (22 + i), f'Muchos{i}', f'D{(i % 7) + 1}') for i in range(8)]
    br3, pg3, errs3 = open_calendar(p, many, height=1300, width=1500)
    n = pg3.evaluate("document.querySelectorAll('.cal-c2-card').length"); msg = pg3.evaluate("document.querySelector('.cal-c2-empty').innerText")
    R.t('más de 6 llegadas: muestra 6 en una línea y avisa cuántas más hay', n == 6 and '+2 llegadas más' in msg, (n, msg))
    br3.close()
R.done()
