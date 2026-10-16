const { Schema, model } = require('mongoose');

// Modelos del authorization server OAuth 2.1.
// - Los secretos (códigos, refresh tokens, txn) se guardan HASHEADOS (sha256): si se filtra la BD no sirven.
// - Los documentos caducan o se eliminan solos con un índice TTL sobre "expireAt".
//   (El borrado por TTL de MongoDB puede tardar hasta ~60 s: el código también comprueba la caducidad.)

// Clientes registrados (registro dinámico, RFC 7591). Siempre son clientes públicos (sin secreto).
const OAuthClientSchema = new Schema({
    clientId:     { type: String, required: true, unique: true },
    clientName:   { type: String, required: true },
    redirectUris: { type: [String], required: true },
    expireAt:     { type: Date, required: true } // se renueva con cada uso
});
OAuthClientSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

// Solicitud de autorización pendiente (entre mostrar el login y que el usuario lo envíe).
// El formulario solo lleva el "txn" (aleatorio); el resto de datos viven aquí, no en campos ocultos.
const OAuthRequestSchema = new Schema({
    txnHash:       { type: String, required: true, unique: true },
    clientId:      { type: String, required: true },
    redirectUri:   { type: String, required: true },
    state:         { type: String },
    codeChallenge: { type: String, required: true },
    attempts:      { type: Number, default: 0 },
    expireAt:      { type: Date, required: true }
});
OAuthRequestSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

// Código de autorización: un solo uso, vida de 60 s.
const OAuthCodeSchema = new Schema({
    codeHash:      { type: String, required: true, unique: true },
    clientId:      { type: String, required: true },
    userId:        { type: Schema.Types.ObjectId, ref: 'Usuario', required: true },
    redirectUri:   { type: String, required: true },
    codeChallenge: { type: String, required: true },
    resource:      { type: String, required: true },
    scope:         { type: String, required: true },
    expireAt:      { type: Date, required: true }
});
OAuthCodeSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

// Refresh token con rotación. "familyId" agrupa la cadena de rotaciones:
// si se reutiliza un token ya usado, se revoca toda la familia.
const OAuthRefreshSchema = new Schema({
    tokenHash: { type: String, required: true, unique: true },
    familyId:  { type: String, required: true, index: true },
    clientId:  { type: String, required: true },
    userId:    { type: Schema.Types.ObjectId, ref: 'Usuario', required: true },
    used:      { type: Boolean, default: false },
    expireAt:  { type: Date, required: true }
});
OAuthRefreshSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

module.exports = {
    OAuthClient:  model('OAuthClient', OAuthClientSchema),
    OAuthRequest: model('OAuthRequest', OAuthRequestSchema),
    OAuthCode:    model('OAuthCode', OAuthCodeSchema),
    OAuthRefresh: model('OAuthRefresh', OAuthRefreshSchema)
};
