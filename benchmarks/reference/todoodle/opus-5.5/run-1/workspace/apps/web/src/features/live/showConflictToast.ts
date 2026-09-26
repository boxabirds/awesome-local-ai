import { toast } from 'sonner';

export const CONFLICT_TEXT = 'Someone else changed this just now.';
export const USE_MINE_TEXT = 'Use my version';
export const KEEP_THEIRS_TEXT = 'Keep theirs';

/**
 * The conflict notice when the editor is already closed (recently saved): a persistent toast with
 * both choices. id = key, so a later conflict on the same key replaces it.
 */
export function showConflictToast(key: string, opts: { theirs: string; onUseMine(): void; onKeepTheirs(): void }): void {
  toast(CONFLICT_TEXT, {
    id: key,
    duration: Number.POSITIVE_INFINITY,
    description: `Now: ${opts.theirs}`,
    action: { label: USE_MINE_TEXT, onClick: opts.onUseMine },
    cancel: { label: KEEP_THEIRS_TEXT, onClick: opts.onKeepTheirs },
  });
}

export function dismissConflictToast(key: string): void {
  toast.dismiss(key);
}
