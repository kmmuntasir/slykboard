import { z } from 'zod';

const HEX_RE = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

export const hexColorSchema = z
  .string()
  .regex(HEX_RE, 'Invalid hex color')
  .transform((h) => {
    const clean = h.slice(1).toUpperCase();
    return clean.length === 3
      ? '#' +
          clean
            .split('')
            .map((c) => c + c)
            .join('')
      : '#' + clean;
  });

export const slugParam = z.object({
  slug: z
    .string()
    .min(2)
    .max(16)
    .regex(/^[A-Z][A-Z0-9]{1,15}$/, 'Invalid slug'),
});

export const labelIdParam = z.object({
  id: z.string().uuid(),
});

export const createLabelBody = z.object({
  name: z.string().min(1).max(50),
  color: hexColorSchema,
});

export const updateLabelBody = z
  .object({
    name: z.string().min(1).max(50).optional(),
    color: hexColorSchema.optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'Body must include at least one field' });
