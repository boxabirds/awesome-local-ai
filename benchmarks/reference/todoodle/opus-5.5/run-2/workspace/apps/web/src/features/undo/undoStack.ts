import { isActive, type UndoHandle } from './createUndo';

export type { UndoHandle };

/** The undo handles of the toasts on screen, oldest first (pushed on show, removed when settled). */
const stack: UndoHandle[] = [];

export function pushUndo(handle: UndoHandle): void {
  stack.push(handle);
}

export function removeUndo(handle: UndoHandle): void {
  const at = stack.indexOf(handle);
  if (at !== -1) stack.splice(at, 1);
}

/** The most recent toast still counting or paused: the only one Cmd/Ctrl+Z undoes. */
export function latestActiveUndo(): UndoHandle | undefined {
  for (let i = stack.length - 1; i >= 0; i--) if (isActive(stack[i]!)) return stack[i];
  return undefined;
}

/** Test hook: as after a page load. */
export function resetUndoStackForTests(): void {
  stack.length = 0;
}
