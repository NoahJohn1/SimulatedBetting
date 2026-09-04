import { afterEach, describe, expect, it, vi } from 'vitest';
import { activeTransport, sendEmail } from '@/server/notify/transport';
import type { RenderedEmail } from '@/server/notify/types';

const email: RenderedEmail = {
  subject: 'Your account was approved',
  text: 'body',
  html: '<p>body</p>',
  headers: { 'List-Unsubscribe': '<https://x/y>' },
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('activeTransport', () => {
  it('is console when no API key is set', () => {
    vi.stubEnv('RESEND_API_KEY', '');
    expect(activeTransport()).toBe('console');
  });

  it('is resend when a key is set', () => {
    vi.stubEnv('RESEND_API_KEY', 're_abc');
    expect(activeTransport()).toBe('resend');
  });
});

describe('sendEmail', () => {
  it('sends nothing and reports success without a key — dev mode is the absence of one', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});

    const result = await sendEmail({ to: 'a@example.com', email });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
  });

  it('POSTs to Resend with the bearer key and the one-click headers', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_abc');
    vi.stubEnv('EMAIL_FROM', 'Bets <bets@example.com>');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendEmail({ to: 'a@example.com', email });

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.authorization).toBe('Bearer re_abc');

    const body = JSON.parse(init.body);
    expect(body.to).toEqual(['a@example.com']);
    expect(body.from).toBe('Bets <bets@example.com>');
    expect(body.subject).toBe('Your account was approved');
    expect(body.headers['List-Unsubscribe']).toBe('<https://x/y>');
  });

  it('reports a non-2xx as a failure rather than throwing', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_abc');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 422 })));

    const result = await sendEmail({ to: 'a@example.com', email });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('422');
  });

  it('reports a thrown fetch as a failure rather than propagating it', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_abc');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')));

    const result = await sendEmail({ to: 'a@example.com', email });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBe('TypeError: network down');
  });
});
