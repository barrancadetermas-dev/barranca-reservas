// Ventana "Armado de hoy y mañana": texto listo para mandar por WhatsApp a la encargada (editable, copiar o abrir WhatsApp)
import { buildArmadoText, fetchArrivals } from '../services/armado-service.js';
import { localToday, showToast } from '../supabase-config.js';

export async function openArmadoModal(db, hotelId) {
  document.getElementById('armado-ov')?.remove();
  const ov = document.createElement('div');
  ov.id = 'armado-ov'; ov.className = 'armado-ov';
  ov.innerHTML = `<div class="armado-box" role="dialog" aria-label="Armado de hoy y mañana">
    <div class="armado-hd"><span>📲 Armado de hoy y mañana</span><button type="button" data-x title="Cerrar">✕</button></div>
    <div class="armado-bd">
      <div class="armado-opts">
        <label><input type="checkbox" id="arm-hoy" checked> Hoy</label>
        <label><input type="checkbox" id="arm-man" checked> Mañana</label>
        <label><input type="checkbox" id="arm-saldo" checked> Incluir saldo</label>
      </div>
      <textarea class="armado-ta" id="arm-text" spellcheck="false">Cargando llegadas…</textarea>
      <small style="color:var(--color-text-3)">Podés editar el texto antes de enviarlo. El saldo de cada depto reparte los pagos generales en proporción.</small>
    </div>
    <div class="armado-ft"><button type="button" id="arm-copy">📋 Copiar</button><button type="button" class="wa" id="arm-wa">💬 Abrir WhatsApp</button><button type="button" data-x>Cerrar</button></div></div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('[data-x]')) close(); });
  const onKey = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);

  const ta = ov.querySelector('#arm-text');
  let data = [];
  const render = () => {
    ta.value = buildArmadoText(data, localToday(), {
      hoy: ov.querySelector('#arm-hoy').checked, manana: ov.querySelector('#arm-man').checked, saldo: ov.querySelector('#arm-saldo').checked });
  };
  ['#arm-hoy', '#arm-man', '#arm-saldo'].forEach(id => ov.querySelector(id).addEventListener('change', render));
  ov.querySelector('#arm-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(ta.value); } catch { ta.select(); document.execCommand?.('copy'); }
    showToast('📋 Armado copiado', 'success');
  });
  ov.querySelector('#arm-wa').addEventListener('click', () => window.open('https://wa.me/?text=' + encodeURIComponent(ta.value), '_blank', 'noopener'));
  try { data = await fetchArrivals(db, hotelId, localToday()); render(); }
  catch (err) { ta.value = 'No se pudieron cargar las llegadas: ' + (err?.message ?? err); }
}
