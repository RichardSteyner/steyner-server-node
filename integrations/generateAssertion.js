const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

function normalizePrivateKey(key) {
    if (!key || typeof key !== 'string') {
        return key;
    }

    return key.replace(/\\n/g, '\n').trim();
}

function loadPrivateKey(privateKeyPath) {
    const resolvedPath = path.isAbsolute(privateKeyPath)
        ? privateKeyPath
        : path.resolve(process.cwd(), privateKeyPath);

    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`No se encontró el archivo de clave privada: ${resolvedPath}`);
    }

    return fs.readFileSync(resolvedPath, 'utf8');
}

/**
 * Genera un assertion JWT firmado con RS256.
 * @param {Object} options
 * @param {string} options.iss Issuer del JWT
 * @param {string} options.sub Subject del JWT
 * @param {string} options.aud Audience del JWT
 * @param {string|number} [options.expiresIn='1h'] Tiempo de expiración del JWT
 * @param {string} [options.privateKeyPath] Ruta al archivo .key de la clave privada
 * @param {string} [options.privateKey] Clave privada RS256 en formato PEM.
 *   PEM es el contenido original del archivo, incluyendo delimitadores y saltos de línea:
 *     -----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----
 *   Base64 es una codificación de ese contenido y no debe confundirse con el formato PEM.
 *   Si envías la clave desde una variable de entorno, convierte el Base64 a UTF-8
 *   o usa saltos de línea escapados (\n) dentro de la cadena PEM.
 *   Ejemplo con Base64 en .env:
 *     SF_JWT_PRIVATE_KEY_B64=LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tCg==
 *   Comandos para generar Base64 desde el archivo PEM:
 *     Linux/macOS:
 *       base64 -w 0 private.key
 *     Windows PowerShell:
 *       [Convert]::ToBase64String([IO.File]::ReadAllBytes('privatepath.key'))
 *   En Node lo conviertes a string utf-8:
 *     const privateKey = Buffer.from(process.env.SF_JWT_PRIVATE_KEY_B64, 'base64').toString('utf8');
 * @param {Object} [options.additionalClaims] Reclamaciones adicionales a incluir en el payload
 * @returns {string}
 */
function generateAssertion({
    iss,
    sub,
    aud,
    expiresIn = '1h',
    privateKeyPath,
    privateKey,
    additionalClaims = {}
} = {}) {
    if (!iss) {
        throw new Error('El campo "iss" es obligatorio para generar el assertion.');
    }

    if (!sub) {
        throw new Error('El campo "sub" es obligatorio para generar el assertion.');
    }

    if (!aud) {
        throw new Error('El campo "aud" es obligatorio para generar el assertion.');
    }

    const signingKey = privateKey
        ? normalizePrivateKey(privateKey)
        : (privateKeyPath
            ? loadPrivateKey(privateKeyPath)
            : normalizePrivateKey(process.env.SF_JWT_PRIVATE_KEY) || loadPrivateKey(process.env.SF_JWT_PRIVATE_KEY_PATH)
        );

    if (!signingKey) {
        throw new Error('No se encontró la clave privada RS256. Proporcione privateKey, privateKeyPath, SF_JWT_PRIVATE_KEY o SF_JWT_PRIVATE_KEY_PATH.');
    }

    const payload = {
        iss,
        sub,
        aud,
        ...additionalClaims
    };

    return jwt.sign(payload, signingKey, {
        algorithm: 'RS256',
        expiresIn
    });
}

module.exports = {
    generateAssertion,
    loadPrivateKey
};
