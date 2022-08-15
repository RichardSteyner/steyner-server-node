const { Schema, model } = require('mongoose');

const LogSchema = Schema({
    titulo: {
        type: String,
        required: [true, 'El titulo es obligatorio'],
        unique: true
    },
    tipo: {
        type: String,
        required: [true, 'El tipo es obligatorio']
    },
    detalleTipo: {
        type: String,
        required: [true, 'El detalle tipo es obligatorio']
    },
    descripcion: {
        type: String,
        required: [true, 'La descripcion es obligatoria']
    },
    solucion: {
        type: String,
        required: [true, 'La solucion es obligatoria']
    },
    codigoClave: {
        type: String
    },
    vigencia: {
        type: Boolean,
        default: true,
        required: true
    },
    usuario: {
        type: Schema.Types.ObjectId,
        ref: 'Usuario',
        required: true
    }
});


LogSchema.methods.toJSON = function() {
    const { __v, ...data  } = this.toObject();
    return data;
}


module.exports = model( 'Log', LogSchema );
