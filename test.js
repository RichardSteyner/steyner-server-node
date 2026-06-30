require('dotenv').config();
const sfService = require('./integrations/SalesforceIngestionService');

try {
    sfService.add({
        keyCode: "ERR_404",
        title: "Error de Conexión",
        type: "Error",
        subType: "Network",
        description: "Fallo al conectar con el servidor de base de datos remoto.",
        solution: "Verificar las credenciales y el estado de la red."
    });
} catch (err) {
    console.error('Error al agregar registro a la cola de Salesforce:', err);
}

sfService._getAccessTokenDataCloud().then( token => {
    console.log('Token SF: ' + token);
}).catch(err => {
    console.error('Error: ' + err);
})


/*
sfService.flush().then(() => { 
    console.log('Datos intentados de enviar a Salesforce');
}).catch(err => {
    console.error('Error enviando datos a Salesforce:', err);
});

try {
    console.log(sfService._buildJwtAssertion());
} catch (error) {
    console.error(error);
}

sfService._getAccessTokenDataCloud().then(token => {
    console.log('Token de acceso obtenido:', token);
}).catch(err => {
    console.error('Error obteniendo token de acceso:', err);
});

console.log(process.cwd());*/