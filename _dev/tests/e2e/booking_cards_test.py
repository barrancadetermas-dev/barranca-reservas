"""Tarjetas de reservas (pestaña Abiertas): compactas, alineadas, sin perder información ni acciones.
Requiere vite en :5199 (ver LEEME.md). Guarda capturas en /tmp/cards_<ancho>.png"""
import sys
from playwright.sync_api import sync_playwright
P=F=0
def t(n,c,x=''):
    global P,F
    if c: P+=1; print('✅',n)
    else: F+=1; print('❌',n,str(x)[:500])
U={'D1':{'name':'3AMB Duplex','color':'#ea580c','sort_order':1},'D2':{'name':'2AMB Duplex','color':'#1e3a8a','sort_order':2},'D5':{'name':'2AMB P. Baja','color':'#3b82f6','sort_order':5}}
def bk(id,ci,co,first,last,units,total,paid,status,nights,**kw):
    d={'id':id,'check_in':ci,'check_out':co,'nights':nights,'status':status,'source':'direct','is_blocked':False,'total_amount':total,'total_paid':paid,'balance':total-paid,
       'pax':3,'adults':3,'children':0,'price_per_night':total//max(1,nights),'guests':{'id':'g'+id,'first_name':first,'last_name':last,'gender':'male','tags':[],'nationality':'AR'},
       'booking_units':[{'unit_id':u,'price_per_night':1,'units':U[u]} for u in units],'payments':[],'notes':None}
    d.update(kw); return d
