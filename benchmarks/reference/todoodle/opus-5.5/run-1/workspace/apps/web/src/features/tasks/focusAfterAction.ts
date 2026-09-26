import { isTypingTarget } from '@/lib/shortcuts';
import { ADD_TASK_SELECTOR } from './useRovingList';

/** Where focus goes when the row at `removedIndex` leaves a list of `orderedIds` (ids before removal). */
export type FocusTarget = { kind: 'row'; id: string } | { kind: 'addTask' };

/**
 * Only row -> the list's add-task control; the last of many -> the previous row; otherwise -> the next row
 * (prd.focus_after_action). Never the top of the page.
 */
export function nextFocusTarget(orderedIds: readonly string[], removedIndex: number): FocusTarget {
  if (orderedIds.length <= 1) return { kind: 'addTask' };
  const last = orderedIds.length - 1;
  const index = removedIndex >= last ? last - 1 : removedIndex + 1;
  return { kind: 'row', id: orderedIds[index]! };
}

const ROW_SELECTOR = ':scope > [data-task-id]';

function rowSelector(id: string): string {
  return `[data-task-id="${CSS.escape(id)}"]`;
}

/**
 * Moves focus off a row that is about to leave the list: reads the list's row order in one pass, then
 * focuses the target (story 5's roving tabindex makes it the list's Tab stop when it receives focus).
 * Returns the element that received focus.
 */
export function focusAfterRemoval(listEl: HTMLElement, removedId: string): HTMLElement | null {
  const rows = listEl.querySelectorAll<HTMLElement>(ROW_SELECTOR);
  const ids: string[] = [];
  let removedIndex = -1;
  for (const row of rows) {
    const id = row.dataset.taskId ?? '';
    if (id === removedId) removedIndex = ids.length;
    ids.push(id);
  }
  if (removedIndex === -1) return null;
  const target = nextFocusTarget(ids, removedIndex);
  const element =
    target.kind === 'row' ? listEl.querySelector<HTMLElement>(`:scope > ${rowSelector(target.id)}`) : document.querySelector<HTMLElement>(ADD_TASK_SELECTOR);
  element?.focus();
  return element;
}

// ---------------------------------------------------------------- wiring into the task actions

/** Where focus was moved per task id, so a rollback can bring it back to the restored row. */
const movedTo = new Map<string, HTMLElement>();
let pendingRowFocus: string | null = null;

/**
 * The action's task leaves the list (completed after the animation, or deleted): move focus to its
 * neighbour, unless the user has already moved on to typing somewhere else.
 */
export function moveFocusBeforeRemoval(id: string): void {
  const row = document.querySelector<HTMLElement>(rowSelector(id));
  const list = row?.closest<HTMLElement>('[role="listbox"]');
  if (!row || !list) return;
  const active = document.activeElement;
  if (active && active !== document.body && !row.contains(active) && isTypingTarget(active)) return;
  const focused = focusAfterRemoval(list, id);
  if (focused) movedTo.set(id, focused);
}

/** The removal was rolled back: if focus is still where we put it, it returns to the restored row. */
export function refocusAfterRollback(id: string): void {
  const target = movedTo.get(id);
  movedTo.delete(id);
  const active = document.activeElement;
  if (target && (active === target || active === document.body || active === null)) pendingRowFocus = id;
}

/** Called by TaskList after every render: focuses a row a rollback asked for, once it is back on screen. */
export function applyPendingRowFocus(listEl: HTMLElement | null): void {
  if (!pendingRowFocus || !listEl) return;
  const row = listEl.querySelector<HTMLElement>(`:scope > ${rowSelector(pendingRowFocus)}`);
  if (!row) return;
  pendingRowFocus = null;
  row.focus();
}

/** Test helper. */
export function clearFocusStateForTests(): void {
  movedTo.clear();
  pendingRowFocus = null;
}
