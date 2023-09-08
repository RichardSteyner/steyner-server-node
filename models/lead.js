
const { Schema, model } = require('mongoose');

const LeadSchema = Schema({
    name: {
        type: String,
        required: [true, 'El nombre es obligatorio']
    },
    email: {
        type: String,
        required: [true, 'El correo es obligatorio'],
        unique: true
    },
    category: {
        type: String,
        required: true,
        default: 'FREE',
        emun: ['FREE', 'STARTUP', 'ENTERPRISE']
    },
    comments: {
        type: String
    },
    deleted: {
        type: Boolean,
        default: false
    },
    createDate: {
        type: Date,
        default: new Date()
    },
    modifiedDate: {
        type: Date,
        default: new Date()
    },
});



LeadSchema.methods.toJSON = function() {
    const { __v, _id, ...lead  } = this.toObject();
    lead.uid = _id;
    return lead;
}

module.exports = model( 'Lead', LeadSchema );