const { Resend } = require('resend');

const resend = new Resend( process.env.RESEND_API_KEY );

const sendEmail = async ( { toAddress, subject, body } ) => {

    try {
        const data = await resend.emails.send({
          from: 'Codifacil <onboarding@resend.dev>',
          to: toAddress,
          subject: subject,
          html: body,
        });
    } catch (error) {
        console.error(error);
    }

}


module.exports = {
    sendEmail
}