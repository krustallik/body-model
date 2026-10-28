import { getEnv } from "@/lib/env";
import { consumeApplicationAuthLimit } from "./rate-limit";

export type AuthEmailPurpose = "verify" | "reset" | "change";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function messageFor(purpose: AuthEmailPurpose, code: string) {
  const label = purpose === "verify"
    ? "Підтвердження email"
    : purpose === "change"
      ? "Підтвердження зміни пароля"
      : "Відновлення пароля";
  const safeCode = escapeHtml(code);
  return {
    subject: `BodyCast — ${label}`,
    text: `${label}. Код: ${code}. Він діє 5 хвилин і може бути використаний один раз. Якщо ви не запитували цей лист, проігноруйте його.`,
    html: `<!doctype html><html lang="uk"><body style="margin:0;background:#080b0a;color:#eef4f1;font-family:Arial,sans-serif;padding:24px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="100%" style="max-width:520px;background:#111817;border:1px solid #31413c;border-radius:18px;padding:28px"><tr><td><p style="margin:0;color:#54c6a0;font-weight:700;letter-spacing:.12em">BODYCAST</p><h1 style="font-size:24px;margin:24px 0 10px">${label}</h1><p style="color:#a9b8b2;line-height:1.6">Введіть цей код у BodyCast. Він діє 5 хвилин і може бути використаний один раз.</p><p style="font-size:34px;letter-spacing:.25em;font-weight:700;background:#182421;padding:18px;border-radius:12px;text-align:center">${safeCode}</p><p style="color:#82928c;font-size:13px;line-height:1.5">Якщо ви не виконували цю дію, проігноруйте лист. Не пересилайте код іншим людям.</p></td></tr></table></td></tr></table></body></html>`,
  };
}

export async function sendAuthEmail(input: { email: string; code: string; purpose: AuthEmailPurpose }) {
  const env = getEnv();
  if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL || !env.BREVO_SENDER_NAME) {
    throw new Error("Transactional email provider is not configured");
  }
  const recipientLimit = await consumeApplicationAuthLimit(
    `bodycast:brevo:recipient:${input.email.trim().toLowerCase()}`,
    86_400,
    env.AUTH_EMAIL_RECIPIENT_DAILY_LIMIT,
  );
  if (!recipientLimit.allowed) throw new Error("Transactional email recipient daily limit has been reached");
  const quota = await consumeApplicationAuthLimit(
    `bodycast:brevo:daily:${new Date().toISOString().slice(0, 10)}`,
    86_400,
    env.AUTH_EMAIL_DAILY_LIMIT,
  );
  if (!quota.allowed) throw new Error("Transactional email daily quota has been reached");
  const message = messageFor(input.purpose, input.code);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": env.BREVO_API_KEY,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender: { email: env.BREVO_SENDER_EMAIL, name: env.BREVO_SENDER_NAME },
        to: [{ email: input.email }],
        subject: message.subject,
        textContent: message.text,
        htmlContent: message.html,
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Transactional email provider rejected the request (${response.status})`);
  } finally {
    clearTimeout(timeout);
  }
}
