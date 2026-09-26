import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { deletedMessage } from '@/lib/errors';
import { type Conflict, EditGuard, type GuardFields, registerEditGuard } from './editGuard';
import { dismissConflictToast, showConflictToast } from './showConflictToast';

export type UseEditGuardOptions<F extends GuardFields> = {
  /** 'workspace:<id>' | 'task:<id>' | 'project:<id>' */
  key: string;
  /** The current draft (while editing) or the last saved values. */
  fields: F;
  /** 'workspace' | 'task' | 'project', used in "This <label> was deleted". */
  entityLabel: string;
  /** The consumer's normal save; must reject on failure (GoneError for 410). */
  save: (patch: Partial<F>) => Promise<void>;
  /** Close the editor: the entity was deleted under the user. */
  onGone?: () => void;
};

export type EditGuardApi<F extends GuardFields> = {
  arm(): void;
  disarm(): void;
  markSaved(saved: F): void;
  /** Set while the editor is open and someone else's change replaced the user's edit (show ConflictNotice). */
  conflict: null | Pick<Conflict<F>, 'mine' | 'theirs'>;
  /** Saves the user's version again. Resolves with the error when it failed (the conflict is kept). */
  useMine(): Promise<Error | null>;
  keepTheirs(): void;
};

function describe(values: Partial<GuardFields>): string {
  return Object.values(values)
    .map((value) => value ?? '')
    .join(', ');
}

/**
 * Guards an editor against concurrent edits (live.conflict_notice). Arm it when the edit UI opens,
 * disarm when it closes, markSaved after each successful save.
 *
 * @example Story 6 task editor:
 *   const guard = useEditGuard({ key: `task:${task.id}`, fields: { title: draft }, entityLabel: 'task',
 *     save: (patch) => updateTask.mutateAsync(patch), onGone: closeEditor });
 *   <input onFocus={guard.arm} ... />
 *   {guard.conflict ? <ConflictNotice theirs={guard.conflict.theirs.title ?? ''} onUseMine={guard.useMine} onKeepTheirs={guard.keepTheirs} /> : null}
 */
export function useEditGuard<F extends GuardFields>(opts: UseEditGuardOptions<F>): EditGuardApi<F> {
  // Latest values in refs (advanced-event-handler-refs): the guard never re-subscribes on render.
  const fieldsRef = useRef(opts.fields);
  const saveRef = useRef(opts.save);
  const onGoneRef = useRef(opts.onGone);
  const labelRef = useRef(opts.entityLabel);
  useEffect(() => {
    fieldsRef.current = opts.fields;
    saveRef.current = opts.save;
    onGoneRef.current = opts.onGone;
    labelRef.current = opts.entityLabel;
  });

  const [guard] = useState(
    () =>
      new EditGuard<F>({
        key: opts.key,
        getFields: () => fieldsRef.current,
        save: (patch) => saveRef.current(patch),
        onGone: () => {
          dismissConflictToast(opts.key);
          onGoneRef.current?.();
          toast(deletedMessage(labelRef.current), { id: `gone:${opts.key}` });
        },
      }),
  );

  useEffect(() => registerEditGuard(guard), [guard]);

  // Editor closed (recently saved) when the conflict arrives: a persistent toast instead of the inline notice.
  useEffect(() => {
    const sync = () => {
      const state = guard.getState();
      if (state.kind === 'conflicted' && !state.editorOpen) {
        showConflictToast(guard.key, {
          theirs: describe(state.theirs),
          onUseMine: () => void guard.useMine(),
          onKeepTheirs: guard.keepTheirs,
        });
      } else if (state.kind !== 'conflicted' || state.editorOpen) {
        dismissConflictToast(guard.key);
      }
    };
    return guard.subscribe(sync);
  }, [guard]);

  const state = useSyncExternalStore(guard.subscribe, guard.getState);
  const conflict = state.kind === 'conflicted' && state.editorOpen ? state : null;

  return {
    arm: guard.arm,
    disarm: guard.disarm,
    markSaved: guard.markSaved,
    conflict: conflict ? { mine: conflict.mine, theirs: conflict.theirs } : null,
    useMine: guard.useMine,
    keepTheirs: guard.keepTheirs,
  };
}
