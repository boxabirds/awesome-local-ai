import type { ReactNode } from 'react';
import { toast } from 'sonner';

/**
 * Toasts with an explicit live-region role (sonner's own toasts have none): successes are role=status
 * (announced politely, never interrupting), failures role=alert (announced immediately).
 */
export function ToastCard({ role, children }: { role: 'status' | 'alert'; children: ReactNode }) {
  return (
    <div
      role={role}
      data-toast-role={role}
      className="flex w-[var(--width,356px)] max-w-[calc(100vw-2rem)] items-center gap-3 rounded-md border border-border bg-background px-4 py-3 text-sm text-foreground shadow-lg"
    >
      {children}
    </div>
  );
}

/** A polite success message ('Task restored'). */
export function notifyStatus(message: string, id?: string): void {
  toast.custom(() => <ToastCard role="status">{message}</ToastCard>, id === undefined ? undefined : { id });
}

/** An immediate failure message ("Couldn't save — try again"). */
export function notifyAlert(message: string, id?: string): void {
  toast.custom(() => <ToastCard role="alert">{message}</ToastCard>, id === undefined ? undefined : { id });
}
