import { Resend } from "resend";

export async function sendEmail({ to, subject, html, attachments }) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: "Decked Out WNC <contracts@deckedoutwnc.com>",
    to,
    subject,
    html,
    attachments,
  });
  if (error) {
    throw new Error(`Resend email failed: ${error.message}`);
  }
}
