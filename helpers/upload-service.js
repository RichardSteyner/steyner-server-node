const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises'); // Node.js v15+ para streams asíncronos

class UploadService {
  constructor() {
    this.uploadDir = path.join(__dirname, '../uploads-v2');
	this.chunksDir = path.join(__dirname, '../uploads-v2/chunks');
    // Aseguramos que la carpeta exista al iniciar
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }

	// Store en memoria (NOTA: En producción usar Redis)
    this.uploadSessions = new Map();
    
    // Limpieza automática cada hora
    setInterval(() => this.cleanupExpiredSessions(), 60 * 60 * 1000);
  }

  /**
   * VERSIÓN Archivo Entero
   * Mueve el archivo procesado por Multer o escribe un buffer directo.
   */
  async saveWholeFile(fileObject) {
    const targetPath = path.join(this.uploadDir, `full-${Date.now()}-${fileObject.originalname}`);
    
    // Si usamos memoryStorage de Multer, tenemos fileObject.buffer
    // Escribimos el archivo de una sola vez
    await fs.promises.writeFile(targetPath, fileObject.buffer);
    
    return {
      filename: fileObject.originalname,
      path: targetPath,
      size: fileObject.size
    };
  }

  /**
   * VERSIÓN 2: Por Chunks (Fragmentos)
   * Recibe un stream de lectura (el chunk) y lo añade al final del archivo.
   * Utiliza flags: 'a' (append) para no sobrescribir.
   */
  async appendChunk(filename, fileStream) {
    const targetPath = path.join(this.uploadDir, `chunked-${filename}`);
    
    // Creamos un stream de escritura en modo 'append'
    const writeStream = fs.createWriteStream(targetPath, { flags: 'a' });

    // Usamos pipeline para manejar el flujo de datos de manera segura y eficiente
    await pipeline(fileStream, writeStream);

    // Obtenemos el tamaño actual del archivo para devolverlo
    const stats = await fs.promises.stat(targetPath);
    
    return {
      filename: filename,
      currentSize: stats.size,
      status: 'chunk_appended'
    };
  }

  // --- Lógica de Sesión ---
  async initSession({ filename, fileSize, totalChunks, mimeType }) {
    const uploadId = crypto.randomBytes(16).toString('hex');
    const safeFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');

    const sessionData = {
      uploadId,
      filename: safeFilename,
      fileSize,
      totalChunks: parseInt(totalChunks),
      mimeType: mimeType || 'application/octet-stream',
      receivedChunks: new Set(), // Set para evitar duplicados
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24h
    };

    this.uploadSessions.set(uploadId, sessionData);
    
    // Crear carpeta específica para este upload
    await fs.promises.mkdir(path.join(this.chunksDir, uploadId), { recursive: true });

    return { uploadId, expiresAt: sessionData.expiresAt };
  }

  // --- Procesar Chunk Individual ---
  async processChunk({ uploadId, chunkIndex, file, hash }) {
    const session = this.uploadSessions.get(uploadId);
    if (!session) throw new Error('SESSION_NOT_FOUND');

    // Validar hash si existe (Integridad de datos)
    if (hash) {
      const fileBuffer = await fs.readFile(file.path);
      const calculatedHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      if (calculatedHash !== hash) {
        await fs.unlink(file.path).catch(() => {}); // Borrar chunk corrupto
        throw new Error('HASH_MISMATCH');
      }
    }

    // Actualizar sesión
    session.receivedChunks.add(parseInt(chunkIndex));
    
    return {
      received: session.receivedChunks.size,
      total: session.totalChunks,
      progress: (session.receivedChunks.size / session.totalChunks) * 100
    };
  }

  // --- Finalizar y Ensamblar ---
  async completeUpload(uploadId, finalHash) {
    const session = this.uploadSessions.get(uploadId);
    if (!session) throw new Error('SESSION_NOT_FOUND');

    if (session.receivedChunks.size !== session.totalChunks) {
      throw new Error('MISSING_CHUNKS');
    }

    const sessionChunksDir = path.join(this.chunksDir, uploadId);
    const finalPath = path.join(this.uploadDir, `${Date.now()}-${session.filename}`);
    const writeStream = fs.createWriteStream(finalPath);

    // Iterar y escribir en orden (0, 1, 2...)
    for (let i = 0; i < session.totalChunks; i++) {
      const chunkPath = path.join(sessionChunksDir, `chunk-${i}`);
      // Validamos que el chunk físico exista
      if (!fs.existsSync(chunkPath)) throw new Error(`CHUNK_FILE_MISSING: ${i}`);
      
      const chunkBuffer = await fs.promises.readFile(chunkPath);
      writeStream.write(chunkBuffer);
    }
    
    writeStream.end();

    // Esperar a que termine de escribir el archivo final
    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    // Validar hash final si se envió
    if (finalHash) {
        const finalBuffer = await fs.promises.readFile(finalPath);
        const calculatedHash = crypto.createHash('sha256').update(finalBuffer).digest('hex');
        if (calculatedHash !== finalHash) {
            await fs.promises.unlink(finalPath).catch(() => {});
            throw new Error('FINAL_HASH_MISMATCH');
        }
    }

    // Limpieza
    await fs.promises.rm(sessionChunksDir, { recursive: true, force: true });
    this.uploadSessions.delete(uploadId);

    const stats = await fs.promises.stat(finalPath);
    return {
      filename: session.filename,
      path: finalPath,
      size: stats.size
    };
  }

  // --- Limpieza de Cron ---
  async cleanupExpiredSessions() {
    const now = new Date();
    for (const [uploadId, session] of this.uploadSessions.entries()) {
      if (session.expiresAt < now) {
        const dir = path.join(this.chunksDir, uploadId);
        await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
        this.uploadSessions.delete(uploadId);
        console.log(`🧹 Sesión expirada limpiada: ${uploadId}`);
      }
    }
  }
}

module.exports = new UploadService();