const { response } = require('express');
const { Log, Usuario } = require('../models');


const obtenerLogs = async(req, res = response ) => {

    try {

        const { limite = 10, desde = 0, sort = "titulo", order = "desc" } = req.query;
        const query = { vigencia: true };

        const [ total, logs ] = await Promise.all([
            Log.countDocuments(query),
            Log.find(query)
                .populate('usuario', 'nombre')
                .skip( Number( desde ) )
                .limit(Number( limite ))
				.sort({ [sort]: order })
        ]);

        res.json({
            total,
            logs
        });

    } catch(err) {
        console.error(err);
        res.status(500).json({ msj: 'Contacte con su administrador' });        
    }

}

const obtenerLog = async(req, res = response ) => {

    try {

        const { id } = req.params;
        const log = await Log.findById( id )
                                .populate('usuario', 'nombre');

        res.json( log );

    } catch(err) {
        console.error(err);
        res.status(500).json({ msj: 'Contacte con su administrador' });        
    }

}

const crearLog = async(req, res = response ) => {

    try {

        const { vigencia, usuario, ...body } = req.body;

        const titulo = body.titulo.toUpperCase();

        const logDB = await Log.findOne({ titulo });

        if ( logDB ) {
            return res.status(400).json({
                msg: `El log ${ logDB.titulo }, ya existe`
            });
        }

        let idUsuario;
        if(req.usuario) {
            idUsuario = req.usuario._id;
        } else {
            const usuarioDB = await Usuario.findOne({correo: 'steyner.urupeque.s@gmail.com'});
            idUsuario = usuarioDB._id;
        }

        // Generar la data a guardar
        const data = {
            ...body,
            titulo,
            usuario: idUsuario
        }

        const log = new Log( data );

        // Guardar DB
        await log.save();

        res.status(201).json(log);

    } catch(err) {
        console.error(err);
        res.status(500).json({ msj: 'Contacte con su administrador' });        
    }

}

const actualizarLog = async( req, res = response ) => {

    try {

        const { id } = req.params;
        const { vigencia, usuario, ...data } = req.body;

        if( data.titulo ) {
            data.titulo  = data.titulo.toUpperCase();
        }

        //data.usuario = req.usuario._id;

        const log = await Log.findByIdAndUpdate(id, data, { new: true });

        res.json( log );

    } catch(err) {
        console.error(err);
        res.status(500).json({ msj: 'Contacte con su administrador' });        
    }

}

const borrarLog = async(req, res =response ) => {

    try {

        const { id } = req.params;
        const logBorrado = await Log.findByIdAndUpdate( id, { vigencia: false }, {new: true });

        res.json( logBorrado );

    } catch(err) {
        console.error(err);
        res.status(500).json({ msj: 'Contacte con su administrador' });        
    }

}



module.exports = {
    crearLog,
    obtenerLogs,
    obtenerLog,
    actualizarLog,
    borrarLog
}