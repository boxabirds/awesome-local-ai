import { type UndoHandle, isActive } from './createUndo';

// Every undo toast on screen, oldest first. Only the most recent ACTIVE one answers Cmd/Ctrl+Z.

const stack: UndoHandle[] = [];

export function pushUndo(handle: UndoHandle): void {
  stack.push(handle);
}

export function removeUndo(handle: UndoHandle): void {
  const index = stack.indexOf(handle);
  if (index !== -1) stack.splice(index, 1);
}

/** The newest handle still counting or paused (expired or used ones are skipped). */
export function latestActiveUndo(): UndoHandle | undefined {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (isActive(stack[i]!.state)) return stack[i];
  }
  return undefined;
}

/** Test helper. */
export function clearUndoStackForTests(): void {
  stack.length = 0;
}
