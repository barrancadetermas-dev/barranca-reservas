"""Extras de reservas con 2+ deptos: saldo por unidad (pagos generales repartidos proporcional), edición rápida (abre en Precios),
mensaje de armado hoy/mañana para la encargada, nombre propio en la lista de Reservas y en el voucher."""
import sys, re; sys.path.insert(0, __import__('os').path.dirname(__file__))
from _cal_helpers import *
import json
exec(open(__import__('os').path.join(__import__('os').path.dirname(__file__), 'multiunit_form_test.py'), encoding='utf-8').read().split("with sync_playwright() as p:")[0].split('"""', 2)[2].replace("B = 'http://localhost:5199/_dev/tests/harness/'", "HB = 'http://localhost:5199/_dev/tests/harness/'"))
R = Report()
STORED = booking([('D2', 120000, {'adults': 3, 'children': 0, 'free_nights': 1, 'discount_pct': 10, 'surcharge_amount': 0, 'label': 'Depto de los abuelos'}),
                  ('D3', 110000, {'adults': 1, 'children': 2, 'free_nights': 0, 'discount_pct': 0, 'surcharge_amount': 0, 'label': 'Los primos'})],
                 unit_pricing=True, total_amount=764000, total_paid=176400,
                 payments=[{'id': 'p1', 'method': 'cash', 'amount': 100000, 'amount_ars': 100000, 'payment_date': '2026-10-02', 'currency': 'ARS', 'unit_id': 'D2'},
                           {'id': 'p2', 'method': 'transfer', 'amount': 76400, 'amount_ars': 76400, 'payment_date': '2026-10-03', 'currency': 'ARS', 'unit_id': None}])
