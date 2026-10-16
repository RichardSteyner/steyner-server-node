'use strict';

// Genera un par de claves EC P-256 (ES256) para firmar los access tokens.
// Uso:  node scripts/generate-oauth-key.js
//
// - OAUTH_PRIVATE_KEY  -> SECRETA. Solo va en las variables de entorno del BACKEND.
// - OAUTH_JWKS_JSON    -> pública. Va en las variables de entorno del MCP.
//
// No pegues la clave privada en chats, tickets, capturas ni repositorios.

const crypto = require('crypto');

const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const jwk = publicKey.export({ format: 'jwk' });

// Mismo cálculo de kid que oauth/config.js (huella RFC 7638).
const kid = crypto
    .createHash('sha256')
    .update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }))
    .digest('base64url');

console.log('# ===== BACKEND (secreto) =====');
console.log('OAUTH_PRIVATE_KEY=' + pem.trim().replace(/\n/g, '\\n'));
console.log('');
console.log('# ===== MCP (público) =====');
console.log('OAUTH_JWKS_JSON=' + JSON.stringify({ keys: [{ ...jwk, kid, use: 'sig', alg: 'ES256' }] }));
