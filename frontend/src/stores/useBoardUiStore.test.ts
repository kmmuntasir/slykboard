import { describe, it, expect, beforeEach } from 'vitest';
import { useBoardUiStore } from './useBoardUiStore';

describe('useBoardUiStore', () => {
  const tests = [
    {
      name: 'defaults dragInProgress to false',
      act: () => {},
      expected: false,
    },
    {
      name: 'setDragInProgress(true) flips flag true',
      act: () => useBoardUiStore.getState().setDragInProgress(true),
      expected: true,
    },
    {
      name: 'setDragInProgress(false) resets flag false',
      act: () => {
        useBoardUiStore.getState().setDragInProgress(true);
        useBoardUiStore.getState().setDragInProgress(false);
      },
      expected: false,
    },
  ];

  beforeEach(() => {
    useBoardUiStore.setState({ dragInProgress: false });
  });

  tests.forEach(({ name, act, expected }) => {
    it(name, () => {
      act();
      expect(useBoardUiStore.getState().dragInProgress).toBe(expected);
    });
  });
});
