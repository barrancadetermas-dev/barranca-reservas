// gmail-section.js — Bandeja Gmail en MILA PMS
// Usa Google OAuth 2.0 (GAPI) para autenticar y leer emails
// Requiere configurar VITE_GOOGLE_CLIENT_ID en .env de Vercel

import { showToast } from '../supabase-config.js';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? null;
const SCOPES    = 'https://www.googleapis.com/auth/gmail.readonly';

let _initialized = false;
let _currentTab  = 'inbox';
let _token       = null;

// ── Init ─────────────────────────────────────────────
export function initGmailSection() {
  if (_initialized) return;
  _initialized = true;

  document.getElementById('gmail-tab-inbox')?.addEventListener('click', () => { _currentTab='inbox'; setTab('inbox'); if(_token) loadThreads(); });
  document.getElementById('gmail-tab-sent')?.addEventListener('click',  () => { _currentTab='sent';  setTab('sent');  if(_token) loadThreads(); });
  document.getElementById('gmail-refresh-btn')?.addEventListener('click', () => { if(_token) loadThreads(); else startOAuth(); });
  document.getElementById('gmail-back-btn')?.addEventListener('click', showList);
  document.getElementById('gmail-connect-btn')?.addEventListener('click', startOAuth);
}

// ── OAuth ─────────────────────────────────────────────
function startOAuth() {
  if (!CLIENT_ID) {
    showToast('Falta configurar VITE_GOOGLE_CLIENT_ID en Vercel', 'error');
    return;
  }
  // Check if we have a stored token
  const stored = sessionStorage.getItem('mila_gmail_token');
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed.expires > Date.now()) {
        _token = parsed.token;
        loadThreads();
        return;
      }
    } catch {}
  }

  // Open OAuth popup
  const redirectUri = window.location.origin + '/gmail-callback.html';
  const url = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${encodeURIComponent(CLIENT_ID)}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `response_type=token&scope=${encodeURIComponent(SCOPES)}&` +
    `prompt=consent`;
  
  const popup = window.open(url, 'gmail_oauth', 'width=500,height=600,left=300,top=100');
  
  // Listen for token from popup
  const handler = (e) => {
    if (e.origin !== window.location.origin) return;
    if (e.data?.type === 'gmail_token') {
      window.removeEventListener('message', handler);
      _token = e.data.token;
      sessionStorage.setItem('mila_gmail_token', JSON.stringify({
        token: _token, expires: Date.now() + (e.data.expires_in ?? 3600) * 1000
      }));
      popup?.close();
      loadThreads();
    }
  };
  window.addEventListener('message', handler);
}

