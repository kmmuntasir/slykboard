import { z } from 'zod';

// POST /api/auth/google body
export const authCodeSchema = z.object({
  code: z.string().min(1),
});
