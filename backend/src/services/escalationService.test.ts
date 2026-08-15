// SLYK-0400 — escalationService tests. The dispatcher POST is mocked (its
// signing/retry behavior is dispatcherClient.test.ts's domain); the DB seam
// is a minimal fluent fake — the service only reads one pipelineJobs row.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    postToDispatcher: vi.fn(),
    select: vi.fn(),
  },
}));

vi.mock('./dispatcherClient', () => ({
  postToDispatcher: mocks.postToDispatcher,
  DispatcherError: class DispatcherError extends Error {
    constructor(
      public path: string,
      public status: number,
      public detail: string,
    ) {
      super(`Dispatcher ${path} ${status}: ${detail}`);
    }
  },
}));

vi.mock('../db/client', () => {
  const rows: Array<Record<string, unknown>> = [];
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => mocks.select(),
          }),
        }),
      }),
    },
    __setRows: (r: Array<Record<string, unknown>>) => rows.push(...r),
  };
});

import { escalateTicket, _resetEscalationDebounceForTests } from './escalationService';
import { AppError } from '../utils/appError';

const TICKET = '11111111-1111-4111-8111-111111111111';
const PROJECT = '33333333-3333-4333-8333-333333333333';

function jobRow(state: string) {
  return { ticketId: TICKET, projectId: PROJECT, state, attempts: 3 };
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetEscalationDebounceForTests();
  mocks.postToDispatcher.mockResolvedValue({} as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('escalateTicket', () => {
  it('BLOCKED_HUMAN: posts the signed webhook and returns the ack shape', async () => {
    mocks.select.mockResolvedValue([jobRow('BLOCKED_HUMAN')] as never);

    const result = await escalateTicket(TICKET);

    expect(result).toMatchObject({ ticketId: TICKET, projectId: PROJECT });
    expect(result.escalatedAt).toBeTruthy();
    expect(mocks.postToDispatcher).toHaveBeenCalledTimes(1);
    const [path, body] = mocks.postToDispatcher.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(path).toBe('/webhooks/pm-action/need-human-help');
    expect(body).toMatchObject({ ticketId: TICKET, projectId: PROJECT, reason: 'BLOCKED_HUMAN' });
    expect(typeof body.idempotencyKey).toBe('string');
  });

  it('no job row → NOT_FOUND 404', async () => {
    mocks.select.mockResolvedValue([] as never);
    await expect(escalateTicket(TICKET)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  it.each(['QUEUED', 'AGENT_RUNNING', 'FAILED_CI', 'DONE'])(
    'non-BLOCKED state %s → 409 CONFLICT',
    async (state) => {
      mocks.select.mockResolvedValue([jobRow(state)] as never);
      await expect(escalateTicket(TICKET)).rejects.toMatchObject({
        code: 'CONFLICT',
        status: 409,
      });
      expect(mocks.postToDispatcher).not.toHaveBeenCalled();
    },
  );

  it('second call within 60s → 409 debounce, single dispatch', async () => {
    mocks.select.mockResolvedValue([jobRow('BLOCKED_HUMAN')] as never);

    await escalateTicket(TICKET);
    await expect(escalateTicket(TICKET)).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(mocks.postToDispatcher).toHaveBeenCalledTimes(1);
  });

  it('dispatcher failure → UPSTREAM_FAILED 502 and the debounce window is released for a retry', async () => {
    mocks.select.mockResolvedValue([jobRow('BLOCKED_HUMAN')] as never);
    mocks.postToDispatcher.mockRejectedValueOnce(
      Object.assign(new Error('Dispatcher /x 500: down'), {
        name: 'DispatcherError',
      }) as never,
    );

    await expect(escalateTicket(TICKET)).rejects.toBeInstanceOf(AppError);
    await expect(escalateTicket(TICKET)).resolves.toMatchObject({ ticketId: TICKET });
    expect(mocks.postToDispatcher).toHaveBeenCalledTimes(2);
  });

  it('secondary Slack ping fires only when the env is set (fire-and-forget)', async () => {
    mocks.select.mockResolvedValue([jobRow('BLOCKED_HUMAN')] as never);
    const slackFetch = vi.fn().mockResolvedValue({} as never);
    vi.stubGlobal('fetch', slackFetch);

    // Env unset → no Slack POST.
    await escalateTicket(TICKET);
    expect(slackFetch).not.toHaveBeenCalled();

    vi.stubEnv('SLYKBOARD_SLACK_ESCALATION_WEBHOOK', 'https://hooks.slack.example/x');
    _resetEscalationDebounceForTests();
    await escalateTicket(TICKET);
    expect(slackFetch).toHaveBeenCalledTimes(1);
    const [url, init] = slackFetch.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe('https://hooks.slack.example/x');
    expect(JSON.parse(String(init.body)).text).toContain(TICKET);
  });
});
