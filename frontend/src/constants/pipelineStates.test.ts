import { describe, it, expect } from 'vitest';
import {
  PIPELINE_STATES,
  PIPELINE_STATE_LABEL,
  FAILED_PIPELINE_STATES,
  isFailedPipelineState,
} from './pipelineStates';

// SLYK-0310 — the 15-state vocabulary and its plain-English map are the
// single source shared by <PipelinePanel> and <FailedPipelineBadge>
// (06-frontend-ui.md § state map, verbatim).

describe('pipelineStates', () => {
  it('holds all 15 states in enum order', () => {
    expect(PIPELINE_STATES).toHaveLength(15);
    expect(PIPELINE_STATES[0]).toBe('BACKLOG');
    expect(PIPELINE_STATES[9]).toBe('DONE');
    expect(PIPELINE_STATES[14]).toBe('BLOCKED_HUMAN');
  });

  it('labels every state (no gaps, plain English)', () => {
    for (const state of PIPELINE_STATES) {
      expect(PIPELINE_STATE_LABEL[state]).toBeTruthy();
    }
    expect(PIPELINE_STATE_LABEL.BACKLOG).toBe('Task queued');
    expect(PIPELINE_STATE_LABEL.AGENT_RUNNING).toBe('Agent started (Cyrus session)');
    expect(PIPELINE_STATE_LABEL.DONE).toBe('Deployed');
    expect(PIPELINE_STATE_LABEL.FAILED_CI).toBe('Automated tests failed');
    expect(PIPELINE_STATE_LABEL.BLOCKED_HUMAN).toBe('Needs human help');
  });

  describe('isFailedPipelineState (badge gating)', () => {
    const tests: Array<{ name: string; state: string | null | undefined; expected: boolean }> = [
      { name: 'FAILED_AGENT', state: 'FAILED_AGENT', expected: true },
      { name: 'FAILED_CI', state: 'FAILED_CI', expected: true },
      { name: 'FAILED_CONFLICT', state: 'FAILED_CONFLICT', expected: true },
      { name: 'FAILED_DEPLOY', state: 'FAILED_DEPLOY', expected: true },
      { name: 'BLOCKED_HUMAN', state: 'BLOCKED_HUMAN', expected: true },
      { name: 'QUEUED (healthy)', state: 'QUEUED', expected: false },
      { name: 'AGENT_RUNNING (healthy)', state: 'AGENT_RUNNING', expected: false },
      { name: 'DONE (terminal success)', state: 'DONE', expected: false },
      { name: 'null (plain mode)', state: null, expected: false },
      { name: 'undefined (field absent)', state: undefined, expected: false },
    ];

    tests.forEach(({ name, state, expected }) => {
      it(`${name} → ${expected}`, () => {
        expect(isFailedPipelineState(state as never)).toBe(expected);
      });
    });

    it('failed set covers exactly the 5 failure states', () => {
      expect(FAILED_PIPELINE_STATES).toHaveLength(5);
      for (const state of PIPELINE_STATES) {
        expect(isFailedPipelineState(state)).toBe(FAILED_PIPELINE_STATES.includes(state));
      }
    });
  });
});
