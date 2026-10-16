'use strict';

const jwt = require('jsonwebtoken');
const Usuario = require('../models/usuario');
const cfg = require('./config');
const h = require('./helpers');

// Intercambio de tokens (RFC 8693).
//
// El MCP recibe el access token del usuario (aud = MCP). Para llamar al backend NO lo reenvía
// (eso sería "token passthrough", prohibido por la especificación de MCP): lo cambia aquí por
// otro token distinto que:
//   - está emitido PARA EL BACKEND (aud = cfg.exchange.audience),
//   - lleva la identidad del usuario (sub),
//   - dura pocos minutos y solo vale para el scope "logs",
//   - indica quién actúa en su nombre (claim "act" = el MCP).

const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';
const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token';

// Credenciales del cliente por HTTP Basic (RFC 6749 §2.3.1: id y secreto codificados como formulario).
function parseBasic(header) {
    if (typeof header !== 'string') return null;
    const match = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(header);
    if (!match) return null;
    const decoded = Buffer.from(match[1], 'base64').toString('utf8');
    const i = decoded.indexOf(':');
    if (i < 0) return null;
    try {
        return {
            id: decodeURIComponent(decoded.slice(0, i)),
            secret: decodeURIComponent(decoded.slice(i + 1))
        };
    } catch {
        return null;
    }
}

const scopesOf = (claims) => (typeof claims.scope === 'string' ? claims.scope.split(' ') : []);

async function handleTokenExchange(req, res) {
    const ex = cfg.exchange;
    if (!ex.enabled) {
        return h.jsonError(res, 400, 'unsupported_grant_type', 'El intercambio de tokens no está habilitado');
    }

    // 1) El MCP se autentica como cliente confidencial. Un token de usuario robado, por sí solo,
    //    no sirve para pedir tokens del backend: hace falta además este secreto.
    const creds = parseBasic(req.headers.authorization);
    const idOk = creds ? h.safeEqual(creds.id, ex.clientId) : false;
    const secretOk = creds ? h.safeEqual(creds.secret, ex.clientSecret) : false;
    if (!(idOk && secretOk)) {
        console.warn(`[oauth] intercambio: credenciales de cliente incorrectas ip=${req.ip}`);
        res.set('WWW-Authenticate', 'Basic realm="oauth", charset="UTF-8"');
        return h.jsonError(res, 401, 'invalid_client');
    }

    // 2) Parámetros (todo lo que no coincida exactamente se rechaza).
    const body = req.body || {};
    const subjectToken = h.str(body.subject_token, 4096);
    if (!subjectToken || body.subject_token_type !== ACCESS_TOKEN_TYPE) {
        return h.jsonError(res, 400, 'invalid_request', 'subject_token o subject_token_type inválidos');
    }
    if (body.requested_token_type && body.requested_token_type !== ACCESS_TOKEN_TYPE) {
        return h.jsonError(res, 400, 'invalid_request', 'requested_token_type no soportado');
    }
    if (h.str(body.audience, 2000) !== ex.audience) {
        return h.jsonError(res, 400, 'invalid_target', 'audience no reconocida');
    }
    if ((h.str(body.scope, 100) || ex.scope) !== ex.scope) {
        return h.jsonError(res, 400, 'invalid_scope', `Solo se admite el scope "${ex.scope}"`);
    }

    // 3) El subject_token debe ser un access token NUESTRO, vigente y emitido PARA EL MCP.
    let claims;
    try {
        claims = jwt.verify(subjectToken, cfg.publicKeyPem, {
            algorithms: ['ES256'],
            issuer: cfg.issuer,
            audience: cfg.resource
        });
    } catch {
        return h.jsonError(res, 400, 'invalid_grant', 'subject_token inválido o caducado');
    }
    if (!claims.sub || !scopesOf(claims).includes('mcp')) {
        return h.jsonError(res, 400, 'invalid_grant', 'subject_token sin el scope requerido');
    }

    // 4) La cuenta debe seguir activa y autorizada (puede haberse desactivado desde que inició sesión).
    const usuario = await Usuario.findById(claims.sub);
    if (!usuario || !usuario.estado || !cfg.allowedEmails.has(String(usuario.correo).toLowerCase())) {
        return h.jsonError(res, 400, 'invalid_grant', 'La cuenta ya no está autorizada');
    }

    // 5) Emitir el token para el backend. La identidad sale del token verificado, nunca de la petición.
    const accessToken = jwt.sign(
        { scope: ex.scope, client_id: claims.client_id, act: { sub: ex.clientId } },
        cfg.privateKeyPem,
        {
            algorithm: 'ES256',
            keyid: cfg.kid,
            issuer: cfg.issuer,
            audience: ex.audience,
            subject: String(usuario._id),
            expiresIn: ex.ttlSeconds,
            jwtid: h.randomToken(12)
        }
    );

    console.log(`[oauth] intercambio concedido user=${usuario._id} actor=${ex.clientId}`);
    res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
    return res.json({
        access_token: accessToken,
        issued_token_type: ACCESS_TOKEN_TYPE,
        token_type: 'Bearer',
        expires_in: ex.ttlSeconds,
        scope: ex.scope
    });
}

// Lo usa el middleware validarJWT del backend para aceptar los tokens intercambiados.
// Lanza una excepción si el token no es válido para esta API.
function verifyExchangedToken(token) {
    if (!cfg.exchange.enabled) throw new Error('intercambio deshabilitado');
    const claims = jwt.verify(token, cfg.publicKeyPem, {
        algorithms: ['ES256'],
        issuer: cfg.issuer,
        audience: cfg.exchange.audience
    });
    if (!claims.sub || !scopesOf(claims).includes(cfg.exchange.scope)) {
        throw new Error('scope insuficiente');
    }
    return claims;
}

module.exports = { handleTokenExchange, verifyExchangedToken, TOKEN_EXCHANGE_GRANT, ACCESS_TOKEN_TYPE };
