import { beforeEach, describe, expect, it, vi } from 'vitest';

const bag = vi.hoisted(() => ({
  // listLabels: db.select({id,name,color}).from(labels).innerJoin(projects).where().orderBy()
  listLabelsRows: [] as Array<{ id: string; name: string; color: string }>,
  // createLabel / replaceTicketLabels: project lookup
  projectRow: [] as Array<Record<string, unknown>>,
  // createLabel: insert returning
  insertLabelReturn: [] as Array<Record<string, unknown>>,
  insertLabelError: null as unknown, // when set, insert() rejects
  lastInsertLabelValues: null as Record<string, unknown> | null,
  // updateLabel: existing label snapshot
  labelRow: [] as Array<Record<string, unknown>>,
  updateLabelReturn: [] as Array<Record<string, unknown>>,
  updateLabelError: null as unknown,
  // deleteLabel
  deleteLabelReturn: [] as Array<{ id: string }>,
  // hydrateLabelsForTickets
  hydrateRows: [] as Array<{
    ticketId: string;
    labelId: string;
    name: string;
    color: string;
  }>,
  selectInvoked: 0, // for "empty ticketIds -> select NOT called"
  // replaceTicketLabels: ticket lookup
  ticketRow: [] as Array<Record<string, unknown>>,
  // replaceTicketLabels: labels-in-project validation
  foundLabels: [] as Array<{ id: string }>,
  replaceInsertValues: null as Array<Record<string, unknown>> | null,
  replaceDeleteInvoked: false,
}));

vi.mock('../db/client', async () => {
  const { labels, projects, ticketLabels, tickets } = await import('../db/schema');

  // Distinguish labels-table select shapes by projection:
  //  - {id,name,color} -> listLabels innerJoin path
  //  - {id}            -> replaceTicketLabels validation path
  //  - undefined       -> updateLabel label-snapshot path
  const isListLabelsProjection = (p?: Record<string, unknown>) =>
    !!p && 'name' in p && 'color' in p;
  const isValidationProjection = (p?: Record<string, unknown>) =>
    !!p && 'id' in p && !('name' in p);

  const db = {
    select: (projection?: Record<string, unknown>) => {
      bag.selectInvoked++;
      const chain = {
        from: (table: unknown) => {
          // listLabels: select({id,name,color}).from(labels).innerJoin(projects).where().orderBy()
          if (table === labels && isListLabelsProjection(projection)) {
            return {
              innerJoin: () => ({
                where: () => ({ orderBy: () => Promise.resolve(bag.listLabelsRows) }),
              }),
            };
          }
          // replaceTicketLabels validation: select({id}).from(labels).where(and(...)) — terminal
          if (table === labels && isValidationProjection(projection)) {
            return { where: () => Promise.resolve(bag.foundLabels) };
          }
          // updateLabel snapshot: select().from(labels).where().limit()
          if (table === labels && !projection) {
            return { where: () => ({ limit: () => Promise.resolve(bag.labelRow) }) };
          }
          // createLabel / replaceTicketLabels: project lookup via select().from(projects).where().limit()
          if (table === projects) {
            return { where: () => ({ limit: () => Promise.resolve(bag.projectRow) }) };
          }
          // hydrateLabelsForTickets: select({...}).from(ticketLabels).innerJoin(labels).where()
          if (table === ticketLabels) {
            return {
              innerJoin: () => ({ where: () => Promise.resolve(bag.hydrateRows) }),
            };
          }
          // replaceTicketLabels: ticket lookup db.select().from(tickets).where().limit()
          if (table === tickets) {
            return { where: () => ({ limit: () => Promise.resolve(bag.ticketRow) }) };
          }
          return chain;
        },
        where: () => chain,
        limit: () => Promise.resolve([]),
        orderBy: () => Promise.resolve(bag.listLabelsRows),
        innerJoin: () => chain,
      };
      return chain;
    },
    insert: (table: unknown) => {
      if (table === labels) {
        return {
          values: (vals: Record<string, unknown>) => {
            bag.lastInsertLabelValues = vals;
            return {
              returning: () => {
                if (bag.insertLabelError) return Promise.reject(bag.insertLabelError);
                return Promise.resolve(bag.insertLabelReturn);
              },
            };
          },
        };
      }
      if (table === ticketLabels) {
        return {
          values: (vals: Array<Record<string, unknown>>) => {
            bag.replaceInsertValues = vals;
            return Promise.resolve([]);
          },
        };
      }
      return { values: () => Promise.resolve([]) };
    },
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => {
            if (bag.updateLabelError) return Promise.reject(bag.updateLabelError);
            return Promise.resolve(bag.updateLabelReturn);
          },
        }),
      }),
    }),
    delete: (table: unknown) => ({
      where: () => {
        if (table === labels) {
          return {
            returning: () => Promise.resolve(bag.deleteLabelReturn),
          };
        }
        if (table === ticketLabels) {
          bag.replaceDeleteInvoked = true;
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      },
    }),
  };
  return { db };
});

