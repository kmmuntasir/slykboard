import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { DeleteTicketConfirm } from './DeleteTicketConfirm';

describe('DeleteTicketConfirm', () => {
  let appRoot: HTMLElement;

  beforeEach(() => {
    // Modal's useModalA11y inert-mutes #app-root if present.
    appRoot = document.createElement('main');
    appRoot.id = 'app-root';
    document.body.appendChild(appRoot);
  });

  afterEach(() => {
    appRoot.remove();
    cleanup();
  });

  it('renders the title "Delete ticket?" when open', () => {
    render(
      <DeleteTicketConfirm
        isOpen
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Delete ticket?' })).toBeInTheDocument();
  });

  it('renders nothing when isOpen is false', () => {
    render(
      <DeleteTicketConfirm
        isOpen={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('calls onCancel when the Cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(<DeleteTicketConfirm isOpen onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onConfirm when the Delete button is clicked', () => {
    const onConfirm = vi.fn();
    render(<DeleteTicketConfirm isOpen onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons and shows "Deleting…" while isDeleting', () => {
    render(
      <DeleteTicketConfirm
        isOpen
        isDeleting
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const cancel = screen.getByRole('button', { name: /Cancel/ });
    const del = screen.getByRole('button', { name: /Deleting/ });
    expect(cancel).toBeDisabled();
    expect(del).toBeDisabled();
    expect(del.textContent).toBe('Deleting…');
  });
});
