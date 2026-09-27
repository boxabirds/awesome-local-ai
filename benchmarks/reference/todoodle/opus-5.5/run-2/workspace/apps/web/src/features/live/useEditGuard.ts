import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { type Conflict, EditGuard, editGuards } from './editGuard';
import { showConflictToast } from './showConflictToast';

export type UseEditGuardOptions<F extends Record<string, string | null>> = {
  /** 'workspace:<id>' | 'task:<id>' | 'project:<id>' */
  key: string;
  /** The current draft (while editing) or last saved values. */
  fields: F;
  /** 'workspace' | 'task' | 'project', for "This task was deleted". */
  entityLabel: string;
  /** The consumer's normal save. */
  save: (patch: Partial<F>) => Promise<void>;
  /** Close the editor when the entity is deleted (the toast is shown for you). */
  onGone?: () => void;
};

export type EditGuardApi<F extends Record<string, string | null>> = {
  arm(): void;
  disarm(): void;
  markSaved(saved: F): void;
  /** Only the changed fields; null when there is no conflict. */
  conflict: Conflict<F> | null;
  /** Resolves when saved again; rejects with the error when that failed (mine is kept). */
  useMine(): Promise<void>;
  keepTheirs(): void;
};

/**
 * Protects an editor against other people's concurrent changes (live.conflict_notice). While
 * the editor is open, render `<ConflictNotice>` when `conflict` is set; when the conflict hits a
 * recent save with the editor closed, a persistent toast is shown for you.
 *
 * @example Stories 6 and 7 (task and project editors):
 * const guard = useEditGuard({
 *   key: `task:${task.id}`,
 *   fields: { title: draftTitle, description: draftDescription },
 *   entityLabel: 'task',
 *   save: (patch) => updateTask.mutateAsync(patch),
 *   onGone: closeEditor,
 * });
 * // onFocus / open: guard.arm(); on close: guard.disarm();
 * // after a successful save: guard.markSaved({ title, description });
 * // {guard.conflict ? <ConflictNotice theirs={guard.conflict.theirs.title ?? ''}
 * //    onUseMine={() => void guard.useMine()} onKeepTheirs={guard.keepTheirs} /> : null}
 */
export function useEditGuard<F extends Record<string, string | null>>(opts: UseEditGuardOptions<F>): EditGuardApi<F> {
  const { key, entityLabel } = opts;
  const fieldsRef = useRef(opts.fields);
  const saveRef = useRef(opts.save);
  const onGoneRef = useRef(opts.onGone);
  useEffect(() => {
    fieldsRef.current = opts.fields;
    saveRef.current = opts.save;
    onGoneRef.current = opts.onGone;
  });

  const [guard] = useState(
    () =>
      new EditGuard({
        key,
        getFields: () => fieldsRef.current,
        onGone: () => {
          toast(`This ${entityLabel} was deleted`, { id: `gone:${key}` });
          onGoneRef.current?.();
        },
      }),
  );
  useEffect(() => editGuards.add(guard), [guard]);

  const conflict = useSyncExternalStore(guard.subscribe, guard.getConflict, guard.getConflict) as Conflict<F> | null;

  const [api] = useState(() => {
    const useMine = async () => {
      const error = await guard.useMine((patch) => saveRef.current(patch as Partial<F>));
      if (error) throw error;
    };
    const keepTheirs = () => guard.keepTheirs();
    return {
      arm: () => guard.arm(),
      disarm: () => guard.disarm(),
      markSaved: (saved: F) => guard.markSaved(saved),
      useMine,
      keepTheirs,
    };
  });

  // Editor already closed (a recent save was replaced): a persistent toast with both choices.
  useEffect(() => {
    const state = guard.getState();
    if (conflict && state.kind === 'conflicted' && state.from === 'recentlySaved') {
      const theirs = Object.values(conflict.theirs).find((v) => v !== null && v !== undefined) ?? '';
      showConflictToast({
        key,
        theirs: String(theirs),
        onUseMine: () => void api.useMine().catch(() => {}),
        onKeepTheirs: api.keepTheirs,
      });
    } else if (!conflict) {
      toast.dismiss(key);
    }
  }, [conflict, guard, key, api]);

  return { ...api, conflict };
}
