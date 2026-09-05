import type { RenderedEmail } from './types';

export interface OutgoingEmail {
  to: string;
  email: RenderedEmail;
}

export type SendResult = { ok: true } | { ok: false; error: string };

const SEND_TIMEOUT_MS = 10_000;
const DEFAULT_FROM = 'SimulatedBetting <onboarding@resend.dev>';

/**
 * Dev mode is the absence of a key, not a second flag (D68).
 *
 * This is the idiom the repo already uses twice — `ALERT_WEBHOOK_URL` unset makes `raiseAlert`
 * warn rather than fail, and D62 makes Sentry inert without a DSN. It also means CI and the test
 * suite cannot send mail by construction, since no key is ever set there.
 */
export function activeTransport(): 'resend' | 'console' {
  return process.env.RESEND_API_KEY ? 'resend' : 'console';
}

/** Never throws. A dead provider must not be able to fail the pass that called it. */
export async function sendEmail({ to, email }: OutgoingEmail): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;

  if (!key) {
    console.info(
      `[notify] no RESEND_API_KEY, so this was not sent:\nto: ${to}\nsubject: ${email.subject}\n${email.text}`,
    );
    return { ok: true };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || DEFAULT_FROM,
        to: [to],
        subject: email.subject,
        text: email.text,
        html: email.html,
        headers: email.headers,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return { ok: false, error: `Resend answered ${response.status}: ${detail.slice(0, 200)}` };
    }

    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return { ok: false, error: `${error.name}: ${error.message}` };
  }
}
