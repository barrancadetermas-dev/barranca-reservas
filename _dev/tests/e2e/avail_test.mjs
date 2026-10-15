import { findConflicts } from '/home/claude/mila/js/services/availability-service.js';
let pass=0, fail=0; const t=(n,c,x='')=>{c?pass++:fail++;console.log(c?'✅':'❌',n,c?'':x)};

// Base simulada: devuelve filas de booking_units con su reserva
const DB = [
  // Reserva #1234 (10→13): D2 10→12, D5 12→13 (con tramos)
  { unit_id:'D2', segment_check_in:'2026-01-10', segment_check_out:'2026-01-12', bookings:{ id:'b1234', check_in:'2026-01-10', check_out:'2026-01-13', status:'paid', guests:{first_name:'Juan',last_name:'Pérez'} } },
  { unit_id:'D5', segment_check_in:'2026-01-12', segment_check_out:'2026-01-13', bookings:{ id:'b1234', check_in:'2026-01-10', check_out:'2026-01-13', status:'paid', guests:{first_name:'Juan',last_name:'Pérez'} } },
  // Reserva vieja sin tramos: D3 20→25
  { unit_id:'D3', segment_check_in:null, segment_check_out:null, bookings:{ id:'bOld', check_in:'2026-01-20', check_out:'2026-01-25', status:'partial', guests:{first_name:'Ana',last_name:'Gómez'} } },
];
let lastSelect = '';
const mkDb = ({ failSegments=false } = {}) => ({ from: () => {
  const q = { _units:null, _lt:null, _gt:null,
    select(sel){ lastSelect = sel; q._sel = sel; return q; },
    in(_, u){ q._units=u; return q; }, not(){ return q; },
    lt(_, v){ q._lt=v; return q; }, gt(_, v){ q._gt=v; return q; },
    then(res, rej){
      if (failSegments && /segment_check/.test(q._sel)) return Promise.resolve({ data:null, error:{ message:'column booking_units.segment_check_in does not exist' } }).then(res, rej);
      const rows = DB.filter(r => q._units.includes(r.unit_id) && r.bookings.check_in < q._lt && r.bookings.check_out > q._gt)
                     .map(r => failSegments ? { unit_id:r.unit_id, bookings:r.bookings } : r);
      return Promise.resolve({ data: rows, error:null }).then(res, rej);
    } };
  return q;
}});
const db = mkDb();

let c = await findConflicts(db, [{unit_id:'D5', from:'2026-01-10', to:'2026-01-12'}]);
t('D5 libre del 10 al 12 aunque #1234 abarque 10→13 (usa solo su tramo 12→13)', c.length===0, JSON.stringify(c));
c = await findConflicts(db, [{unit_id:'D5', from:'2026-01-11', to:'2026-01-13'}]);
t('D5 del 11 al 13 choca con el tramo de #1234 y dice quién y cuándo', c.length===1 && c[0].guestName==='Juan Pérez' && c[0].from==='2026-01-12' && c[0].to==='2026-01-13', JSON.stringify(c));
c = await findConflicts(db, [{unit_id:'D2', from:'2026-01-12', to:'2026-01-14'}]);
t('D2 libre desde el 12 (recambio con el fin de su tramo)', c.length===0, JSON.stringify(c));
c = await findConflicts(db, [{unit_id:'D3', from:'2026-01-24', to:'2026-01-26'}]);
t('reserva vieja sin tramos: bloquea toda su estadía', c.length===1 && c[0].from==='2026-01-20' && c[0].to==='2026-01-25', JSON.stringify(c));
c = await findConflicts(db, [{unit_id:'D3', from:'2026-01-25', to:'2026-01-27'}]);
t('reserva vieja: entrar el día de su check-out es recambio válido', c.length===0);
c = await findConflicts(db, [{unit_id:'D2', from:'2026-01-10', to:'2026-01-12'}], { excludeBookingId:'b1234' });
t('al EDITAR #1234 no choca consigo misma', c.length===0);
c = await findConflicts(db, [{unit_id:'D2', from:'2026-01-10', to:'2026-01-12'},{unit_id:'D5', from:'2026-01-12', to:'2026-01-13'}]);
t('dos tramos pedidos que replican a #1234 → 2 choques', c.length===2);
c = await findConflicts(db, []);
t('sin tramos → sin consulta ni choques', c.length===0);
c = await findConflicts(mkDb({failSegments:true}), [{unit_id:'D3', from:'2026-01-21', to:'2026-01-22'}]);
t('base SIN columnas de tramo → reintenta y sigue funcionando', c.length===1 && !/segment_check/.test(lastSelect), lastSelect);
console.log(`\n${pass} ok · ${fail} fallos`); process.exit(fail?1:0);
