// api/rio.js — Vercel Serverless Function
// Proxy server-side para la API del INA (Instituto Nacional del Agua).
// Evita el bloqueo CORS que sufren los proxies públicos desde el browser.
//
// Endpoint resultante: https://barranca-reservas.vercel.app/api/rio
// Mismo dominio → sin CORS, sin restricciones.

const INA_WFS =
  'https://alerta.ina.gob.ar/geoserver/wfs' +
  '?service=WFS&version=2.0.0&request=GetFeature' +
  '&typeName=alerta5:ultimas_alturas' +
  '&outputFormat=application/json' +
  '&count=500';

export default async function handler(req, res) {
  // Solo GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const upstream = await fetch(INA_WFS, {
      headers: {
        'User-Agent': 'MILA-PMS/1.0 (barranca-termas)',
        'Accept':     'application/json',
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!upstream.ok) {
      return res.status(502).json({
        error: `INA respondió HTTP ${upstream.status}`,
        source: 'ina-wfs',
      });
    }

    const text = await upstream.text();

    // Verificar que sea JSON (el INA a veces responde XML en errores)
    if (text.trimStart().startsWith('<')) {
      return res.status(502).json({
        error: 'INA devolvió XML en lugar de JSON (posible error del servidor)',
        preview: text.slice(0, 200),
      });
    }

    const data = JSON.parse(text);

    // Cache de 1 hora en Vercel Edge (los datos del INA se actualizan cada hora)
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
    res.setHeader('Content-Type', 'application/json');

    return res.status(200).json(data);
  } catch (err) {
    console.error('[api/rio] error:', err?.message);
    return res.status(502).json({
      error: err?.message ?? 'Error desconocido al consultar INA',
    });
  }
}
