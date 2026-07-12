// ══════════════════════════════════════════════════════
// gmail-section.js — Bandeja Gmail dentro de MILA PMS
// Usa la API de Gmail (fetch directo a la API REST)
// via el token OAuth ya autorizado en el conector.
// ══════════════════════════════════════════════════════

import { showToast } from '../supabase-config.js';

let _currentTab     = 'inbox';
let _threads        = [];
let _initialized    = false;

// ── Inicializar ────────────────────────────────────────
export function initGmailSection() {
  if (_initialized) return;
  _initialized = true;

  document.getElementById('gmail-tab-inbox')?.addEventListener('click', () => {
    _currentTab = 'inbox';
    setActiveTab('inbox');
    loadThreads();
  });
  document.getElementById('gmail-tab-sent')?.addEventListener('click', () => {
    _currentTab = 'sent';
    setActiveTab('sent');
    loadThreads();
  });
  document.getElementById('gmail-refresh-btn')?.addEventListener('click', () => loadThreads());
  document.getElementById('gmail-back-btn')?.addEventListener('click', () => {
    document.getElementById('gmail-detail').classList.add('hidden');
    document.getElementById('gmail-list').style.display = '';
  });
}

function setActiveTab(tab) {
  document.getElementById('gmail-tab-inbox')?.classList.toggle('btn-primary', tab === 'inbox');
  document.getElementById('gmail-tab-inbox')?.classList.toggle('btn-outline', tab !== 'inbox');
  document.getElementById('gmail-tab-sent')?.classList.toggle('btn-primary', tab === 'sent');
  document.getElementById('gmail-tab-sent')?.classList.toggle('btn-outline', tab !== 'sent');
}

