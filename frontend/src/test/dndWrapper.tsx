import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { DragDropContext, Droppable } from '@hello-pangea/dnd';
import { TooltipProvider } from '@/components/ui/Tooltip';

// pangea's <Draggable> (mounted inside TicketCard) requires a <DragDropContext> +
// <Droppable> ancestor or it throws on mount. This wrapper provides the minimal
// context so leaf-card tests can render+assert without pointer DnD (jsdom cannot
// drive pangea's pointer sensor — drag behavior is unit-tested via pure functions
// in boardReorder.test.ts, not here).
//
// TooltipProvider is mounted app-wide in main.tsx (production); mount it here too
// — TicketCard renders AssigneeAvatar, whose Radix Tooltip throws without it.
export function renderInDnd(ui: ReactElement) {
    return render(
        <TooltipProvider>
            <DragDropContext onDragEnd={() => {}}>
                <Droppable droppableId="test-col" type="CARD" direction="vertical">
                    {(provided) => (
                        <div ref={provided.innerRef} {...provided.droppableProps}>
                            {ui}
                            {provided.placeholder}
                        </div>
                    )}
                </Droppable>
            </DragDropContext>
        </TooltipProvider>,
    );
}
