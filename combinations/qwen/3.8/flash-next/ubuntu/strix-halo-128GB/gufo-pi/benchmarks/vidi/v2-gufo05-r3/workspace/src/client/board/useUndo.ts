import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import type * as Y from 'yjs';
import type { UndoController } from './undo';
import { createUndo } from './undo';

/**
 * React bindings for one person's undo history.
 *
 * {@link useUndoController} owns the controller (one per board document, alive
 * for as long as the board is on screen); {@link useUndo} is what the controls
 * read: whether there is anything to undo or redo, and the two commands.
 */
export interface UndoApi {
  /** False when this person's undo stack is empty or the board cannot be changed. */
  canUndo: boolean;
  /** False when this person's redo stack is empty or the board cannot be changed. */
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

/** What a shell hands out: a controller that works whenever one is attached. */
interface UndoShell {
  readonly controller: UndoController;
  /** Point at another board: the next attach starts from an empty history. */
  use(doc: Y.Doc): void;
  /** Start capturing: a fresh, empty history. */
  attach(): void;
  /** Stop capturing and throw the history away. */
  detach(): void;
}

/**
 * A controller that can be switched on and off without the components holding it
 * noticing.
 *
 * React (in development) mounts, unmounts and mounts again; a controller created
 * at mount and destroyed at unmount would therefore be dead on the second mount.
 * The shell is the stable object the board passes around, and the real
 * `UndoManager` behind it lives only while the board is attached — which is also
 * what makes the history session-only (`undo.session_only`): detach it and the
 * steps are gone.
 */
function createUndoShell(initial: Y.Doc): UndoShell {
  const listeners = new Set<() => void>();
  /** Scopes asked for while detached (story 16's comments), re-applied on attach. */
  const scopes: Parameters<UndoController['addScope']>[0][] = [];
  let doc = initial;
  let inner: UndoController | null = null;

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  const shell: UndoShell = {
    use(next: Y.Doc) {
      if (next === doc) return;
      shell.detach();
      doc = next;
    },
    controller: {
      undo: () => inner?.undo() ?? false,
      redo: () => inner?.redo() ?? false,
      boundary: () => {
        inner?.boundary();
      },
      canUndo: () => inner?.canUndo() ?? false,
      canRedo: () => inner?.canRedo() ?? false,
      addScope: (type) => {
        if (!scopes.includes(type)) scopes.push(type);
        inner?.addScope(type);
      },
      onChange: (cb) => {
        listeners.add(cb);
        return () => {
          listeners.delete(cb);
        };
      },
      destroy: () => shell.detach(),
    },
    attach() {
      if (inner !== null) return;
      inner = createUndo(doc);
      for (const scope of scopes) inner.addScope(scope);
      inner.onChange(notify);
    },
    detach() {
      const current = inner;
      inner = null;
      current?.destroy();
      notify();
    },
  };
  return shell;
}

/**
 * The board's undo history: one per document, created when the board is opened
 * and destroyed when it closes or the board changes, so a reload (or another
 * board) starts with nothing to undo.
 */
export function useUndoController(doc: Y.Doc): UndoController {
  const [shell] = useState<UndoShell>(() => createUndoShell(doc));

  useEffect(() => {
    // A different board is a different history: the old steps go with the old doc.
    shell.use(doc);
    shell.attach();
    return () => shell.detach();
  }, [shell, doc]);

  return shell.controller;
}

/**
 * The board's undo history, made available to the pieces that cannot be handed
 * it as a prop — object components are rendered from the registry with one fixed
 * prop shape (stories 9-12 rely on it), while the text editor is the one place
 * inside them that needs undo (`undo.boundaries`).
 */
export const UndoContext = createContext<UndoController | null>(null);

/** The history of the board this component is on, or `null` if there is none. */
export function useBoardUndo(): UndoController | null {
  return useContext(UndoContext);
}

const NEVER = () => false;

/**
 * Undo and redo as a control sees them.
 *
 * The state comes from the controller's own change events, so a button that
 * becomes unusable stops looking usable without polling. While the board cannot
 * be edited (`undo.not_editable`) both answers are `false` and the commands do
 * nothing, whatever the stacks hold.
 */
export function useUndo(controller: UndoController, canEdit: boolean): UndoApi {
  const subscribe = useCallback(
    (onStoreChange: () => void) => controller.onChange(onStoreChange),
    [controller],
  );
  const readCanUndo = useCallback(
    () => canEdit && controller.canUndo(),
    [canEdit, controller],
  );
  const readCanRedo = useCallback(
    () => canEdit && controller.canRedo(),
    [canEdit, controller],
  );
  const canUndo = useSyncExternalStore(subscribe, readCanUndo, NEVER);
  const canRedo = useSyncExternalStore(subscribe, readCanRedo, NEVER);

  const undo = useCallback(() => {
    if (canEdit) controller.undo();
  }, [canEdit, controller]);
  const redo = useCallback(() => {
    if (canEdit) controller.redo();
  }, [canEdit, controller]);

  return { canUndo, canRedo, undo, redo };
}