// ── Load Threads ──────────────────────────────────────
export async function loadThreads() {
  const listEl = document.getElementById('gmail-list');
  if (!listEl) return;

  // Check stored token first
  if (!_token) {
    const stored = sessionStorage.getItem('mila_gmail_token');
    if (stored) {
      try {
        const p = JSON.parse(stored);
        if (p.expires > Date.now()) _token = p.token;
      } catch {}
    }
  }

  if (!_token) { showNoAuth(listEl); return; }

  listEl.innerHTML = renderLoading();
  document.getElementById('gmail-detail')?.classList.add('hidden');
  listEl.style.display = 'flex';
  listEl.style.flexDirection = 'column';

  try {
    const query = _currentTab === 'sent' ? 'in:sent' : 'in:inbox';
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads?q=${encodeURIComponent(query)}&maxResults=25`,
      { headers: { Authorization: `Bearer ${_token}` } }
    );
    if (res.status === 401) { _token = null; sessionStorage.removeItem('mila_gmail_token'); showNoAuth(listEl); return; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data    = await res.json();
    const threads = data.threads ?? [];
    if (!threads.length) {
      listEl.innerHTML = '<p style="padding:40px;text-align:center;color:var(--color-text-3)">Sin correos en esta bandeja.</p>';
      return;
    }

    const details = await Promise.all(
      threads.map(t =>
        fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${t.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
          { headers: { Authorization: `Bearer ${_token}` } }
        ).then(r => r.ok ? r.json() : null).catch(() => null)
      )
    );

    renderThreadList(listEl, details.filter(Boolean));
  } catch (err) {
    listEl.innerHTML = `<div style="padding:40px;text-align:center;color:var(--color-danger)">
      <div style="font-size:1.5rem;margin-bottom:8px">⚠️</div>
      <p>Error al cargar correos: ${esc(err.message)}</p>
      <button onclick="loadThreads()" style="margin-top:12px" class="btn btn-outline btn-sm">Reintentar</button>
    </div>`;
  }
}

// ── Render list ───────────────────────────────────────
function renderThreadList(listEl, threads) {
  listEl.innerHTML = threads.map(thread => {
    const msg    = thread.messages?.[0];
    const get    = n => msg?.payload?.headers?.find(h => h.name === n)?.value ?? '';
    const unread = thread.messages?.some(m => m.labelIds?.includes('UNREAD'));
    const from   = get('From').replace(/<.*>/, '').replace(/"/g,'').trim() || 'Sin remitente';
    const subj   = get('Subject') || '(sin asunto)';
    const date   = fmtDate(get('Date'));
    const initials = from.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();

    return `<div class="gmail-thread-item${unread ? ' gmail-unread' : ''}" data-thread-id="${thread.id}"
      style="display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:8px;cursor:pointer;
        border:0.5px solid var(--color-border);background:var(--color-surface-2);
        transition:background .12s;margin-bottom:4px">
      <div style="width:36px;height:36px;border-radius:50%;background:var(--color-primary);color:#fff;
        display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0">
        ${initials}
      </div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:2px">
          <span style="font-size:.82rem;font-weight:${unread?'700':'500'};color:var(--color-text);
            overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(from)}</span>
          <span style="font-size:.7rem;color:var(--color-text-3);flex-shrink:0">${date}</span>
        </div>
        <div style="font-size:.77rem;color:${unread?'var(--color-text-2)':'var(--color-text-3)'};
          font-weight:${unread?'600':'400'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${esc(subj)}
        </div>
      </div>
      ${unread ? '<span style="width:7px;height:7px;border-radius:50%;background:var(--color-primary);flex-shrink:0"></span>' : ''}
    </div>`;
  }).join('');

  listEl.querySelectorAll('.gmail-thread-item').forEach(el => {
    el.addEventListener('mouseenter', () => { el.style.background = 'var(--color-surface-3,var(--color-border))'; });
    el.addEventListener('mouseleave', () => { el.style.background = 'var(--color-surface-2)'; });
    el.addEventListener('click', () => openThread(el.dataset.threadId));
  });
}

// ── Open full thread ──────────────────────────────────
async function openThread(id) {
  document.getElementById('gmail-list').style.display = 'none';
  const det = document.getElementById('gmail-detail');
  const content = document.getElementById('gmail-detail-content');
  det.classList.remove('hidden');
  content.innerHTML = renderLoading();

  try {
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads/${id}?format=full`,
      { headers: { Authorization: `Bearer ${_token}` } }
    );
    const data = await res.json();
    content.innerHTML = (data.messages ?? []).map((msg, i) => {
      const get  = n => msg.payload?.headers?.find(h => h.name === n)?.value ?? '';
      const body = extractBody(msg.payload);
      const from = get('From').replace(/<.*>/, '').trim();
      return `
        <div style="margin-bottom:16px;padding-bottom:16px;${i < (data.messages.length-1) ? 'border-bottom:0.5px solid var(--color-border)' : ''}">
          <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:3px">
            <span style="font-size:.82rem;font-weight:600;color:var(--color-text)">${esc(from)}</span>
            <span style="font-size:.7rem;color:var(--color-text-3)">${esc(get('Date'))}</span>
          </div>
          <div style="font-size:.75rem;color:var(--color-text-3);margin-bottom:10px">
            Para: ${esc(get('To'))}
          </div>
          <div style="font-size:.8rem;color:var(--color-text-2);line-height:1.7;
            max-height:350px;overflow-y:auto;white-space:pre-wrap;word-break:break-word;
            padding:10px;background:var(--color-surface-2);border-radius:6px">
            ${body}
          </div>
        </div>`;
    }).join('');
  } catch (err) {
    content.innerHTML = `<p style="color:var(--color-danger)">Error: ${esc(err.message)}</p>`;
  }
}

