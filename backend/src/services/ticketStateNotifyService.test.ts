import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// SLYK-0390 — unit tests for the DONE / BLOCKED_HUMAN email trigger. Mock
// wiring follows agentWaitingNotifyService.test.ts: vi.hoisted bag + fluent
// mock db. The service reads post-commit on `db` (never inside a tx):
//   (a) db.select({...}).from(tickets).innerJoin(projects).innerJoin(users)
//         .where().limit(1)                    — ticket context
//   (b) db.select({done, blocked}).from(notificationPreferences).where()
//         .limit(1)                            — opt-in gate
// Email delivery goes through emailService's transport seam (captured, no
// vendor SDK).

const bag = vi.hoisted(() => ({
  contextLimit: vi.fn(),
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
          limit: () => bag.preferenceLimit(),
        }),
      }),
    }),
  };
  return { db };
});

import { resetEmailTransport, setEmailTransport, type EmailMessage } from './emailService';
import { notifyTicketStateEmail } from './ticketStateNotifyService';

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

describe('notifyTicketStateEmail — delivery', () => {
  it('kind=done sends the ticket-deployed email to the creator', async () => {
    await notifyTicketStateEmail(TICKET_ID, 'done');

    expect(sent).toHaveLength(1);
    const email = sent[0]!;
    expect(email.to).toBe('pm@example.com');
    // Subject: ticket deployed (the ticket's wording) + display id + title.
    expect(email.subject).toBe('[E2E-42] Fix login bug — ticket deployed');
    expect(email.text).toContain('E2E-42');
    expect(email.text).toContain('E2E Project');
    expect(email.text).toContain('Fix login bug');
    expect(email.text).toContain('deployed');
    // Deep link /projects/:slug/tickets/:displayId against frontendUrl.
    expect(email.text).toContain('http://localhost:5173/projects/e2e/tickets/E2E-42');
    expect(email.html).toContain('href="http://localhost:5173/projects/e2e/tickets/E2E-42"');
  });

  it('kind=blockedHuman sends the needs-help email with blocked wording', async () => {
    await notifyTicketStateEmail(TICKET_ID, 'blockedHuman');

    expect(sent).toHaveLength(1);
    const email = sent[0]!;
    expect(email.subject).toBe('[E2E-42] Fix login bug — blocked — needs your help');
    expect(email.text).toContain('blocked');
    expect(email.text).toContain('needs human help');
    expect(email.html).toContain('Help in Slykboard');
  });

  it('escapes HTML in ticket title / project name in the HTML body', async () => {
    bag.contextLimit.mockResolvedValue([contextRow({ ticketTitle: 'Fix <b>login</b>' })]);

    await notifyTicketStateEmail(TICKET_ID, 'done');

    const email = sent[0]!;
    expect(email.html).toContain('&lt;b&gt;login&lt;/b&gt;');
    // Plain-text body carries the raw title unescaped.
    expect(email.text).toContain('Fix <b>login</b>');
  });
});

describe('notifyTicketStateEmail — opt-in gate', () => {
  it('notifyOnDone=false suppresses the DONE email', async () => {
    bag.preferenceLimit.mockResolvedValue([{ notifyOnDone: false, notifyOnBlockedHuman: true }]);

    await notifyTicketStateEmail(TICKET_ID, 'done');

    expect(sent).toHaveLength(0);
  });

  it('notifyOnBlockedHuman=false suppresses the BLOCKED_HUMAN email', async () => {
    bag.preferenceLimit.mockResolvedValue([{ notifyOnDone: true, notifyOnBlockedHuman: false }]);

    await notifyTicketStateEmail(TICKET_ID, 'blockedHuman');

    expect(sent).toHaveLength(0);
  });

  it('each kind only consults its own flag (done=true, blocked=false)', async () => {
    bag.preferenceLimit.mockResolvedValue([{ notifyOnDone: true, notifyOnBlockedHuman: false }]);

    await notifyTicketStateEmail(TICKET_ID, 'done');

    expect(sent).toHaveLength(1);
  });

  it('no row → both kinds send (lazy default true)', async () => {
    bag.preferenceLimit.mockResolvedValue([]);

    await notifyTicketStateEmail(TICKET_ID, 'done');
    await notifyTicketStateEmail(TICKET_ID, 'blockedHuman');

    expect(sent).toHaveLength(2);
  });
});

describe('notifyTicketStateEmail — failure isolation', () => {
  it('ticket context missing → no email, no throw', async () => {
    bag.contextLimit.mockResolvedValue([]);

    await expect(notifyTicketStateEmail(TICKET_ID, 'done')).resolves.toBeUndefined();

    expect(sent).toHaveLength(0);
  });

  it('db failure → resolves, never rejects', async () => {
    bag.contextLimit.mockRejectedValue(new Error('connection lost'));

    await expect(notifyTicketStateEmail(TICKET_ID, 'done')).resolves.toBeUndefined();
  });

  it('transport failure is swallowed by sendEmail (still resolves)', async () => {
    setEmailTransport({
      name: 'broken',
      async send() {
        throw new Error('SMTP down');
      },
    });

    await expect(notifyTicketStateEmail(TICKET_ID, 'done')).resolves.toBeUndefined();
  });
});
