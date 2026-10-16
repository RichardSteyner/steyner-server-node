'use strict';

const express = require('express');
const cors = require('cors');
const bcryptjs = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const Usuario = require('../models/usuario');
const { OAuthClient, OAuthRequest, OAuthCode, OAuthRefresh } = require('../models/oauth');
const cfg = require('./config');
const h = require('./helpers');

const router = express.Router();

// Parsers propios (límite pequeño). Este router se monta ANTES de CORS y de express.json() global.
const formParser = express.urlencoded({ extended: false, limit: '10kb' });
const jsonParser = express.json({ limit: '10kb' });

// CORS abierto SOLO para endpoints públicos que clientes MCP basados en navegador pueden necesitar.
// No hay cookies ni credenciales de navegador en juego, por eso "*" es seguro aquí.
const publicCors = cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'MCP-Protocol-Version'],
    maxAge: 600
});

const MAX_CLIENTS = 200;
const MAX_ATTEMPTS_PER_TXN = 5;
const CLIENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REQUEST_TTL_MS = 10 * 60 * 1000;
const CODE_TTL_MS = 60 * 1000;
const SCOPE = 'mcp';

// ---------------------------------------------------------------------------
// Utilidades del router
// ---------------------------------------------------------------------------

const wrap = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch((err) => {
        console.error('[oauth] error interno:', err);
        if (res.headersSent) return next(err);
        if (req.path === '/oauth/authorize') {
            return h.page(res, 500, 'Error', '<p>Error interno. Vuelve a intentarlo desde tu cliente.</p>');
        }
        return h.jsonError(res, 500, 'server_error');
    });

const limiter = (windowMs, limit, opts = {}) =>
    rateLimit({
        windowMs,
        limit,
        standardHeaders: true,
        legacyHeaders: false,
        handler: (req, res) =>
            req.path === '/oauth/authorize'
                ? h.page(res, 429, 'Demasiados intentos', '<p>Demasiadas solicitudes. Espera unos minutos.</p>')
                : h.jsonError(res, 429, 'temporarily_unavailable', 'Demasiadas solicitudes'),
        ...opts
    });

const authorizeViewLimiter = limiter(15 * 60 * 1000, 60);
// Solo cuentan los intentos que responden >= 400 (los logins fallidos devuelven 401).
const loginLimiter = limiter(15 * 60 * 1000, 10, { skipSuccessfulRequests: true });
const registerLimiter = limiter(60 * 60 * 1000, 10);
const tokenLimiter = limiter(60 * 1000, 60);

const metadata = {
    issuer: cfg.issuer,
    authorization_endpoint: `${cfg.issuer}/oauth/authorize`,
    token_endpoint: `${cfg.issuer}/oauth/token`,
    registration_endpoint: `${cfg.issuer}/oauth/register`,
    revocation_endpoint: `${cfg.issuer}/oauth/revoke`,
    jwks_uri: `${cfg.issuer}/.well-known/jwks.json`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [SCOPE],
    authorization_response_iss_parameter_supported: true
};

// ---------------------------------------------------------------------------
// Metadatos y claves públicas
// ---------------------------------------------------------------------------

router.options(['/.well-known/*', '/oauth/token', '/oauth/register', '/oauth/revoke'], publicCors);

router.get(['/.well-known/oauth-authorization-server', '/.well-known/openid-configuration'], publicCors, (req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json(metadata);
});

router.get('/.well-known/jwks.json', publicCors, (req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json(cfg.jwks);
});

// ---------------------------------------------------------------------------
// Registro dinámico de clientes (RFC 7591)
// Solo se aceptan redirect URIs de la lista blanca (claude.ai, chatgpt.com, extras) o loopback.
// ---------------------------------------------------------------------------

