const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises'); // Node.js v15+ para streams asíncronos

class UploadService {
  constructor() {
    this.uploadDir = path.join(__dirname, '../uploads-v2');
    // Aseguramos que la carpeta exista al iniciar
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
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
}

module.exports = new UploadService();