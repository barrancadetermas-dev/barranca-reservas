// ══════════════════════════════════════════════════════════════
// gender.js — Género del huésped y textos dinámicos ("alojado/a/e")
//
// ÚNICA fuente de verdad: ningún otro archivo debe escribir
// "alojado"/"alojada" a mano. Valores guardados en guests.gender:
//   'male' | 'female' | 'nonbinary' | null (sin especificar)
// ══════════════════════════════════════════════════════════════

export const GENDERS = [
  { value: 'male',      label: 'Masculino'  },
  { value: 'female',    label: 'Femenino'   },
  { value: 'nonbinary', label: 'No binario' },
];

const VOWEL = { male: 'o', female: 'a', nonbinary: 'e' };

/** Devuelve 'male' | 'female' | 'nonbinary' o null si no es un valor válido. */
export function normalizeGender(g) {
  return typeof g === 'string' && Object.hasOwn(VOWEL, g) ? g : null;
}

/**
 * Concordancia de una palabra terminada en -o/-a/-e.
 * @param {string} stem  raíz sin la vocal final ('alojad')
 */
function agree(stem, gender, plural) {
  return stem + VOWEL[gender] + (plural ? 's' : '');
}

/**
 * Forma correcta de "alojado".
 * @param {string|null} gender  'male' | 'female' | 'nonbinary' | null
 * @param {object} [o]
 * @param {number}  [o.count=1]       1 → singular; cualquier otro número → plural
 * @param {boolean} [o.withCount]     antepone el número: "2 alojadas"
 * @param {'capital'|'lower'|'upper'} [o.style='capital']  Alojada / alojada / ALOJADA
 * @param {string}  [o.fallback='male']  género a usar si no está definido
 *   (reservas viejas). Cada pantalla pasa el que usaba antes → no cambia nada.
 * @example alojado('female')                       // 'Alojada'
 * @example alojado('nonbinary', { count: 2 })      // 'Alojades'
 * @example alojado('male', { count: 1, withCount: true, style: 'lower' }) // '1 alojado'
 */
export function alojado(gender, { count = 1, withCount = false, style = 'capital', fallback = 'male' } = {}) {
  const g = normalizeGender(gender) ?? normalizeGender(fallback) ?? 'male';
  let word = agree('alojad', g, count !== 1);
  if (style === 'upper')   word = word.toUpperCase();
  else if (style === 'capital') word = word[0].toUpperCase() + word.slice(1);
  return withCount ? `${count} ${style === 'upper' ? word : word.toLowerCase()}` : word;
}

/**
 * Género a usar para referirse a un GRUPO de huéspedes:
 *  - todos el mismo género definido → ese
 *  - géneros definidos pero distintos → 'male' (plural genérico del español)
 *  - alguno sin especificar (reservas viejas) o lista vacía → null, y alojado()
 *    aplica su `fallback` (cada pantalla conserva el texto que ya tenía)
 */
export function groupGender(genders = []) {
  const list = genders.map(normalizeGender);
  if (!list.length || list.some(g => g === null)) return null;
  return list.every(g => g === list[0]) ? list[0] : 'male';
}
