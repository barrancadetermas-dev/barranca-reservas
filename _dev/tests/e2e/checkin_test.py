import sys
from playwright.sync_api import sync_playwright
P=F=0
def t(n,c,x=''):
    global P,F
    if c: P+=1; print('✅',n)
    else: F+=1; print('❌',n,str(x)[:300])
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_context().new_page(); errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto('http://localhost:5199/_dev/tests/harness/harness.html'); pg.wait_for_function('window.__ready===true')
    pg.evaluate("""()=>{ window.__events=[]; document.addEventListener('booking:changed',()=>window.__events.push('changed')); }""")
    def run(js, data):
        pg.evaluate("(d)=>{window.__calls.length=0;window.__events.length=0;window.__errors={};window.__data=d;document.getElementById('toast-container').innerHTML=''}", data)
        return pg.evaluate(js)
    CALL = """async()=>{ const m=await import('/js/services/checkin-service.js'); const {AppContext}=await import('/js/supabase-config.js'); AppContext.role='staff';
      const db=window.form.db; return await m.registerCheckIn(db,'b1',{guestName:'Juan Pérez'}); }"""
    toasts = lambda: pg.evaluate("document.getElementById('toast-container').innerText").replace('\n',' ')
    calls  = lambda: pg.evaluate("window.__calls")

    # 1) registro normal
    r = run(CALL, {'bookings:update':[{'id':'b1','checked_in_at':'2026-01-10T15:00:00Z'}]})
    c = calls(); upd=[x for x in c if x['table']=='bookings' and x['op']=='update']
    t('check-in normal: ok y changed', r['ok'] and r['changed'], r)
    t('escribe SOLO checked_in_at (no toca pagos/saldo/estado)', len(upd)==1 and list(upd[0]['args'][0][1].keys())==['checked_in_at'], upd and upd[0]['args'])
    t('es condicional en la base (solo si checked_in_at IS NULL y no cancelada/bloqueo)', any('is("checked_in_at",null)' in f for f in upd[0]['filters']) and any('not("status","in","(cancelled,blocked)")' in f for f in upd[0]['filters']), upd[0]['filters'])
    t('no se crea ninguna reserva ni se tocan pagos', not [x for x in c if x['op'] in ('insert','delete','upsert')] and not [x for x in c if x['table']=='payments'], [x['key'] for x in c])
    t('avisa a las demás pantallas (booking:changed) y confirma', pg.evaluate("window.__events.length")>=1 and 'Check-in registrado' in toasts(), toasts())

    # 2) doble clic simultáneo
    pg.evaluate("(d)=>{window.__calls.length=0;window.__events.length=0;window.__data=d}", {'bookings:update':[{'id':'b1'}]})
    rs = pg.evaluate("""async()=>{ const m=await import('/js/services/checkin-service.js'); const db=window.form.db;
        return await Promise.all([m.registerCheckIn(db,'b1',{}), m.registerCheckIn(db,'b1',{}), m.registerCheckIn(db,'b1',{})]); }""")
    upd=[x for x in calls() if x['table']=='bookings' and x['op']=='update']
    t('3 clics simultáneos → UN solo registro en la base', len(upd)==1 and sum(1 for x in rs if x.get('changed'))==1 and sum(1 for x in rs if x.get('busy'))==2, (len(upd), rs))

    # 3) ya estaba registrado
    r = run(CALL, {'bookings:update':[], 'bookings:select':{'status':'paid','checked_in_at':'2026-01-10T12:00:00Z'}})
    t('ya registrado: ok sin duplicar (already) y lo informa', r['ok'] and r.get('already') and not r.get('changed') and 'ya tenía' in toasts(), (r, toasts()))

    # 4) cancelada
    r = run(CALL, {'bookings:update':[], 'bookings:select':{'status':'cancelled','checked_in_at':None}})
    t('reserva cancelada: no se registra y explica por qué', (not r['ok']) and 'cancelada' in toasts(), (r, toasts()))

    # 5) sin permisos / RLS (0 filas y la reserva no es visible)
    r = run(CALL, {'bookings:update':[], 'bookings:select':None})
    t('bloqueado por permisos: NO muestra éxito falso', (not r['ok']) and '✅' not in toasts() and 'permisos' in toasts(), (r, toasts()))

    # 6) error de la base
    pg.evaluate("(d)=>{window.__calls.length=0;window.__data=d;window.__errors={'bookings:update':{message:'permission denied for table bookings'}};document.getElementById('toast-container').innerHTML=''}", {})
    r = pg.evaluate(CALL)
    t('error de la base: se informa (antes el Dashboard igual decía ✅)', (not r['ok']) and '✅' not in toasts() and 'permission' in toasts().lower(), (r,toasts()))

    # 7) rol sin permiso
    r = run("""async()=>{ const m=await import('/js/services/checkin-service.js'); const {AppContext}=await import('/js/supabase-config.js'); const old=AppContext.role; AppContext.role='viewer'; try{ return await m.registerCheckIn(window.form.db,'b1',{}); } finally { AppContext.role=old; } }""", {'bookings:update':[{'id':'b1'}]})
    upd=[x for x in calls() if x['op']=='update']
    t('rol sin permiso: no escribe nada', (not r['ok']) and not upd, (r, [x['key'] for x in calls()]))

    # 8) stayStatus
    st = pg.evaluate("""async()=>{ const m=await import('/js/services/checkin-service.js'); const T='2026-01-11';
      const b=(o)=>({status:'paid',check_in:'2026-01-10',check_out:'2026-01-13',checked_in_at:null,checked_out_at:null,...o});
      return { up:m.stayStatus(b({check_in:'2026-01-12'}),T), pend:m.stayStatus(b({}),T), pendToday:m.stayStatus(b({check_in:T}),T), inh:m.stayStatus(b({checked_in_at:'x'}),T),
        out:m.stayStatus(b({checked_in_at:'x',checked_out_at:'y'}),T), fin:m.stayStatus(b({check_out:'2026-01-11'}),T), can:m.stayStatus(b({status:'cancelled'}),T), blk:m.stayStatus(b({status:'blocked'}),T),
        partialUnpaidInHouse:m.stayStatus(b({status:'partial',checked_in_at:'x'}),T), pendingPayInHouse:m.stayStatus(b({status:'pending',checked_in_at:'x'}),T) }; }""")
    t('estados de alojamiento', st=={'up':'upcoming','pend':'pending_checkin','pendToday':'pending_checkin','inh':'in_house','out':'checked_out','fin':'finished','can':'cancelled','blk':'blocked','partialUnpaidInHouse':'in_house','pendingPayInHouse':'in_house'}, st)
    t('con saldo pendiente puede estar alojada (estado de pago ≠ alojamiento)', st['partialUnpaidInHouse']=='in_house' and st['pendingPayInHouse']=='in_house')
    t('sin errores de JS', not errs, errs)
    b.close()
print(f"\n{P} ok · {F} fallos"); sys.exit(1 if F else 0)
