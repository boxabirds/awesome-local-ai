import { NAME_HINT_MS, WORKSPACE_NAME_MAX } from '@todoodle/shared/limits';
import { type KeyboardEvent, memo, useEffect, useRef, useState } from 'react';

type Props = { name: string; onRename: (name: string) => Promise<unknown> };

/**
 * Inline editable workspace name. Enter or blur commits, Escape cancels, the value is trimmed.
 * An empty name reverts and shows a brief hint; an unchanged name sends nothing.
 */
export const WorkspaceNameEditor = memo(function WorkspaceNameEditor({ name, onRename }: Props) {
  const [draft, setDraft] = useState(name);
  const [editing, setEditing] = useState(false);
  // The submitted name, shown until the rename settles (then the saved or rolled-back name shows).
  const [pending, setPending] = useState<string | null>(null);
  const [hintVisible, setHintVisible] = useState(false);
  const cancelled = useRef(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(hintTimer.current), []);

  function showHint() {
    clearTimeout(hintTimer.current);
    setHintVisible(true);
    hintTimer.current = setTimeout(() => setHintVisible(false), NAME_HINT_MS);
  }

  function startEditing() {
    setDraft(pending ?? name);
    setEditing(true);
  }

  function commit() {
    setEditing(false);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const trimmed = draft.trim();
    if (trimmed === '') {
      showHint();
      return;
    }
    if (trimmed === name) return;
    setPending(trimmed);
    void onRename(trimmed).finally(() => setPending((current) => (current === trimmed ? null : current)));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      cancelled.current = true;
      event.currentTarget.blur();
    }
  }

  return (
    <div className="relative min-w-0 flex-1">
      <input
        aria-label="Workspace name"
        className="w-full min-w-0 truncate rounded-md border border-transparent bg-transparent px-2 py-1 text-lg font-semibold outline-none hover:border-border focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:hover:border-transparent pointer-coarse:min-h-11"
        value={editing ? draft : (pending ?? name)}
        maxLength={WORKSPACE_NAME_MAX}
        onFocus={startEditing}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      <p role="status" className="absolute left-2 top-full text-xs text-muted-foreground">
        {hintVisible ? "Name can't be empty" : null}
      </p>
    </div>
  );
});
