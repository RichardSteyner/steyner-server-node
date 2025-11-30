const fs = require('fs');
const path = require('path');
const axios = require('axios'); // Asegúrate de tener axios: npm install axios
const FormData = require('form-data');

// CONFIGURACIÓN
const FILE_TO_UPLOAD = path.join(__dirname, 'CURRICULUM VITAE 2025 (english).pdf'); // Pon aquí un archivo real que tengas
const API_URL = 'http://localhost:8080/api/uploads-v2/session-upload';
const CHUNK_SIZE = 1 * 1024 * 1024; // 1MB por chunk

async function uploadFile() {
  if (!fs.existsSync(FILE_TO_UPLOAD)) {
    console.error('❌ El archivo de prueba no existe:', FILE_TO_UPLOAD);
    return;
  }

  const stats = fs.statSync(FILE_TO_UPLOAD);
  const fileSize = stats.size;
  const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);
  const fileName = path.basename(FILE_TO_UPLOAD);

  console.log(`📦 Iniciando subida: ${fileName} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`🔢 Total chunks: ${totalChunks}`);

  try {
    // 1. INICIAR SESIÓN
    const initResponse = await axios.post(`${API_URL}/init`, {
      filename: fileName,
      fileSize: fileSize,
      totalChunks: totalChunks,
      mimeType: 'application/octet-stream' // Puedes detectar el real si quieres
    });

    const { uploadId } = initResponse.data.data;
    console.log(`✨ Sesión iniciada. ID: ${uploadId}`);

    // 2. SUBIR CHUNKS
    const fileBuffer = fs.readFileSync(FILE_TO_UPLOAD);
    
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, fileSize);
      const chunkBuffer = fileBuffer.subarray(start, end);

      const form = new FormData();
      // El orden importa para Multer: Campos de texto primero
      form.append('uploadId', uploadId);
      form.append('chunkIndex', i.toString()); 
      form.append('chunk', chunkBuffer, { filename: 'blob' });

      await axios.post(`${API_URL}/chunk`, form, {
        headers: form.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });

      // Barra de progreso simple
      const percent = Math.round(((i + 1) / totalChunks) * 100);
      process.stdout.write(`\r🚀 Subiendo: ${percent}% (Chunk ${i + 1}/${totalChunks})`);
    }

    console.log('\n✅ Todos los chunks subidos.');

    // 3. COMPLETAR
    console.log('🔨 Solicitando ensamblaje...');
    const completeResponse = await axios.post(`${API_URL}/complete`, {
      uploadId: uploadId
    });

    console.log('🎉 ¡ÉXITO! Archivo guardado en:', completeResponse.data.data.path);

  } catch (error) {
    console.error('\n❌ Error:', error.response ? error.response.data : error.message);
  }
}

uploadFile();