// ── Cargar threads via Gmail API ──────────────────────
export async function loadThreads() {
  const listEl = document.getElementById('gmail-list');
  if (!listEl) return;
  listEl.innerHTML = '<p class="empty-state-sm" style="padding:40px;text-align:center">⏳ Cargando correos...</p>';
  document.getElementById('gmail-detail')?.classList.add('hidden');
  listEl.style.display = '';

  try {
    const query  = _currentTab === 'sent' ? 'in:sent' : 'in:inbox';
    const url    = `https://gmail.googleapis.com/gmail/v1/users/me/threads?q=${encodeURIComponent(query)}&maxResults=20`;
    const token  = await getGmailToken();
    if (!token) { showNoAuth(listEl); return; }

    const res    = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) { showNoAuth(listEl); return; }
    if (!res.ok)            { throw new Error(`HTTP ${res.status}`); }

    const data   = await res.json();
    const threads = data.threads ?? [];

    if (!threads.length) {
      listEl.innerHTML = '<p class="empty-state-sm" style="padding:40px;text-align:center">Sin correos en esta bandeja.</p>';
      return;
    }

    // Cargar metadata de cada thread (en paralelo, máx 20)
    const details = await Promise.all(
      threads.map(t =>
        fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${t.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date&metadataHeaders=To`,
          { headers: { Authorization: `Bearer ${token}` } }
        ).then(r => r.ok ? r.json() : null)
      )
    );

    _threads = details.filter(Boolean);
    renderList(listEl, token);

  } catch (err) {
    listEl.innerHTML = `<p class="empty-state-sm" style="padding:40px;text-align:center;color:var(--color-danger)">Error al cargar Gmail: ${err.message}</p>`;
    console.error('[Gmail]', err);
  }
}

// ── Render lista de threads ────────────────────────────
function renderList(listEl, token) {
  listEl.innerHTML = _threads.map(thread => {
    const msg     = thread.messages?.[0];
    const headers = msg?.payload?.headers ?? [];
    const get     = name => headers.find(h => h.name === name)?.value ?? '—';
    const subject = get('Subject');
    const from    = get('From').replace(/<.*>/, '').trim();
    const date    = formatDate(get('Date'));
    const unread  = thread.messages?.some(m => m.labelIds?.includes('UNREAD'));

    return `
      <div class="gmail-thread-item ${unread ? 'gmail-unread' : ''}"
           data-thread-id="${thread.id}"
           style="display:flex;align-items:center;gap:12px;padding:10px 14px;
             border-radius:8px;cursor:pointer;border:0.5px solid var(--color-border);
             background:var(--color-surface-2);transition:background .12s">
        <div style="width:36px;height:36px;border-radius:50%;background:var(--color-primary);
          color:#fff;display:flex;align-items:center;justify-content:center;
          font-size:13px;font-weight:700;flex-shrink:0">
          ${from.charAt(0).toUpperCase()}
        </div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
            <span style="font-size:.82rem;font-weight:${unread ? '700' : '500'};color:var(--color-text);
              overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(from)}</span>
            <span style="font-size:.7rem;color:var(--color-text-3);flex-shrink:0">${date}</span>
          </div>
          <div style="font-size:.78rem;color:var(--color-text-2);overflow:hidden;
            text-overflow:ellipsis;white-space:nowrap;font-weight:${unread ? '600' : '400'}">
            ${esc(subject)}
          </div>
        </div>
        ${unread ? '<span style="width:8px;height:8px;border-radius:50%;background:var(--color-primary);flex-shrink:0"></span>' : ''}
      </div>`;
  }).join('');

  // Click para ver email completo
  listEl.querySelectorAll('.gmail-thread-item').forEach(el => {
    el.addEventListener('mouseenter', () => el.style.background = 'var(--color-surface-3)');
    el.addEventListener('mouseleave', () => el.style.background = 'var(--color-surface-2)');
    el.addEventListener('click', () => openThread(el.dataset.threadId, token));
  });
}

// ── Ver thread completo ────────────────────────────────
async function openThread(threadId, token) {
  const detailEl = document.getElementById('gmail-detail');
  const contentEl = document.getElementById('gmail-detail-content');
  const listEl   = document.getElementById('gmail-list');

  detailEl.classList.remove('hidden');
  listEl.style.display = 'none';
  contentEl.innerHTML  = '<p style="padding:20px;color:var(--color-text-3)">⏳ Cargando...</p>';

  try {
    const res  = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    const msgs = data.messages ?? [];

    contentEl.innerHTML = msgs.map(msg => {
      const headers = msg.payload?.headers ?? [];
      const get     = name => headers.find(h => h.name === name)?.value ?? '—';
      const body    = extractBody(msg.payload);
      return `
        <div style="margin-bottom:20px;padding-bottom:20px;border-bottom:0.5px solid var(--color-border)">
          <div style="margin-bottom:8px">
            <div style="font-size:.82rem;font-weight:700;color:var(--color-text)">${esc(get('Subject'))}</div>
            <div style="font-size:.75rem;color:var(--color-text-3);margin-top:3px">
              De: ${esc(get('From'))} → Para: ${esc(get('To'))}
            </div>
            <div style="font-size:.72rem;color:var(--color-text-3)">${esc(get('Date'))}</div>
          </div>
          <div style="font-size:.8rem;color:var(--color-text-2);line-height:1.6;
            max-height:400px;overflow-y:auto;white-space:pre-wrap;word-break:break-word">
            ${body}
          </div>
        </div>`;
    }).join('');

  } catch (err) {
    contentEl.innerHTML = `<p style="color:var(--color-danger)">Error: ${err.message}</p>`;
  }
}

// ── Helpers ────────────────────────────────────────────
function extractBody(payload) {
  if (!payload) return '';
  // Buscar text/plain primero
  const findPart = (p, mime) => {
    if (p.mimeType === mime && p.body?.data) return p.body.data;
    for (const part of p.parts ?? []) {
      const found = findPart(part, mime);
      if (found) return found;
    }
    return null;
  };
  const b64 = findPart(payload, 'text/plain') ?? findPart(payload, 'text/html') ?? '';
  if (!b64) return '(sin contenido)';
  try {
    const decoded = atob(b64.replace(/-/g,'+').replace(/_/g,'/'));
    // Strip HTML tags para text/html
    return decoded.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000);
  } catch { return '(no se pudo decodificar)'; }
}

function formatDate(dateStr) {
  if (!dateStr || dateStr === '—') return '';
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now - d;
    if (diff < 86400000) return d.toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' });
    if (diff < 7*86400000) return d.toLocaleDateString('es-AR', { weekday:'short' });
    return d.toLocaleDateString('es-AR', { day:'2-digit', month:'short' });
  } catch { return dateStr.slice(0, 10); }
}

function showNoAuth(listEl) {
  listEl.innerHTML = `
    <div style="padding:40px;text-align:center">
      <div style="font-size:2rem;margin-bottom:12px">📧</div>
      <p style="font-size:.9rem;color:var(--color-text-2);margin-bottom:16px">
        Para ver Gmail necesitás conectar tu cuenta de Google en Claude.ai
      </p>
      <p style="font-size:.78rem;color:var(--color-text-3)">
        Menú → Conectores → Gmail → Conectar
      </p>
    </div>`;
}

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Token OAuth ────────────────────────────────────────
// El token llega del conector de Gmail ya configurado en Claude.
// En producción, el usuario tiene que haber autorizado la app.
async function getGmailToken() {
  // Intentar obtener el token desde el contexto del conector MCP
  // Si no está disponible, retorna null y mostramos el mensaje de auth.
  try {
    // El conector de Gmail de Claude.ai inyecta el token en window.__gmailToken
    // cuando el usuario lo tiene conectado.
    if (window.__gmailToken) return window.__gmailToken;

    // Fallback: intentar via localStorage si lo guardó previamente
    const stored = localStorage.getItem('mila_gmail_token');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.expires > Date.now()) return parsed.token;
    }
    return null;
  } catch { return null; }
}