with sync_playwright() as p:
    b = p.chromium.launch()
    # ── Detalle: saldo por unidad ─────────────────────────────────────────────
    pg = b.new_context(viewport={'width': 1000, 'height': 1300}).new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(HB + 'harness.html'); pg.wait_for_function('window.__ready===true')
    pg.evaluate("(a)=>form.openDetail(a)", STORED); pg.wait_for_timeout(500)
    txt = pg.evaluate("document.getElementById('detail-body').innerText")
    R.t('detalle: bloque "Saldo por unidad"', 'saldo por unidad' in txt.lower(), txt[:200])
    R.t('detalle: muestra el nombre propio de cada depto', 'Depto de los abuelos' in txt and 'Los primos' in txt)
    R.t('detalle: depto 2 → pagó $100.000 + parte del pago general ($32.400) → saldo $191.600', '191.600' in txt, txt)
    R.t('detalle: depto 3 → parte del pago general ($44.000) → saldo $396.000', '396.000' in txt, txt)
    R.t('detalle: aclara cómo se reparten los pagos generales', 'proporción' in txt)
    R.t('detalle: la distribución por unidad con nombres propios', 'Distribución por unidad' in txt.replace('DISTRIBUCIÓN POR UNIDAD', 'Distribución por unidad') or 'DISTRIBUCIÓN' in txt.upper())
    # ── Edición rápida: abre directo en Precios ───────────────────────────────
    pg.evaluate("(a)=>{window.__calls.length=0;window.__errors={};window.__data={'bookings:select':a,'payments:select':a.payments,'booking_units:select':[],'bookings:update':[{'id':a.id}],'guests:update':[{'id':'G1'}]}}", STORED)
    pg.evaluate("form.openEdit('m1', {step: 3})"); pg.wait_for_timeout(1200)
    R.t('edición rápida: abre directo en el paso 3 (Precios)', pg.evaluate("form._currentStep") == 3, pg.evaluate("form._currentStep"))
    R.t('edición rápida: se ve "Distribución por unidad" y los nombres cargados', pg.is_visible('#unit-dist-wrap') and pg.input_value('.ud-lbl[data-uid="D2"]') == 'Depto de los abuelos')
    pg.evaluate("form.openEdit('m1')"); pg.wait_for_timeout(1000)
    R.t('"Editar" común sigue empezando en el paso 1', pg.evaluate("form._currentStep") == 1, pg.evaluate("form._currentStep"))
    R.t('el botón ⚡ Edición rápida existe en el detalle', pg.locator('#detail-btn-quick').count() == 1)
    # ── Voucher con 2 deptos: nombre propio, importes por depto y distribución ─
    html = pg.evaluate("""async (bk)=>{ const m=await import('/js/services/voucher-guest.js'); let out='';
      const orig=window.open; window.open=()=>({document:{open(){},write(h){out=h},close(){}}});
      m.openGuestVoucher(bk,{name:'Barranca de Termas'}); window.open=orig; return out; }""", STORED)
    R.t('voucher: líneas por depto con su nombre propio', 'Depto de los abuelos · Departamento 2' in html and 'Los primos · Departamento 3' in html, html[:100])
    R.t('voucher: noche sin cargo y descuento SOLO en el depto 2', '120.000' in html and '36.000' in html)
    R.t('voucher: distribución por departamento', '3 adultos' in html and '1 adulto, 2 niños' in html)
    R.t('sin errores de JS (detalle / edición rápida / voucher)', not errs, errs)
    # ── Lista de Reservas: nombre propio junto al chip del depto ──────────────
    pg2 = b.new_context(viewport={'width': 1300, 'height': 900}).new_page(); errs2 = []
    pg2.on('pageerror', lambda e: errs2.append(str(e)))
    pg2.goto(HB + 'harness-list.html'); pg2.wait_for_function('window.__ready===true')
    row = pg2.evaluate("(a)=>window.list._renderRow(a,'2026-10-19')", STORED)
    R.t('lista: el nombre propio aparece junto a cada depto', 'bl-unit-lbl' in row and 'Depto de los abuelos' in row and 'Los primos' in row)
    one = json.loads(json.dumps(STORED)); one['booking_units'] = one['booking_units'][:1]
    R.t('lista: una sola unidad NO agrega el nombre (como siempre)', 'bl-unit-lbl' not in pg2.evaluate("(a)=>window.list._renderRow(a,'2026-10-19')", one))
    R.t('sin errores de JS (lista)', not errs2, errs2)
    b.close()
    # ── Armado hoy/mañana desde el calendario ─────────────────────────────────
    T = lambda id, ci, co, last, u, **kw: bk(id, ci, co, last, u, **kw)
    B2 = [T('h', '2026-10-19', '2026-10-22', 'López', 'D6', adults=2, children=0, pax=2, total_amount=150000, total_paid=50000, balance=100000, first_name=None),
          T('m', '2026-10-20', '2026-10-21', 'Bedu', 'D7', adults=4, children=0, pax=4, total_amount=40000, total_paid=0, balance=40000),
          T('x', '2026-10-25', '2026-10-27', 'Lejana', 'D2')]
    br, cg, errs3 = open_calendar(p, B2, height=1200)
    cg.locator('[data-act="armado"]').click(); cg.wait_for_selector('#arm-text'); cg.wait_for_function("document.getElementById('arm-text').value.includes('HOY') && !document.getElementById('arm-text').value.includes('Cargando')"); 
    ta = cg.input_value('#arm-text')
    R.t('armado: títulos HOY y MAÑANA', ta.startswith('HOY\n') and '\n\nMAÑANA\n' in ta, ta)
    R.t('armado: línea con el formato pedido (#6 ~ NOMBRE, PERS, (fechas) noches. $saldo)', re.search(r'#6 ~ ANA LÓPEZ, 2PERS, \(19/10 al 22/10\) 3 noches\. \$100\.000', ta) is not None, ta)
    R.t('armado: la de mañana con su saldo', re.search(r'#7 ~ ANA BEDU, 4PERS, \(20/10 al 21/10\) 1 noche\. \$40\.000', ta) is not None, ta)
    R.t('armado: no incluye llegadas de otros días', 'LEJANA' not in ta)
    cg.uncheck('#arm-saldo'); R.t('armado: sin saldo cuando se destilda', '$' not in cg.input_value('#arm-text'))
    cg.uncheck('#arm-man'); R.t('armado: solo HOY', 'MAÑANA' not in cg.input_value('#arm-text') and 'HOY' in cg.input_value('#arm-text'))
    R.t('sin errores de JS (armado)', not errs3, errs3); br.close()
R.done()
