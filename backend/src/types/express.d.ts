import type { ProjectRow } from '../services/projectService';

export interface AuthenticatedUser {
  id: string;
  email: string;
  // SLYK-01: replaces the global role enum. Populated by authenticate from the
  // JWT `pa` claim.
  isPlatformAdmin: boolean;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthenticatedUser;
    // SLYK-0150: raw request bytes, captured by the verify-configured json
    // parser mounted on /api/v1/internal (see index.ts). agentTokenAuth
    // verifies the dispatcher HMAC over these exact bytes — re-serialized
    // JSON would break the signature on key-ordering differences.
    rawBody?: Buffer;
    // SLYK-01 Task I: attached by requireProjectMember / resolveProject
    // middleware. The resolved ProjectRow (authorized for the caller).
    project?: ProjectRow;
    // SLYK-01 Task I: project-scoped member tier for the resolved project.
    // 'PROJECT_ADMIN' | 'MEMBER' = real membership row; null = Platform-Admin
    // bypass (not a real member); undefined = membership middleware has not run.
    projectMember?: 'PROJECT_ADMIN' | 'MEMBER' | null;
  }
}
