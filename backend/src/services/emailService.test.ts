import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// SLYK-0350 — unit tests for the email seam. sendEmail must NEVER throw.
// Delivery tests use a capture transport; the SMTP path mocks nodemailer's
// factory to assert the env-driven wiring + transporter pooling without a
// live relay (no network in CI).

const bag = vi.hoisted(() => ({
  sendMail: vi.fn(async () => {}),
  createTransport: vi.fn(() => ({ sendMail: bag.sendMail })),
}));

vi.mock('nodemailer', () => ({ default: { createTransport: bag.createTransport } }));

import {
  resetEmailTransport,
  sendEmail,
  setEmailTransport,
  smtpTransportForTest,
} from './emailService';
import type { EmailMessage } from './emailService';

const sent: EmailMessage[] = [];

beforeEach(() => {
  sent.length = 0;
  bag.sendMail.mockClear();
  bag.createTransport.mockClear();
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

describe('sendEmail', () => {
  it('delegates to the active transport with the message verbatim', async () => {
    const message: EmailMessage = {
      to: 'pm@example.com',
      subject: 'hello',
      text: 'plain',
      html: '<p>html</p>',
    };

    await sendEmail(message);

    expect(sent).toEqual([message]);
  });

  it('resolves (does not throw) when the transport rejects', async () => {
    setEmailTransport({
      name: 'broken',
      async send() {
        throw new Error('SMTP connection refused');
      },
    });

    await expect(
      sendEmail({ to: 'x', subject: 's', text: 't', html: 'h' }),
    ).resolves.toBeUndefined();
  });
});

describe('SMTP transport (env-configured)', () => {
  it('no SLYKBOARD_SMTP_HOST → reset keeps the no-op transport (nothing sent)', async () => {
    resetEmailTransport();

    await sendEmail({ to: 'pm@example.com', subject: 's', text: 't', html: 'h' });

    expect(bag.createTransport).not.toHaveBeenCalled();
    expect(bag.sendMail).not.toHaveBeenCalled();
  });

  it('SMTP transport: env-shaped transporter, pooled, message passed through', async () => {
    // env is frozen at import (no SMTP host in the test env — reset picks
    // the no-op), so select the SMTP transport directly. What matters here
    // is the wiring it builds from env + the pooling + the message pass-through.
    setEmailTransport(smtpTransportForTest);

    await sendEmail({ to: 'pm@example.com', subject: 's', text: 't', html: 'h' });
    await sendEmail({ to: 'pm@example.com', subject: 's2', text: 't', html: 'h' });

    // One pooled transporter, two sends through it.
    expect(bag.createTransport).toHaveBeenCalledTimes(1);
    expect(bag.sendMail).toHaveBeenCalledTimes(2);
    expect(bag.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'pm@example.com', subject: 's', text: 't', html: 'h' }),
    );
    expect(bag.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: expect.any(String) }),
    );
  });
});
