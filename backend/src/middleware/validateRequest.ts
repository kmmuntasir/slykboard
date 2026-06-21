import type { Request, Response, NextFunction } from 'express';
import type { ZodTypeAny } from 'zod';
import { flattenError } from 'zod';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';

// Accept either a single schema (applied to body) or a per-source partial.
export interface ValidationSchema {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

type SchemaInput = ZodTypeAny | ValidationSchema;

function isZodSchema(s: SchemaInput): s is ZodTypeAny {
  return typeof (s as ZodTypeAny).parse === 'function';
}

function normalize(schema: SchemaInput): ValidationSchema {
  return isZodSchema(schema) ? { body: schema } : schema;
}

/**
 * Edge validation factory. Usage:
 *   router.post('/x', validateRequest(z.object({ name: z.string() })), handler)
 *   router.get('/x/:id', validateRequest({ params: z.object({ id: z.uuid() }) }), handler)
 *
 * On success, overwrites req.body / req.query / req.params with the parsed
 * (typed, coerced, stripped) values. On failure throws AppError with
 * code VALIDATION_FAILED, status 400, details = z.flattenError(err).
 */
export function validateRequest(schema: SchemaInput) {
  const normalized = normalize(schema);

  return (req: Request, _res: Response, next: NextFunction): void => {
    const sources: Array<keyof ValidationSchema> = ['body', 'query', 'params'];

    for (const source of sources) {
      const s = normalized[source];
      if (!s) continue;

      const result = s.safeParse(req[source]);
      if (!result.success) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, 'Request validation failed', {
          details: {
            source,
            issues: flattenError(result.error), // Zod 4: { formErrors, fieldErrors }
          },
        });
      }
      // Overwrite with parsed (coerced/stripped) value.
      (req[source] as unknown) = result.data;
    }

    next();
  };
}
