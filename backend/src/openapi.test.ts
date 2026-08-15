// SLYK-0420 — OpenAPI document tests: structure, completeness against
// AGENT_API_PATHS (a new route that forgets registration fails here), and
// $ref integrity (zod-to-openapi throws on orphan refs at generation time —
// successful generation is itself the check, plus a manual sweep).
import { describe, it, expect } from 'vitest';

import { generateOpenApiDocument, AGENT_API_PATHS } from './openapi';

const doc = generateOpenApiDocument() as {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
  tags?: Array<{ name: string }>;
};

describe('generateOpenApiDocument', () => {
  it('is a valid OpenAPI 3 document with the agent API identity', () => {
    expect(doc.openapi).toBe('3.0.0');
    expect(doc.info.title).toBe('Slykboard Agent API');
    expect(doc.info.version).toBe('1.0.0');
  });

  it('registers every agent path (completeness — new routes must register)', () => {
    for (const entry of AGENT_API_PATHS) {
      const [method, path] = entry.split(' ') as [string, string];
      expect(doc.paths[path], `${path} missing from the spec`).toBeTruthy();
      expect(doc.paths[path]?.[method.toLowerCase()], `${method} ${path} missing`).toBeTruthy();
    }
    // No strays: every spec entry is in the canonical list.
    const canonical = new Set<string>(AGENT_API_PATHS);
    for (const [path, methods] of Object.entries(doc.paths)) {
      for (const method of Object.keys(methods)) {
        expect(canonical.has(`${method.toUpperCase()} ${path}`), `${method} ${path} is not in AGENT_API_PATHS`).toBe(true);
      }
    }
  });

  it('every operation declares at least one response', () => {
    for (const [path, methods] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(methods)) {
        expect(
          Object.keys(op.responses ?? {}).length,
          `${method} ${path} has no responses`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('the SSE route documents text/event-stream', () => {
    const op = doc.paths['/api/v1/me/tickets/{ticketId}/events']?.get;
    expect(op).toBeTruthy();
    expect(JSON.stringify(op?.responses)).toContain('text/event-stream');
  });

  it('no $ref points at an undefined component', () => {
    const components = JSON.stringify(doc).match(/"components"\s*:\s*{/) ? true : false;
    // Collect every $ref target used anywhere in the document.
    const docStr = JSON.stringify(doc);
    const refs = [...docStr.matchAll(/"\$ref"\s*:\s*"([^"]+)"/g)].map((m) => m[1] ?? '');
    const defined = new Set<string>();
    if (components) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const comps = (doc as any).components ?? {};
      for (const [group, entries] of Object.entries(comps)) {
        for (const name of Object.keys(entries as Record<string, unknown>)) {
          defined.add(`#/components/${group}/${name}`);
        }
      }
    }
    for (const ref of refs) {
      expect(defined.has(ref), `orphan $ref ${ref}`).toBe(true);
    }
  });

  it('memoizes — same object identity on repeat calls', () => {
    expect(generateOpenApiDocument()).toBe(generateOpenApiDocument());
  });
});
