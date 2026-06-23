import { useCallback, useEffect, useRef } from 'react';

// F16 D1: hand-rolled accessible-dialog behaviour (0 deps). Implements the W3C
// APG Dialog Pattern — focus trap, initial focus, Esc, scroll lock, focus restore.
// `onEsc` lets a caller intercept Esc (e.g. to show a dirty-confirm before close);
// falls back to `onClose` when omitted.
//
// Requires the app shell to wrap routed content in `<main id="app-root">` (T6) so
// `inert` can mute background content. Without it, scroll lock still works via
// `document.body.style.overflow`.
interface UseModalA11yOptions {
  isOpen: boolean;
  onClose: () => void;
  /** Called on Esc when the caller wants a dirty-check before close. */
  onEsc?: () => void;
}

// Visible, focusable element selectors (APG). [tabindex="-1"] is deliberately
// excluded so the trap skips programmatically-hidden focuses like the dialog root.
const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useModalA11y({ isOpen, onClose, onEsc }: UseModalA11yOptions) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const appRootRef = useRef<HTMLElement | null>(null);

  // Mount/open: capture the trigger, move focus inside, lock scroll, inert the
  // app root. Cleanup restores everything and returns focus to the trigger.
  useEffect(() => {
    if (!isOpen || !dialogRef.current) return;
    triggerRef.current = document.activeElement as HTMLElement | null;
    appRootRef.current = document.getElementById('app-root');

    const first = dialogRef.current.querySelector<HTMLElement>(TABBABLE);
    (first ?? dialogRef.current).focus();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (appRootRef.current) appRootRef.current.inert = true;

    return () => {
      document.body.style.overflow = prevOverflow;
      if (appRootRef.current) appRootRef.current.inert = false;
      triggerRef.current?.focus();
    };
  }, [isOpen]);

  // Esc + Tab wrap (first <-> last). Capture phase so we intercept before children.
  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen || !dialogRef.current) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        (onEsc ?? onClose)();
        return;
      }
      if (e.key !== 'Tab') return;
      const tabbables = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(TABBABLE),
      );
      if (tabbables.length === 0) return;
      const first = tabbables[0]!;
      const last = tabbables[tabbables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [isOpen, onClose, onEsc],
  );

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener('keydown', onKeyDown, { capture: true });
    return () => document.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [isOpen, onKeyDown]);

  return { dialogRef };
}
