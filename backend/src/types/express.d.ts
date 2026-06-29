import type { ProjectRow } from '../services/projectService';

export interface AuthenticatedUser {
  id: string;
  email: string;
  // SLYK-01: replaces the global role enum. Populated by authenticate from the
  // JWT `pa` claim.
  isPlatformAdmin: boolean;
  // SLYK-01: project-scoped member context, set by requireProjectMember /
  // resolveProject middleware (Batch 3). `null` = Platform-Admin bypass (not a
  // real member); undefined = middleware has not run.
  projectMember?: 'PROJECT_ADMIN' | 'MEMBER' | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthenticatedUser;
    // F47: attached by requireProjectMember middleware (creator || admin gate).
    project?: ProjectRow;
  }
}
