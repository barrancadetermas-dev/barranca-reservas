/**
 * MILA PMS — components/ColorPalette.js
 * Selector de paleta: 14 colores en 2 filas (7 fríos + 7 cálidos).
 */

export const COLOR_PALETTE = {
  frios: [
    { id: 'c1', hex: '#7C3AED', nombre: 'Violeta'   },
    { id: 'c2', hex: '#4F46E5', nombre: 'Índigo'    },
    { id: 'c3', hex: '#2563EB', nombre: 'Azul'      },
    { id: 'c4', hex: '#0284C7', nombre: 'Azul Rey'  },
    { id: 'c5', hex: '#0891B2', nombre: 'Cian'      },
    { id: 'c6', hex: '#0D9488', nombre: 'Teal'      },
    { id: 'c7', hex: '#059669', nombre: 'Esmeralda' },
  ],
  calidos: [
    { id: 'w1', hex: '#65A30D', nombre: 'Lima'      },
    { id: 'w2', hex: '#CA8A04', nombre: 'Amarillo'  },
    { id: 'w3', hex: '#D97706', nombre: 'Ámbar'     },
    { id: 'w4', hex: '#EA580C', nombre: 'Naranja'   },
    { id: 'w5', hex: '#DC2626', nombre: 'Rojo'      },
    { id: 'w6', hex: '#BE185D', nombre: 'Rosa'      },
    { id: 'w7', hex: '#9D174D', nombre: 'Granate'   },
  ],
};

export const ALL_COLORS = [...COLOR_PALETTE.frios, ...COLOR_PALETTE.calidos];

/**
 * Busca un color por su hex (case-insensitive).
 * @param {string} hex
 * @returns {{ id, hex, nombre } | undefined}
 */
export function findColorByHex(hex) {
  return ALL_COLORS.find(c => c.hex.toLowerCase() === hex?.toLowerCase());
}

/**
 * Renderiza el selector de paleta en un contenedor.
 *
 * @param {HTMLElement} contenedor
 * @param {string}      [colorActual='#4F46E5']  - Hex seleccionado
 * @param {Function}    onChange                 - Callback con (hex: string)
 */
export function renderColorPalette(contenedor, colorActual = '#4F46E5', onChange) {
  const filas = [
    { label: 'Fríos',   colores: COLOR_PALETTE.frios  },
    { label: 'Cálidos', colores: COLOR_PALETTE.calidos },
  ];

  contenedor.innerHTML = `
    <div class="color-palette" role="radiogroup" aria-label="Paleta de colores">
      ${filas.map(fila => `
        <div class="palette-row">
          <span class="palette-row__label">${fila.label}</span>
          <div class="palette-row__swatches">
            ${fila.colores.map(c => {
              const isSelected = c.hex.toLowerCase() === colorActual?.toLowerCase();
              return `
                <button
                  type="button"
                  class="color-swatch${isSelected ? ' color-swatch--selected' : ''}"
                  data-color="${c.hex}"
                  title="${c.nombre}"
                  aria-label="${c.nombre}"
                  aria-pressed="${isSelected}"
                  style="--swatch-color: ${c.hex}"
                ></button>
              `;
            }).join('')}
          </div>
        </div>
      `).join('')}
      <p class="palette-selected-label">
        Seleccionado: <span id="palette-selected-name">
          ${findColorByHex(colorActual)?.nombre ?? '—'}
        </span>
      </p>
    </div>
  `;

  contenedor.querySelectorAll('.color-swatch').forEach(btn => {
    btn.addEventListener('click', () => {
      const hex = btn.dataset.color;

      // Actualizar UI
      contenedor.querySelectorAll('.color-swatch').forEach(b => {
        const sel = b.dataset.color === hex;
        b.classList.toggle('color-swatch--selected', sel);
        b.setAttribute('aria-pressed', sel);
      });

      // Actualizar label
      const nameEl = contenedor.querySelector('#palette-selected-name');
      if (nameEl) nameEl.textContent = findColorByHex(hex)?.nombre ?? hex;

      if (typeof onChange === 'function') onChange(hex);
    });
  });
}

/**
 * Color por defecto del sistema (Índigo).
 */
export const DEFAULT_COLOR = '#4F46E5';
