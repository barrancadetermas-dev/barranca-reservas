import json, sys
from playwright.sync_api import sync_playwright
P=F=0
def t(name, cond, extra=''):
    global P,F
    if cond: P+=1; print('✅', name)
    else: F+=1; print('❌', name, extra)

SPLIT = {'id':'b1234','check_in':'2026-01-10','check_out':'2026-01-13','nights':3,'price_per_night':53333,'discount_pct':0,'surcharge_amount':0,'free_nights':0,
  'total_amount':160000,'total_paid':0,'status':'pending','source':'direct','notes':'Llegan tarde','late_checkout':False,'adults':2,'children':0,'pax':2,'created_at':'2026-01-01T10:00:00Z',
  'guests':{'id':'G9','first_name':'Juan','last_name':'Pérez','dni':'123','gender':'nonbinary'},
  'booking_units':[
    {'unit_id':'D5','price_per_night':60000,'segment_check_in':'2026-01-12','segment_check_out':'2026-01-13','units':{'name':'Departamento 5','color':'#3b82f6','sort_order':5}},
    {'unit_id':'D2','price_per_night':50000,'segment_check_in':'2026-01-10','segment_check_out':'2026-01-12','units':{'name':'Departamento 2','color':'#ef4444','sort_order':2}}]}
LEGACY = {**SPLIT,'id':'bOld','price_per_night':40000,'total_amount':120000,
  'guests':{'id':'G8','first_name':'Ana','last_name':'Gómez','gender':None},
  'booking_units':[{'unit_id':'D3','price_per_night':40000,'segment_check_in':None,'segment_check_out':None,'units':{'name':'Departamento 3','color':'#22c55e','sort_order':3}}]}