import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import {
  createLabel,
  deleteLabel,
  hydrateLabelsForTickets,
  listLabels,
  replaceTicketLabels,
  updateLabel,
} from './labelService';

function resetBag() {
  bag.listLabelsRows = [];
  bag.projectRow = [];
  bag.insertLabelReturn = [];
  bag.insertLabelError = null;
  bag.lastInsertLabelValues = null;
  bag.labelRow = [];
  bag.updateLabelReturn = [];
  bag.updateLabelError = null;
  bag.deleteLabelReturn = [];
  bag.hydrateRows = [];
  bag.selectInvoked = 0;
  bag.ticketRow = [];
  bag.foundLabels = [];
  bag.replaceInsertValues = null;
  bag.replaceDeleteInvoked = false;
}

const PROJECT_ID = 'p1';
const TICKET_ID = 't1';

describe('labelService listLabels', () => {
  beforeEach(resetBag);

  it('returns [] when project has no labels', async () => {
    bag.listLabelsRows = [];
    const out = await listLabels('SLYK');
    expect(out).toEqual([]);
  });

  it('returns labels sorted by name (passthrough of DB orderBy)', async () => {
    bag.listLabelsRows = [
      { id: 'l2', name: 'bug', color: '#FF0000' },
      { id: 'l1', name: 'api', color: '#00FF00' },
    ];
    const out = await listLabels('SLYK');
    expect(out.length).toBe(2);
    expect(out[0]!.id).toBe('l2');
  });

  it('passes the slug through to the where clause (cross-project isolation is DB-enforced)', async () => {
    bag.listLabelsRows = [{ id: 'l1', name: 'x', color: '#000000' }];
    await listLabels('OTHER');
    // DB layer receives whatever slug we pass; we assert no error path and a single
    // resolved row. Full isolation is covered by integration tests.
    const out = await listLabels('SLYK');
    expect(out).toEqual([{ id: 'l1', name: 'x', color: '#000000' }]);
  });
});

describe('labelService createLabel', () => {
  beforeEach(resetBag);

  it('inserts a label and returns the row with normalized color passthrough', async () => {
    bag.projectRow = [{ id: PROJECT_ID }];
    bag.insertLabelReturn = [
      {
        id: 'l1',
        projectId: PROJECT_ID,
        name: 'Bug',
        color: '#FF0000',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const out = await createLabel({ projectSlug: 'SLYK', name: 'Bug', color: '#ff0000' });

    expect(out.id).toBe('l1');
    expect(bag.lastInsertLabelValues).not.toBeNull();
    expect(bag.lastInsertLabelValues!.projectId).toBe(PROJECT_ID);
    expect(bag.lastInsertLabelValues!.name).toBe('Bug');
    expect(bag.lastInsertLabelValues!.color).toBe('#ff0000');
  });

  it('throws CONFLICT on duplicate (project_id, name) via PG 23505', async () => {
    bag.projectRow = [{ id: PROJECT_ID }];
    bag.insertLabelError = { code: '23505' };

    const error = await createLabel({
      projectSlug: 'SLYK',
      name: 'Bug',
      color: '#FF0000',
    }).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.CONFLICT);
  });

  it('throws NOT_FOUND when project slug is unknown', async () => {
    bag.projectRow = [];

    const error = await createLabel({
      projectSlug: 'ghost',
      name: 'Bug',
      color: '#FF0000',
    }).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.NOT_FOUND);
    expect(bag.lastInsertLabelValues).toBeNull();
  });

  it('rethrows non-unique errors unchanged', async () => {
    bag.projectRow = [{ id: PROJECT_ID }];
    const other = new Error('connection refused');
    bag.insertLabelError = other;

    const error = await createLabel({
      projectSlug: 'SLYK',
      name: 'Bug',
      color: '#FF0000',
    }).catch((e) => e);

    expect(error).toBe(other);
  });
});

