import { toast } from 'sonner';

export const CONFLICT_TEXT = 'Someone else changed this just now.';

/**
 * The conflict notice when the editor is already closed (our save was recent): a persistent toast
 * with both choices. `id = key`, so a later conflict on the same thing replaces it.
 */
export function showConflictToast(opts: {
  key: string;
  theirs: string;
  onUseMine(): void;
  onKeepTheirs(): void;
}): void {
  toast(CONFLICT_TEXT, {
    id: opts.key,
    duration: Number.POSITIVE_INFINITY,
    description: `Their version: ${opts.theirs}`,
    action: { label: 'Use my version', onClick: opts.onUseMine },
    cancel: { label: 'Keep theirs', onClick: opts.onKeepTheirs },
  });
}