router.post('/oauth/register', publicCors, registerLimiter, jsonParser, wrap(async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];

    if (uris.length < 1 || uris.length > 5 || !uris.every((u) => h.isAllowedRedirectUri(u))) {
        return h.jsonError(res, 400, 'invalid_redirect_uri', 'redirect_uris no permitidos');
    }
    if ((await OAuthClient.estimatedDocumentCount()) >= MAX_CLIENTS) {
        return h.jsonError(res, 503, 'temporarily_unavailable', 'Límite de clientes alcanzado');
    }

    // El nombre es solo informativo (se escapa al mostrarlo); se limpia y se acorta.
    const rawName = typeof body.client_name === 'string' ? body.client_name : '';
    const clientName = rawName.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 80) || 'Cliente MCP';

    const clientId = `mcp_${h.randomToken(16)}`;
    await OAuthClient.create({
        clientId,
        clientName,
        redirectUris: uris,
        expireAt: new Date(Date.now() + CLIENT_TTL_MS)
    });

    // Siempre cliente público; el servidor puede sobrescribir lo solicitado (RFC 7591 §3.2.1).
    res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
    return res.status(201).json({
        client_id: clientId,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_name: clientName,
        redirect_uris: uris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none'
    });
}));

// ---------------------------------------------------------------------------
// Autorización: GET muestra login + consentimiento; POST lo procesa
// ---------------------------------------------------------------------------

router.get('/oauth/authorize', authorizeViewLimiter, wrap(async (req, res) => {
    const q = req.query;
    const clientId = h.str(q.client_id, 200);
    const redirectUri = h.str(q.redirect_uri, 2000);
    const client = clientId ? await OAuthClient.findOne({ clientId }).lean() : null;

    // Si el cliente o la redirect_uri no son válidos, NO se redirige (evita open redirect).
    if (!client || !redirectUri || !h.redirectUriMatches(client.redirectUris, redirectUri)) {
        return h.page(res, 400, 'Solicitud inválida',
            '<h1>Solicitud inválida</h1><p>El cliente o la URL de retorno no están registrados. No se te redirigió por seguridad.</p>');
    }

    const state = h.str(q.state, 512);
    const fail = (error, description) => h.redirectError(res, redirectUri, error, description, state);

    if (q.response_type !== 'code') {
        return fail('unsupported_response_type', 'Solo se admite response_type=code');
    }
    // PKCE obligatorio y solo S256.
    const challenge = h.str(q.code_challenge, 128);
    if (!challenge || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge) || q.code_challenge_method !== 'S256') {
        return fail('invalid_request', 'PKCE con code_challenge_method=S256 es obligatorio');
    }
    // Indicador de recurso (RFC 8707): solo se admite nuestro MCP.
    const requestedResource = h.str(q.resource, 2000);
    if (requestedResource && requestedResource !== cfg.resource) {
        return fail('invalid_target', 'resource no reconocido');
    }

    const txn = h.randomToken();
    await OAuthRequest.create({
        txnHash: h.sha256(txn),
        clientId,
        redirectUri,
        state,
        codeChallenge: challenge,
        expireAt: new Date(Date.now() + REQUEST_TTL_MS)
    });

    return h.loginPage(res, { txn, client, redirectUri });
}));

const expiredPage = (res) =>
    h.page(res, 400, 'Solicitud expirada',
        '<h1>Solicitud expirada</h1><p>Vuelve a iniciar la conexión desde tu cliente.</p>');

