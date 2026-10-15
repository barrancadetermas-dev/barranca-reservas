import { JSDOM } from 'jsdom';
const dom = new JSDOM('<div id="s"></div><div id="p"></div>', { url: 'http://localhost' });
globalThis.window = dom.window; globalThis.document = dom.window.document;
const { SplitStayEditor } = await import('/home/claude/mila/js/components/split-stay-editor.js');

let pass = 0, fail = 0;
const t = (name, cond, extra='') => { cond ? pass++ : fail++; console.log(cond ? '✅' : '❌', name, cond ? '' : extra); };
const units = [
  { id:'D2', name:'Depto 2', color:'#f00', sort_order:2, max_guests:4 },
  { id:'D3', name:'Depto 3', color:'#0f0', sort_order:3, max_guests:4 },
  { id:'D5', name:'Depto 5', color:'#00f', sort_order:5, max_guests:6 },
  { id:'D6', name:'Depto 6', color:'#ff0', sort_order:6, max_guests:2 },
];
let busy = [];            // conflictos simulados
let changes = [], toasts = [];
const mk = () => new SplitStayEditor({
  structureEl: document.getElementById('s'), priceEl: document.getElementById('p'),
  getUnits: () => units,
  checkConflicts: async (segs) => busy.filter(b => segs.some(s => s.unit_id === b.unit_id && s.from < b.to && s.to > b.from)),
  onChange: (segs, extra) => changes.push({ segs, extra }),
  toast: (m) => toasts.push(m),
});
const ed = mk();
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 1) Activación: 3 noches → 2 + 1
t('no activa con 1 noche', ed.activate({ checkIn:'2026-01-10', checkOut:'2026-01-11', firstUnitId:'D2' }) === false && !ed.active);
t('activa con 3 noches', ed.activate({ checkIn:'2026-01-10', checkOut:'2026-01-13', firstUnitId:'D2', price:50000 }) === true && ed.active);
let sg = ed.getSegments();
t('2 tramos: D2 10→12 (2n) y 2º depto 12→13 (1n)', sg.length===2 && sg[0].unit_id==='D2' && sg[0].from==='2026-01-10' && sg[0].to==='2026-01-12' && sg[0].nights===2 && sg[1].from==='2026-01-12' && sg[1].to==='2026-01-13' && sg[1].nights===1, JSON.stringify(sg));
t('el 2º depto por defecto no es el mismo', sg[1].unit_id !== 'D2');
t('se dibujan 2 filas de estructura y 2 de precio', document.querySelectorAll('#s .split-row').length===2 && document.querySelectorAll('#p .split-price-row').length===2);
t('los selects de depto deshabilitan el ya usado por otro tramo', [...document.querySelectorAll('#s select')[0].options].find(o=>o.value===sg[1].unit_id).disabled === true);

// 2) Auto-selección de depto libre: D3 ocupado el 12 → debe elegir otro
busy = [{ unit_id:'D3', from:'2026-01-11', to:'2026-01-14', guestName:'Ana' }];
const ed2 = (() => { document.getElementById('s').innerHTML=''; return mk(); })();
ed2.activate({ checkIn:'2026-01-10', checkOut:'2026-01-13', firstUnitId:'D2', price:50000 });
await sleep(400);
t('auto-elige un depto LIBRE para el 2º tramo (salta D3 ocupado)', ed2.getSegments()[1].unit_id === 'D5', JSON.stringify(ed2.getSegments()));
t('sin conflictos tras la auto-selección → válido salvo precio', ed2.validate().ok === true, JSON.stringify(ed2.validate()));
busy = [];

// 3) Cambiar el corte
const sel = document.querySelector('#s .split-bound');
t('hay selector de fecha de cambio (solo en tramos no finales)', !!sel && document.querySelectorAll('#s .split-bound').length === 1);
ed2.rows[0].price = 50000; ed2.rows[1].price = 60000;
sel.value = '2026-01-11'; sel.dispatchEvent(new dom.window.Event('change', { bubbles:true }));
sg = ed2.getSegments();
t('mover el corte al 11 → 1 noche + 2 noches', sg[0].nights===1 && sg[1].nights===2 && sg[1].from==='2026-01-11', JSON.stringify(sg));
// corte inválido
const before = JSON.stringify(ed2.getSegments());
const sel2 = document.querySelector('#s .split-bound');
sel2.value = '2026-01-13'; sel2.dispatchEvent(new dom.window.Event('change', { bubbles:true }));
t('corte inválido (= check-out) se rechaza y avisa', JSON.stringify(ed2.getSegments())===before && toasts.some(m=>/entre el/.test(m)), toasts.join('|'));

