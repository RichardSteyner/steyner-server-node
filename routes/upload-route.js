const { Router } = require('express');
const fs = require('fs');
const multer = require('multer');
const path = require('path');
const uploadController = require('../controllers/uploads-controller');


const router = Router();

// --- CONFIG MULTER 1: Simple (Para /api/upload-whole) ---
const storageSimple = multer.memoryStorage();
const uploadSimple = multer({ storage: storageSimple });

// --- CONFIG MULTER 2: Session Based (Para /api/session-upload/chunk) ---
// Guardamos el chunk directamente en disco en la carpeta temp del ID
const storageSession = multer.diskStorage({
  destination: (req, file, cb) => {
    const { uploadId } = req.body;
    if (!uploadId) {
        return cb(new Error('No uploadId provided in body'), null);
    }
    // La carpeta ya debe haber sido creada por el servicio en /init
    const chunkDir = path.join(__dirname, '../uploads-v2/chunks', uploadId);
    
    // Verificación defensiva por si la carpeta no existe (ej. reinicio servidor)
    if (!fs.existsSync(chunkDir)) {
        return cb(new Error('Session directory not found'), null);
    }
    cb(null, chunkDir);
  },
  filename: (req, file, cb) => {
    const { chunkIndex } = req.body;
    // Guardamos como chunk-0, chunk-1, etc.
    cb(null, `chunk-${chunkIndex}`);
  }
});

const uploadSession = multer({ 
    storage: storageSession,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB por chunk max
});

/**
 * RUTA 1: Subida de archivo completo (Standard Multipart)
 * Uso: POST /api/upload-whole
 * Body: Form-Data, Key: 'file'
 */
router.post('/upload-whole', uploadSimple.single('file'), uploadController.uploadWhole);


/**
 * RUTA 2: Subida por Chunks (Streaming binario)
 * Uso: POST /api/upload-chunk
 * Headers: Content-Type: application/octet-stream, x-file-name: video.mp4
 * Body: Binary Data (Raw)
 * Nota: No usamos Multer aquí porque queremos el stream crudo (req)
 */
router.post('/upload-chunk', uploadController.uploadChunk);


// 2. NUEVAS Rutas Robustas (Session Based)
router.post('/session-upload/init', uploadController.initSession);

// IMPORTANTE: El cliente debe enviar 'uploadId' y 'chunkIndex' ANTES que el 'file' en el FormData
// para que Multer pueda leer el body en la función destination.
router.post('/session-upload/chunk', uploadSession.single('chunk'), (req, res) => {
    uploadController.uploadSessionChunk(req, res);
});

router.post('/session-upload/complete', (req, res) => {
    uploadController.completeSession(req, res);
});

module.exports = router;