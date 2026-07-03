/**
 * MILA PMS — components/AvatarPicker.js
 * Selector visual de 8 avatares con guardado en Supabase.
 */

export const AVATARS = [
  { id: 1, emoji: '🧑‍💼', label: 'Gerente'    },
  { id: 2, emoji: '👩‍💻', label: 'Dev'         },
  { id: 3, emoji: '🏨', label: 'Hotel'        },
  { id: 4, emoji: '🌿', label: 'Naturaleza'  },
  { id: 5, emoji: '🎯', label: 'Estratega'   },
  { id: 6, emoji: '🌊', label: 'Viajero'     },
  { id: 7, emoji: '🦁', label: 'Líder'       },
  { id: 8, emoji: '⭐', label: 'VIP'          },
];

/**
 * Renderiza el selector de avatares en un contenedor.
 *
 * @param {HTMLElement} contenedor  - Donde se inyecta el HTML
 * @param {number}      [avatarActual=1]  - ID del avatar actualmente seleccionado
 * @param {Function}    onChange    - Callback invocado con (avatarId: number)
 */
export function renderAvatarPicker(contenedor, avatarActual = 1, onChange) {
  contenedor.innerHTML = `
    <div class="avatar-picker" role="radiogroup" aria-label="Seleccionar avatar">
      <p class="avatar-picker__label">Elegí tu avatar</p>
      <div class="avatar-picker__grid">
        ${AVATARS.map(av => `
          <button
            type="button"
            class="avatar-option${av.id === avatarActual ? ' avatar-option--selected' : ''}"
            data-avatar-id="${av.id}"
            title="${av.label}"
            aria-label="${av.label}"
            aria-pressed="${av.id === avatarActual}"
          >
            <span class="avatar-emoji" aria-hidden="true">${av.emoji}</span>
            <span class="avatar-label">${av.label}</span>
          </button>
        `).join('')}
      </div>
    </div>
  `;

  contenedor.querySelectorAll('.avatar-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.avatarId);

      // Actualizar estados UI
      contenedor.querySelectorAll('.avatar-option').forEach(b => {
        const isSelected = Number(b.dataset.avatarId) === id;
        b.classList.toggle('avatar-option--selected', isSelected);
        b.setAttribute('aria-pressed', isSelected);
      });

      if (typeof onChange === 'function') onChange(id);
    });
  });
}

/**
 * Guarda el avatar y color elegidos en la tabla user_profiles.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {number} avatarId    - 1–8
 * @param {string} avatarColor - Hex color ej: '#4F46E5'
 * @returns {Promise<boolean>} - true si fue exitoso
 */
export async function guardarPerfil(supabase, avatarId, avatarColor) {
  const { data: { user }, error: authErr } = await supabase.auth.getUser();

  if (authErr || !user) {
    console.error('guardarPerfil: Sin sesión activa.', authErr);
    return false;
  }

  const { error } = await supabase
    .from('user_profiles')
    .upsert({
      id:            user.id,
      avatar_id:     avatarId,
      avatar_color:  avatarColor,
    }, { onConflict: 'id' });

  if (error) {
    console.error('guardarPerfil: Error al guardar:', error.message, error);
    return false;
  }

  return true;
}

/**
 * Carga el perfil del usuario actual desde Supabase.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<{avatar_id: number, avatar_color: string} | null>}
 */
export async function cargarPerfil(supabase) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('user_profiles')
    .select('avatar_id, avatar_color')
    .eq('id', user.id)
    .single();

  if (error) {
    // PGRST116 = no encontró fila → perfil nuevo, no es error grave
    if (error.code !== 'PGRST116') console.error('cargarPerfil error:', error);
    return null;
  }

  return data;
}

/**
 * Renderiza el avatar del usuario actual en un elemento img/span.
 * Útil para el header/navbar.
 *
 * @param {HTMLElement} el        - Elemento donde mostrar el avatar
 * @param {number}      avatarId  - 1–8
 * @param {string}      color     - Color de fondo hex
 */
export function renderAvatarDisplay(el, avatarId = 1, color = '#4F46E5') {
  const av = AVATARS.find(a => a.id === avatarId) ?? AVATARS[0];
  el.innerHTML = `<span class="avatar-display__emoji">${av.emoji}</span>`;
  el.style.setProperty('--avatar-bg', color);
  el.title = av.label;
  el.classList.add('avatar-display');
}
