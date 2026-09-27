import { NAME_HINT_MS } from '@todoodle/shared/limits';
import { memo, useEffect, useRef, useState } from 'react';
import { useRenameWorkspace } from './useRenameWorkspace';

/** Inline-editable workspace name. Enter or blur commits, Escape cancels; the value is trimmed. */
export const WorkspaceNameEditor = memo(function WorkspaceNameEditor({
  workspaceId,
  name,
}: {
  workspaceId: string;
  name: string;
}) {
  const rename = useRenameWorkspace(workspaceId);
  // null while not editing, so the field always shows the latest (possibly optimistic) name.
  const [draft, setDraft] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(false);
  const cancelled = useRef(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(hintTimer.current), []);

  // While a rename is in flight show what was submitted (no flash of the old name before the
  // optimistic cache write lands); on failure it falls back to the rolled-back cached name.
  const shown = rename.isPending && rename.variables !== undefined ? rename.variables : name;

  function commit() {
    if (cancelled.current || draft === null) {
      cancelled.current = false;
      setDraft(null);
      return;
    }
    const next = draft.trim();
    setDraft(null);
    if (next === '') {
      setShowHint(true);
      clearTimeout(hintTimer.current);
      hintTimer.current = setTimeout(() => setShowHint(false), NAME_HINT_MS);
      return;
    }
    if (next !== shown) rename.mutate(next);
  }

  return (
    <div className="flex min-w-0 flex-col">
      <input
        aria-label="Workspace name"
        className="min-w-0 rounded-md bg-transparent px-2 py-1 text-lg font-semibold hover:bg-muted focus-visible:bg-background focus-visible:outline-2 focus-visible:outline-ring disabled:hover:bg-transparent"
        value={draft ?? shown}
        onChange={(e) => {
          const value = e.target.value;
          setDraft(() => value);
        }}
        onFocus={() => setDraft((current) => current ?? shown)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
      />
      <p role="status" className="px-2 text-sm text-destructive empty:hidden">
        {showHint ? "Name can't be empty" : ''}
      </p>
    </div>
  );
});
