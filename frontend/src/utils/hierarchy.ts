import type { Ticket } from '@/types/ticket';

// CR-03: pure hierarchy helpers shared by the board, the detail modal, and the
// delete-confirm tree. Board payloads carry the full live ticket set, so all
// tree math is in-memory (max depth 3 by the rank ordering).

export interface HierarchyNode {
  ticket: Ticket;
  children: HierarchyNode[];
}

/** Live descendant tree of `rootId` (the root itself is NOT included). */
export function buildDescendantTree(
  tickets: ReadonlyArray<Ticket>,
  rootId: string,
): HierarchyNode[] {
  const byParent = new Map<string, Ticket[]>();
  for (const ticket of tickets) {
    if (ticket.parentId === null) continue;
    const list = byParent.get(ticket.parentId) ?? [];
    list.push(ticket);
    byParent.set(ticket.parentId, list);
  }
  const seen = new Set<string>([rootId]); // corrupt-cycle guard
  const build = (parentId: string): HierarchyNode[] =>
    (byParent.get(parentId) ?? [])
      .filter((ticket) => !seen.has(ticket.id) && (seen.add(ticket.id), true))
      .map((ticket) => ({ ticket, children: build(ticket.id) }));
  return build(rootId);
}

/** Total node count of a forest (children + grandchildren + …). */
export function countNodes(nodes: ReadonlyArray<HierarchyNode>): number {
  return nodes.reduce((sum, node) => sum + 1 + countNodes(node.children), 0);
}

// Stable epic-chip colors derived from the epic id (deterministic across
// sessions/clients — no persistence needed).
const EPIC_COLOR_CLASSES = [
  'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/40',
  'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/40',
  'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40',
  'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40',
  'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40',
  'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/40',
] as const;

export function epicColorClass(epicId: string): string {
  let hash = 0;
  for (let i = 0; i < epicId.length; i += 1) {
    hash = (hash * 31 + epicId.charCodeAt(i)) | 0;
  }
  return EPIC_COLOR_CLASSES[Math.abs(hash) % EPIC_COLOR_CLASSES.length]!;
}
