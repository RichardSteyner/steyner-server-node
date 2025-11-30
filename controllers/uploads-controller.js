const { uploadService } = require('../helpers');
const { response } = require('express');

class UploadController {
  
  // Controlador para Versión 1: Archivo Entero
  async uploadWhole(req, res = response) {
    try {
      if (!req.file) {
        return res.status(400).json({ 
          success: false, 
          error: 'No se envió ningún archivo.' 
        });
      }

      // Llamamos al servicio pasando solo los datos necesarios
      const result = await uploadService.saveWholeFile(req.file);

      return res.status(201).json({
        success: true,
        message: 'Archivo entero subido exitosamente',
        data: result
      });

    } catch (error) {
      console.error('Error en uploadWhole:', error);
      return res.status(500).json({ 
        success: false, 
        error: 'Error interno al procesar el archivo.' 
      });
    }
  }

  // Controlador para Versión 2: Chunks
  async uploadChunk(req, res = response) {
    try {
      // Esperamos el nombre del archivo en los headers o query params para saber a dónde hacer append
      const filename = req.headers['x-file-name'] || req.query.filename;

      if (!filename) {
        return res.status(400).json({ 
          success: false, 
          error: 'Debe especificar el nombre del archivo (Header: x-file-name)' 
        });
      }

      // req es un Readable Stream en Node.js. 
      // Pasamos el stream directamente al servicio para que lo escriba mientras llega.
      const result = await uploadService.appendChunk(filename, req);

      return res.status(200).json({
        success: true,
        message: 'Chunk recibido y procesado',
        data: result
      });

    } catch (error) {
      console.error('Error en uploadChunk:', error);
      return res.status(500).json({ 
        success: false, 
        error: 'Error al procesar el chunk.' 
      });
    }
  }


  // 1. Iniciar
  async initSession(req, res = response) {
    try {
      const { filename, fileSize, totalChunks, mimeType } = req.body;
      if (!filename || !fileSize || !totalChunks) {
		console.log('Datos incompletos en initSession:', req.body);
        return res.status(400).json({ success: false, error: 'Faltan datos requeridos' });
      }

      const result = await uploadService.initSession({ filename, fileSize, totalChunks, mimeType });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
		  console.error('Error en initSession:', error);		
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // 2. Recibir Chunk
  async uploadSessionChunk(req, res) {
    try {
      // req.file viene de Multer configurado en app.js
      const { uploadId, chunkIndex, hash } = req.body;
      
      if (!req.file || !uploadId || chunkIndex === undefined) {
        return res.status(400).json({ success: false, error: 'Datos incompletos' });
      }

      const status = await uploadService.processChunk({ 
        uploadId, 
        chunkIndex, 
        file: req.file, 
        hash 
      });

      res.status(200).json({ success: true, data: status });

    } catch (error) {
      // Manejo de errores específicos
      if (error.message === 'SESSION_NOT_FOUND') return res.status(404).json({ success: false, error: 'Sesión no existe o expiró' });
      if (error.message === 'HASH_MISMATCH') return res.status(400).json({ success: false, error: 'Chunk corrupto (Hash mismatch)' });
      
      console.error(error);
      res.status(500).json({ success: false, error: 'Error interno' });
    }
  }

  // 3. Completar
  async completeSession(req, res) {
    try {
      const { uploadId, finalHash } = req.body;
      if (!uploadId) return res.status(400).json({ success: false, error: 'Falta uploadId' });

      const result = await uploadService.completeUpload(uploadId, finalHash);
      res.status(200).json({ success: true, message: 'Archivo ensamblado correctamente', data: result });

    } catch (error) {
      if (error.message === 'MISSING_CHUNKS') return res.status(400).json({ success: false, error: 'Faltan chunks por subir' });
      if (error.message === 'FINAL_HASH_MISMATCH') return res.status(400).json({ success: false, error: 'Archivo final corrupto' });
      
      console.error(error);
      res.status(500).json({ success: false, error: 'Error al ensamblar archivo' });
    }
  }
}

module.exports = new UploadController();