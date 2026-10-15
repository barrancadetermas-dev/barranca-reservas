import sys
from playwright.sync_api import sync_playwright
P=F=0
def t(n,c,x=''):
    global P,F
    if c: P+=1; print('✅',n)
    else: F+=1; print('❌',n,str(x)[:300])
BK={'id':'b1','check_in':'2026-02-10','check_out':'2026-02-13','nights':3,'status':'partial','source':'booking','total_amount':150000,'total_paid':50000,'balance':100000,
    'guests':{'first_name':'Juan','last_name':'Pérez'},'booking_units':[{'unit_id':'D2','units':{'name':'Departamento 2','sort_order':2}}],'payments':[]}
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_context(viewport={'width':1100,'height':900}).new_page(); errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto('http://localhost:5199/_dev/tests/harness/harness-list.html'); pg.wait_for_function('window.__ready===true')
    pg.evaluate("(b)=>{ window.list._allBookings=[b]; }", BK)
    def start(fresh, errors=None):
        pg.evaluate("(a)=>{window.__calls.length=0;window.__errors=a.errors||{};window.__data={'bookings:select':a.fresh,'payments:insert':[{id:'p1'}],'bookings:update':[{id:'b1'}]}; document.getElementById('overlay-pay-full')?.remove(); document.getElementById('toast-container').innerHTML='';}",{'fresh':fresh,'errors':errors})
        pg.evaluate("(b)=>{ window.list._allBookings=[b]; window.list.load=async()=>{}; }", BK)
        pg.evaluate("window.list._payFull('b1')"); pg.wait_for_selector('#pf-confirm')
    toast=lambda: pg.evaluate("document.getElementById('toast-container').innerText").replace('\n',' ')
    calls=lambda: pg.evaluate("window.__calls")
    opts=pg.eval_on_selector_all('#pf-method option','o=>o.map(x=>x.value)') if False else None

    start({'balance':100000,'status':'partial'})
    opts=pg.eval_on_selector_all('#pf-method option','o=>o.map(x=>x.value)')
    t('métodos de pago = los que acepta la base (sin "card")', 'card' not in opts and 'credit_card' in opts and 'debit_card' in opts, opts)
    t('la fecha propuesta es la LOCAL (no UTC)', pg.input_value('#pf-date')==pg.evaluate("(()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')})()"))
    # triple clic rápido
    pg.evaluate("(()=>{const b=document.getElementById('pf-confirm'); b.click(); b.click(); b.click();})()"); pg.wait_for_timeout(900)
    ins=[c for c in calls() if c['table']=='payments' and c['op']=='insert']
    t('3 clics seguidos → UN solo pago', len(ins)==1, [c['key'] for c in calls()])
    if ins:
        row=ins[0]['args'][0][1]
        t('pago asociado a la reserva correcta, con el saldo exacto y amount_ars', row['booking_id']=='b1' and row['amount']==100000 and row['amount_ars']==100000 and row['method']=='transfer', row)
    ups=[c for c in calls() if c['table']=='bookings' and c['op']=='update']
    t('no toca check-in ni crea reservas', not [c for c in calls() if c['table']=='bookings' and c['op']=='insert'] and all('checked_in_at' not in c['args'][0][1] for c in ups), [c['args'] for c in ups])
    t('confirma al usuario', 'Pago registrado' in toast(), toast())

    # saldo ya cobrado desde otra pantalla
    start({'balance':0,'status':'paid'})
    pg.click('#pf-confirm'); pg.wait_for_timeout(700)
    t('si ya está saldada en la base → NO inserta otro pago y lo avisa', not [c for c in calls() if c['table']=='payments' and c['op']=='insert'] and 'ya no tiene saldo' in toast(), (toast(), [c['key'] for c in calls()]))

    # saldo cambió (se cobró una seña desde otra pantalla)
    start({'balance':40000,'status':'partial'})
    pg.click('#pf-confirm'); pg.wait_for_timeout(700)
    t('si el saldo cambió → NO cobra el monto viejo y pide reabrir', not [c for c in calls() if c['table']=='payments' and c['op']=='insert'] and 'saldo cambió' in toast(), toast())

    # cancelada
    start({'balance':100000,'status':'cancelled'})
    pg.click('#pf-confirm'); pg.wait_for_timeout(700)
    t('reserva cancelada → no se cobra', not [c for c in calls() if c['table']=='payments' and c['op']=='insert'], toast())

    # error de la base (p.ej. enum): el botón se rehabilita y se informa
    start({'balance':100000,'status':'partial'}, {'payments:insert':{'message':'invalid input value for enum payment_method: "x"'}})
    pg.click('#pf-confirm'); pg.wait_for_timeout(700)
    t('error de la base: se informa y el botón queda disponible para reintentar', 'Error al registrar pago' in toast() and not pg.evaluate("document.getElementById('pf-confirm').disabled"), toast())
    # reserva ya pagada desde el inicio
    pg.evaluate("(b)=>{window.list._allBookings=[{...b,balance:0,status:'paid'}]; document.getElementById('toast-container').innerHTML=''; document.getElementById('overlay-pay-full')?.remove();}", BK)
    pg.evaluate("window.list._payFull('b1')"); pg.wait_for_timeout(200)
    t('reserva pagada: ni siquiera abre el cobro', pg.evaluate("!document.getElementById('overlay-pay-full')") and 'ya está pagada' in toast())
    t('sin errores de JS', not errs, errs)
    b.close()
print(f"\n{P} ok · {F} fallos"); sys.exit(1 if F else 0)