describe('labelService updateLabel', () => {
  beforeEach(resetBag);

  it('applies rename + recolor and returns {old, new} snapshots', async () => {
    const old = {
      id: 'l1',
      projectId: PROJECT_ID,
      name: 'Bug',
      color: '#FF0000',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const next = { ...old, name: 'Defect', color: '#00FF00' };
    bag.labelRow = [old];
    bag.updateLabelReturn = [next];

    const result = await updateLabel({
      labelId: 'l1',
      patch: { name: 'Defect', color: '#00FF00' },
    });

    expect(result.old).toBe(old);
    expect(result.new).toBe(next);
  });

  it('throws CONFLICT when rename collides with an existing name (PG 23505)', async () => {
    bag.labelRow = [
      {
        id: 'l1',
        projectId: PROJECT_ID,
        name: 'Bug',
        color: '#FF0000',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    bag.updateLabelError = { code: '23505' };

    const error = await updateLabel({
      labelId: 'l1',
      patch: { name: 'Existing' },
    }).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.CONFLICT);
  });

  it('throws NOT_FOUND when the label id is absent', async () => {
    bag.labelRow = [];

    const error = await updateLabel({
      labelId: 'missing',
      patch: { name: 'X' },
    }).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.NOT_FOUND);
  });
});

describe('labelService deleteLabel', () => {
  beforeEach(resetBag);

  it('deletes the label and returns {id}', async () => {
    bag.deleteLabelReturn = [{ id: 'l1' }];

    const out = await deleteLabel('l1');

    expect(out).toEqual({ id: 'l1' });
  });

  it('throws NOT_FOUND when the label id is absent', async () => {
    bag.deleteLabelReturn = [];

    const error = await deleteLabel('missing').catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.NOT_FOUND);
  });

  // Cascade delete of TicketLabels is enforced at the DB layer via FK ON DELETE
  // CASCADE — not testable here without simulating the DB trigger.
});

describe('labelService hydrateLabelsForTickets', () => {
  beforeEach(resetBag);

  it('returns an empty Map and does NOT invoke db.select when ticketIds is empty', async () => {
    const before = bag.selectInvoked;
    const out = await hydrateLabelsForTickets([]);
    expect(out.size).toBe(0);
    expect(bag.selectInvoked).toBe(before);
  });

  it('returns a Map keyed by ticketId for a single ticket with labels', async () => {
    bag.hydrateRows = [
      { ticketId: TICKET_ID, labelId: 'l1', name: 'bug', color: '#FF0000' },
      { ticketId: TICKET_ID, labelId: 'l2', name: 'api', color: '#00FF00' },
    ];

    const out = await hydrateLabelsForTickets([TICKET_ID]);

    expect(out.size).toBe(1);
    expect(out.get(TICKET_ID)).toEqual([
      { id: 'l1', name: 'bug', color: '#FF0000' },
      { id: 'l2', name: 'api', color: '#00FF00' },
    ]);
  });

  it('aggregates labels across multiple tickets', async () => {
    bag.hydrateRows = [
      { ticketId: 't1', labelId: 'l1', name: 'a', color: '#000000' },
      { ticketId: 't2', labelId: 'l2', name: 'b', color: '#111111' },
    ];

    const out = await hydrateLabelsForTickets(['t1', 't2']);

    expect(out.size).toBe(2);
    expect(out.get('t1')!.length).toBe(1);
    expect(out.get('t2')!.length).toBe(1);
  });

  it('ticket with no label rows yields no Map entry (DB returns nothing for it)', async () => {
    bag.hydrateRows = []; // no rows for t1
    const out = await hydrateLabelsForTickets([TICKET_ID]);
    // Map does NOT contain the key — caller must default to [] at the read site.
    expect(out.has(TICKET_ID)).toBe(false);
  });
});

describe('labelService replaceTicketLabels', () => {
  beforeEach(resetBag);

  it('deletes then inserts the new label set', async () => {
    bag.ticketRow = [{ id: TICKET_ID, projectId: PROJECT_ID }];
    bag.foundLabels = [{ id: 'l1' }, { id: 'l2' }];

    await replaceTicketLabels({ ticketId: TICKET_ID, labelIds: ['l1', 'l2'] });

    expect(bag.replaceDeleteInvoked).toBe(true);
    expect(bag.replaceInsertValues).toEqual([
      { ticketId: TICKET_ID, labelId: 'l1' },
      { ticketId: TICKET_ID, labelId: 'l2' },
    ]);
  });

  it('throws VALIDATION_FAILED when a label does not belong to the project', async () => {
    bag.ticketRow = [{ id: TICKET_ID, projectId: PROJECT_ID }];
    // asked for 2, found 1 -> mismatch
    bag.foundLabels = [{ id: 'l1' }];

    const error = await replaceTicketLabels({
      ticketId: TICKET_ID,
      labelIds: ['l1', 'foreign'],
    }).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(bag.replaceDeleteInvoked).toBe(false);
  });

  it('with empty labelIds performs delete only, no insert', async () => {
    bag.ticketRow = [{ id: TICKET_ID, projectId: PROJECT_ID }];

    await replaceTicketLabels({ ticketId: TICKET_ID, labelIds: [] });

    expect(bag.replaceDeleteInvoked).toBe(true);
    expect(bag.replaceInsertValues).toBeNull();
  });

  it('throws NOT_FOUND when ticket id is absent', async () => {
    bag.ticketRow = [];

    const error = await replaceTicketLabels({
      ticketId: 'missing',
      labelIds: ['l1'],
    }).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.NOT_FOUND);
    expect(bag.replaceDeleteInvoked).toBe(false);
  });
});
