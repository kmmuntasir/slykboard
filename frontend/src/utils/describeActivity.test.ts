import { describe, it, expect } from 'vitest';

import { actorLabel, describeActivity } from './describeActivity';
import type { ActivityEntry } from '@/types/activity';

// F19 T2: table-driven sentence-switch over actionType (REQ-5.2/5.3 grammar) +
// removed-entity edge fallbacks (null actor / null from-to / priority Title-Case).

function entry(partial: Partial<ActivityEntry>): ActivityEntry {
    return {
        id: 'log-1',
        createdAt: '2026-06-24T10:00:00.000Z',
        actionType: 'CREATED',
        actor: { id: 'u1', fullName: 'Muntasir', avatarUrl: null },
        from: null,
        to: null,
        message: null,
        ...partial,
    };
}

describe('describeActivity', () => {
    const cases: Array<{ name: string; input: ActivityEntry; expected: string }> = [
        {
            name: 'CREATED → created the ticket',
            input: entry({ actionType: 'CREATED' }),
            expected: 'created the ticket',
        },
        {
            name: 'STATUS_CHANGED → moved from {from} to {to}',
            input: entry({ actionType: 'STATUS_CHANGED', from: 'To Do', to: 'In Progress' }),
            expected: 'moved from To Do to In Progress',
        },
        {
            name: 'PRIORITY_CHANGED → Title-Cases the enum via PRIORITY_DISPLAY',
            input: entry({ actionType: 'PRIORITY_CHANGED', from: 'LOW', to: 'HIGH' }),
            expected: 'changed Priority from Low to High',
        },
        {
            name: 'ASSIGNEE_CHANGED → changed assignee from {from} to {to}',
            input: entry({ actionType: 'ASSIGNEE_CHANGED', from: 'Alice', to: 'Bob' }),
            expected: 'changed assignee from Alice to Bob',
        },
        {
            name: 'LABELS_CHANGED → passthrough readable message',
            input: entry({ actionType: 'LABELS_CHANGED', message: 'added: Bug; removed: API' }),
            expected: 'added: Bug; removed: API',
        },
        {
            name: 'CONTENT_UPDATED → generic, no diff (REQ-5.3)',
            input: entry({ actionType: 'CONTENT_UPDATED' }),
            expected: 'updated the description',
        },
    ];

    cases.forEach(({ name, input, expected }) => {
        it(name, () => {
            expect(describeActivity(input).clause).toBe(expected);
        });
    });

    it('LABELS_CHANGED falls back to "updated labels" when message is null', () => {
        expect(describeActivity(entry({ actionType: 'LABELS_CHANGED', message: null })).clause).toBe(
            'updated labels',
        );
    });

    it('STATUS_CHANGED with null from/to renders the "Unknown user" fallback', () => {
        expect(
            describeActivity(entry({ actionType: 'STATUS_CHANGED', from: null, to: null })).clause,
        ).toBe('moved from Unknown user to Unknown user');
    });

    it('ASSIGNEE_CHANGED with null from/to renders the "Unknown user" fallback', () => {
        expect(
            describeActivity(entry({ actionType: 'ASSIGNEE_CHANGED', from: null, to: null }))
                .clause,
        ).toBe('changed assignee from Unknown user to Unknown user');
    });

    it('PRIORITY_CHANGED with a null side falls back via displayPriority', () => {
        expect(
            describeActivity(entry({ actionType: 'PRIORITY_CHANGED', from: null, to: 'HIGH' }))
                .clause,
        ).toBe('changed Priority from Unknown user to High');
    });
});

describe('actorLabel', () => {
    it('returns the actor fullName', () => {
        expect(
            actorLabel(entry({ actor: { id: 'u1', fullName: 'Muntasir', avatarUrl: null } })),
        ).toBe('Muntasir');
    });

    it('returns "Unknown user" for a null actor (deleted user)', () => {
        expect(actorLabel(entry({ actor: null }))).toBe('Unknown user');
    });
});
