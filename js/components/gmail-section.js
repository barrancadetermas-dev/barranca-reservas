// gmail-section.js — Bandeja Gmail en MILA PMS (solo lectura)
import { showToast } from '../supabase-config.js';

let _initialized = false;
let _currentTab = 'inbox';

export function initGmailSection() {
  if (_initialized) return;
  _initialized = true;
  document.getElementById('gmail-tab-inbox')?.addEventListener('click', () => { _currentTab='inbox'; setTab('inbox'); loadThreads(); });
  document.getElementById('gmail-tab-sent')?.addEventListener('click',  () => { _currentTab='sent';  setTab('sent');  loadThreads(); });
  document.getElementById('gmail-refresh-btn')?.addEventListener('click', () => loadThreads());
  document.getElementById('gmail-back-btn')?.addEventListener('click', () => {
    document.getElementById('gmail-detail')?.classList.add('hidden');
    document.getElementById('gmail-list').style.display = '';
  });
}

function setTab(tab) {
  document.getElementById('gmail-tab-inbox')?.classList.toggle('btn-primary', tab === 'inbox');
  document.getElementById('gmail-tab-inbox')?.classList.toggle('btn-outline', tab !== 'inbox');
  document.getElementById('gmail-tab-sent')?.classList.toggle('btn-primary', tab === 'sent');
  document.getElementById('gmail-tab-sent')?.classList.toggle('btn-outline', tab !== 'sent');
}

export async function loadThreads() {
  const listEl = document.getElementById('gmail-list');
  if (!listEl) return;
  listEl.innerHTML = '<p class="empty-state-sm" style="padding:40px;text-align:center">⏳ Cargando...</p>';
  document.getElementById('gmail-detail')?.classList.add('hidden');
  listEl.style.display = '';

  try {
    const token = window.__gmailToken ?? localStorage.getItem('mila_gmail_token');
    if (!token) { showNoAuth(listEl); return; }

    const query = _currentTab === 'sent' ? 'in:sent' : 'in:inbox';
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads?q=${encodeURIComponent(query)}&maxResults=20`,
      { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) { showNoAuth(listEl); return; }
    const data = await res.json();
    const threads = data.threads ?? [];
    if (!threads.length) { listEl.innerHTML = '<p class="empty-state-sm" style="padding:40px;text-align:center">Sin correos.</p>'; return; }

    const details = await Promise.all(threads.map(t =>
      fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${t.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${token}` } }).then(r => r.ok ? r.json() : null)
    ));

    listEl.innerHTML = details.filter(Boolean).map(thread => {
      const msg = thread.messages?.[0];
      const get = n => msg?.payload?.headers?.find(h => h.name === n)?.value ?? '—';
      const unread = thread.messages?.some(m => m.labelIds?.includes('UNREAD'));
      const from = get('From').replace(/<.*>/, '').trim();
      const date = fmtDate(get('Date'));
      return `<div class="gmail-item ${unread ? 'gmail-unread' : ''}" data-id="${thread.id}" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;cursor:pointer;border:0.5px solid var(--color-border);background:var(--color-surface-2);margin-bottom:4px">
        <div style="width:32px;height:32px;border-radius:50%;background:var(--color-primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0">${from.charAt(0).toUpperCase()}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;justify-content:space-between;gap:8px">
            <span style="font-size:.8rem;font-weight:${unread?'700':'500'};color:var(--color-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(from)}</span>
            <span style="font-size:.7rem;color:var(--color-text-3);flex-shrink:0">${date}</span>
          </div>
          <div style="font-size:.75rem;color:var(--color-text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(get('Subject'))}</div>
        </div>
        ${unread ? '<span style="width:7px;height:7px;border-radius:50%;background:var(--color-primary);flex-shrink:0"></span>' : ''}
      </div>`;
    }).join('');

    listEl.querySelectorAll('.gmail-item').forEach(el => {
      el.addEventListener('click', () => openThread(el.dataset.id, token));
    });
  } catch (err) {
    listEl.innerHTML = `<p class="empty-state-sm" style="padding:40px;text-align:center;color:var(--color-danger)">Error: ${err.message}</p>`;
  }
}

async function openThread(id, token) {
  document.getElementById('gmail-list').style.display = 'none';
  const det = document.getElementById('gmail-detail');
  const content = document.getElementById('gmail-detail-content');
  det.classList.remove('hidden');
  content.innerHTML = '<p style="color:var(--color-text-3)">⏳ Cargando...</p>';
  try {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${id}?format=full`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    content.innerHTML = (data.messages ?? []).map(msg => {
      const get = n => msg.payload?.headers?.find(h => h.name === n)?.value ?? '—';
      const body = extractBody(msg.payload);
      return `<div style="margin-bottom:16px;padding-bottom:16px;border-bottom:0.5px solid var(--color-border)">
        <div style="font-size:.85rem;font-weight:600;color:var(--color-text);margin-bottom:4px">${esc(get('Subject'))}</div>
        <div style="font-size:.72rem;color:var(--color-text-3);margin-bottom:10px">De: ${esc(get('From'))} · ${esc(get('Date'))}</div>
        <div style="font-size:.8rem;color:var(--color-text-2);line-height:1.6;max-height:300px;overflow-y:auto;white-space:pre-wrap;word-break:break-word">${body}</div>
      </div>`;
    }).join('');
  } catch (err) { content.innerHTML = `<p style="color:var(--color-danger)">Error: ${err.message}</p>`; }
}

function extractBody(payload) {
  const find = (p, mime) => {
    if (p?.mimeType === mime && p.body?.data) return p.body.data;
    for (const part of p?.parts ?? []) { const r = find(part, mime); if (r) return r; }
    return null;
  };
  const b64 = find(payload, 'text/plain') ?? find(payload, 'text/html') ?? '';
  if (!b64) return '(sin contenido)';
  try { return atob(b64.replace(/-/g,'+').replace(/_/g,'/')).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,2000); }
  catch { return '(no se pudo decodificar)'; }
}

function fmtDate(s) {
  try {
    const d = new Date(s), now = new Date(), diff = now - d;
    if (diff < 86400000) return d.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'});
    if (diff < 7*86400000) return d.toLocaleDateString('es-AR',{weekday:'short'});
    return d.toLocaleDateString('es-AR',{day:'2-digit',month:'short'});
  } catch { return s?.slice(0,10) ?? ''; }
}

function showNoAuth(el) {
  el.innerHTML = `<div style="padding:40px;text-align:center;max-width:400px;margin:0 auto">
    <div style="font-size:3rem;margin-bottom:16px">📧</div>
    <div style="font-size:1rem;font-weight:600;color:var(--color-text);margin-bottom:8px">Gmail no conectado</div>
    <p style="font-size:.82rem;color:var(--color-text-2);line-height:1.6;margin-bottom:16px">
      Para ver tus correos de <strong>barrancadetermas@gmail.com</strong> directamente en MILA,
      conectá tu cuenta de Google desde Claude.ai.
    </p>
    <div style="font-size:.75rem;color:var(--color-text-3);background:var(--color-surface-2);border-radius:8px;padding:10px 14px;text-align:left;line-height:1.8">
      1. Abrí Claude.ai en el navegador<br>
      2. Menú → Conectores → Gmail<br>
      3. Hacé clic en "Conectar"<br>
      4. Volvé acá y recargá la página
    </div>
  </div>`;
}

function esc(s) { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
