## 📚 Diccionario de Transferencia y Codificación de Archivos

Este diccionario te ayudará a diferenciar los tipos de datos y los protocolos de transmisión, esenciales para diseñar arquitecturas de transferencia de archivos.

| Término                      | Definición y Contexto                                                                                                                                                                     | Similitud/Diferencia Clave                                                                                                             |
| :--------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------- |
| **Binario**                  | La representación fundamental de datos (secuencia de 1s y 0s) que no es legible como texto (ej., imágenes, videos, ejecutables).                                                          | **Es la forma nativa de los archivos.** La mayoría de los otros términos son envoltorios o representaciones de estos datos.            |
| **Blob**                     | (Binary Large Object). Tipo de dato utilizado en sistemas (ej., Apex, SQL, navegadores) para almacenar datos binarios grandes e inmutables.                                               | **Similitud con Buffer:** Ambos contienen bytes binarios. `Blob` es un tipo de dato, `Buffer` es un objeto de manipulación en Node.js. |
| **Buffer**                   | Región de memoria temporal en Node.js para almacenar datos binarios mientras se transfieren. Es el contenedor que utiliza el _Stream_.                                                    | **Función:** El _Buffer_ es el contenedor; el _Stream_ es el mecanismo de movimiento.                                                  |
| **Stream**                   | (Flujo). Mecanismo que procesa datos en pequeños bloques (`Buffer`s) a medida que llegan, en lugar de cargarlos todos a la vez.                                                           | **Ventaja:** Fundamental para manejar archivos grandes sin saturar la memoria (Heap Size).                                             |
| **Base64**                   | Esquema de codificación que representa datos binarios en un formato de texto ASCII (letras/números/símbolos). Se usa para incrustar binarios en entornos solo de texto (ej., JSON, URLs). | **Desventaja:** Aumenta el tamaño del archivo binario original en **aprox. 33%**.                                                      |
| **application/octet-stream** | **MIME Type** genérico que indica que el cuerpo de la petición contiene datos binarios crudos.                                                                                            | **Uso:** Ideal para la subida binaria pura cuando solo se envía el archivo (ej., _streaming_ simple).                                  |
| **multipart/form-data**      | **MIME Type** especializado para enviar datos de múltiples tipos (texto + binario) en una sola petición HTTP, utilizando _delimitadores_ (boundaries).                                    | **Uso:** Obligatorio cuando se necesita enviar metadata de texto (`uploadId`, `chunkIndex`) junto con los datos binarios del _chunk_.  |
| **Chunking**                 | La práctica de dividir un archivo grande en pequeños fragmentos (`chunks`) para evitar superar límites de tiempo, memoria (Heap Size) y permitir la reanudación de la subida.             | **Estrategia:** La base de una transferencia de archivos escalable y resiliente.                                                       |

---

## 🧠 Consideraciones Arquitectónicas Clave (Apex vs. Servidor)

El mayor desafío en la transferencia de archivos desde sistemas restrictivos como **Salesforce Apex** es el límite de memoria (**Heap Size**), que es la razón principal para evitar ciertas operaciones.

🎯 Conclusión Arquitectónica Final
La necesidad de recurrir a la codificación Base64 solo para poder usar substring() confirma que Apex no está diseñado para esta tarea in-memory.

Si tu archivo es grande:

Mantén tu solución actual de chunking en el lado del cliente (Navegador/App Externa) o en un Proxy Node.js (opción ya discutida).

En Apex, no cargues el VersionData completo. Si la subida debe originarse en Salesforce, debes asegurarte de que el archivo ya esté dividido en fragmentos persistentes (por ejemplo, guardados en objetos personalizados o un almacén externo) antes de que la transacción de envío comience.
