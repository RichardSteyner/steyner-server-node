'use strict';

const crypto = require('crypto');
const bcryptjs = require('bcryptjs');
const cfg = require('./config');

// ---------------------------------------------------------------------------
// Básicos
// ---------------------------------------------------------------------------

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

// Aleatorio criptográficamente seguro (nunca Math.random).
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

// Devuelve el valor solo si es un string (no array/objeto) y su longitud es razonable.
// Evita "parameter pollution" (?a=1&a=2) y entradas gigantes.
const str = (value, max) =>
    typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined;

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ESC_MAP[c]);

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function safeEqual(a, b) {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// PKCE S256: base64url(sha256(verifier)) === challenge
function pkceMatches(verifier, challenge) {
    const computed = crypto.createHash('sha256').update(verifier).digest('base64url');
    return safeEqual(computed, challenge);
}

// Hash falso para igualar el tiempo de respuesta cuando el correo no existe (evita enumerar usuarios).
const DUMMY_HASH = bcryptjs.hashSync('contraseña-inexistente-para-igualar-tiempos', 10);

// ---------------------------------------------------------------------------
// Redirect URIs
// ---------------------------------------------------------------------------

// https: solo URIs EXACTAS de esta lista (Claude, ChatGPT y las que añadas por variable de entorno).
// Nota: la URL de ChatGPT sale de documentación de terceros; ChatGPT muestra la URL exacta al crear
// el conector. Si difiere, añádela en OAUTH_ALLOWED_REDIRECT_URIS.
const BUILTIN_HTTPS_REDIRECTS = [
    'https://claude.ai/api/mcp/auth_callback',
    'https://claude.com/api/mcp/auth_callback',
    'https://chatgpt.com/connector_platform_oauth_redirect'
];
const allowedHttps = new Set([...BUILTIN_HTTPS_REDIRECTS, ...cfg.extraRedirectUris]);

// http: solo loopback (clientes nativos como Claude Code, mcp-remote, Inspector), RFC 8252.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function parseUrl(value) {
    try {
        return new URL(value);
    } catch {
        return null;
    }
}

const isLoopback = (u) => u.protocol === 'http:' && LOOPBACK_HOSTS.has(u.hostname);

// ¿Se puede REGISTRAR esta URI?
function isAllowedRedirectUri(uri) {
    if (typeof uri !== 'string' || uri.length > 2000 || uri.includes('#')) return false;
    const u = parseUrl(uri);
    if (!u || u.username || u.password) return false;
    if (u.protocol === 'https:') return allowedHttps.has(uri);
    return isLoopback(u);
}

// ¿La URI pedida coincide con alguna registrada? Comparación EXACTA, salvo el puerto en loopback.
function redirectUriMatches(registered, requested) {
    if (typeof requested !== 'string' || requested.includes('#')) return false;
    const r = parseUrl(requested);
    if (!r || r.username || r.password) return false;
    return registered.some((reg) => {
        if (reg === requested) return true;
        const g = parseUrl(reg);
        return (
            g &&
            isLoopback(g) &&
            isLoopback(r) &&
            g.hostname === r.hostname &&
            g.pathname === r.pathname &&
            g.search === r.search
        );
    });
}

// ---------------------------------------------------------------------------
// Respuestas
// ---------------------------------------------------------------------------

function jsonError(res, status, error, description) {
    res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
    return res.status(status).json({ error, ...(description ? { error_description: description } : {}) });
}

