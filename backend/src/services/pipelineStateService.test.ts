import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RETRY_CAP,
  LEGAL_TRANSITIONS,
  PIPELINE_STATES,
  assertLegalTransition,
  exceedsRetryCap,
  isLegalTransition,
  type PipelineState,
} from './pipelineStateService';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';

// SLYK-0250: exhaustive matrix coverage. The legal cells below are transcribed
// from the 15×15 table in 05-backend-routes.md § Pipeline state transitions —
// every other cell must throw.
const LEGAL: ReadonlyArray<readonly [PipelineState, PipelineState]> = [
  ['BACKLOG', 'QUEUED'],
  ['QUEUED', 'AGENT_RUNNING'],
  ['QUEUED', 'FAILED_AGENT'],
  ['AGENT_RUNNING', 'AGENT_WAITING'],
  ['AGENT_RUNNING', 'PR_OPEN'],
  ['AGENT_RUNNING', 'FAILED_AGENT'],
  ['AGENT_WAITING', 'AGENT_RUNNING'],
  ['AGENT_WAITING', 'FAILED_AGENT'],
  ['PR_OPEN', 'CI_RUNNING'],
  ['CI_RUNNING', 'MERGING'],
  ['CI_RUNNING', 'FAILED_CI'],
  ['MERGING', 'CONFLICT_RETRY'],
  ['MERGING', 'DONE'],
  ['CONFLICT_RETRY', 'MERGING'],
  ['CONFLICT_RETRY', 'FAILED_CONFLICT'],
  ['DEPLOYING', 'DONE'],
  ['DEPLOYING', 'FAILED_DEPLOY'],
  ['FAILED_AGENT', 'QUEUED'],
  ['FAILED_AGENT', 'BLOCKED_HUMAN'],
  ['FAILED_CI', 'QUEUED'],
  ['FAILED_CI', 'BLOCKED_HUMAN'],
  ['FAILED_CONFLICT', 'QUEUED'],
  ['FAILED_CONFLICT', 'BLOCKED_HUMAN'],
  ['FAILED_DEPLOY', 'QUEUED'],
  ['FAILED_DEPLOY', 'BLOCKED_HUMAN'],
  ['BLOCKED_HUMAN', 'QUEUED'],
];

const legalKeys = new Set(LEGAL.map(([from, to]) => `${from}->${to}`));

