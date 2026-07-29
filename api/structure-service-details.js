// ======================================================================================
// Vercel Serverless Function: estructura el texto dictado por el analista en la
// planilla fija (Requerimiento 1). Corre en el servidor para no exponer la API key
// de Anthropic en el navegador.
//
// Requiere la variable de entorno ANTHROPIC_API_KEY configurada en Vercel
// (Project Settings → Environment Variables).
// ======================================================================================

const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    const { rawText } = req.body || {};
    if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
        res.status(400).json({ error: 'rawText es requerido' });
        return;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        res.status(500).json({ error: 'ANTHROPIC_API_KEY no está configurada en el servidor' });
        return;
    }

    const today = new Date().toLocaleDateString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit' });

    const systemPrompt = `Eres un asistente que estructura notas de campo dictadas por analistas de mantenimiento predictivo (CBM) en A-MAQ S.A. Recibes texto desordenado (transcrito de voz, con muletillas o sin puntuación clara) y debes reorganizarlo EXACTAMENTE en esta plantilla, sin texto adicional antes ni después:

Fecha de gestión: [valor]
Ingeniero encargado: [valor]
Cantidad de subsistemas: [valor]
Hora de entrada: [valor]
Hora de salida: [valor]
Horas a cobrar en el servicio: [valor]
SCT: [valor]
Observaciones adicionales: [valor]

Reglas estrictas:
- Si un dato no fue mencionado en el texto, escribe exactamente "No especificado" en ese campo. No inventes ni asumas valores que no estén en el texto.
- "Fecha de gestión": si no se menciona una fecha explícita, usa ${today} (fecha de hoy).
- Las horas deben quedar en formato HH:MM (24 horas) cuando sea posible determinarlas a partir del texto.
- "SCT" responde únicamente "Sí" o "No" si se menciona explícitamente; si no se menciona, "No especificado".
- Todo lo dictado que no encaje en los campos anteriores va en "Observaciones adicionales", resumido pero fiel al contenido original, sin inventar información nueva.
- Responde ÚNICAMENTE con la plantilla completada. No agregues encabezados, explicaciones, ni comentarios antes o después.`;

    try {
        const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: ANTHROPIC_MODEL,
                max_tokens: 500,
                system: systemPrompt,
                messages: [{ role: 'user', content: rawText }]
            })
        });

        if (!aiResp.ok) {
            const errText = await aiResp.text();
            res.status(502).json({ error: 'Error del servicio de IA: ' + errText });
            return;
        }

        const aiData = await aiResp.json();
        const structured = (aiData?.content?.[0]?.text || '').trim();

        if (!structured) {
            res.status(502).json({ error: 'Respuesta vacía de la IA' });
            return;
        }

        res.status(200).json({ structured });
    } catch (err) {
        res.status(500).json({ error: 'Error interno: ' + err.message });
    }
};
