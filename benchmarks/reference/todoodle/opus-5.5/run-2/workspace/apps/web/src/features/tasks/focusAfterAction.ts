/*
 * Where keyboard focus goes when a task leaves the list (completed or deleted), from the row,
 * the keyboard or the detail sheet: the next row, or the previous one when it was the last, or
 * the list's add-task control when the list is now empty. Works with story 5's roving tabindex:
 * the target row gets tabIndex 0 (the list's focus handler makes it the active row).
 */

export type FocusTarget = { kind: 'row'; id: string } | { kind: 'addTask' };

/** Marks the control that takes focus when the last row goes (the "+ Add task" button or the floating +). */
export const ADD_TASK_ATTR = 'data-add-task';

/** Pure: the target after removing the row at `removedIndex` from `orderedIds`. */
export function nextFocusTarget(orderedIds: readonly string[], removedIndex: number): FocusTarget {
  const next = orderedIds[removedIndex + 1];
  if (next !== undefined) return { kind: 'row', id: next };
  const previous = removedIndex > 0 ? orderedIds[removedIndex - 1] : undefined;
  return previous !== undefined ? { kind: 'row', id: previous } : { kind: 'addTask' };
}

/** The row element of a task, or null. */
export function rowElement(id: string, root: ParentNode = document): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(id)}"]`);
}

function rowsOf(listEl: HTMLElement): HTMLElement[] {
  return Array.from(listEl.querySelectorAll<HTMLElement>(':scope > [data-task-id]'));
}

/** The add-task control that belongs with this list (the visible one). */
function addTaskControl(listEl: HTMLElement | null): HTMLElement | null {
  const scope = listEl?.closest('main') ?? document;
  const controls = Array.from(scope.querySelectorAll<HTMLElement>(`[${ADD_TASK_ATTR}]`));
  return controls.find((el) => !el.hidden) ?? controls[0] ?? null;
}

/** The target for removing `removedId` from the list on screen (read in one pass). */
export function focusTargetFor(listEl: HTMLElement, removedId: string): FocusTarget {
  const ids: string[] = [];
  let removedIndex = -1;
  for (const row of rowsOf(listEl)) {
    const id = row.dataset.taskId!;
    if (id === removedId) removedIndex = ids.length;
    ids.push(id);
  }
  if (removedIndex === -1) return ids.length > 0 ? { kind: 'row', id: ids[0]! } : { kind: 'addTask' };
  return nextFocusTarget(ids, removedIndex);
}

/** Moves focus to a target. A row becomes the list's single tab stop. */
export function focusTarget(target: FocusTarget, listEl: HTMLElement | null): void {
  if (target.kind === 'row') {
    const row = rowElement(target.id, listEl ?? document);
    if (row) {
      for (const other of listEl ? rowsOf(listEl) : []) if (other !== row && other.tabIndex !== -1) other.tabIndex = -1;
      row.tabIndex = 0;
      row.focus();
      return;
    }
  }
  addTaskControl(listEl)?.focus();
}

/** Before `removedId`'s row goes: focus its neighbour (or the add-task control). */
export function focusAfterRemoval(listEl: HTMLElement, removedId: string): void {
  focusTarget(focusTargetFor(listEl, removedId), listEl);
}

/** True when keyboard focus is inside the task's row (on the row or one of its controls). */
export function focusIsInRow(id: string): boolean {
  const active = document.activeElement;
  return active instanceof HTMLElement && active.closest('[data-task-id]')?.getAttribute('data-task-id') === id;
}

/**
 * Focuses the task's row once it is on screen again (after a rollback re-inserts it). Rendering
 * is batched, so this checks for a few frames.
 */
export function focusRowWhenPresent(id: string, frames = 10): void {
  const attempt = (left: number) => {
    const row = rowElement(id);
    if (row) {
      const list = row.parentElement;
      focusTarget({ kind: 'row', id }, list);
      return;
    }
    if (left > 0) requestAnimationFrame(() => attempt(left - 1));
  };
  attempt(frames);
}
