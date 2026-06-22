import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { DragDropContext, Droppable } from '@hello-pangea/dnd';

// pangea's <Draggable> (mounted inside TicketCard) requires a <DragDropContext> +
// <Droppable> ancestor or it throws on mount. This wrapper provides the minimal
// context so leaf-card tests can render+assert without pointer DnD (jsdom cannot
// drive pangea's pointer sensor — drag behavior is unit-tested via pure functions
// in boardReorder.test.ts, not here).
export function renderInDnd(ui: ReactElement) {
    return render(
        <DragDropContext onDragEnd={() => {}}>
            <Droppable droppableId="test-col" type="CARD" direction="vertical">
                {(provided) => (
                    <div ref={provided.innerRef} {...provided.droppableProps}>
                        {ui}
                        {provided.placeholder}
                    </div>
                )}
            </Droppable>
        </DragDropContext>,
    );
}
