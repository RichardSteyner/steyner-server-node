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
}

module.exports = new UploadController();