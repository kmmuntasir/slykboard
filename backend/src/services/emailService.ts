import nodemailer from 'nodemailer';
import { env } from '../config/env';
import { logger } from '../config/logger';

// SLYK-0350 — minimal email seam. 06-frontend-ui.md § Notifications says
// "use whatever slykboard already uses" — an audit found NOTHING (no
// Resend/SendGrid/nodemailer/SMTP anywhere), so this module defines a
// transport interface with a no-op default and an SMTP implementation
// selected by env (SLYKBOARD_SMTP_HOST; see config/env.ts). No vendor SDK
// coupling — any SMTP-speaking provider works, and a future transport
// (Resend, SES…) slots in behind sendEmail without caller changes.
//
// One email per AGENT_WAITING entry, fired-and-forgotten by
// agentWaitingNotifyService — this module only owns delivery.

/** What every email carries — plain-text + minimal HTML body pair. */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailTransport {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

/** Dev/test default: log a one-line summary, send nothing. */
const logTransport: EmailTransport = {
  name: 'log',
  async send(message) {
    logger.info(
      { to: message.to, subject: message.subject, transport: 'log' },
      'email (no-op transport)',
    );
  },
};

/** SMTP transport (prod). One shared connection pool, created lazily. */
type Transporter = ReturnType<typeof nodemailer.createTransport>;
let smtpPool: Transporter | undefined;

const smtpTransport: EmailTransport = {
  name: 'smtp',
  async send(message) {
    // Lazy init: unreachable when env.smtpHost is unset, and a failure at
    // createTransport time surfaces on first send (caught by sendEmail).
    if (!smtpPool) {
      smtpPool = nodemailer.createTransport({
        host: env.smtpHost,
        port: env.smtpPort,
        secure: env.smtpPort === 465,
        auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPassword } : undefined,
      });
    }
    await smtpPool.sendMail({
      from: env.smtpFrom,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  },
};

// env.smtpHost is the switch: unset (dev/test default) → no-op logging
// transport; set → real SMTP. Config is frozen at boot; a host change
// requires a restart.
let transport: EmailTransport = env.smtpHost ? smtpTransport : logTransport;

/** Swap the transport (tests capture via this seam). */
export function setEmailTransport(next: EmailTransport): void {
  transport = next;
}

/** Restore the env-selected default (no-op without SMTP config). */
export function resetEmailTransport(): void {
  transport = env.smtpHost ? smtpTransport : logTransport;
}

/** Test seam: the SMTP transport itself (normally chosen by env). */
export const smtpTransportForTest: EmailTransport = smtpTransport;

/**
 * Send one email. NEVER throws — email failure must not fail the caller's
 * request (SLYK-0350 AC). PM-supplied text is capped at 200 chars in the
 * error log line (03-security.md § Logging, mirrors dispatcherClient).
 */
const LOG_TEXT_CAP = 200;

function truncateForLog(text: string): string {
  return text.length > LOG_TEXT_CAP ? `${text.slice(0, LOG_TEXT_CAP)}…[truncated]` : text;
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  try {
    await transport.send(message);
  } catch (err) {
    logger.error(
      {
        to: message.to,
        subject: truncateForLog(message.subject),
        transport: transport.name,
        err: err instanceof Error ? err.message : String(err),
      },
      'email send failed',
    );
  }
}
