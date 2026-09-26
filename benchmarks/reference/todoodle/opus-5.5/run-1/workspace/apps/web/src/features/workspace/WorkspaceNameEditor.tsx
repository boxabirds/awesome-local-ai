import { NAME_HINT_MS, WORKSPACE_NAME_MAX } from '@todoodle/shared/limits';
import { type KeyboardEvent, memo, useEffect, useRef, useState } from 'react';
import { ConflictNotice } from '@/features/live/ConflictNotice';
import { useEditGuard } from '@/features/live/useEditGuard';
import { useWorkspaceContext } from './WorkspaceContext';

type Props = {
  name: string;
  canEdit?: boolean;
  /** Saves the name; rejects when saving failed (the caller rolls back and explains). */
  onRename: (name: string) => Promise<unknown>;
};

const USE_MINE_FAILED_TEXT = "Couldn't save your version — try again";

/**
 * Inline editable workspace name. Enter or blur commits, Escape cancels, the value is trimmed.
 * An empty name reverts and shows a brief hint; an unchanged name sends nothing.
 * Story 4: guarded against concurrent renames. If someone else's rename replaces the user's edit, the
 * field shows theirs and a notice lets the user choose whose version to keep; their text is never lost.
 */
export const WorkspaceNameEditor = memo(function WorkspaceNameEditor({ name, canEdit = true, onRename }: Props) {
  const { workspaceId } = useWorkspaceContext();
  const [draft, setDraft] = useState(name);
  const [editing, setEditing] = useState(false);
  // The submitted name, shown until the rename settles (then the saved or rolled-back name shows).
  const [pending, setPending] = useState<string | null>(null);
  const [hintVisible, setHintVisible] = useState(false);
  const [choiceError, setChoiceError] = useState<string | null>(null);
  const cancelled = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Read by the blur handler, which can fire while the fieldset is being disabled (story 4).
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;

  async function save(next: string): Promise<void> {
    setPending(next);
    try {
      await onRename(next);
    } finally {
      setPending((current) => (current === next ? null : current));
    }
  }

  const guard = useEditGuard({
    key: `workspace:${workspaceId}`,
    fields: { name: editing ? draft : (pending ?? name) },
    entityLabel: 'workspace',
    save: (patch) => save(patch.name ?? name),
  });
  const theirs = guard.conflict?.theirs.name ?? null;

  // Someone else's rename replaced the draft: the field shows theirs (the user's text stays in the guard).
  useEffect(() => {
    if (theirs !== null) setDraft(theirs);
  }, [theirs]);

  useEffect(() => () => clearTimeout(hintTimer.current), []);

  function showHint() {
    clearTimeout(hintTimer.current);
    setHintVisible(true);
    hintTimer.current = setTimeout(() => setHintVisible(false), NAME_HINT_MS);
  }

  function startEditing() {
    guard.arm();
    // Still editing (the field was disabled mid-edit, or a conflict is open): keep the draft.
    if (editing) return;
    setDraft(pending ?? name);
    setEditing(true);
  }

  function commit() {
    // Editing was disabled (offline) while typing: keep the draft in the field, send nothing.
    if (!canEditRef.current) return;
    if (cancelled.current) {
      cancelled.current = false;
      setEditing(false);
      guard.disarm();
      return;
    }
    // A conflict is waiting for the user's choice: leaving the field does not close it.
    if (guard.conflict) return;
    setEditing(false);
    guard.disarm();
    const trimmed = draft.trim();
    if (trimmed === '') {
      showHint();
      return;
    }
    if (trimmed === name) return;
    save(trimmed).then(
      () => guard.markSaved({ name: trimmed }),
      () => undefined, // rolled back and explained by the rename mutation
    );
  }

  /** After a choice: keep editing if the field still has focus, otherwise close the editor. */
  function finishChoice(value: string) {
    setChoiceError(null);
    if (document.activeElement === input.current) {
      setDraft(value);
      guard.arm();
    } else {
      setEditing(false);
    }
  }

  async function chooseMine() {
    const mine = guard.conflict?.mine.name ?? draft;
    const error = await guard.useMine();
    if (error) setChoiceError(USE_MINE_FAILED_TEXT);
    else finishChoice(mine);
  }

  function chooseTheirs() {
    guard.keepTheirs();
    finishChoice(theirs ?? name);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      // Closing the editor with a conflict open keeps theirs.
      if (guard.conflict) guard.keepTheirs();
      setChoiceError(null);
      cancelled.current = true;
      event.currentTarget.blur();
    }
  }

  return (
    <div className="relative min-w-0 flex-1">
      <input
        ref={input}
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
      {guard.conflict && theirs !== null ? (
        <div className="absolute left-0 top-full z-50 mt-1 w-80 max-w-[calc(100vw-2rem)]">
          <ConflictNotice theirs={theirs} onUseMine={() => void chooseMine()} onKeepTheirs={chooseTheirs} error={choiceError} />
        </div>
      ) : null}
    </div>
  );
});