B=[
 bk('b1','2026-10-20','2026-10-27','Gabriel','Ochoa',['D5'],400000,200000,'partial',7,pax=6,adults=4,children=2),             # seña + saldo pendiente
 bk('b2','2026-10-21','2026-10-24','Melany Belén','Tolesano',['D2'],200000,200000,'paid',3),                                  # pago completo
 bk('b3','2026-10-24','2026-10-27','Claudia','Geijo',['D1','D2'],450000,200000,'partial',3,pax=11,adults=6,children=5),      # dos unidades
 bk('b4','2026-11-02','2026-11-05','Irina','Brandeburgo',['D5'],200000,0,'pending',3,free_nights=1),                          # 1 noche sin cargo, sin pagos
 bk('b5','2026-11-10','2026-11-16','Oscar','Vercelli',['D5'],300000,100000,'partial',6,free_nights=2,discount_pct=10,late_checkout=True), # 2 gratis + descuento + late CO
]
TODAY='2026-10-19'
ACTIONS=['edit','voucher','whatsapp','flag','reprogram','delete']
with sync_playwright() as p:
    b=p.chromium.launch()
    for W in (1920,1600,1460,1459,1366,1180,820,700,390):
        pg=b.new_context(viewport={'width':W,'height':900}).new_page(); errs=[]
        pg.on('pageerror',lambda e:errs.append(str(e)))
        pg.clock.install(time=__import__('datetime').datetime.fromisoformat(TODAY+'T12:00:00'))
        pg.goto('http://localhost:5199/_dev/tests/harness/harness-list.html'); pg.wait_for_function('window.__ready===true')
        pg.add_style_tag(content='#login-screen{display:none!important}')
        pg.evaluate("()=>{let e=document.getElementById('bookings-list');while(e&&e!==document.body){e.classList.remove('hidden');if(getComputedStyle(e).display==='none')e.style.display='block';e=e.parentElement}}")
        pg.evaluate("(a)=>{window.list._allBookings=a.b; window.list._render(a.t); document.querySelectorAll('.bl-month-body.bl-hidden').forEach(e=>e.classList.remove('bl-hidden'))}",{'b':B,'t':TODAY}); pg.wait_for_timeout(300)
        rows=pg.evaluate("""()=>[...document.querySelectorAll('#bookings-list .booking-row')].map(r=>{const q=s=>r.querySelector(s);const bx=e=>{if(!e)return null;const b=e.getBoundingClientRect();return {l:Math.round(b.left),r:Math.round(b.right),t:Math.round(b.top),b:Math.round(b.bottom)}};
          return {id:r.dataset.bookingId,h:Math.round(r.getBoundingClientRect().height),main:bx(q('.bl-row-main')),guest:bx(q('.bl-guest-name')),dates:bx(q('.bl-dates')),amount:bx(q('.bl-amount-total')),status:bx(q('.status-badge')),acts:bx(q('.booking-actions-cell')),
            actions:[...r.querySelectorAll('[data-action]')].map(x=>x.dataset.action),text:r.innerText.replace(/\\s+/g,' '),
            overflow:[...r.querySelectorAll('.bl-col-guest,.bl-col-dates,.bl-col-amount,.bl-col-status,.bl-money-sub,.bl-money-main,.bl-stay-meta')].filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.className)}})""")
        pg.locator('#bookings-list').screenshot(path=f'/tmp/cards_{W}.png')
        print(f'\n── ancho {W}px ──', [r['h'] for r in rows])
        if not rows: t(f'{W}: se dibujaron tarjetas',False); continue
        mobile = W<=768
        if not mobile:
            lim=lambda r: (90 if r['id']=='b3' else (72 if W>=1600 else 84)) if W>=1460 else (120 if W>=1100 else 150)   # b3 = 2 unidades (chips apilados)
            t(f'{W}: tarjetas compactas (≥1600px ≤72px, ≥1460px ≤84px, 2 unidades ≤90px; angostas ≤120/150px · antes 101–155px)', all(r['h']<=lim(r) for r in rows), [(r['id'],r['h']) for r in rows])
            if W>=1460:
                same=lambda k,e: len({r[k][e] for r in rows})==1
                t(f'{W}: nombres alineados en la misma columna (x izquierda)', same('guest','l'), [r['guest'] for r in rows])
                t(f'{W}: fechas alineadas en la misma columna (x izquierda)', same('dates','l'), [r['dates']['l'] for r in rows])
                t(f'{W}: importes alineados a la derecha', same('amount','r'), [r['amount']['r'] for r in rows])
                t(f'{W}: estado alineado', same('status','l'), [r['status']['l'] for r in rows])
                t(f'{W}: acciones alineadas a la derecha', same('acts','r'), [r['acts']['r'] for r in rows])
                t(f'{W}: columnas sin superposición (guest < fechas < importe < estado < acciones)', all(r['guest']['r']<=r['dates']['l'] and r['dates']['r']<=r['amount']['l'] and r['amount']['r']<=r['status']['l'] and r['status']['r']<=r['acts']['l'] for r in rows), [(r['guest'],r['dates'],r['amount']) for r in rows][:2])
        t(f'{W}: sin desbordes de texto dentro de las columnas', all(not r['overflow'] for r in rows), [(r['id'],r['overflow']) for r in rows if r['overflow']])
        t(f'{W}: no se sale del ancho disponible', all(r['main']['r']<=W for r in rows), [r['main'] for r in rows])
        for r in rows:
            missing=[a for a in ACTIONS if a not in r['actions']]
            t(f'{W}: {r["id"]} conserva las acciones editar/voucher/mensaje/marcar/reprogramar/eliminar', not missing, (missing, r['actions']))
        txt={r['id']:r['text'] for r in rows}
        t(f'{W}: b1 seña+saldo: total, cobrado, % y pendiente', all(x in txt['b1'] for x in ['$400.000','$200.000 cobrado','50%','pendiente','Cobrar','Ochoa','20/10/2026','27/10/2026','7 noches','4 adultos + 2 menores','SEÑADA']), txt['b1'])
        t(f'{W}: b2 pago completo: ✓ Pagado, sin Cobrar', '✓ Pagado' in txt['b2'] and 'Cobrar' not in txt['b2'] and 'pendiente' not in txt['b2'], txt['b2'])
        t(f'{W}: b3 dos unidades: ambos chips', '3AMB Duplex' in txt['b3'] and '2AMB Duplex' in txt['b3'], txt['b3'])
        t(f'{W}: b4 sin pagos: 0% abonado + promo 2+1', '0% abonado' in txt['b4'] and 'PROMO 2+1' in txt['b4'], txt['b4'])
        t(f'{W}: b5 descuento + promo + late CO visibles', '▼' in txt['b5'] and 'PROMO 4+2' in txt['b5'] and 'Late CO' in txt['b5'], txt['b5'])
        # acciones: cada botón dispara su handler con el id correcto
        calls=pg.evaluate("""()=>{const L=window.list,log=[];
          for(const m of ['_openVoucher','_sendWhatsApp','_deleteBooking','_openFlagModal','_payFull','_reprogramBooking','_openDetail']) L[m]=(id)=>log.push([m,id]);
          const row=document.querySelector('.booking-row[data-booking-id="b1"]');
          for(const a of ['voucher','whatsapp','flag','pay-full','reprogram','delete']){const btn=row.querySelector('[data-action="'+a+'"]'); if(btn) btn.click();}
          row.querySelector('.bl-guest-info').click();
          return log}""")
        exp=[['_openVoucher','b1'],['_sendWhatsApp','b1'],['_openFlagModal','b1'],['_payFull','b1'],['_reprogramBooking','b1'],['_deleteBooking','b1'],['_openDetail','b1']]
        t(f'{W}: los botones siguen llamando a sus funciones con el id de la reserva', calls==exp, calls)
        t(f'{W}: sin errores de JS', not errs, errs)
        pg.close()
    b.close()
print(f'\n{P} ok · {F} fallas'); sys.exit(1 if F else 0)
