import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatAlert, raiseAlert } from '@/server/ops/alerts';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('formatAlert', () => {
  it('leads with the kind and appends each context line', () => {
    const body = formatAlert({
      kind: 'BALANCE_DRIFT',
      message: 'Two memberships disagree with the ledger.',
      context: { pairs: 2, totalDriftCents: '1500' },
    });

    expect(body).toBe(
      '[BALANCE_DRIFT] Two memberships disagree with the ledger.\npairs: 2\ntotalDriftCents: 1500',
    );
  });

  it('is just the line when there is no context', () => {
    expect(formatAlert({ kind: 'CRON_RECOVERED', message: 'settle is green again.' })).toBe(
      '[CRON_RECOVERED] settle is green again.',
    );
  });
});

describe('raiseAlert', () => {
  it('posts a body carrying both content and text, so Discord and Slack both accept it', async () => {
    vi.stubEnv('ALERT_WEBHOOK_URL', 'https://hooks.example/abc');
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await raiseAlert({ kind: 'CRON_FAILED', message: 'settle threw.' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://hooks.example/abc');
    expect(init.method).toBe('POST');

    const body = JSON.parse(init.body);
    expect(body.content).toBe('[CRON_FAILED] settle threw.');
    expect(body.text).toBe(body.content);
  });

  it('posts nothing when no webhook is configured', async () => {
    vi.stubEnv('ALERT_WEBHOOK_URL', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      raiseAlert({ kind: 'CRON_FAILED', message: 'settle threw.' }),
    ).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves when the webhook rejects — the alarm can never be the outage', async () => {
    vi.stubEnv('ALERT_WEBHOOK_URL', 'https://hooks.example/abc');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(raiseAlert({ kind: 'ESCROW_DRIFT', message: 'drift.' })).resolves.toBeUndefined();
  });

  it('resolves when the webhook answers non-2xx', async () => {
    vi.stubEnv('ALERT_WEBHOOK_URL', 'https://hooks.example/abc');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(raiseAlert({ kind: 'ESCROW_DRIFT', message: 'drift.' })).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('carries a timeout, so a webhook that never answers cannot eat a settle budget', async () => {
    vi.stubEnv('ALERT_WEBHOOK_URL', 'https://hooks.example/abc');
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await raiseAlert({ kind: 'CRON_FAILED', message: 'settle threw.' });

    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});
