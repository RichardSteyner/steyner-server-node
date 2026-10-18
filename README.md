# Steyner Server Node

Servidor backend de Node.js basado en Express, MongoDB y JWT, con una capa REST para gestión de usuarios, productos, categorías, logs, uploads y una implementación propia de **Authorization Server OAuth 2.1** para integrar clientes MCP (Claude, ChatGPT, MCP Inspector, `mcp-remote`...).

> **Estado de la capa OAuth:** funcional y verificada con el flujo manual completo y con un conector OAuth real (canje de código, refresh con rotación e intercambio de tokens). Sus reglas de seguridad se probaron con pruebas automáticas sobre stubs. **No** se ha probado aún con ChatGPT ni con todas las versiones de los clientes. Mantener un authorization server propio es una responsabilidad de seguridad: ver [Limitaciones conocidas](#limitaciones-conocidas).

**Documentación relacionada:** el servidor MCP que consume este Authorization Server (resource server) tiene su propio README en el repositorio `steyner-mcp`, con sus variables, el guard de validación y el cliente de intercambio de tokens.

## Índice

- [Descripción general](#descripción-general)
- [Inicio rápido](#inicio-rápido)
- [Arquitectura del sistema](#arquitectura-del-sistema)
- [Authorization Server (OAuth 2.1)](#authorization-server-oauth-21)
- [Estructura principal del proyecto](#estructura-principal-del-proyecto)
- [Modelo de autenticación](#modelo-de-autenticación)
- [Seguridad y buenas prácticas](#seguridad-y-buenas-prácticas)
- [Variables de entorno](#variables-de-entorno)
- [Consideraciones de despliegue](#consideraciones-de-despliegue)
- [Casos de uso del proyecto](#casos-de-uso-del-proyecto)
- [Resumen y recomendaciones](#resumen-y-recomendaciones)

---

## Descripción general

Este proyecto es un backend monolítico que se ejecuta desde `app.js` y crea una instancia del servidor principal en `models/server.js`. Combina tres responsabilidades:

- **WebServer:** sirve la aplicación web estática y configura la capa HTTP global del sistema.
- **RestServer:** expone los endpoints de negocio bajo `/api/*`.
- **Authorization Server:** habilita un flujo OAuth 2.1 con PKCE para autorizar clientes externos y emitir tokens firmados con los que un servidor MCP actúa **en nombre de un usuario**.

Tecnologías:

- Node.js 22
- Express
- MongoDB con Mongoose
- JWT para autenticación interna
- OAuth 2.1 para autorización de terceros (`ES256`)
- Google Sign-In
- Cloudinary y manejo de archivos
- CORS, validación de campos y rate limiting

## Inicio rápido

1. Instala dependencias:

   ```bash
   npm install
   ```

2. Configura las variables de entorno a partir de `.example.env` o crea un `.env` con los valores reales.

3. Inicia el servidor:

   ```bash
   npm start
   ```

El arranque del proyecto se hace en `app.js`:

```js
require('dotenv').config();
const Server = require('./models/server');

const server = new Server();
server.listen();
```

El Authorization Server **está apagado por defecto**: solo se activa con `OAUTH_ENABLED=true`. Para activarlo, ver [Puesta en marcha del Authorization Server](#puesta-en-marcha).

## Arquitectura del sistema

### 1) WebServer

Definido en `models/server.js`, es la capa central del backend. Su función es:

- crear la instancia de Express
- configurar `trust proxy`, CORS, JSON parsing y manejo de archivos
- montar los routers de la aplicación
- servir contenido estático desde `public/`
- preparar la ruta fallback para una SPA
- activar el Authorization Server opcional si `OAUTH_ENABLED=true`

También conecta a MongoDB con `dbConnection()`, usando la configuración de `database/config.js`.

**Orden de los middlewares.** Para el Authorization Server importa el orden en `middlewares()`:

1. (Opcional) log de diagnóstico `[entrada]`, que imprime método, ruta, IP, `x-forwarded-for` y `User-Agent` (no los cuerpos).
2. **Router OAuth**, si `OAUTH_ENABLED=true`. Va **antes de CORS** porque define sus propios parsers (límite de 10 KB) y su propio CORS abierto en los endpoints públicos; si el CORS global (con lista de dominios) se ejecutara antes, respondería el preflight sin las cabeceras que necesitan los clientes MCP.
3. CORS global (dominios permitidos) y `express.json()`.
4. Rutas REST (`/api/*`).
5. Estáticos y fallback de la SPA (`get('*')`). Tiene que ir **después** del router OAuth, o `/.well-known/*` devolvería el `index.html`.

```js
// models/server.js (fragmento relevante)
this.app.set('trust proxy', 3);        // Render + Cloudflare: ver "Consideraciones de despliegue"
this.app.disable('x-powered-by');

middlewares() {
    // ... log de diagnóstico [entrada] ...
    const oauthRouter = require('../oauth');   // null si OAUTH_ENABLED !== 'true'
    if (oauthRouter) this.app.use(oauthRouter);
    // ... CORS, express.json(), rutas, estáticos, fallback ...
}
```

### 2) RestServer

La parte REST está organizada por rutas en `routes/` y controladores en `controllers/`.

Rutas principales:

- `/api/auth` → login, Google Sign-In, validación de JWT
- `/api/usuarios` → CRUD de usuarios, validaciones y roles
- `/api/productos` → CRUD de productos
- `/api/categorias` → CRUD de categorías
- `/api/logs` → gestión de logs
- `/api/uploads` y `/api/uploads-v2` → carga y gestión de archivos
- `/api/leads` → gestión de leads
- `/api/pocs` → integración de POCs
- `/api/webhooks-wsp` → webhook de WhatsApp
- `/api/buscar` → búsqueda general

Flujo típico de una petición REST:

1. La ruta en `routes/*.js` recibe la solicitud.
2. Se valida el cuerpo o parámetros con `express-validator` (si falta algo, responde `400` con `{ "errors": [ { "msg", "param", "location" } ] }`).
3. Se aplica middleware como `validarJWT` o `esAdminRole`.
4. El controlador procesa la lógica.
5. Se responde con JSON.

Ejemplo de autenticación: `routes/auth.js` expone `/login`, `/google` y `/validarJWT`; `controllers/auth.js` valida credenciales, verifica el token de Google o genera el JWT; `helpers/generar-jwt.js` firma con `SECRETORPRIVATEKEY`.

La seguridad REST se apoya en `middlewares/validar-jwt.js`, `validar-roles.js` y `validar-campos.js`.

### 3) Authorization Server

Vive en la carpeta `oauth/`. Se describe en detalle en la sección siguiente.

---

## Authorization Server (OAuth 2.1)

### Qué es (y qué no es)

Un servidor de autorización **mínimo y de propósito único**, embebido en este backend, que permite que un servidor MCP protegido por OAuth (el *resource server*, repositorio `steyner-mcp`) reciba tokens de usuarios y actúe como ellos.

| Rol (OAuth) | Quién es |
|---|---|
| **Authorization server** | Este backend (`oauth/`) |
| **Resource server** | El servidor MCP (`steyner-mcp`) |
| **Cliente** | Claude, ChatGPT, MCP Inspector, `mcp-remote`... |
| **Propietario del recurso** | La persona que inicia sesión (tabla `Usuario`) |
| **Cliente confidencial de intercambio** | El propio MCP, con `OAUTH_EXCHANGE_CLIENT_SECRET` |

Qué **no** es:

- No es un proveedor de identidad general: no emite `id_token` ni expone `userinfo`. Publica también `/.well-known/openid-configuration`, pero es el mismo documento que el de OAuth y solo sirve para el descubrimiento.
- Los clientes registrados son siempre **públicos** (sin secreto); la seguridad descansa en PKCE y en la `redirect_uri`. La excepción es el cliente de intercambio (el MCP), que sí se autentica con secreto.
- Solo hay **un recurso** (`MCP_RESOURCE_URL`) y **un scope** de usuario (`mcp`). No hay consentimiento por permisos ni se recuerda el consentimiento: cada conexión muestra la pantalla.
- No implementa CIMD (Client ID Metadata Documents), solo registro dinámico (DCR).

### Activación y arranque

`oauth/index.js` es el interruptor:

```js
if (process.env.OAUTH_ENABLED !== 'true') {
    console.log('[oauth] Deshabilitado (OAUTH_ENABLED distinto de "true")');
    module.exports = null;
} else {
    module.exports = require('./router');
    console.log('[oauth] Authorization server habilitado');
}
```

- Mientras `OAUTH_ENABLED` no sea `true`, el módulo no carga nada y el backend funciona igual que sin él. Puedes desplegar el código antes de configurar claves.
- Con `OAUTH_ENABLED=true`, `oauth/config.js` **valida todas las variables al arrancar y lanza un error si falta alguna** (`[oauth] Falta la variable de entorno X`): el backend no inicia. Es intencional: es mejor fallar al arrancar que dejar el servidor de autorización a medio configurar.

### Flujo completo

```
Cliente MCP            Navegador del usuario        Backend (Authorization Server)          steyner-mcp (Resource Server)
    │                                                                                                │
    │ 1. POST /mcp sin token ───────────────────────────────────────────────────────────────────────►│
    │ ◄─────────────────────────────── 401 + WWW-Authenticate: resource_metadata=... ────────────────│
    │ 2. GET /.well-known/oauth-protected-resource  ─────────────────────────────────────────────────►│
    │ ◄────────────────────────────── authorization_servers: [OAUTH_ISSUER] ─────────────────────────│
    │ 3. GET /.well-known/oauth-authorization-server ─────────────►│
    │ 4. POST /oauth/register ────────────────────────────────────►│   → client_id
    │ 5. abre /oauth/authorize?...&code_challenge=... ─►│ GET /oauth/authorize ►│ valida y muestra el login
    │                                                   │ POST /oauth/authorize ►│ credenciales + lista blanca
    │ ◄────────────── redirección a redirect_uri?code=...&state=...&iss=... (code: 60 s, un solo uso)
    │ 6. POST /oauth/token (code + code_verifier) ────────────────►│   → access_token (aud = MCP) + refresh_token
    │ 7. POST /mcp  Authorization: Bearer <access_token> ───────────────────────────────────────────►│ valida iss/aud/exp/scope
    │                                                              │◄── 8. POST /oauth/token (token-exchange, Basic)
    │                                                              │      → token para el backend (5 min, scope logs)
    │                                                              │◄── 9. /api/logs  (x-token = token intercambiado)
```

Cuando el access token caduca, el cliente usa el refresh token (`grant_type=refresh_token`) sin que el usuario vuelva a iniciar sesión.

### Endpoints

| Método | Ruta | Qué hace | CORS abierto | Límite |
|---|---|---|---|---|
| GET | `/.well-known/oauth-authorization-server` y `/.well-known/openid-configuration` | Metadatos del servidor (el mismo JSON en ambas) | Sí | — |
| GET | `/.well-known/jwks.json` | Clave pública de firma (JWKS) | Sí | — |
| POST | `/oauth/register` | Registro dinámico de clientes (RFC 7591) | Sí | 10 por hora por IP |
| GET | `/oauth/authorize` | Valida la solicitud y muestra el login + consentimiento | No | 60 cada 15 min por IP |
| POST | `/oauth/authorize` | Procesa el login y emite el código | No | 10 **fallos** cada 15 min por IP |
| POST | `/oauth/token` | `authorization_code`, `refresh_token` y `token-exchange` | Sí | 60 por minuto por IP |
| POST | `/oauth/revoke` | Revoca la familia de un refresh token (RFC 7009) | Sí | Comparte el límite de `/oauth/token` |

Metadatos publicados (`/.well-known/oauth-authorization-server`):

```json
{
  "issuer": "https://tu-backend.com",
  "authorization_endpoint": "https://tu-backend.com/oauth/authorize",
  "token_endpoint": "https://tu-backend.com/oauth/token",
  "registration_endpoint": "https://tu-backend.com/oauth/register",
  "revocation_endpoint": "https://tu-backend.com/oauth/revoke",
  "jwks_uri": "https://tu-backend.com/.well-known/jwks.json",
  "response_types_supported": ["code"],
  "response_modes_supported": ["query"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["none"],
  "revocation_endpoint_auth_methods_supported": ["none"],
  "scopes_supported": ["mcp"],
  "authorization_response_iss_parameter_supported": true
}
```

El grant de intercambio de tokens **no se anuncia**: es de uso interno entre el MCP y este backend.

### Registro de clientes y redirect URIs

`POST /oauth/register` (JSON) acepta `client_name` y `redirect_uris`. Devuelve `201` con un `client_id` (`mcp_` + 16 bytes aleatorios en base64url). Siempre crea un cliente **público**, aunque se pida otro `token_endpoint_auth_method` (el servidor puede sobrescribirlo, RFC 7591 §3.2.1).

Reglas del registro:

- Entre 1 y 5 `redirect_uris`, todas permitidas por la política de abajo; si alguna no lo es, `400 invalid_redirect_uri`.
- Máximo de **200 clientes** en total (`503 temporarily_unavailable` al superarlo).
- `client_name` se limpia (sin caracteres de control ni `<` `>`) y se corta a 80 caracteres. Es solo informativo y se escapa siempre al mostrarlo.
- El cliente caduca a los **30 días sin uso**; se renueva al autorizar y también al emitir tokens (canje o refresh).

**Política de redirect URIs:**

| Tipo | Se permite |
|---|---|
| `https` | Solo URIs **exactas** de la lista blanca: `https://claude.ai/api/mcp/auth_callback`, `https://claude.com/api/mcp/auth_callback`, `https://chatgpt.com/connector_platform_oauth_redirect` y las que añadas en `OAUTH_ALLOWED_REDIRECT_URIS` |
| `http` | Solo loopback (`localhost`, `127.0.0.1`, `[::1]`) con **cualquier puerto y ruta** (RFC 8252). Lo usan Claude Code, `mcp-remote` y el Inspector |
| Cualquier otra (`javascript:`, esquemas propios, `https` fuera de la lista) | Rechazada |
| Con fragmento (`#`), con usuario/contraseña en la URL, o de más de 2000 caracteres | Rechazada |

Al autorizar, la `redirect_uri` debe **coincidir exactamente** con una registrada (solo se ignora el puerto en loopback, y solo si el host, la ruta y la query coinciden). Si el cliente o la URI no son válidos, se muestra una página de error y **no se redirige** (evita el *open redirect*).

> La URL de callback de ChatGPT de la lista base proviene de documentación de terceros y no está verificada. ChatGPT muestra la URL exacta al crear el conector: si difiere, añádela en `OAUTH_ALLOWED_REDIRECT_URIS`.
>
> La excepción de loopback explica por qué un flujo manual con `http://localhost:PUERTO/callback` funciona aunque la lista blanca solo mencione a Claude y ChatGPT: es tu **navegador** quien sigue la redirección a `localhost`, y esa excepción es el mecanismo estándar para aplicaciones de escritorio y terminal.

### Autorización: login y consentimiento

**`GET /oauth/authorize`** valida, por este orden:

1. `client_id` registrado y `redirect_uri` coincidente. Si falla: página de error, sin redirección.
2. `response_type=code`; si no, redirige con `unsupported_response_type`.
3. **PKCE obligatorio**: `code_challenge` de 43 a 128 caracteres base64url y `code_challenge_method=S256`; si no, redirige con `invalid_request`.
4. `resource`, si viene, debe ser exactamente `MCP_RESOURCE_URL` (si no, `invalid_target`). Si no viene, se acepta: los tokens siempre se emiten para ese recurso.
5. `state` de hasta 512 caracteres (si es más largo, no se devuelve en la redirección).

Si todo es válido, guarda una **solicitud pendiente** (`txn`, 10 minutos) y muestra el formulario. El formulario solo lleva el `txn` aleatorio como campo oculto: el resto de datos viven en el servidor, no en campos manipulables.

**`POST /oauth/authorize`** (botones *Autorizar* y *Cancelar*):

1. Busca la solicitud por `txn`. Si no existe o expiró: "Solicitud expirada".
2. *Cancelar* → redirige con `access_denied`.
3. Cuenta el intento (máximo **5 por solicitud**; al superarlo, la solicitud se elimina).
4. Normaliza el correo (minúsculas) y comprueba el bloqueo por correo (**5 fallos → 15 minutos**).
5. Busca al usuario sin distinguir mayúsculas y **siempre ejecuta `bcrypt`** (con un hash falso si el usuario no existe) para igualar los tiempos.
6. Exige: el usuario existe, `estado: true`, contraseña correcta **y** su correo está en `OAUTH_ALLOWED_EMAILS`. Todos los fallos devuelven el mismo mensaje ("Credenciales incorrectas.") con estado `401`, para no revelar qué cuentas existen ni cuáles están autorizadas.
7. Consume la solicitud de forma atómica, genera el **código** (60 segundos, un solo uso, guardado hasheado) y redirige (`303`) a la `redirect_uri` con `code`, `state` e `iss` (RFC 9207).

Las páginas HTML escapan todo valor dinámico y llevan `Content-Security-Policy` (`default-src 'none'`, `frame-ancestors 'none'`), `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` y `Cache-Control: no-store`. La CSP **no define `form-action` a propósito**: Chrome lo aplica también a la redirección posterior al envío del formulario y rompería el retorno al cliente.

### Tokens

**Access token (JWT `ES256`)** emitido en el canje del código y en cada refresh:

| Claim | Valor |
|---|---|
| `iss` | `OAUTH_ISSUER` |
| `sub` | Id del usuario |
| `aud` | `MCP_RESOURCE_URL` (el MCP rechaza cualquier otro) |
| `scope` | `mcp` |
| `client_id` | Cliente que lo pidió |
| `iat`, `exp` | Emisión y caducidad (por defecto 30 minutos) |
| `jti` | Identificador aleatorio |

La cabecera lleva `alg: ES256` y `kid` (huella RFC 7638 de la clave pública).

**Canje del código (`grant_type=authorization_code`):** exige `client_id`, `code`, `code_verifier` (43–128 caracteres), y `redirect_uri` idéntica a la de la autorización. El código se **borra de forma atómica** al primer intento, aunque la validación falle (reutilizarlo da `invalid_grant`). Se comprueba que no haya caducado, que pertenezca al cliente, la `redirect_uri` exacta y el PKCE con comparación en tiempo constante.

**Refresh token** (opaco, 32 bytes aleatorios, guardado hasheado, 30 días por defecto):

- **Rotación:** cada uso emite un refresh nuevo de la misma *familia* y marca el anterior como usado. Mientras el cliente refresque al menos una vez al mes, no hay que volver a iniciar sesión.
- **Detección de reutilización:** si se presenta un refresh ya usado, se **revoca toda la familia** (posible robo) y se registra una advertencia. Un cliente que reintente el refresh en paralelo puede provocar esto y obligar a reconectar.
- En cada refresh se **revalida al usuario** (activo y en la lista blanca) y que el `client_id` coincida; si no, se revoca la familia.
- `POST /oauth/revoke` elimina toda la familia. Responde siempre `200` con cuerpo vacío, aunque el token no exista, para no revelar su validez. Los access tokens no se pueden revocar: caducan solos.

**Intercambio de tokens (`grant_type=urn:ietf:params:oauth:grant-type:token-exchange`, RFC 8693).** Lo usa el MCP para **no reenviar** el token del usuario al backend (*token passthrough*, prohibido por la especificación de MCP) y actuar como esa persona. Está **deshabilitado** salvo que definas `OAUTH_EXCHANGE_CLIENT_SECRET`.

1. El MCP se autentica como cliente confidencial con HTTP Basic (`client_id:client_secret`, codificados como formulario). Un token de usuario robado, por sí solo, no basta: hace falta además el secreto.
2. Parámetros exactos: `subject_token`, `subject_token_type` y `requested_token_type` (ambos `urn:ietf:params:oauth:token-type:access_token`), `audience` igual a `OAUTH_BACKEND_AUDIENCE` y `scope=logs`. Cualquier otro valor se rechaza (`invalid_request`, `invalid_target` o `invalid_scope`).
3. El `subject_token` debe ser un access token **nuestro**: `ES256`, `iss` correcto, `aud` igual al MCP, vigente y con scope `mcp`. Un token intercambiado no se puede volver a intercambiar (su `aud` no es el MCP).
4. Se comprueba que la cuenta siga **activa y en la lista blanca**.
5. Se emite un token nuevo y de vida corta:

| Claim | Valor |
|---|---|
| `aud` | `OAUTH_BACKEND_AUDIENCE` (por defecto `<issuer>/api`): identifica a la API, no al MCP |
| `sub` | El usuario del `subject_token` (nunca sale de la petición) |
| `scope` | `logs` |
| `act` | `{ "sub": "<OAUTH_EXCHANGE_CLIENT_ID>" }`: quién actúa en su nombre |
| `client_id`, `jti`, `exp` | Cliente original, id aleatorio y 5 minutos por defecto |

Respuesta (RFC 8693): `access_token`, `issued_token_type`, `token_type: "Bearer"`, `expires_in` y `scope`.

**Duraciones:**

| Elemento | Vida | Uso |
|---|---|---|
| Solicitud pendiente (`txn`) | 10 minutos | Un solo éxito, hasta 5 intentos |
| Código de autorización | 60 segundos | Un solo uso |
| Access token (usuario → MCP) | 30 minutos (configurable, 5 min–24 h) | Reutilizable, no revocable |
| Refresh token | 30 días (configurable, 1 h–90 días), con rotación | Un solo uso por token |
| Token intercambiado (MCP → API) | 5 minutos (configurable, 1–15 min) | Reutilizable, solo en rutas permitidas |
| Cliente registrado | 30 días sin uso | — |

### Códigos de error

Los endpoints responden con `{ "error": "...", "error_description": "..." }` y `Cache-Control: no-store`.

| `error` | Estado | Cuándo |
|---|---|---|
| `invalid_request` | 400 | Faltan o son inválidos parámetros de `/oauth/token` (`grant_type`, `client_id`, `code`, `code_verifier`, `redirect_uri`, `refresh_token`, `subject_token`...) |
| `invalid_client` | 401 | `client_id` desconocido o caducado; en el intercambio, credenciales Basic incorrectas |
| `invalid_grant` | 400 | Código inválido, caducado o ya usado; PKCE o `redirect_uri` que no coinciden; refresh inválido, caducado o reutilizado; cuenta que ya no está autorizada; `subject_token` inválido |
| `invalid_target` | 400 | `resource` o `audience` no reconocidos |
| `invalid_scope` | 400 | En el intercambio, un scope distinto de `logs` |
| `unsupported_grant_type` | 400 | Grant desconocido, o intercambio de tokens deshabilitado |
| `temporarily_unavailable` | 429 / 503 | Límite de frecuencia (429) o tope de clientes en el registro (503) |
| `server_error` | 500 | Error interno (el detalle queda en el log, no en la respuesta) |

Otros errores específicos: `invalid_redirect_uri` en el registro, y en `/oauth/authorize` (por redirección, una vez validados cliente y `redirect_uri`) `unsupported_response_type`, `invalid_request`, `invalid_target` y `access_denied`.

> Un `429` cuyo cuerpo es **texto plano** (`Too Many Requests`) **no lo genera este módulo**: sus `429` son JSON con `error: temporarily_unavailable` (o una página HTML en `/oauth/authorize`). Si ves el de texto plano, viene de la plataforma (ver "Backend dormido" en [Consideraciones de despliegue](#consideraciones-de-despliegue)).

### Validación de tokens en la API (`validarJWT`)

`middlewares/validar-jwt.js` lee `x-token` y decide por el algoritmo de la cabecera:

| Algoritmo | Qué es | Cómo se valida |
|---|---|---|
| `HS256` | Token de sesión de siempre (login tradicional) | `SECRETORPRIVATEKEY`, con el algoritmo fijado explícitamente |
| `ES256` | Token intercambiado emitido por este servidor para el MCP | Firma con la clave pública, `iss`, `aud = OAUTH_BACKEND_AUDIENCE`, `exp` y scope `logs` |

Para los tokens `ES256` se aplica además **mínimo privilegio**: solo valen en las rutas de `OAUTH_EXCHANGE_ALLOWED_PATHS` (por defecto `/api/logs`, con límite de segmento exacto: `/api/logs-admin` no coincide) y reciben `403` en cualquier otra. En ambos casos se carga el usuario y se exige `estado: true`; `req.usuario` queda con la persona que inició sesión, así que `crearLog` guarda su `_id` como autor.

Para que la identidad llegue a los controladores, las rutas que deban aceptar al MCP (`POST` y `PUT` de `/api/logs`) **tienen que llevar `validarJWT`**. Si una ruta no lo lleva, el token se ignora y el controlador usa su valor de respaldo.

### Modelo de datos

Cuatro colecciones (modelos en `models/oauth.js`; nombres por defecto de Mongoose). **Los secretos se guardan hasheados (SHA-256)**: si se filtra la base de datos, no sirven. Todas caducan solas con un índice TTL sobre `expireAt` (MongoDB puede tardar hasta ~60 s en borrar; el código comprueba la caducidad por su cuenta).

| Colección (modelo) | Contenido | Caduca |
|---|---|---|
| `oauthclients` (`OAuthClient`) | `clientId`, `clientName`, `redirectUris` | 30 días sin uso |
| `oauthrequests` (`OAuthRequest`) | `txnHash`, `clientId`, `redirectUri`, `state`, `codeChallenge`, `attempts` | 10 minutos |
| `oauthcodes` (`OAuthCode`) | `codeHash`, `clientId`, `userId`, `redirectUri`, `codeChallenge`, `resource`, `scope` | 60 segundos |
| `oauthrefreshes` (`OAuthRefresh`) | `tokenHash`, `familyId`, `clientId`, `userId`, `used` | 30 días (por refresh) |

El usuario de MongoDB debe poder **crear índices** (Mongoose los crea al conectar); si no puede, los documentos no se limpiarán solos.

### Configuración

**Requisitos del modelo `Usuario`.** El Authorization Server reutiliza tu tabla de usuarios y solo lee estos campos: `correo`, `password` (hash de `bcryptjs`), `estado` (booleano) y `_id`. No añade campos ni modifica usuarios. Si cambias esos nombres, hay que ajustar `oauth/router.js`, `oauth/exchange.js` y `middlewares/validar-jwt.js`.

Variables del Authorization Server (obligatorias cuando `OAUTH_ENABLED=true`, salvo que se indique otra cosa):

| Variable | Descripción |
|---|---|
| `OAUTH_ENABLED` | `true` para activarlo |
| `OAUTH_ISSUER` | URL pública **fija** de este backend, `https`, sin ruta ni barra final (solo se permite `http` en `localhost`). Va en `iss` y en los metadatos. **Nunca se deriva de la petición** ni del header `Host` |
| `MCP_RESOURCE_URL` | URL pública **exacta** del endpoint del MCP, p. ej. `https://<tu-mcp>.onrender.com/mcp`. Es el `aud` de los access tokens y debe ser idéntica en el MCP. Es la URL del **MCP**, no la de este backend |
| `OAUTH_ALLOWED_EMAILS` | Lista separada por comas de los correos que pueden autorizar el MCP. **Denegar por defecto**: la tabla `Usuario` tiene más cuentas, que no deben poder usarlo |
| `OAUTH_PRIVATE_KEY` | Clave **privada** EC P-256 en PEM, en **una sola línea** con los saltos de línea escritos como `\n`. Secreta |
| `OAUTH_ALLOWED_REDIRECT_URIS` | Opcional. Redirect URIs `https` adicionales, separadas por comas (p. ej. el callback de ChatGPT) |
| `OAUTH_ACCESS_TTL_SECONDS` | Opcional. Vida del access token. Por defecto `1800`; rango 300–86400 |
| `OAUTH_REFRESH_TTL_SECONDS` | Opcional. Vida del refresh token. Por defecto `2592000`; rango 3600–7776000 |
| `OAUTH_EXCHANGE_CLIENT_SECRET` | Para el intercambio de tokens. Mínimo 32 caracteres, secreto, **idéntico en el MCP**. Si falta, el intercambio queda deshabilitado |
| `OAUTH_EXCHANGE_CLIENT_ID` | Opcional. Por defecto `mcp-resource-server`; idéntico en el MCP si lo cambias |
| `OAUTH_BACKEND_AUDIENCE` | Opcional. Por defecto `<OAUTH_ISSUER>/api`; idéntica en el MCP si la cambias |
| `OAUTH_EXCHANGE_TTL_SECONDS` | Opcional. Vida del token intercambiado. Por defecto `300`; rango 60–900 |
| `OAUTH_EXCHANGE_ALLOWED_PATHS` | Opcional. Rutas donde `validarJWT` acepta tokens intercambiados, separadas por comas. Por defecto `/api/logs` |

**Generar la clave de firma** (una sola vez):

```bash
node scripts/generate-oauth-key.js
```

Imprime dos bloques:

```
# ===== BACKEND (secreto) =====
OAUTH_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nMIGH...\n-----END PRIVATE KEY-----

# ===== MCP (público) =====
OAUTH_JWKS_JSON={"keys":[{"kty":"EC","crv":"P-256","x":"...","y":"...","kid":"...","use":"sig","alg":"ES256"}]}
```

- `OAUTH_PRIVATE_KEY` va **solo** en las variables de este backend.
- `OAUTH_JWKS_JSON` es público y va en las variables del MCP (así el MCP valida firmas sin consultar a este backend, que puede estar dormido). También se publica en `/.well-known/jwks.json`.
- No ejecutes el script de nuevo "por probar": cada ejecución genera otro par y el JWKS del MCP dejaría de coincidir.
- **Rotación:** genera un par nuevo, actualiza `OAUTH_PRIVATE_KEY` aquí y `OAUTH_JWKS_JSON` en el MCP a la vez. Se publica una sola clave, así que los tokens anteriores dejan de valer y habrá que volver a conectar.
- Nunca pegues la clave privada en chats, capturas, tickets ni repositorios, ni la imprimas en logs.

**Secreto de intercambio:**

```bash
node -p "require('crypto').randomBytes(32).toString('hex')"
```

Es un secreto **simétrico** compartido con el MCP: trátalo como una contraseña y rótalo cambiándolo en ambos servicios a la vez.

Valores que deben coincidir entre este backend y el MCP:

| Backend | MCP |
|---|---|
| `OAUTH_ISSUER` | `OAUTH_ISSUER` |
| `MCP_RESOURCE_URL` | `MCP_RESOURCE_URL` |
| `OAUTH_PRIVATE_KEY` (privada) | `OAUTH_JWKS_JSON` (pública correspondiente) |
| `OAUTH_EXCHANGE_CLIENT_SECRET` | `OAUTH_EXCHANGE_CLIENT_SECRET` |
| `OAUTH_EXCHANGE_CLIENT_ID` (si se cambia) | `OAUTH_EXCHANGE_CLIENT_ID` |
| `OAUTH_BACKEND_AUDIENCE` (si se cambia) | `OAUTH_BACKEND_AUDIENCE` |

Dependencias que usa el módulo: `express`, `cors`, `bcryptjs`, `jsonwebtoken`, `mongoose` y `express-rate-limit`.

### Medidas de seguridad

| Amenaza | Medida |
|---|---|
| Robo de código por redirección a un sitio ajeno (*open redirect*) | Lista blanca al registrar, coincidencia exacta al autorizar y, si no coincide, sin redirección |
| XSS en la página de login | Todo valor dinámico escapado, CSP y solo un `txn` en el formulario |
| Clickjacking | `frame-ancestors 'none'` y `X-Frame-Options: DENY` |
| Interceptación del código | PKCE `S256` obligatorio y verificado siempre; código de un solo uso, 60 s, atómico |
| Códigos y tokens predecibles o filtrados | `crypto.randomBytes` y almacenamiento hasheado |
| Fuerza bruta de contraseñas | Límite por IP, bloqueo por correo, 5 intentos por solicitud, `bcrypt` siempre, mensaje genérico |
| Enumeración de cuentas | Mismo mensaje y mismo coste de cálculo para "no existe", "inactivo", "contraseña incorrecta" y "no autorizado" |
| Cualquier usuario del sistema puede usar el MCP | Lista blanca `OAUTH_ALLOWED_EMAILS` |
| Robo de refresh token | Rotación y revocación de la familia ante reutilización; revalidación del usuario en cada refresh |
| Token válido pero de otro destinatario | `iss` y `aud` verificados; clave asimétrica (ES256) con `kid` |
| Algoritmo confundido (HS256 con clave pública) | Algoritmos fijados explícitamente en cada verificación |
| *Token passthrough* | Intercambio de tokens: token distinto, para el backend, de 5 minutos y mínimo privilegio |
| Uso del intercambio con un token robado | Autenticación del cliente (MCP) con secreto |
| Cuenta desactivada que sigue operando | El intercambio y el refresh revalidan al usuario |
| Issuer manipulable | `OAUTH_ISSUER` fijo por variable, nunca derivado de la petición |
| Registro masivo de clientes | 10 por hora por IP, máximo 200 clientes y caducidad a los 30 días sin uso |
| Entradas gigantes o repetidas | Parsers de 10 KB, longitudes máximas y rechazo de parámetros repetidos (`?a=1&a=2`) |

### Logs del módulo

| Línea | Significado |
|---|---|
| `[oauth] Deshabilitado ...` / `Authorization server habilitado` | Estado al arrancar |
| `[oauth] autorización concedida client=... user=...` | Login correcto y código emitido |
| `[oauth] login fallido ip=... client=...` | Credenciales incorrectas (no se registra el correo ni la contraseña) |
| `[oauth] tokens emitidos grant=authorization_code client=... user=...` | Primer canje de un cliente |
| `[oauth] tokens emitidos grant=refresh_token client=... user=...` | Un cliente refrescó el access token |
| `[oauth] reutilización de refresh token detectada, familia revocada ...` | Posible robo o reintento en paralelo |
| `[oauth] intercambio concedido user=... actor=...` | El MCP obtuvo un token para el backend |
| `[oauth] intercambio: credenciales de cliente incorrectas ip=...` | Secreto o `client_id` del MCP incorrectos |
| `[oauth] error interno: ...` | Excepción no controlada (responde `server_error`) |

El log `[entrada]` no muestra el `grant`: un refresh y un canje se distinguen por las líneas `tokens emitidos` de arriba (o, sin ellas, por un `POST /oauth/token` sin `autorización concedida` justo antes).

### Puesta en marcha

1. Instala la dependencia nueva: `npm i express-rate-limit`. Sube `package.json` y `package-lock.json` juntos.
2. Revisa que el `require` del modelo de usuario en `oauth/router.js`, `oauth/exchange.js` y `middlewares/validar-jwt.js` coincide **exactamente** con el nombre del archivo (en Linux, `Usuario.js` y `usuario.js` son distintos).
3. Genera las claves (`node scripts/generate-oauth-key.js`) y el secreto de intercambio.
4. Configura las variables en el servicio (ver tabla) y `OAUTH_ENABLED=true`. Despliega.
5. Comprueba en el navegador (el JWKS **no** debe contener el campo `d`):
   - `https://<tu-backend>/.well-known/oauth-authorization-server`
   - `https://<tu-backend>/.well-known/jwks.json`
6. Confirma que `routes/logs.js` aplica `validarJWT` en `POST` y `PUT`.
7. Despliega el MCP con las variables que corresponden y prueba.

**Prueba manual del flujo (PowerShell, usa `curl.exe`).** Despierta antes el backend si está en un plan que duerme.

```powershell
# 1) Registrar un cliente
Set-Content reg.json '{"client_name":"Prueba manual","redirect_uris":["http://localhost:53682/callback"],"token_endpoint_auth_method":"none"}'
curl.exe -i -X POST https://<tu-backend>/oauth/register -H "Content-Type: application/json" --data "@reg.json"

# 2) PKCE
node -e "const c=require('crypto');const v=c.randomBytes(32).toString('base64url');console.log('verifier='+v);console.log('challenge='+c.createHash('sha256').update(v).digest('base64url'))"
```

3. Abre en el navegador (sustituye `CLIENT_ID` y `CHALLENGE`). Tras el login, el navegador intentará ir a `localhost` y mostrará un error de conexión: es normal; el `code` está en la barra de direcciones. Ese `code` **lo crea el servidor tras un login correcto** y no aparece en la URL de la página de login.

```
https://<tu-backend>/oauth/authorize?response_type=code&client_id=CLIENT_ID&redirect_uri=http%3A%2F%2Flocalhost%3A53682%2Fcallback&code_challenge=CHALLENGE&code_challenge_method=S256&state=abc123&resource=https%3A%2F%2F<tu-mcp>%2Fmcp
```

```powershell
# 4) Canjear el código (en menos de 60 s)
curl.exe -X POST https://<tu-backend>/oauth/token -d "grant_type=authorization_code" -d "client_id=CLIENT_ID" -d "code=CODE" -d "redirect_uri=http://localhost:53682/callback" -d "code_verifier=VERIFIER"

# 5) Refrescar (consume el refresh token y emite uno nuevo)
curl.exe -i -X POST https://<tu-backend>/oauth/token -d "grant_type=refresh_token" -d "client_id=CLIENT_ID" -d "refresh_token=REFRESH_TOKEN"

# 6) Revocar (responde 200 vacío) y comprobar que ya no se puede refrescar (debe dar 400 invalid_grant)
curl.exe -i -X POST https://<tu-backend>/oauth/revoke -d "token=REFRESH_TOKEN" -d "client_id=CLIENT_ID"
```

> No pegues en chats ni tickets un `code` vigente, ni access ni refresh tokens. Borra el cliente de prueba al terminar.

**Comprobaciones de seguridad:**

| Prueba | Resultado esperado |
|---|---|
| Canjear el mismo código dos veces | La segunda da `invalid_grant` |
| Esperar más de 60 s antes de canjear | `invalid_grant` |
| Reenviar el formulario tras un login correcto (botón "atrás") | "Solicitud expirada" |
| 5 contraseñas incorrectas en la misma página | La siguiente da "Solicitud expirada" |
| 5 fallos con el mismo correo | Bloqueo de 15 minutos |
| Autorizar con una `redirect_uri` no registrada | Página de error, sin redirección |
| Autorizar sin `code_challenge` o con otro método | Redirección con `invalid_request` |
| Cuenta que no está en `OAUTH_ALLOWED_EMAILS` | El mismo "Credenciales incorrectas." |
| Reutilizar un refresh token ya usado | `invalid_grant` y familia revocada (aviso en logs) |
| Usar el token intercambiado en `/api/usuarios` | `403` |
| Usar el access token del MCP directamente contra la API | `401` (otra audiencia) |

**Cómo comprobar el intercambio** (en los logs del backend, alrededor de la llamada):

```
[entrada] ... POST /oauth/token  ua=steyner-mcp/1.0
[oauth] intercambio concedido user=<id> actor=mcp-resource-server
[entrada] ... POST /api/logs     ua=steyner-mcp/1.0
```

y **ningún** `POST /api/auth/login` del MCP: si aparece, el MCP está usando su cuenta de servicio. Si el usuario que inició sesión es el mismo de siempre, el campo `usuario` del log no cambia; para verlo variar hay que autorizar con otra cuenta de la lista blanca.

### Solución de problemas

| Síntoma | Causa probable / qué revisar |
|---|---|
| El backend no arranca: `[oauth] Falta la variable de entorno X` | Con `OAUTH_ENABLED=true` todas las obligatorias deben estar definidas; revisa también `OAUTH_PRIVATE_KEY` (una línea, con `\n`) |
| `/.well-known/...` devuelve el `index.html` o un `404` | `OAUTH_ENABLED` distinto de `true`, o el router OAuth está montado **después** del fallback `get('*')` |
| Los clientes basados en navegador fallan en el preflight | El router OAuth está montado después del CORS global |
| `invalid_redirect_uri` al registrar | La URI no está en la lista blanca: añádela en `OAUTH_ALLOWED_REDIRECT_URIS` |
| Página "Solicitud inválida" al autorizar | Cliente no registrado o caducado (30 días sin uso), o `redirect_uri` distinta de la registrada |
| Siempre "Credenciales incorrectas." | Correo fuera de `OAUTH_ALLOWED_EMAILS`, usuario inactivo, contraseña errónea o bloqueo de 15 minutos |
| `429` en el login, el registro o el token | Límites de frecuencia de este módulo, **o** el backend dormido (ver [Consideraciones de despliegue](#consideraciones-de-despliegue)) |
| `invalid_grant` al canjear | Código caducado (60 s) o ya usado, `redirect_uri` distinta, o `code_verifier` que no corresponde al `code_challenge` |
| `invalid_client` en `/oauth/token` | `client_id` desconocido o caducado. En el intercambio: `OAUTH_EXCHANGE_CLIENT_ID` o secreto distintos del MCP |
| `El intercambio de tokens no está habilitado` | Falta `OAUTH_EXCHANGE_CLIENT_SECRET` en este backend |
| `invalid_target` | `resource` o `audience` no coinciden con `MCP_RESOURCE_URL` / `OAUTH_BACKEND_AUDIENCE` |
| `403 Token no autorizado para esta ruta` | Un token intercambiado se usó fuera de `OAUTH_EXCHANGE_ALLOWED_PATHS` |
| `401 Token no válido` con un token intercambiado | Expirado, `aud` o scope incorrectos, intercambio deshabilitado o configuración OAuth sin cargar |
| El log muestra `ip=::1` | Falta `trust proxy`; los límites por IP y el log verían una IP interna |
| Aviso de `express-rate-limit` sobre `X-Forwarded-For` | Falta `trust proxy` |
| Los documentos de OAuth no se borran solos | El usuario de MongoDB no puede crear los índices TTL |

### Operación y mantenimiento

Consultas en `mongosh` sobre las colecciones por defecto que genera Mongoose (compruébalas con `show collections` si tu configuración difiere):

```js
// Ver los clientes registrados
db.oauthclients.find({}, { clientId: 1, clientName: 1, redirectUris: 1, expireAt: 1 })

// Eliminar un cliente (p. ej. uno de pruebas) y todos sus refresh tokens
db.oauthclients.deleteOne({ clientId: "mcp_XXXX" })
db.oauthrefreshes.deleteMany({ clientId: "mcp_XXXX" })
```

| Quiero... | Cómo | Efecto |
|---|---|---|
| Autorizar a otra persona | Añadir su correo a `OAUTH_ALLOWED_EMAILS` (separado por comas) y reiniciar el servicio | Puede iniciar sesión en el flujo OAuth. Las variables se leen al arrancar |
| Cortar a una persona | Poner su `estado` en `false` (afecta también al resto de la app) o quitar su correo de `OAUTH_ALLOWED_EMAILS` y reiniciar | Su siguiente refresh o intercambio falla con `invalid_grant`: el MCP deja de llegar al backend en unos 5 minutos como máximo. Su access token sigue valiendo ante el MCP hasta que caduque (30 minutos por defecto) |
| Cortar a una aplicación cliente | Borrar su cliente y sus refresh tokens (consulta de arriba) o `POST /oauth/revoke` con su refresh token | No puede autorizar ni refrescar; los access tokens ya emitidos caducan solos |
| Cortar todo el acceso | `db.oauthrefreshes.deleteMany({})` y `db.oauthclients.deleteMany({})`; para invalidar también los access tokens ya emitidos, rotar la clave de firma | Todos los clientes tienen que registrarse y autorizar de nuevo |
| Rotar el secreto de intercambio | Cambiarlo en el backend y en el MCP **a la vez** | Mientras difieran, el MCP recibe `invalid_client` en el intercambio |
| Rotar la clave de firma | Ver [Configuración](#configuración) | Los tokens anteriores dejan de valer; hay que volver a conectar |
| Limpiar datos de prueba | No hace falta | Los clientes, solicitudes, códigos y refresh tokens caducan solos |

### Limitaciones conocidas

- **Un solo recurso, un solo scope** (`mcp`) y una sola clave de firma publicada. Para varios MCP habría que aceptar una lista de recursos y poner el recurso solicitado en el `aud`.
- **Registro abierto con límites:** cualquiera puede registrar un cliente, pero solo con redirect URIs de la lista blanca o loopback, y sin credenciales de una cuenta autorizada no obtiene nada. Un cliente podría registrarse con un nombre engañoso (p. ej. "Claude"): la pantalla de consentimiento muestra el nombre (no verificado) y el destino; autoriza solo los flujos que tú iniciaste.
- Sin **CIMD**; los clientes que solo lo soporten (o requieran un cliente preregistrado) no podrán conectarse tal cual.
- Los **access tokens no se pueden revocar** (caducan solos; lo mitiga que el intercambio revalida al usuario cada 5 minutos).
- El **bloqueo por correo** y los **contadores de rate limiting** están en memoria: se reinician con el servicio y no se comparten entre instancias.
- Un cliente que reintente el refresh en paralelo puede provocar la revocación de la familia y forzar una reconexión.
- No se recuerda el consentimiento ni hay pantalla de gestión de aplicaciones autorizadas; el único modo de cortar el acceso de un cliente es `POST /oauth/revoke` o eliminar sus documentos.
- La clave de firma no se puede rotar sin invalidar los tokens existentes.
- Verificado con un conector OAuth real; **no** con ChatGPT ni con todas las versiones de los clientes (el uso del refresh y el descubrimiento del registro dependen de cada cliente).

---

## Estructura principal del proyecto

```text
steyner-server-node/
├── app.js
├── .env
├── .example.env
├── package.json
├── public/
├── models/
│   ├── server.js
│   ├── usuario.js
│   ├── producto.js
│   ├── categoria.js
│   ├── log.js
│   ├── oauth.js                  # OAuthClient, OAuthRequest, OAuthCode, OAuthRefresh
│   └── index.js
├── routes/
│   ├── auth.js
│   ├── usuarios.js
│   ├── productos.js
│   ├── categorias.js
│   ├── logs.js
│   ├── uploads.js
│   ├── upload-route.js
│   ├── leads.js
│   ├── pocs.js
│   ├── webhooks-wsp.js
│   └── buscar.js
├── controllers/
│   ├── auth.js
│   ├── usuarios.js
│   ├── productos.js
│   ├── categorias.js
│   ├── logs.js
│   ├── uploads.js
│   ├── webhooks-wsp.js
│   └── ...
├── middlewares/
│   ├── validar-jwt.js            # HS256 (sesión) y ES256 (token intercambiado del MCP)
│   ├── validar-campos.js
│   ├── validar-roles.js
│   └── validar-archivo.js
├── helpers/
│   ├── generar-jwt.js
│   ├── google-verify.js
│   ├── db-validators.js
│   ├── subir-archivo.js
│   └── upload-service.js
├── database/
│   └── config.js
├── oauth/                        # Authorization Server
│   ├── index.js                  # interruptor OAUTH_ENABLED
│   ├── config.js                 # variables, clave de firma, kid, JWKS
│   ├── helpers.js                # redirect URIs, PKCE, páginas HTML, bloqueo por intentos
│   ├── router.js                 # metadatos, register, authorize, token, revoke
│   └── exchange.js               # intercambio de tokens (RFC 8693) y verificación del token intercambiado
├── scripts/
│   └── generate-oauth-key.js     # genera la clave EC P-256 y el JWKS
├── integrations/
└── uploads-v2/
```

## Modelo de autenticación

El sistema usa tres tipos de token:

1. **JWT interno del backend** (`HS256`)
   - Emitido en `helpers/generar-jwt.js`, firmado con `SECRETORPRIVATEKEY`, dura 4 horas.
   - Autenticación tradicional de la API (cabecera `x-token`).

2. **Access token OAuth** (`ES256`, `aud` = MCP, scope `mcp`)
   - Lo emite el Authorization Server tras el login del usuario.
   - **Solo sirve contra el MCP**: la API lo rechaza (otra audiencia).

3. **Token intercambiado** (`ES256`, `aud` = API, scope `logs`, 5 minutos)
   - Lo emite el Authorization Server al MCP a cambio del access token del usuario.
   - Lleva la identidad del usuario y el claim `act` del MCP. Solo vale en las rutas permitidas.

El middleware `validarJWT` soporta los modelos 1 y 3 en la API; el 2 nunca debe llegar a la API. Esto permite que la autenticación tradicional y el acceso delegado del MCP convivan sin tocar los controladores.

## Seguridad y buenas prácticas

Capa REST y general:

- CORS configurado con dominios permitidos
- Validación de campos con `express-validator`
- Middleware de JWT por ruta
- Verificación de roles y permisos
- Control de carga de archivos y directorios temporales
- `trust proxy` configurado para ver la IP real detrás de Render y Cloudflare

Capa OAuth (detalle en [Medidas de seguridad](#medidas-de-seguridad)):

- PKCE obligatorio, redirect URIs con lista blanca y coincidencia exacta
- Lista blanca de correos, bloqueo y límites de intentos, rate limiting en los endpoints OAuth
- Tokens `ES256` con `iss`/`aud`/scope, refresh con rotación e intercambio de tokens con mínimo privilegio
- Secretos hasheados en la base de datos

Recomendaciones operativas:

- `GET /api/logs` es público (no exige token): decide si es intencional y qué datos expone.
- No subas `.env` al repositorio y no compartas capturas con claves.

## Variables de entorno

La plantilla base está en `.example.env`.

```env
PORT=8080
MONGODB_CNN=
SECRETORPRIVATEKEY=
GOOGLE_CLIENT_ID=
GOOGLE_SECRET_ID=
CLOUDINARY_URL=

# --- Authorization Server (solo si OAUTH_ENABLED=true) ---
OAUTH_ENABLED=true
OAUTH_ISSUER=https://tu-backend.com
MCP_RESOURCE_URL=https://tu-mcp.com/mcp
OAUTH_ALLOWED_EMAILS=usuario@dominio.com
OAUTH_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----

# Intercambio de tokens (si no se define, queda deshabilitado)
OAUTH_EXCHANGE_CLIENT_SECRET=
# OAUTH_EXCHANGE_CLIENT_ID=mcp-resource-server
# OAUTH_BACKEND_AUDIENCE=https://tu-backend.com/api
# OAUTH_EXCHANGE_TTL_SECONDS=300
# OAUTH_EXCHANGE_ALLOWED_PATHS=/api/logs

# Opcionales
# OAUTH_ALLOWED_REDIRECT_URIS=https://...
# OAUTH_ACCESS_TTL_SECONDS=1800
# OAUTH_REFRESH_TTL_SECONDS=2592000
```

Notas:

- `MCP_RESOURCE_URL` es la URL pública del **MCP** (`.../mcp`), no la del backend.
- `OAUTH_PRIVATE_KEY` va en **una sola línea**, con los saltos de línea escritos como `\n` (es lo que imprime `scripts/generate-oauth-key.js`).
- Detalle de cada variable y de cuáles deben coincidir con el MCP: [Configuración](#configuración).

## Consideraciones de despliegue

- **Backend dormido (plan gratuito de Render).** Los servicios gratuitos se suspenden tras unos 15 minutos sin tráfico. Con el backend dormido, las peticiones que salen **desde otro servicio de Render** (como el MCP) reciben un `429 Too Many Requests` del borde de la plataforma y **no lo despiertan**, mientras que un navegador o tu PC sí lo despiertan. No lo causa el código de este backend: ni siquiera aparecen en sus logs. Como el flujo OAuth pasa por aquí (autorizar, canjear, refrescar, intercambiar), conviene mantenerlo despierto: un plan sin suspensión, o un monitor **externo** (no un servicio de Render) que consulte una ruta ligera como `/health`.
- **`trust proxy`:** detrás de Render y Cloudflare, `x-forwarded-for` trae tres saltos más el proxy local. Con `trust proxy` en `3`, `req.ip` es la IP real del cliente. Compruébalo en el log `[entrada]`: `ip=` debe mostrar la IP del cliente y no `::1`. Es importante porque los límites de frecuencia se calculan por IP.
- **Orden de despliegue:** primero este backend (con el Authorization Server y el secreto de intercambio activos) y después el MCP.
- **Índices TTL:** el usuario de MongoDB debe poder crear índices.
- **Rutas con mayúsculas:** Linux distingue `Usuario.js` de `usuario.js` en los `require`.

## Casos de uso del proyecto

El backend sirve como:

- API de autenticación y gestión de usuarios
- Sistema de catálogo de productos y categorías
- Registro y consulta de logs de aplicación
- Gestión de archivos multimedia y uploads
- Integración con proveedores externos y webhooks
- Autoridad OAuth para clientes MCP o aplicaciones externas

## Resumen y recomendaciones

Este proyecto combina un backend web tradicional y una capa REST con un Authorization Server OAuth 2.1 propio:

- **WebServer:** expone la aplicación y la infraestructura HTTP.
- **RestServer:** ofrece la lógica de negocio del sistema.
- **Authorization Server:** controla la autorización externa, especialmente para clientes MCP, y permite que el MCP actúe con la identidad de cada usuario mediante intercambio de tokens.

Para trabajar con este proyecto, conviene entender cuatro puntos:

1. `app.js` es el punto de entrada.
2. `models/server.js` es el contenedor principal del servidor y define el orden de los middlewares (el router OAuth va antes de CORS y antes del fallback de la SPA).
3. `oauth/` es una capa de autorización completa, aunque se activa con un interruptor (`OAUTH_ENABLED`). `oauth/config.js` es el punto único de configuración y `oauth/router.js` implementa los endpoints.
4. `middlewares/validar-jwt.js` es donde se decide qué tokens acepta la API y en qué rutas.

Si se quiere mantener y extender el sistema, la evolución natural es seguir separando cada capa (negocio, seguridad y protocolos externos) y, para la capa OAuth, valorar una librería madura o un proveedor gestionado si el alcance crece más allá de este caso de uso.

Pendientes razonables de la capa OAuth: probar con una segunda cuenta de la lista blanca (para ver variar el `usuario` de los logs), verificar el flujo con ChatGPT, soportar varios recursos, y decidir si `GET /api/logs` debe seguir siendo público.