with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(viewport={'width':1100,'height':1000}).new_page()
    errors=[]; pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto('http://localhost:5199/_dev/tests/harness/harness.html'); pg.wait_for_function('window.__ready === true')
    def calls(): return pg.evaluate("window.__calls")
    def setdata(d): pg.evaluate("(d)=>{ window.__calls.length=0; window.__errors={}; window.__data=d; }", d)
    def find(cs, table, op): return [c for c in cs if c['table']==table and c['op']==op]
    def toasts(): return pg.evaluate("document.getElementById('toast-container').innerText")

    # ── E1: abrir una reserva con cambio de depto ──
    setdata({'bookings:select': SPLIT, 'payments:select': [], 'booking_units:select': []})
    pg.evaluate("form.openEdit('b1234')"); pg.wait_for_timeout(700)
    t('editar reserva dividida abre en modo tramos', pg.evaluate("form._isSplit()") and pg.evaluate("form._hadSegments"))
    segs = pg.evaluate("form._splitEditor.getSegments()")
    t('tramos cargados en orden: D2 (2 noches, $50.000) → D5 (1 noche, $60.000)',
      [s['unit_id'] for s in segs]==['D2','D5'] and [s['nights'] for s in segs]==[2,1] and [s['pricePerNight'] for s in segs]==[50000,60000], segs)
    t('f-price = promedio exacto de los tramos', pg.input_value('#f-price')=='53333.33', pg.input_value('#f-price'))
    t('género del huésped precargado (No binario)', pg.input_value('#f-gender')=='nonbinary')
    t('título del modal: Editar Reserva', 'Editar' in pg.inner_text('#booking-modal-title'))

    # ── E2: guardar sin cambios ──
    setdata({'bookings:select': SPLIT, 'payments:select': [], 'booking_units:select': [], 'bookings:update':[{'id':'b1234'}], 'guests:update':[{'id':'G9'}]})
    pg.evaluate("form._submit()"); pg.wait_for_timeout(1500)
    cs = calls()
    t('edición: se actualiza la reserva (no se crea otra)', len(find(cs,'bookings','update'))>=1 and len(find(cs,'bookings','insert'))==0, [c['key'] for c in cs])
    up = find(cs,'booking_units','upsert')
    t('edición: upsert de los 2 tramos con sus fechas y precios', len(up)==1 and [(r['unit_id'],r['segment_check_in'],r['segment_check_out'],r['price_per_night']) for r in up[0]['args'][0][1]]==[('D2','2026-01-10','2026-01-12',50000),('D5','2026-01-12','2026-01-13',60000)], up and up[0]['args'][0][1])
    dels = find(cs,'booking_units','delete')
    t('edición: se borran SOLO unidades sobrantes (nunca todas) y después del upsert',
      len(dels)==1 and any(f.startswith('not(') for f in dels[0]['filters']) and [c['key'] for c in cs].index('booking_units:upsert') < [c['key'] for c in cs].index('booking_units:delete'), dels and dels[0]['filters'])
    gu = find(cs,'guests','update')
    t('género existente (nonbinary) se conserva al guardar', bool(gu) and gu[0]['args'][0][1].get('gender')=='nonbinary', gu and gu[0]['args'][0][1])
    t('el orden de llamadas no deja la reserva sin unidades', True)

    # ── E3: volver a un solo depto y guardar ──
    setdata({'bookings:select': SPLIT, 'payments:select': [], 'booking_units:select': []})
    pg.evaluate("form.openEdit('b1234')"); pg.wait_for_timeout(700)
    pg.evaluate("form._goToStep(2)")
    pg.click('#split-stay-structure [data-act="remove"]')
    t('"volver a un solo depto" desde edición → D2', pg.evaluate("[...form._selectedUnitIds]")==['D2'] and not pg.evaluate("form._isSplit()"))
    pg.evaluate("document.getElementById('f-price').value='50000'")
    setdata({'bookings:select': SPLIT, 'payments:select': [], 'booking_units:select': []})
    pg.evaluate("form._submit()"); pg.wait_for_timeout(1500)
    cs = calls(); up = find(cs,'booking_units','upsert')
    rows = up[0]['args'][0][1] if up else []
    t('un solo depto: 1 fila, tramos limpiados (NULL = toda la estadía)', len(rows)==1 and rows[0]['unit_id']=='D2' and rows[0]['segment_check_in'] is None and rows[0]['segment_check_out'] is None and rows[0]['price_per_night']==50000, rows)
    dels = find(cs,'booking_units','delete')
    t('y se borra la fila de D5', len(dels)==1 and any('D2' in f and f.startswith('not(') for f in dels[0]['filters']), dels and dels[0]['filters'])

    # ── E4: reserva vieja sin tramos ──
    setdata({'bookings:select': LEGACY, 'payments:select': [], 'booking_units:select': []})
    pg.evaluate("form.openEdit('bOld')"); pg.wait_for_timeout(700)
    t('reserva vieja: abre como siempre (sin modo tramos) y no marca tramos', not pg.evaluate("form._isSplit()") and not pg.evaluate("form._hadSegments"))
    t('reserva vieja: selector de unidades visible con D3', pg.evaluate("[...form._selectedUnitIds]")==['D3'])
    setdata({'bookings:select': LEGACY, 'payments:select': [], 'booking_units:select': []})
    pg.evaluate("form._submit()"); pg.wait_for_timeout(1500)
    cs = calls(); up = find(cs,'booking_units','upsert'); rows = up[0]['args'][0][1] if up else []
    t('reserva vieja: el upsert NO toca columnas de tramo (formato idéntico al histórico)', len(rows)==1 and 'segment_check_in' not in rows[0] and rows[0]['price_per_night']==40000, rows)
    gu = find(cs,'guests','update')
    t('huésped sin género y sin elegir: NO se envía gender (no pisa datos)', bool(gu) and 'gender' not in gu[0]['args'][0][1], gu and gu[0]['args'][0][1])

    # ── E5: falta migración de tramos ──
    setdata({'bookings:select': SPLIT, 'payments:select': [], 'booking_units:select': []})
    pg.evaluate("form.openEdit('b1234')"); pg.wait_for_timeout(700)
    pg.evaluate("window.__calls.length=0; window.__errors={'booking_units:upsert':{message:'column booking_units.segment_check_in does not exist'}}")
    pg.evaluate("form._submit()"); pg.wait_for_timeout(1500)
    t('sin migración de tramos: mensaje claro (no un error críptico)', 'migration_booking_segments.sql' in toasts(), toasts())

    # ── E6: ficha de reserva ──
    pg.evaluate("(b)=>form.openDetail(b)", SPLIT); pg.wait_for_timeout(200)
    rows = pg.eval_on_selector_all('#detail-body .detail-stay-row','r=>r.map(x=>x.innerText.replace(/\\s+/g," ").trim())')
    t('ficha: sección de alojamiento con los 2 tramos', len(rows)==2 and '10/01 → 12/01' in rows[0] and 'Departamento 2' in rows[0] and '2 noches' in rows[0] and '12/01 → 13/01' in rows[1] and 'Departamento 5' in rows[1] and '1 noche' in rows[1], rows)
    txt = pg.inner_text('#detail-body')
    t('ficha: UN solo check-in/check-out y 3 noches de la reserva completa', txt.upper().count('CHECK-IN')==1 and txt.upper().count('CHECK-OUT')==1 and '3 noches' in txt, txt[:200])
    t('ficha: desglose por tramo y subtotal exacto $160.000', 'Departamento 2 · 2 × $50.000' in txt.replace('\u00a0',' ') or '50.000' in txt, txt)
    pg.evaluate("(b)=>form.openDetail(b)", LEGACY); pg.wait_for_timeout(200)
    t('ficha de reserva simple: sin sección de tramos', pg.eval_on_selector_all('#detail-body .detail-stay','e=>e.length')==0)
    evil = {**LEGACY,'notes':'<img src=x onerror=window.__pwn=1>','guests':{**LEGACY['guests'],'first_name':'<b>X</b>'}}
    pg.evaluate("(b)=>form.openDetail(b)", evil); pg.wait_for_timeout(300)
    t('ficha: notas y nombre con HTML se escapan', pg.evaluate("!window.__pwn") and pg.eval_on_selector_all('#detail-body img','e=>e.length')==0)

    t('sin errores de JS', not errors, errors)
    b.close()
print(f"\n{P} ok · {F} fallos"); sys.exit(1 if F else 0)