router.post('/oauth/authorize', loginLimiter, formParser, wrap(async (req, res) => {
    const body = req.body || {};
    const txn = h.str(body.txn, 200);
    const txnHash = txn ? h.sha256(txn) : null;
    const pending = txnHash ? await OAuthRequest.findOne({ txnHash }).lean() : null;
    if (!pending || pending.expireAt < new Date()) return expiredPage(res);

    const client = await OAuthClient.findOne({ clientId: pending.clientId }).lean();
    if (!client) return expiredPage(res);

    if (body.decision === 'deny') {
        await OAuthRequest.deleteOne({ txnHash });
        return h.redirectError(res, pending.redirectUri, 'access_denied', 'El usuario canceló la autorización', pending.state);
    }

    // Máximo de intentos por solicitud (el documento devuelto es el anterior al incremento).
    const before = await OAuthRequest.findOneAndUpdate({ txnHash }, { $inc: { attempts: 1 } });
    if (!before) return expiredPage(res);
    if (before.attempts >= MAX_ATTEMPTS_PER_TXN) {
        await OAuthRequest.deleteOne({ txnHash });
        return expiredPage(res);
    }

    const showError = (message) =>
        h.loginPage(res, { status: 401, txn, client, redirectUri: pending.redirectUri, error: message });

    const email = (h.str(body.correo, 254) || '').trim().toLowerCase();
    const password = h.str(body.password, 200);
    if (!email || !password) return showError('Ingresa tu correo y tu contraseña.');

    if (h.isLocked(email)) {
        return showError('Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo.');
    }

    // Búsqueda sin distinguir mayúsculas (el valor está escapado y es un string: sin inyección NoSQL).
    const usuario = await Usuario.findOne({ correo: new RegExp(`^${h.escapeRegExp(email)}$`, 'i') });

    // Siempre se ejecuta bcrypt (con hash falso si no existe) para igualar tiempos.
    const passwordOk = await bcryptjs.compare(password, usuario ? usuario.password : h.DUMMY_HASH);
    const allowed = Boolean(usuario) && cfg.allowedEmails.has(String(usuario.correo).toLowerCase());

    // Mismo mensaje para: no existe, inactivo, contraseña incorrecta o no autorizado para el MCP.
    if (!usuario || !usuario.estado || !passwordOk || !allowed) {
        h.registerFailure(email);
        console.warn(`[oauth] login fallido ip=${req.ip} client=${pending.clientId}`);
        return showError('Credenciales incorrectas.');
    }

    // Consumir la solicitud de forma atómica (un solo uso).
    const consumed = await OAuthRequest.findOneAndDelete({ txnHash });
    if (!consumed) return expiredPage(res);
    h.clearFailures(email);

    const code = h.randomToken();
    await OAuthCode.create({
        codeHash: h.sha256(code),
        clientId: consumed.clientId,
        userId: usuario._id,
        redirectUri: consumed.redirectUri,
        codeChallenge: consumed.codeChallenge,
        resource: cfg.resource,
        scope: SCOPE,
        expireAt: new Date(Date.now() + CODE_TTL_MS)
    });
    await OAuthClient.updateOne(
        { clientId: consumed.clientId },
        { $set: { expireAt: new Date(Date.now() + CLIENT_TTL_MS) } }
    );

    console.log(`[oauth] autorización concedida client=${consumed.clientId} user=${usuario._id}`);
    return h.redirectTo(res, consumed.redirectUri, { code, state: consumed.state });
}));

// ---------------------------------------------------------------------------
// Token: authorization_code (+PKCE) y refresh_token (con rotación)
// ---------------------------------------------------------------------------

const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;

async function issueTokens({ userId, clientId, familyId }) {
    const accessToken = jwt.sign({ scope: SCOPE, client_id: clientId }, cfg.privateKeyPem, {
        algorithm: 'ES256',
        keyid: cfg.kid,
        issuer: cfg.issuer,
        audience: cfg.resource, // el MCP rechazará tokens con otra audiencia
        subject: String(userId),
        expiresIn: cfg.accessTtlSeconds,
        jwtid: h.randomToken(12)
    });
    const refreshToken = h.randomToken(32);
    await OAuthRefresh.create({
        tokenHash: h.sha256(refreshToken),
        familyId,
        clientId,
        userId,
        used: false,
        expireAt: new Date(Date.now() + cfg.refreshTtlSeconds * 1000)
    });
    return {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: cfg.accessTtlSeconds,
        refresh_token: refreshToken,
        scope: SCOPE
    };
}

const sendTokens = (res, tokens) => {
    res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
    return res.json(tokens);
};

