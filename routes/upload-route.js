const { Router } = require('express');
const multer = require('multer');
const uploadController = require('../controllers/uploads-controller');


const router = Router();

// --- Configuración Multer (Middleware para Versión de recibir archivo completo) ---
// Usamos memoryStorage para tener el Buffer disponible en el controlador
// Esto permite que el servicio decida cómo escribirlo (Best Practice para control total)
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 } // Límite de 50MB por ejemplo
});

/**
 * RUTA 1: Subida de archivo completo (Standard Multipart)
 * Uso: POST /api/upload-whole
 * Body: Form-Data, Key: 'file'
 */
router.post('/upload-whole', upload.single('file'), uploadController.uploadWhole);


/**
 * RUTA 2: Subida por Chunks (Streaming binario)
 * Uso: POST /api/upload-chunk
 * Headers: Content-Type: application/octet-stream, x-file-name: video.mp4
 * Body: Binary Data (Raw)
 * Nota: No usamos Multer aquí porque queremos el stream crudo (req)
 */
router.post('/upload-chunk', uploadController.uploadChunk);

module.exports = router;