// 4) Precio y validación
t('con precios en ambos tramos → válido', ed2.validate().ok === true, JSON.stringify(ed2.validate()));
const subtotal = ed2.getSegments().reduce((s,x)=>s+x.pricePerNight*x.nights,0);
t('subtotal = 50.000×1 + 60.000×2 = 170.000', subtotal === 170000, subtotal);
ed2.rows[1].price = '';
t('falta un precio → inválido con mensaje de precio', ed2.validate().ok===false && /precio/i.test(ed2.validate().errors[0]));
ed2.rows[1].price = 60000;

// 5) Agregar y quitar tramos
document.querySelector('#s [data-act="add"]')?.click();
t('agregar tramo → 3 tramos', ed2.getSegments().length === 3, JSON.stringify(ed2.getSegments()));
t('3 tramos siguen cubriendo toda la estadía sin huecos', (()=>{const g=ed2.getSegments(); return g[0].from==='2026-01-10' && g[2].to==='2026-01-13' && g[0].to===g[1].from && g[1].to===g[2].from && g.every(x=>x.nights>=1);})(), JSON.stringify(ed2.getSegments()));
document.querySelector('#s [data-act="del"]')?.click();
t('quitar un tramo → 2 tramos y sin huecos', (()=>{const g=ed2.getSegments(); return g.length===2 && g[0].from==='2026-01-10' && g[1].to==='2026-01-13' && g[0].to===g[1].from;})(), JSON.stringify(ed2.getSegments()));
t('con 2 tramos no se ofrece quitar', document.querySelectorAll('#s [data-act="del"]').length === 0);

// 6) Cambio de fechas de la reserva
ed2.setWindow('2026-01-10', '2026-01-15');
sg = ed2.getSegments();
t('extender check-out al 15: último tramo se estira, primero igual', sg[1].to==='2026-01-15' && sg[0].from==='2026-01-10', JSON.stringify(sg));
ed2.setWindow('2026-01-12', '2026-01-15');
sg = ed2.getSegments();
t('mover check-in al 12: el corte se acomoda dentro de la ventana', sg[0].from==='2026-01-12' && sg[0].to>'2026-01-12' && sg[0].to<'2026-01-15' && sg[1].to==='2026-01-15', JSON.stringify(sg));
changes = [];
ed2.setWindow('2026-01-12', '2026-01-13');   // 1 noche para 2 tramos
t('si no alcanzan las noches → sale del modo con aviso y devuelve el 1er depto', !ed2.active && changes.some(c => c.extra?.exitedTo) && toasts.some(m=>/ya no alcanzan/.test(m)), JSON.stringify(changes.map(c=>c.extra)));

// 7) Conflicto real → inválido
busy = [{ unit_id:'D5', from:'2026-01-12', to:'2026-01-13', guestName:'Luis' }];
const ed3 = (() => { document.getElementById('s').innerHTML=''; return mk(); })();
ed3.activate({ checkIn:'2026-01-10', checkOut:'2026-01-13', segments:[
  { unit_id:'D2', from:'2026-01-10', to:'2026-01-12', pricePerNight:50000 },
  { unit_id:'D5', from:'2026-01-12', to:'2026-01-13', pricePerNight:60000 } ] });
await sleep(400);
t('depto ocupado en su tramo → inválido y se muestra el aviso', ed3.validate().ok===false && /ocupado/i.test(ed3.validate().errors[0]) && /Ocupado por Luis/.test(document.querySelector('#s .split-avail.busy')?.textContent ?? ''), document.querySelector('#s')?.textContent.slice(0,200));
busy = [{ unit_id:'D5', from:'2026-01-13', to:'2026-01-15', guestName:'Luis' }];  // empieza justo el día del check-out
ed3._timer = null; await ed3._refreshConflicts();
t('recambio exacto (otra reserva entra el día del check-out) → SIN conflicto', ed3.validate().ok===true, JSON.stringify(ed3.validate()));

// 8) Salida manual
const first = ed3.deactivate({ silent:true });
t('deactivate devuelve el depto del 1er tramo y limpia la UI', first==='D2' && !ed3.active && document.getElementById('s').innerHTML==='' && document.getElementById('p').innerHTML==='');

// 9) Seguridad: nombre de depto con HTML
const evil = [{ id:'X1', name:'<img src=x onerror=alert(1)>', color:'red"', sort_order:1 }, { id:'X2', name:'Normal', color:'#000', sort_order:2 }];
const ed4 = new SplitStayEditor({ structureEl: document.getElementById('s'), priceEl: document.getElementById('p'), getUnits: ()=>evil, checkConflicts: async()=>[], onChange(){}, toast(){} });
ed4.activate({ checkIn:'2026-02-01', checkOut:'2026-02-04', firstUnitId:'X1' });
t('nombres con HTML no se inyectan (se escapan)', !document.querySelector('#s img') && !document.querySelector('#p img'));

console.log(`\n${pass} ok · ${fail} fallos`);
process.exit(fail ? 1 : 0);