router.post('/oauth/token', publicCors, tokenLimiter, formParser, wrap(async (req, res) => {
    const body = req.body || {};
    const grantType = h.str(body.grant_type, 50);
    const clientId = h.str(body.client_id, 200);
    if (!grantType) return h.jsonError(res, 400, 'invalid_request', 'Falta grant_type');
    if (!clientId) return h.jsonError(res, 400, 'invalid_request', 'Falta client_id');

    const client = await OAuthClient.findOne({ clientId }).lean();
    if (!client) return h.jsonError(res, 401, 'invalid_client');

    const requestedResource = h.str(body.resource, 2000);
    if (requestedResource && requestedResource !== cfg.resource) {
        return h.jsonError(res, 400, 'invalid_target', 'resource no reconocido');
    }

    // --- authorization_code ---
    if (grantType === 'authorization_code') {
        const code = h.str(body.code, 200);
        const verifier = h.str(body.code_verifier, 128);
        const redirectUri = h.str(body.redirect_uri, 2000);
        if (!code || !verifier || !VERIFIER_RE.test(verifier) || !redirectUri) {
            return h.jsonError(res, 400, 'invalid_request', 'Faltan o son inválidos code, code_verifier o redirect_uri');
        }

        // Borrado atómico: el código es de un solo uso, aunque la validación posterior falle.
        const codeDoc = await OAuthCode.findOneAndDelete({ codeHash: h.sha256(code) });
        if (
            !codeDoc ||
            codeDoc.expireAt < new Date() ||
            codeDoc.clientId !== clientId ||
            codeDoc.redirectUri !== redirectUri ||
            !h.pkceMatches(verifier, codeDoc.codeChallenge)
        ) {
            return h.jsonError(res, 400, 'invalid_grant', 'Código inválido, caducado o verificación PKCE fallida');
        }

        return sendTokens(res, await issueTokens({
            userId: codeDoc.userId,
            clientId,
            familyId: h.randomToken(16)
        }));
    }

    // --- refresh_token (rotación + detección de reutilización) ---
    if (grantType === 'refresh_token') {
        const refreshToken = h.str(body.refresh_token, 200);
        if (!refreshToken) return h.jsonError(res, 400, 'invalid_request', 'Falta refresh_token');
        const tokenHash = h.sha256(refreshToken);

        // Marca como usado de forma atómica y devuelve el documento anterior.
        const doc = await OAuthRefresh.findOneAndUpdate(
            { tokenHash, used: false, expireAt: { $gt: new Date() } },
            { $set: { used: true } }
        );

        if (!doc) {
            const old = await OAuthRefresh.findOne({ tokenHash }).lean();
            if (old && old.used) {
                // Reutilización: posible robo del token. Se revoca toda la familia.
                await OAuthRefresh.deleteMany({ familyId: old.familyId });
                console.warn(`[oauth] reutilización de refresh token detectada, familia revocada client=${old.clientId}`);
            }
            return h.jsonError(res, 400, 'invalid_grant', 'Refresh token inválido o caducado');
        }

        if (doc.clientId !== clientId) {
            await OAuthRefresh.deleteMany({ familyId: doc.familyId });
            return h.jsonError(res, 400, 'invalid_grant', 'Refresh token inválido');
        }

        // El usuario puede haber sido desactivado o retirado de la lista blanca desde la última vez.
        const usuario = await Usuario.findById(doc.userId);
        if (!usuario || !usuario.estado || !cfg.allowedEmails.has(String(usuario.correo).toLowerCase())) {
            await OAuthRefresh.deleteMany({ familyId: doc.familyId });
            return h.jsonError(res, 400, 'invalid_grant', 'La cuenta ya no está autorizada');
        }

        return sendTokens(res, await issueTokens({
            userId: doc.userId,
            clientId,
            familyId: doc.familyId
        }));
    }

    return h.jsonError(res, 400, 'unsupported_grant_type');
}));

// ---------------------------------------------------------------------------
// Revocación (RFC 7009): revoca la familia del refresh token. Siempre responde 200.
// Los access tokens (JWT de vida corta) no se pueden revocar: caducan solos.
// ---------------------------------------------------------------------------

router.post('/oauth/revoke', publicCors, tokenLimiter, formParser, wrap(async (req, res) => {
    const body = req.body || {};
    const token = h.str(body.token, 200);
    const clientId = h.str(body.client_id, 200);
    if (token && clientId) {
        const doc = await OAuthRefresh.findOne({ tokenHash: h.sha256(token) }).lean();
        if (doc && doc.clientId === clientId) {
            await OAuthRefresh.deleteMany({ familyId: doc.familyId });
        }
    }
    res.set('Cache-Control', 'no-store');
    return res.status(200).end();
}));

module.exports = router;
