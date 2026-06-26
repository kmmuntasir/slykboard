import type { ProjectRow } from '../services/projectService';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: 'ADMIN' | 'MEMBER';
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthenticatedUser;
    // F47: attached by requireProjectMember middleware (creator || admin gate).
    project?: ProjectRow;
  }
}
