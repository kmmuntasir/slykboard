import { z } from 'zod';

// SLYK-0190 — request validation for POST /api/v1/admin/projects
// (docs/agentic-automation/05-backend-routes.md § admin routes).
// SLYK-0150 left the param shapes here; SLYK-0190 adds the create-project
// body. SLYK-0210 adds the decommission confirmation body; SLYK-0370 adds
// the agent-token body + id param.

export const slugParam = z.object({
  slug: z.string().min(1),
});

// Subdomains are not first-come: these hostnames serve shared infrastructure
// (API edge, www root, admin UI, the dispatcher itself, cyrus routing).
// 05-backend-routes.md § reserved list.
export const RESERVED_SUBDOMAINS: readonly string[] = [
  'api',
  'www',
  'admin',
  'dispatcher',
  'cyrus',
];

// Agent-mode slugs/subdomains are lowercase kebab — a DIFFERENT alphabet from
// the plain-mode project slug (utils/slug.ts, uppercase 2–16). Do not reuse
// SLUG_REGEX here.
const KEBAB_REGEX = /^[a-z0-9-]+$/;

// SSH strongly preferred, HTTPS accepted (04-schema.md ProjectAgentMeta.githubRepo).
const GITHUB_REPO_SSH_REGEX = /^git@github\.com:[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+\.git$/;
const GITHUB_REPO_HTTPS_REGEX = /^https:\/\/github\.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+\.git$/;

function isGithubRepoUrl(value: string): boolean {
  return GITHUB_REPO_SSH_REGEX.test(value) || GITHUB_REPO_HTTPS_REGEX.test(value);
}

const STACKS = ['node-express', 'next', 'python-fastapi', 'go', 'static'] as const;
const SOURCE_MODES = ['new', 'existing'] as const;
const VISIBILITIES = ['internal', 'public'] as const;

export const createAgentProjectBody = z
  .object({
    name: z.string().min(1, 'Name is required').max(200, 'Name must be ≤200 chars'),
    slug: z
      .string()
      .min(1, 'Slug is required')
      .max(63)
      .regex(KEBAB_REGEX, 'Slug must be lowercase alphanumeric with hyphens'),
    subdomain: z
      .string()
      .min(1, 'Subdomain is required')
      .max(63)
      .regex(KEBAB_REGEX, 'Subdomain must be lowercase alphanumeric with hyphens')
      .refine((subdomain) => !RESERVED_SUBDOMAINS.includes(subdomain), {
        message: `Subdomain is reserved (${RESERVED_SUBDOMAINS.join(', ')})`,
      }),
    sourceMode: z.enum(SOURCE_MODES),
    // default(null) normalizes an omitted field to null so downstream sees
    // string | null only.
    githubRepo: z
      .string()
      .refine(isGithubRepoUrl, 'githubRepo must be an SSH or HTTPS GitHub .git URL')
      .nullable()
      .default(null),
    stack: z.enum(STACKS),
    agentBackend: z.string().min(1).nullable(),
    visibility: z.enum(VISIBILITIES).default('internal'),
    initialAgentContext: z
      .string()
      .max(10_000, 'initialAgentContext must be ≤10,000 chars')
      .nullable(),
  })
  // sourceMode ↔ githubRepo pairing: required iff 'existing', must be null
  // when 'new' (dispatcher fills it post-creation).
  .superRefine((body, ctx) => {
    if (body.sourceMode === 'existing' && body.githubRepo === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['githubRepo'],
        message: 'githubRepo is required when sourceMode is "existing"',
      });
    }
    if (body.sourceMode === 'new' && body.githubRepo !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['githubRepo'],
        message: 'githubRepo must be null when sourceMode is "new"',
      });
    }
  });

// SLYK-0210 — decommission is the system's most destructive action
// (03-security.md § Decommission safety layer 2): the admin must retype the
// project slug. Shape-only check here; the service compares it against the
// loaded meta row (slug is public in URLs, so the mismatch response may name
// it — nothing beyond it).
export const decommissionProjectBody = z.object({
  confirmSlug: z.string().min(1, 'confirmSlug is required'),
});

// SLYK-0370 — generate body (05-backend-routes.md § POST /api/v1/admin/
// agent-tokens). name 1..200 free text; projectId null = platform-wide.
// Names are NOT unique (04-schema.md AgentTokens) — duplicates allowed.
export const agentTokenBody = z.object({
  name: z.string().min(1, 'Name is required').max(200, 'Name must be ≤200 chars'),
  projectId: z.uuid().nullable(),
});

export const agentTokenParam = z.object({
  id: z.uuid(),
});

export type SlugParam = z.infer<typeof slugParam>;
export type CreateAgentProjectBody = z.infer<typeof createAgentProjectBody>;
export type DecommissionProjectBody = z.infer<typeof decommissionProjectBody>;
export type AgentTokenBody = z.infer<typeof agentTokenBody>;
export type AgentTokenParam = z.infer<typeof agentTokenParam>;
