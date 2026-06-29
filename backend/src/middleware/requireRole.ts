// SLYK-01 Task I — TEMPORARY compat shim. The canonical gate now lives in
// `requirePlatformAdmin.ts`. This file exists ONLY so route files owned by
// Task K (projects/tickets/labels/users.routes.ts) that still import from
// `'../middleware/requireRole'` keep compiling until Task K sweeps them to
// `requirePlatformAdmin()`. Task K deletes this file. Do NOT add new imports
// from this path.
export { requirePlatformAdmin, requireRole } from './requirePlatformAdmin';
