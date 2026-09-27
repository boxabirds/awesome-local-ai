import { browserStorage, writeShowCompleted } from './showCompletedPref';

/**
 * "Show completed" switch at the top of a list. The owner keeps the state (initialised lazily from
 * readShowCompleted, since the list query depends on it); the choice is written here, in the click
 * handler, never in an effect.
 */
export function ShowCompletedToggle({
  workspaceId,
  listKey,
  on,
  onChange,
}: {
  workspaceId: string;
  listKey: string;
  on: boolean;
  onChange(on: boolean): void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => {
        writeShowCompleted(browserStorage(), workspaceId, listKey, !on);
        onChange(!on);
      }}
      className="inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span
        aria-hidden="true"
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 transition-colors motion-reduce:transition-none ${
          on ? 'border-primary bg-primary' : 'border-border bg-muted'
        }`}
      >
        <span
          className={`size-3.5 rounded-full bg-background shadow transition-transform motion-reduce:transition-none ${on ? 'translate-x-4' : 'translate-x-0.5'}`}
        />
      </span>
      Show completed
    </button>
  );
}
