import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env";

let transport: Transporter | null = null;

/** Tests inject a JSON transport here. */
export function setMailTransport(t: Transporter | null) {
  transport = t;
}

export const mailConfigured = () => Boolean(transport || env().SMTP_URL);

/** Sends an email; returns false (and does nothing) when SMTP isn't configured. */
export async function sendMail(msg: { to: string; subject: string; text: string; html?: string }) {
  if (!transport) {
    if (!env().SMTP_URL) return false;
    transport = nodemailer.createTransport(env().SMTP_URL);
  }
  await transport.sendMail({ from: env().MAIL_FROM, ...msg });
  return true;
}
