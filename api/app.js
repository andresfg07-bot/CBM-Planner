// Entrega el código de la aplicación (api/_private) solo a usuarios con sesión válida de Supabase.
// Sin sesión, quien explore el sitio solo ve la pantalla de login (index.html) y un cargador mínimo.
// GET /api/app?part=js|html   con   Authorization: Bearer <access_token de Supabase>

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PARTS = {
    js: { file: 'app.js', type: 'application/javascript; charset=utf-8' },
    html: { file: 'app-shell.html', type: 'text/html; charset=utf-8' }
};
const cache = {};

function loadPart(name) {
    if(!cache[name]) {
        const body = fs.readFileSync(path.join(__dirname, '_private', PARTS[name].file));
        cache[name] = { body, type: PARTS[name].type, etag: '"' + crypto.createHash('sha1').update(body).digest('hex') + '"' };
    }
    return cache[name];
}

const SB_URL = () => (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SB_KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Usuario con sesión válida y perfil registrado en el planner (no basta con tener cuenta en Supabase). */
async function hasAccess(token) {
    const headers = { apikey: SB_KEY(), Authorization: `Bearer ${token}` };
    const u = await fetch(`${SB_URL()}/auth/v1/user`, { headers });
    if(!u.ok) return false;
    const user = await u.json();
    const p = await fetch(`${SB_URL()}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id`, {
        headers: { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}` }
    });
    if(!p.ok) return false;
    return (await p.json()).length > 0;
}

module.exports = async function handler(req, res) {
    try {
        if(req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
        const part = String(req.query?.part || '');
        if(!PARTS[part]) return res.status(400).json({ error: 'part debe ser js o html' });
        if(!SB_URL() || !SB_KEY()) return res.status(500).json({ error: 'Falta SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY' });

        const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
        if(!token || !(await hasAccess(token))) return res.status(401).json({ error: 'Sesión no válida' });

        const { body, type, etag } = loadPart(part);
        res.setHeader('Content-Type', type);
        res.setHeader('Cache-Control', 'private, no-cache');   // el navegador revalida (304) pero la sesión se comprueba siempre
        res.setHeader('ETag', etag);
        res.setHeader('X-Robots-Tag', 'noindex');
        if(req.headers['if-none-match'] === etag) return res.status(304).end();
        return res.status(200).send(body);
    } catch(e) {
        console.error('app:', e);
        return res.status(500).json({ error: e.message });
    }
};
