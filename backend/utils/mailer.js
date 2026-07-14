// Email sending is stubbed for the MVP so the app runs without extra signup
// friction. Wire up a real provider (Resend, SendGrid, or nodemailer + SMTP)
// before going to production — right now this just logs the link.
async function sendVerificationEmail(toEmail, token) {
  const verifyUrl = `${process.env.CLIENT_URL || 'http://localhost:3000'}/verify-email?token=${token}`;
  console.log(`[mailer stub] Verification link for ${toEmail}: ${verifyUrl}`);
  return true;
}

module.exports = { sendVerificationEmail };
