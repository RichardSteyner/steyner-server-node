const { response, request } = require('express');

const Lead = require('../models/lead');

const { sendEmail } = require('../helpers/send-email');


const leadsGet = async(req = request, res = response) => {
    try{
        const { limite = 5, desde = 0 } = req.query;
        const query = { deleted: false };

        const [ total, leads ] = await Promise.all([
            Lead.countDocuments(query),
            Lead.find(query)
                .skip( Number( desde ) )
                .limit(Number( limite ))
        ]);

        res.json({
            total,
            leads
        });
    } catch(err) {
        res.status(500).json(err);
    }
}

const leadsPost = async(req, res = response) => {
    try{
        const { name, email, category, comments } = req.body;

        const existLead = await Lead.findOne({ email });
        let leadDB;
        if ( existLead ) {
            const lead = { name, email, category, comments, modifiedDate: new Date() };
            leadDB = await Lead.findByIdAndUpdate( existLead._id, lead, {new: true} );
        }else {
            // Insert en BD
            const lead = new Lead({ name, email, category, comments });
            leadDB = await lead.save();
        }

        //test get leads and send email
        sendEmail({
            toAddress: ['steyner.urupeque.s@gmail.com'],
            subject: 'New Lead!',
            body: `<h1>New Lead</h1>
                    <p>${name} ${email} ${category}</p>
                    <p>${comments}</p>`
        })

        res.json({
            leadDB
        });
    } catch(err) {
        console.log(err);
        res.status(500).json(err);
    }
}

const leadsPut = async(req, res = response) => {

    try{
        const { id } = req.params;
        const { _id, email, ...resto } = req.body;

        const lead = await Lead.findByIdAndUpdate( id, resto );

        res.json(lead);
    } catch(err) {
        res.status(500).json(err);
    }
}

const leadsPatch = (req, res = response) => {
    res.json({
        msg: 'patch API - leadsPatch'
    });
}

const leadsDelete = async(req, res = response) => {

    try {
        const { id } = req.params;
        const lead = await Lead.findByIdAndUpdate( id, { deleted: false } );

        res.json(lead);
    } catch(err) {
        res.status(500).json(err);
    }
}


module.exports = {
    leadsGet,
    leadsPost,
    leadsPut,
    leadsPatch,
    leadsDelete
}