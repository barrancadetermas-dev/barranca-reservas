import sys, json
from playwright.sync_api import sync_playwright
P=F=0
def t(n,c,x=''):
    global P,F
    if c: P+=1; print('✅',n)
    else: F+=1; print('❌',n,str(x)[:250])
SPLIT=json.load(open('_dev/tests/e2e/split.json'))
SPLIT['payments']=[{'method':'transfer','payment_date':'2026-01-02','amount':60000}]
SPLIT['total_paid']=60000
SPLIT['total_amount']=160000
SPLIT['price_per_night']=53333.33
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_context().new_page(); errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto('http://localhost:5199/_dev/tests/harness/harness.html'); pg.wait_for_function('window.__ready===true')
    html=pg.evaluate("""async (b)=>{ const m=await import('/js/services/voucher-guest.js'); let out='';
      const orig=window.open; window.open=()=>({document:{open(){},write(h){out=h},close(){}}});
      m.openGuestVoucher(b,{name:'Barranca de Termas'}); window.open=orig; return out; }""",SPLIT)
    t('voucher de la lista: tramos en orden con fechas', html.index('Departamento 2')<html.index('Departamento 5') and '10/01 → 12/01' in html and '12/01 → 13/01' in html)
    t('desglose por tramo y total $160.000', '× $\u00a050.000' in html and '× $\u00a060.000' in html and '$\u00a0160.000' in html)
    t('saldo pendiente $100.000 y código de reserva', '$\u00a0100.000' in html and '#B1234' in html.upper().replace('#B1234','#B1234'))
    simple=json.loads(json.dumps(SPLIT)); simple['booking_units']=[{'unit_id':'D3','price_per_night':40000,'units':{'name':'Departamento 3'}}]
    simple['price_per_night']=40000; simple['total_amount']=120000; simple['total_paid']=0; simple['payments']=[]
    html2=pg.evaluate("""async (b)=>{ const m=await import('/js/services/voucher-guest.js'); let out='';
      const orig=window.open; window.open=()=>({document:{open(){},write(h){out=h},close(){}}});
      m.openGuestVoucher(b,{}); window.open=orig; return out; }""",simple)
    t('reserva simple: sin sección de tramos y con "Precio por noche"', 'class="tramo"' not in html2 and 'Precio por noche' in html2 and 'Departamento 3' in html2)
    t('sin errores de JS', not errs, errs)
    b.close()
print(f"\n{P} ok · {F} fallos"); sys.exit(1 if F else 0)
