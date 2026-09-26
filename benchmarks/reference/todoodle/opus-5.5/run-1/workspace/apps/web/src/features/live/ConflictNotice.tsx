import { Button } from '@/components/ui/button';
import { CONFLICT_TEXT, KEEP_THEIRS_TEXT, USE_MINE_TEXT } from './showConflictToast';

type Props = {
  /** The other person's value, shown so the user can compare before choosing. */
  theirs: string;
  onUseMine(): void;
  onKeepTheirs(): void;
  /** Shown when saving "my version" failed (for example offline); the user's text is still kept. */
  error?: string | null;
};

/**
 * Inline notice while an editor is open and someone else's change replaced the user's edit. It stays
 * until the user chooses (or closes the editor, which keeps theirs). Both buttons are in tab order.
 * They keep focus on mousedown so the editor is not blurred (and closed) by the click.
 */
export function ConflictNotice({ theirs, onUseMine, onKeepTheirs, error }: Props) {
  return (
    <div role="alert" className="rounded-md border border-warning bg-background p-3 text-sm shadow-md">
      <p className="font-medium">{CONFLICT_TEXT}</p>
      <p className="mt-1 text-muted-foreground">
        Their version: <span className="font-medium text-foreground">{theirs}</span>
      </p>
      {error ? <p className="mt-1 text-destructive">{error}</p> : null}
      <div className="mt-2 flex gap-2">
        <Button size="sm" onMouseDown={(event) => event.preventDefault()} onClick={onUseMine}>
          {USE_MINE_TEXT}
        </Button>
        <Button size="sm" variant="outline" onMouseDown={(event) => event.preventDefault()} onClick={onKeepTheirs}>
          {KEEP_THEIRS_TEXT}
        </Button>
      </div>
    </div>
  );
}
