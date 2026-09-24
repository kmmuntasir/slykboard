import { describe, expect, it } from 'vitest';

import { buildDescendantTree, countNodes, epicColorClass } from './hierarchy';
import { makeTicket } from '@/test/makeTicket';

// CR-03: pure tree/format helpers for the board chips + cascade-delete confirm.

const epic = makeTicket({ id: 'e1', title: 'Epic', type: 'EPIC' });
const story = makeTicket({ id: 's1', title: 'Story', type: 'STORY', parentId: 'e1' });
const task = makeTicket({ id: 't1', title: 'Task', type: 'TASK', parentId: 's1' });
const sub1 = makeTicket({ id: 'b1', title: 'Sub 1', type: 'SUBTASK', parentId: 't1' });
const sub2 = makeTicket({ id: 'b2', title: 'Sub 2', type: 'SUBTASK', parentId: 't1' });
const other = makeTicket({ id: 'o1', title: 'Other task', type: 'TASK' });
const all = [epic, story, task, sub1, sub2, other];

describe('buildDescendantTree (CR-03)', () => {
  it('builds the nested tree of a root (children + grandchildren + …)', () => {
    const tree = buildDescendantTree(all, 'e1');
    expect(tree).toHaveLength(1);
    expect(tree[0]!.ticket.id).toBe('s1');
    expect(tree[0]!.children[0]!.ticket.id).toBe('t1');
    expect(tree[0]!.children[0]!.children.map((n) => n.ticket.id)).toEqual(['b1', 'b2']);
  });

  it('returns an empty forest for a leaf root', () => {
    expect(buildDescendantTree(all, 'b1')).toEqual([]);
  });

  it('excludes the root itself', () => {
    const tree = buildDescendantTree(all, 'e1');
    expect(tree.map((n) => n.ticket.id)).not.toContain('e1');
  });

  it('guards against corrupt parent cycles (no infinite recursion)', () => {
    const a = makeTicket({ id: 'a', parentId: 'b' });
    const b = makeTicket({ id: 'b', parentId: 'a' });
    expect(() => buildDescendantTree([a, b], 'a')).not.toThrow();
  });
});

describe('countNodes (CR-03)', () => {
  it('counts the whole forest', () => {
    expect(countNodes(buildDescendantTree(all, 'e1'))).toBe(4);
  });

  it('is 0 for an empty forest', () => {
    expect(countNodes([])).toBe(0);
  });
});

describe('epicColorClass (CR-03)', () => {
  it('is deterministic for the same epic id', () => {
    expect(epicColorClass('epic-1')).toBe(epicColorClass('epic-1'));
  });

  it('returns a class string for distinct ids', () => {
    expect(epicColorClass('a')).toMatch(/bg-/);
    expect(epicColorClass('b')).toMatch(/bg-/);
  });
});
