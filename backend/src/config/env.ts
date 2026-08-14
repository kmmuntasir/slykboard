import 'dotenv/config';
import { z } from 'zod';

export interface Config {
  port: number;
  frontendUrl: string;
  frontendUrls: string[];
  nodeEnv: string;
  databaseUrl: string;
  directDatabaseUrl: string;
  runMigrationsOnStart: boolean;
  jwtSecret: string;
  jwtTtl: string; // F07 D8: env-driven JWT TTL (jose setExpirationTime string, e.g. '8h', '15m')
  googleClientId: string;
  googleClientSecret: string;
  googleCallbackUrl: string;
  allowedDomain?: string;
  bootstrapAdminEmail?: string;
  bootstrapAdminFullName?: string;
  bootstrapAdminDisplayName?: string;
  // SLYK-0130 agent mode (docs/agentic-automation/02-dual-mode.md)
  agentMode: boolean;
  dispatcherUrl?: string;
  dispatcherToken?: string;
  slackEscalationWebhook?: string;
}

// SLYK-0130: agent-mode vars. All optional at the schema level — the cross-field
// rule below makes URL+token mandatory only when SLYKBOARD_AGENT_MODE=true.
const agentEnvSchema = z.object({
  SLYKBOARD_AGENT_MODE: z.enum(['true', 'false']).default('false'),
  SLYKBOARD_DISPATCHER_URL: z.string().url().optional(),
  SLYKBOARD_DISPATCHER_TOKEN: z.string().min(64).optional(),
  SLYKBOARD_SLACK_ESCALATION_WEBHOOK: z.string().url().optional(),
});

// SLYK-0130: cross-field rule — agent mode requires the dispatcher pair. Without
// this, agent code paths would NPE on the missing token at first dispatcher call.
function validateAgentEnv(parsed: z.infer<typeof agentEnvSchema>): z.infer<typeof agentEnvSchema> {
  if (parsed.SLYKBOARD_AGENT_MODE === 'true') {
    if (!parsed.SLYKBOARD_DISPATCHER_URL) {
      throw new Error('SLYKBOARD_DISPATCHER_URL required when SLYKBOARD_AGENT_MODE=true');
    }
    if (!parsed.SLYKBOARD_DISPATCHER_TOKEN) {
      throw new Error('SLYKBOARD_DISPATCHER_TOKEN required when SLYKBOARD_AGENT_MODE=true');
    }
  }
  return parsed;
}

// Parse 'true'/'1'/'yes' (case-insensitive) → true; 'false'/'0'/'no' → false; otherwise undefined.
function parseBooleanFlag(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  return undefined;
}

export function loadConfig(envSource: NodeJS.ProcessEnv = process.env): Config {
  if (!envSource.FRONTEND_URL) {
    throw new Error('Missing required environment variable: FRONTEND_URL');
  }
  if (!envSource.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }
  if (!envSource.JWT_SECRET) {
    throw new Error('Missing JWT_SECRET');
  }
  if (envSource.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be >= 32 chars');
  }
  if (!envSource.GOOGLE_CLIENT_ID) {
    throw new Error('Missing GOOGLE_CLIENT_ID');
  }
  if (!envSource.GOOGLE_CLIENT_SECRET) {
    throw new Error('Missing GOOGLE_CLIENT_SECRET');
  }
  if (!envSource.GOOGLE_CALLBACK_URL) {
    throw new Error('Missing GOOGLE_CALLBACK_URL');
  }

  const nodeEnv = envSource.NODE_ENV ?? 'development';

  // SLYK-0130: schema-parse then cross-field validate. safeParse keeps the
  // thrown message actionable (Zod's aggregate error names every bad var).
  const agentParsed = agentEnvSchema.safeParse({
    SLYKBOARD_AGENT_MODE: envSource.SLYKBOARD_AGENT_MODE,
    SLYKBOARD_DISPATCHER_URL: envSource.SLYKBOARD_DISPATCHER_URL,
    SLYKBOARD_DISPATCHER_TOKEN: envSource.SLYKBOARD_DISPATCHER_TOKEN,
    SLYKBOARD_SLACK_ESCALATION_WEBHOOK: envSource.SLYKBOARD_SLACK_ESCALATION_WEBHOOK,
  });
  if (!agentParsed.success) {
    throw new Error(`Invalid agent-mode env vars: ${agentParsed.error.message}`);
  }
  const agentEnv = validateAgentEnv(agentParsed.data);

  return {
    port: Number(envSource.PORT ?? 3000),
    frontendUrl: envSource.FRONTEND_URL,
    frontendUrls: envSource.FRONTEND_URL.split(',')
      .map((u) => u.trim())
      .filter(Boolean),
    nodeEnv,
    databaseUrl: envSource.DATABASE_URL,
    jwtSecret: envSource.JWT_SECRET,
    jwtTtl: envSource.JWT_TTL || '8h', // F07 D8: default preserves F05/F06 behavior
    googleClientId: envSource.GOOGLE_CLIENT_ID,
    googleClientSecret: envSource.GOOGLE_CLIENT_SECRET,
    googleCallbackUrl: envSource.GOOGLE_CALLBACK_URL,
    allowedDomain: envSource.ALLOWED_DOMAIN || undefined,
    bootstrapAdminEmail: envSource.BOOTSTRAP_ADMIN_EMAIL?.trim() || undefined,
    bootstrapAdminFullName: envSource.BOOTSTRAP_ADMIN_FULL_NAME?.trim() || undefined,
    bootstrapAdminDisplayName: envSource.BOOTSTRAP_ADMIN_DISPLAY_NAME?.trim() || undefined,
    directDatabaseUrl: envSource.DIRECT_DATABASE_URL?.trim() || envSource.DATABASE_URL,
    runMigrationsOnStart:
      parseBooleanFlag(envSource.RUN_MIGRATIONS_ON_START) ?? nodeEnv === 'production',
    agentMode: agentEnv.SLYKBOARD_AGENT_MODE === 'true',
    dispatcherUrl: agentEnv.SLYKBOARD_DISPATCHER_URL,
    dispatcherToken: agentEnv.SLYKBOARD_DISPATCHER_TOKEN,
    slackEscalationWebhook: agentEnv.SLYKBOARD_SLACK_ESCALATION_WEBHOOK,
  };
}

export const env: Readonly<Config> = Object.freeze(loadConfig());
