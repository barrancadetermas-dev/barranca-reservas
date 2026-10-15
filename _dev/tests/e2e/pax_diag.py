import json
from playwright.sync_api import sync_playwright
BK = {'id':'b4','check_in':'2026-01-10','check_out':'2026-01-13','nights':3,'price_per_night':50000,'discount_pct':0,'surcharge_amount':0,'free_nights':0,
 'total_amount':150000,'total_paid':0,'status':'pending','source':'booking','notes':'x','late_checkout':False,'adults':4,'children':0,'pax':4,'created_at':'2026-01-01T10:00:00Z',
 'guests':{'id':'G9','first_name':'Juan','last_name':'Pérez','dni':'123'},
 'booking_units':[{'unit_id':'D2','price_per_night':50000,'segment_check_in':None,'segment_check_out':None,'units':{'name':'Departamento 2','color':'#ef4444','sort_order':2}}]}
def variant(**kw): d=json.loads(json.dumps(BK)); d.update(kw); return d
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_context(viewport={'width':1100,'height':1000}).new_page()
    pg.goto('http://localhost:5199/_dev/tests/harness/harness.html'); pg.wait_for_function('window.__ready===true')
    def vals(): return pg.evaluate("[document.getElementById('f-adults').value, document.getElementById('f-children').value, document.getElementById('f-pax').value, document.getElementById('pax-total-num').textContent]")
    for label,bk in [('adults=4,pax=4',BK),('adults=NULL,pax=4',variant(adults=None,children=None)),('adults=1 (default DB),pax=4',variant(adults=1,children=0)),('adults=3,children=1,pax=4',variant(adults=3,children=1))]:
        pg.evaluate("(d)=>{window.__calls.length=0;window.__errors={};window.__data=d}", {'bookings:select':bk,'payments:select':[],'booking_units:select':[]})
        pg.evaluate("form.openEdit('b4')"); pg.wait_for_timeout(800)
        a=vals()
        pg.evaluate("form._goToStep(2)"); pg.evaluate("""()=>{const f=form;f._datePicker.setValue('2026-01-11','2026-01-14');document.getElementById('f-checkin').value='2026-01-11';document.getElementById('f-checkout').value='2026-01-14';f._datePicker._onChange('2026-01-11','2026-01-14');}"""); pg.wait_for_timeout(500)
        c=vals()
        pg.evaluate("form._goToStep(3)"); pg.evaluate("form._goToStep(2)"); pg.evaluate("form._goToStep(1)"); pg.evaluate("form._goToStep(2)")
        d=vals()
        pg.evaluate("document.querySelector('#units-selector .unit-option[data-unit-id=\"D3\"]')?.click()"); pg.wait_for_timeout(300)
        e=vals()
        pg.evaluate("(d)=>{window.__calls.length=0;window.__data=Object.assign(d,{'bookings:update':[{id:'b4'}],'guests:update':[{id:'G9'}]})}", {'bookings:select':bk,'payments:select':[],'booking_units:select':[]})
        pg.evaluate("form._submit()"); pg.wait_for_timeout(1500)
        upd=[c for c in pg.evaluate("window.__calls") if c['table']=='bookings' and c['op']=='update']
        sent=[ (u['args'][0][1].get('pax'),u['args'][0][1].get('adults'),u['args'][0][1].get('children')) for u in upd if 'pax' in u['args'][0][1]]
        print(f"{label:34} abrir={a} fechas={c} pasos={d} unidad={e} guardado(pax,adults,children)={sent}")
    b.close()