function redirectTo(res, redirectUri, params) {
    const url = new URL(redirectUri);
    // "iss" en la respuesta (RFC 9207): evita ataques de confusión de servidor de autorización.
    for (const [k, v] of Object.entries({ ...params, iss: cfg.issuer })) {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    return res.redirect(303, url.toString());
}

const redirectError = (res, redirectUri, error, description, state) =>
    redirectTo(res, redirectUri, { error, error_description: description, state });

// Cabeceras de las páginas HTML (login/consentimiento).
// Nota: NO se define "form-action" a propósito: Chrome lo aplica también a las redirecciones
// posteriores al envío del formulario y rompería el retorno al cliente (claude.ai, localhost...).
function htmlHeaders(res) {
    res.set({
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
        'Content-Security-Policy':
            "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
        'X-Frame-Options': 'DENY', // anti-clickjacking
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer'
    });
}

const LAYOUT_CSS = `
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f5f7;margin:0;padding:24px;color:#1b1f23}
main{max-width:420px;margin:40px auto;background:#fff;padding:28px;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,.08)}
h1{font-size:1.25rem;margin:0 0 12px}
label{display:block;margin:14px 0 4px;font-size:.9rem}
input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #c6cbd1;border-radius:6px;font-size:1rem}
button{margin-top:18px;padding:10px 18px;border:0;border-radius:6px;background:#0969da;color:#fff;font-size:1rem;cursor:pointer}
button.secondary{background:#e6e8eb;color:#1b1f23;margin-left:8px}
.err{background:#ffebe9;color:#a40e26;padding:10px;border-radius:6px}
.muted{color:#57606a;font-size:.85rem}`;

function layout(title, body) {
    return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>${LAYOUT_CSS}</style></head><body><main>${body}</main></body></html>`;
}

function page(res, status, title, bodyHtml) {
    htmlHeaders(res);
    return res.status(status).type('html').send(layout(title, bodyHtml));
}

// Página de login + consentimiento. TODO valor dinámico pasa por esc().
function loginPage(res, { status = 200, txn, client, redirectUri, error }) {
    const target = parseUrl(redirectUri);
    const where = target ? (isLoopback(target) ? 'tu propio equipo (localhost)' : target.host) : 'desconocido';
    const body = `
<h1>Autorizar acceso al MCP de logs</h1>
<p>La aplicación <strong>${esc(client.clientName)}</strong> quiere conectarse a tu servidor MCP.</p>
<p class="muted">El nombre lo declara la propia aplicación y no está verificado.
Al terminar volverás a: <strong>${esc(where)}</strong></p>
${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
<form method="POST" action="/oauth/authorize" autocomplete="on">
  <input type="hidden" name="txn" value="${esc(txn)}">
  <label for="correo">Correo</label>
  <input id="correo" type="email" name="correo" required maxlength="254" autocomplete="username">
  <label for="password">Contraseña</label>
  <input id="password" type="password" name="password" required maxlength="200" autocomplete="current-password">
  <button type="submit" name="decision" value="allow">Autorizar</button>
  <button type="submit" name="decision" value="deny" class="secondary" formnovalidate>Cancelar</button>
</form>`;
    return page(res, status, 'Autorizar acceso', body);
}

// ---------------------------------------------------------------------------
// Bloqueo por intentos fallidos (por correo). En memoria: se reinicia al reiniciar el servicio.
// Se aplica igual a correos que existen y que no existen, para no revelar cuáles son válidos.
// ---------------------------------------------------------------------------

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const failures = new Map();

const isLocked = (key) => {
    const f = failures.get(key);
    return Boolean(f) && f.lockedUntil > Date.now();
};

function registerFailure(key) {
    const now = Date.now();
    if (failures.size > 10000) failures.clear(); // tope de memoria
    const f = failures.get(key);
    if (!f || f.resetAt < now) {
        failures.set(key, { count: 1, resetAt: now + LOCK_MS, lockedUntil: 0 });
        return;
    }
    f.count += 1;
    if (f.count >= MAX_FAILS) {
        f.lockedUntil = now + LOCK_MS;
        f.resetAt = f.lockedUntil;
    }
}

const clearFailures = (key) => failures.delete(key);

setInterval(() => {
    const now = Date.now();
    for (const [k, f] of failures) {
        if (f.resetAt < now && f.lockedUntil < now) failures.delete(k);
    }
}, 5 * 60 * 1000).unref();

module.exports = {
    sha256,
    randomToken,
    str,
    esc,
    escapeRegExp,
    pkceMatches,
    DUMMY_HASH,
    isAllowedRedirectUri,
    redirectUriMatches,
    jsonError,
    redirectTo,
    redirectError,
    page,
    loginPage,
    isLocked,
    registerFailure,
    clearFailures
};
