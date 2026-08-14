import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// SLYK-0350 — unit tests for the AGENT_WAITING email trigger. Mock wiring
// follows pipelineJobService.test.ts: vi.hoisted bag + fluent mock db.
// The service reads post-commit on `db` (never inside a tx):
//   (a) db.select({...}).from(tickets).innerJoin(projects).innerJoin(users)
//         .where().limit(1)                    — ticket context
//   (b) db.select({body}).from(agentMessages).where().orderBy().limit(1)
//                                            — latest AGENT message
//   (c) db.select({bool}).from(notificationPreferences).where().limit(1)
//                                            — opt-in gate
// Email delivery goes through emailService's transport seam (captured, no
// vendor SDK).

const bag = vi.hoisted(() => ({
  contextLimit: vi.fn(),
  messageLimit: vi.fn(),
  preferenceLimit: vi.fn(),
}));

vi.mock('../db/client', () => {
  const db = {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          innerJoin: () => ({
            where: () => ({ limit: () => bag.contextLimit() }),
          }),
        }),
        where: () => ({
          orderBy: () => ({ limit: () => bag.messageLimit() }),
          limit: () => bag.preferenceLimit(),
        }),
      }),
    }),
  };
  return { db };
});

import { resetEmailTransport, setEmailTransport, type EmailMessage } from './emailService';
import { notifyAgentWaitingEmail } from './agentWaitingNotifyService';

const TICKET_ID = '11111111-1111-4111-8111-111111111111';
const CREATOR_ID = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';

function contextRow(overrides: Record<string, unknown> = {}) {
  return {
    creatorId: CREATOR_ID,
    projectId: PROJECT_ID,
    creatorEmail: 'pm@example.com',
    projectSlug: 'e2e',
    projectName: 'E2E Project',
    ticketTitle: 'Fix login bug',
    ticketNumber: 42,
    ...overrides,
  };
}

const sent: EmailMessage[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  bag.contextLimit.mockResolvedValue([contextRow()]);
  bag.messageLimit.mockResolvedValue([{ body: 'Which auth provider should I use?' }]);
  bag.preferenceLimit.mockResolvedValue([]); // no row → opted in (default true)
  sent.length = 0;
  setEmailTransport({
    name: 'test',
    async send(message) {
      sent.push(message);
    },
  });
});

afterEach(() => {
  resetEmailTransport();
});

describe('notifyAgentWaitingEmail — delivery', () => {
  it('sends one email to the ticket creator with ticket + agent context', async () => {
    await notifyAgentWaitingEmail(TICKET_ID);

    expect(sent).toHaveLength(1);
    const email = sent[0]!;
    expect(email.to).toBe('pm@example.com');
    // Display id is the unpadded URL ref (F30 D1): 'E2E-42'.
    expect(email.subject).toBe('[E2E-42] Fix login bug — agent needs your input');
    expect(email.text).toContain('E2E-42');
    expect(email.text).toContain('E2E Project');
    expect(email.text).toContain('Fix login bug');
    expect(email.text).toContain('Which auth provider should I use?');
    // Deep link /projects/:slug/tickets/:displayId against frontendUrl.
    expect(email.text).toContain('http://localhost:5173/projects/e2e/tickets/E2E-42');
    expect(email.html).toContain('href="http://localhost:5173/projects/e2e/tickets/E2E-42"');
    // Minimal HTML: escaped agent body, no styling.
    expect(email.html).toContain('<pre>Which auth provider should I use?</pre>');
  });

  it('escapes HTML in the agent message and ticket title', async () => {
    bag.messageLimit.mockResolvedValue([{ body: '<script>alert(1)</script>' }]);
    bag.contextLimit.mockResolvedValue([contextRow({ ticketTitle: 'Fix <b>login</b>' })]);

    await notifyAgentWaitingEmail(TICKET_ID);

    const email = sent[0]!;
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).toContain('&lt;b&gt;login&lt;/b&gt;');
    // Plain-text body carries the raw markdown body unescaped.
    expect(email.text).toContain('<script>alert(1)</script>');
  });

  it('sends without the message block when no AGENT message exists', async () => {
    bag.messageLimit.mockResolvedValue([]);

    await notifyAgentWaitingEmail(TICKET_ID);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).not.toContain('Which auth');
    expect(sent[0]!.html).not.toContain('<pre>');
  });
});

describe('notifyAgentWaitingEmail — opt-in gate', () => {
  it('row with notifyOnAgentWaiting=false suppresses the email', async () => {
    bag.preferenceLimit.mockResolvedValue([{ notifyOnAgentWaiting: false }]);

    await notifyAgentWaitingEmail(TICKET_ID);

    expect(sent).toHaveLength(0);
  });

  it('row with notifyOnAgentWaiting=true sends', async () => {
    bag.preferenceLimit.mockResolvedValue([{ notifyOnAgentWaiting: true }]);

    await notifyAgentWaitingEmail(TICKET_ID);

    expect(sent).toHaveLength(1);
  });

  it('no row → sent (lazy default true)', async () => {
    bag.preferenceLimit.mockResolvedValue([]);

    await notifyAgentWaitingEmail(TICKET_ID);

    expect(sent).toHaveLength(1);
  });
});

describe('notifyAgentWaitingEmail — failure isolation', () => {
  it('ticket context missing → no email, no throw', async () => {
    bag.contextLimit.mockResolvedValue([]);

    await expect(notifyAgentWaitingEmail(TICKET_ID)).resolves.toBeUndefined();

    expect(sent).toHaveLength(0);
  });

  it('db failure → resolves, never rejects', async () => {
    bag.contextLimit.mockRejectedValue(new Error('connection lost'));

    await expect(notifyAgentWaitingEmail(TICKET_ID)).resolves.toBeUndefined();
  });

  it('transport failure is swallowed by sendEmail (still resolves)', async () => {
    setEmailTransport({
      name: 'broken',
      async send() {
        throw new Error('SMTP down');
      },
    });

    await expect(notifyAgentWaitingEmail(TICKET_ID)).resolves.toBeUndefined();
  });
});
