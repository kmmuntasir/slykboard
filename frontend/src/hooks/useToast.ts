import { toast } from 'sonner';

// Single import surface for toasts. Future tasks (T2/T5/T8/T9) funnel all
// success/error notifications through this hook so the rest of the app never
// imports sonner directly. Keep thin — no custom queue logic.
export type ToastApi = typeof toast;

export { toast };

export function useToast(): ToastApi {
  return toast;
}
