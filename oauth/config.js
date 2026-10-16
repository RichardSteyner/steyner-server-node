'use strict';

const crypto = require('crypto');

// Configuración del authorization server. Falla al arrancar (con mensaje claro) si falta algo,
// pero este archivo solo se carga si OAUTH_ENABLED=true (ver oauth/index.js).

function required(name) {
    const value = process.env[name];
    if (!value || !value.trim()) {
        throw new Error(`[oauth] Falta la variable de entorno ${name}`);
    }
    return value.trim();
}

function intEnv(name, def, min, max) {
    const n = Number(process.env[name] ?? def);
    if (!Number.isInteger(n) || n < min || n > max) {
        throw new Error(`[oauth] ${name} debe ser un entero entre ${min} y ${max}`);
    }
    return n;
}

function parseHttpsUrl(name, value, { allowPath }) {
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new Error(`[oauth] ${name} no es una URL válida`);
    }
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
        throw new Error(`[oauth] ${name} debe usar https (salvo localhost)`);
    }
    if (url.search || url.hash || (!allowPath && url.pathname !== '/')) {
        throw new Error(`[oauth] ${name} tiene un formato no permitido (sin query, sin fragmento${allowPath ? '' : ', sin ruta'})`);
    }
    return url;
}

// Issuer: URL pública del backend, FIJA (nunca se deriva de la petición ni del header Host).
const issuer = required('OAUTH_ISSUER').replace(/\/+$/, '');
parseHttpsUrl('OAUTH_ISSUER', issuer, { allowPath: false });

// Recurso protegido (el endpoint del MCP). Será el "aud" de los tokens.
const resource = required('MCP_RESOURCE_URL');
parseHttpsUrl('MCP_RESOURCE_URL', resource, { allowPath: true });

// Lista blanca de correos que pueden autorizar el MCP (denegar por defecto).
// Importante: la tabla Usuario tiene más usuarios; sin esto, cualquiera con cuenta podría usar el MCP.
const allowedEmails = new Set(
    required('OAUTH_ALLOWED_EMAILS')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
);
if (allowedEmails.size === 0) {
    throw new Error('[oauth] OAUTH_ALLOWED_EMAILS no contiene ningún correo');
}

// Redirect URIs https adicionales permitidas (por ejemplo la URL de callback que muestra ChatGPT).
const extraRedirectUris = (process.env.OAUTH_ALLOWED_REDIRECT_URIS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
for (const uri of extraRedirectUris) {
    const u = new URL(uri);
    if (u.protocol !== 'https:' || uri.includes('#') || u.username || u.password) {
        throw new Error(`[oauth] OAUTH_ALLOWED_REDIRECT_URIS contiene una URI no válida: ${uri}`);
    }
}

// Clave de firma: EC P-256 (ES256). Se pasa en una sola línea con "\n" escapados.
const privateKeyPem = required('OAUTH_PRIVATE_KEY').replace(/\\n/g, '\n');
const privateKeyObj = crypto.createPrivateKey(privateKeyPem);
if (privateKeyObj.asymmetricKeyType !== 'ec') {
    throw new Error('[oauth] OAUTH_PRIVATE_KEY debe ser una clave EC P-256');
}
const publicJwk = crypto.createPublicKey(privateKeyObj).export({ format: 'jwk' });
if (publicJwk.crv !== 'P-256') {
    throw new Error('[oauth] OAUTH_PRIVATE_KEY debe ser una clave EC P-256 (ES256)');
}

const publicKeyPem = crypto.createPublicKey(privateKeyObj).export({ type: 'spki', format: 'pem' });

// kid = huella de la clave pública (RFC 7638). Debe coincidir con el que genera scripts/generate-oauth-key.js
const kid = crypto
    .createHash('sha256')
    .update(JSON.stringify({ crv: publicJwk.crv, kty: publicJwk.kty, x: publicJwk.x, y: publicJwk.y }))
    .digest('base64url');

// Intercambio de tokens (RFC 8693): el MCP cambia el token OAuth del usuario por uno de vida corta
// emitido PARA EL BACKEND, con la identidad de ese usuario. Solo se habilita si hay secreto configurado.
const exchangeSecret = (process.env.OAUTH_EXCHANGE_CLIENT_SECRET || '').trim();
if (exchangeSecret && exchangeSecret.length < 32) {
    throw new Error('[oauth] OAUTH_EXCHANGE_CLIENT_SECRET debe tener al menos 32 caracteres');
}
const exchange = {
    enabled: Boolean(exchangeSecret),
    clientId: (process.env.OAUTH_EXCHANGE_CLIENT_ID || 'mcp-resource-server').trim(),
    clientSecret: exchangeSecret,
    // "aud" de los tokens intercambiados: identifica a la API del backend (no al MCP).
    audience: (process.env.OAUTH_BACKEND_AUDIENCE || `${issuer}/api`).trim(),
    scope: 'logs',
    ttlSeconds: intEnv('OAUTH_EXCHANGE_TTL_SECONDS', 300, 60, 900) // 5 min por defecto
};

module.exports = {
    issuer,
    resource,
    allowedEmails,
    extraRedirectUris,
    privateKeyPem,
    publicKeyPem,
    kid,
    exchange,
    jwks: { keys: [{ ...publicJwk, kid, use: 'sig', alg: 'ES256' }] },
    accessTtlSeconds: intEnv('OAUTH_ACCESS_TTL_SECONDS', 1800, 300, 3600),       // 30 min por defecto
    refreshTtlSeconds: intEnv('OAUTH_REFRESH_TTL_SECONDS', 2592000, 3600, 7776000) // 30 días por defecto
};