function assertIllegal(from: PipelineState, to: PipelineState) {
  // Table cells only carry from/to — default attempts=0 keeps retry-cap out of
  // the matrix test (it has its own describe below).
  expect(() => assertLegalTransition(from, to), `${from} -> ${to} must be illegal`).toThrow(
    AppError,
  );
  try {
    assertLegalTransition(from, to);
  } catch (err) {
    const appErr = err as AppError;
    expect(appErr.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(appErr.status).toBe(400);
    expect(appErr.details).toEqual({ from, to });
    expect(appErr.message).toBe(`Cannot transition from ${from} to ${to}`);
  }
}

// ── 1. Exhaustive 15×15 matrix ────────────────────────────────────────────
describe('pipeline transition matrix (every cell of 15×15 = 225)', () => {
  it('LEGAL_TRANSITIONS matches the spec table cell-for-cell', () => {
    expect([...LEGAL_TRANSITIONS].sort()).toEqual([...legalKeys].sort());
    expect(LEGAL_TRANSITIONS.size).toBe(LEGAL.length);
  });

  PIPELINE_STATES.forEach((from) => {
    describe(`from ${from}`, () => {
      PIPELINE_STATES.forEach((to) => {
        const legal = legalKeys.has(`${from}->${to}`);
        it(`${from} -> ${to}: ${legal ? 'legal' : 'illegal'}`, () => {
          expect(isLegalTransition(from, to)).toBe(legal);
          if (legal) {
            expect(() => assertLegalTransition(from, to)).not.toThrow();
          } else {
            assertIllegal(from, to);
          }
        });
      });
    });
  });

  it('covers all 225 cells (sanity: 15 states, 26 legal)', () => {
    expect(PIPELINE_STATES.length).toBe(15);
    expect(PIPELINE_STATES.length ** 2).toBe(225);
    expect(LEGAL.length).toBe(26);
  });
});

// ── 2. Terminal DONE ──────────────────────────────────────────────────────
describe('DONE is terminal', () => {
  it('rejects every transition out of DONE', () => {
    PIPELINE_STATES.filter((to) => to !== 'DONE').forEach((to) => {
      assertIllegal('DONE', to);
    });
  });

  it('rejects DONE -> DONE too', () => {
    assertIllegal('DONE', 'DONE');
  });
});

// ── 3. Retry cap ──────────────────────────────────────────────────────────
describe('exceedsRetryCap', () => {
  const cases = [
    { attempts: 0, cap: 3, expected: false },
    { attempts: 2, cap: 3, expected: false },
    { attempts: 3, cap: 3, expected: true },
    { attempts: 4, cap: 3, expected: true },
    { attempts: 2, cap: 2, expected: true },
    { attempts: 0, cap: 0, expected: true },
  ];

  cases.forEach(({ attempts, cap, expected }) => {
    it(`attempts=${attempts}, cap=${cap} → ${expected}`, () => {
      expect(exceedsRetryCap(attempts, cap)).toBe(expected);
    });
  });

  it('defaults cap to DEFAULT_RETRY_CAP (3)', () => {
    expect(exceedsRetryCap(2)).toBe(false);
    expect(exceedsRetryCap(3)).toBe(true);
    expect(DEFAULT_RETRY_CAP).toBe(3);
  });
});

describe('retry cap enforcement in assertLegalTransition', () => {
  const FAILED_STATES: PipelineState[] = [
    'FAILED_AGENT',
    'FAILED_CI',
    'FAILED_CONFLICT',
    'FAILED_DEPLOY',
  ];

  const boundaryCases = [2, 3, 4].map((attempts) => ({
    attempts,
    queuedLegal: attempts < DEFAULT_RETRY_CAP,
  }));

  FAILED_STATES.forEach((from) => {
    boundaryCases.forEach(({ attempts, queuedLegal }) => {
      it(`${from} -> QUEUED at attempts=${attempts}: ${queuedLegal ? 'legal' : 'throws'}`, () => {
        if (queuedLegal) {
          expect(() => assertLegalTransition(from, 'QUEUED', attempts)).not.toThrow();
        } else {
          expect(() => assertLegalTransition(from, 'QUEUED', attempts)).toThrow(AppError);
          try {
            assertLegalTransition(from, 'QUEUED', attempts);
          } catch (err) {
            const appErr = err as AppError;
            expect(appErr.code).toBe(ErrorCode.VALIDATION_FAILED);
            expect(appErr.status).toBe(400);
            expect(appErr.details).toEqual({ from, to: 'QUEUED' });
            expect(appErr.message).toContain('BLOCKED_HUMAN');
          }
        }
      });

      it(`${from} -> BLOCKED_HUMAN at attempts=${attempts}: always legal (only exit at cap)`, () => {
        expect(() => assertLegalTransition(from, 'BLOCKED_HUMAN', attempts)).not.toThrow();
      });
    });
  });

  it('honors a custom cap', () => {
    expect(() => assertLegalTransition('FAILED_AGENT', 'QUEUED', 2, 5)).not.toThrow();
    expect(() => assertLegalTransition('FAILED_AGENT', 'QUEUED', 5, 5)).toThrow(AppError);
  });

  it('cap does not affect non-retryable from-states', () => {
    // BACKLOG → QUEUED with attempts past the cap: attempts only counts
    // FAILED_* retries, so a fresh queue must not be blocked.
    expect(() => assertLegalTransition('BACKLOG', 'QUEUED', 99)).not.toThrow();
    expect(() => assertLegalTransition('BLOCKED_HUMAN', 'QUEUED', 99)).not.toThrow();
  });

  it('cap does not rescue illegal transitions', () => {
    // FAILED_AGENT → AGENT_RUNNING is illegal regardless of attempts.
    expect(() => assertLegalTransition('FAILED_AGENT', 'AGENT_RUNNING', 0)).toThrow(AppError);
  });
});
