import { NAME_HINT_MS } from '@todoodle/shared/limits';
import { memo, useEffect, useRef, useState } from 'react';
import { useCanEdit } from '@/features/live/canEdit';
import { ConflictNotice } from '@/features/live/ConflictNotice';
import { useEditGuard } from '@/features/live/useEditGuard';
import { useRenameWorkspace } from './useRenameWorkspace';

/**
 * Inline-editable workspace name. Enter or blur commits, Escape cancels; the value is trimmed.
 * Guarded against concurrent renames: when someone else's rename replaces what the user typed,
 * the field shows theirs and a notice offers Use my version / Keep theirs.
 */
export const WorkspaceNameEditor = memo(function WorkspaceNameEditor({
  workspaceId,
  name,
}: {
  workspaceId: string;
  name: string;
}) {
  const rename = useRenameWorkspace(workspaceId);
  const canEdit = useCanEdit();
  // null until the user types, so the field always shows the latest (possibly optimistic) name.
  const [draft, setDraft] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(false);
  const cancelled = useRef(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);
  const notice = useRef<HTMLDivElement>(null);

  useEffect(() => () => clearTimeout(hintTimer.current), []);

  // While a rename is in flight show what was submitted (no flash of the old name before the
  // optimistic cache write lands); on failure it falls back to the rolled-back cached name.
  const shown = rename.isPending && rename.variables !== undefined ? rename.variables : name;

  const guard = useEditGuard({
    key: `workspace:${workspaceId}`,
    fields: { name: draft ?? shown },
    entityLabel: 'workspace',
    save: async ({ name: mine }) => {
      if (mine) await rename.mutateAsync(mine);
    },
  });
  const conflict = guard.conflict;

  // Someone else's rename replaced the user's text: the field shows theirs; the guard keeps mine.
  useEffect(() => {
    if (conflict) setDraft(null);
  }, [conflict]);

  function commit() {
    // Editing turned off (offline) while typing: keep the text, save nothing.
    if (!canEdit) return;
    guard.disarm();
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
    if (next !== shown) rename.mutate(next, { onSuccess: (saved) => guard.markSaved({ name: saved.name }) });
  }

  function choose(choice: 'mine' | 'theirs') {
    if (choice === 'mine') void guard.useMine().catch(() => {});
    else guard.keepTheirs();
    setDraft(null);
    input.current?.focus();
    guard.arm();
  }

  return (
    <div className="relative flex min-w-0 flex-col">
      <input
        ref={input}
        aria-label="Workspace name"
        className="min-w-0 rounded-md bg-transparent px-2 py-1 text-lg font-semibold hover:bg-muted focus-visible:bg-background focus-visible:outline-2 focus-visible:outline-ring disabled:hover:bg-transparent"
        value={draft ?? shown}
        onChange={(e) => {
          const value = e.target.value;
          setDraft(() => value);
        }}
        onFocus={() => guard.arm()}
        onBlur={(e) => {
          // Moving to the conflict notice's buttons keeps the editor open.
          if (e.relatedTarget instanceof Node && notice.current?.contains(e.relatedTarget)) return;
          commit();
        }}
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
      {conflict ? (
        <ConflictNotice
          ref={notice}
          className="absolute top-full left-0 z-30 w-[min(22rem,90vw)] shadow-md"
          theirs={conflict.theirs.name ?? ''}
          onUseMine={() => choose('mine')}
          onKeepTheirs={() => choose('theirs')}
        />
      ) : null}
      <p role="status" className="px-2 text-sm text-destructive empty:hidden">
        {showHint ? "Name can't be empty" : ''}
      </p>
    </div>
  );
});