// ── Helpers ───────────────────────────────────────────
function showList() {
  document.getElementById('gmail-list').style.display = 'flex';
  document.getElementById('gmail-detail')?.classList.add('hidden');
}

function setTab(tab) {
  ['inbox','sent'].forEach(t => {
    const btn = document.getElementById(`gmail-tab-${t}`);
    if (!btn) return;
    btn.classList.toggle('btn-primary', t === tab);
    btn.classList.toggle('btn-outline',  t !== tab);
  });
}

function showNoAuth(el) {
  el.innerHTML = `
    <div style="max-width:460px;margin:40px auto;text-align:center;padding:0 20px">
      <div style="font-size:3rem;margin-bottom:16px">📧</div>
      <h3 style="font-size:1rem;font-weight:600;color:var(--color-text);margin-bottom:8px">
        Conectá tu cuenta de Gmail
      </h3>
      <p style="font-size:.82rem;color:var(--color-text-2);line-height:1.6;margin-bottom:20px">
        Para ver los correos de <strong>barrancadetermas@gmail.com</strong> dentro de MILA,
        necesitás autorizar el acceso a Gmail.
      </p>
      ${CLIENT_ID
        ? `<button id="gmail-connect-btn" class="btn btn-primary" style="margin-bottom:16px">
            🔑 Conectar con Google
           </button>`
        : `<div style="background:var(--color-surface-2);border:1px solid var(--color-border);
              border-radius:8px;padding:12px 16px;text-align:left;font-size:.78rem;
              color:var(--color-text-2);line-height:1.8">
            <strong style="color:var(--color-text)">⚙️ Configuración requerida:</strong><br>
            1. Creá un proyecto en <a href="https://console.cloud.google.com" target="_blank" style="color:var(--color-primary)">Google Cloud Console</a><br>
            2. Habilitá la Gmail API<br>
            3. Creá credenciales OAuth 2.0 (Web Application)<br>
            4. Agregá <code style="background:var(--color-surface-3,#334155);padding:1px 5px;border-radius:3px">${window.location.origin}/gmail-callback.html</code> como URI autorizado<br>
            5. En Vercel → Settings → Environment Variables → agregá<br>
            <code style="background:var(--color-surface-3,#334155);padding:2px 8px;border-radius:3px;display:block;margin-top:4px">VITE_GOOGLE_CLIENT_ID = tu_client_id</code>
          </div>`
      }
    </div>`;
  document.getElementById('gmail-connect-btn')?.addEventListener('click', startOAuth);
}

function extractBody(payload) {
  const find = (p, mime) => {
    if (p?.mimeType === mime && p.body?.data) return p.body.data;
    for (const part of p?.parts ?? []) { const r = find(part, mime); if (r) return r; }
    return null;
  };
  const b64 = find(payload, 'text/plain') ?? find(payload, 'text/html') ?? '';
  if (!b64) return '(sin contenido)';
  try {
    const txt = atob(b64.replace(/-/g,'+').replace(/_/g,'/'));
    return esc(txt.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0, 3000));
  } catch { return '(no se pudo decodificar el contenido)'; }
}

function fmtDate(s) {
  if (!s) return '';
  try {
    const d = new Date(s), now = new Date(), diff = now - d;
    if (isNaN(diff)) return s.slice(0,10);
    if (diff < 86400000)   return d.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'});
    if (diff < 7*86400000) return d.toLocaleDateString('es-AR',{weekday:'short', day:'2-digit'});
    return d.toLocaleDateString('es-AR',{day:'2-digit',month:'short'});
  } catch { return s.slice(0,10); }
}

function renderLoading() {
  return `<div style="padding:40px;text-align:center;color:var(--color-text-3)">
    <div style="font-size:1.5rem;margin-bottom:8px;animation:spin 1s linear infinite;display:inline-block">⏳</div>
    <p>Cargando correos...</p>
  </div>`;
}

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
