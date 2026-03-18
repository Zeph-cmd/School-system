const nodemailer = require('nodemailer');

function getTransport() {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
}

async function sendEmail({ to, subject, text, html, replyTo }) {
  const transport = getTransport();
  if (!transport) {
    return { sent: false, reason: 'smtp_not_configured' };
  }

  const from = process.env.MAIL_FROM || process.env.SMTP_USER;
  await transport.sendMail({
    from,
    to,
    subject,
    text,
    html,
    replyTo,
  });

  return { sent: true };
}

module.exports = { sendEmail };
