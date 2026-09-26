import { type FocusEvent, type KeyboardEvent, type RefObject, useLayoutEffect, useMemo, useRef } from 'react';

const ROW_SELECTOR = ':scope > [role="option"]';
/** The control focus falls back to when the list becomes empty (the '+ Add task' button or the FAB). */
export const ADD_TASK_SELECTOR = '[data-add-task]';

/**
 * Where a key moves focus from `index` in a list of `count` rows: ↑/k previous, ↓/j next, Home first,
 * End last. Clamps at both ends (no wrap). Null for any other key.
 */
export function rovingTarget(index: number, count: number, key: string): number | null {
  if (count === 0) return null;
  switch (key) {
    case 'ArrowDown':
    case 'j':
      return Math.min(index + 1, count - 1);
    case 'ArrowUp':
    case 'k':
      return Math.max(index - 1, 0);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/**
 * Which row gets focus after `removedId` leaves: the next row, else the previous one. Returns an index
 * into the list WITHOUT the removed row, or -1 when no rows are left (focus the add button instead).
 */
export function indexAfterRemoval(ids: readonly string[], removedId: string): number {
  const index = ids.indexOf(removedId);
  const remaining = ids.length - (index === -1 ? 0 : 1);
  if (remaining === 0) return -1;
  if (index === -1) return 0;
  return Math.min(index, remaining - 1);
}

export type RovingList = {
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onFocus: (event: FocusEvent<HTMLElement>) => void;
  /** Story 6: after a task is completed or deleted, focus its neighbour (or the add button). */
  focusAfterRemoval: (id: string) => void;
};

function rowsOf(list: HTMLElement | null): HTMLElement[] {
  return list ? Array.from(list.querySelectorAll<HTMLElement>(ROW_SELECTOR)) : [];
}

/**
 * Roving tabindex for a listbox of rows (`role=option`, `data-task-id`). Exactly one row has tabIndex 0
 * (the last focused one, else the first), so the list is one Tab stop. The active id lives in a ref and
 * moving focus rewrites tabIndex on only the old and new DOM nodes: no row re-renders on navigation.
 */
export function useRovingList(listRef: RefObject<HTMLElement | null>): RovingList {
  const activeId = useRef<string | null>(null);

  // After every list render (rows added or removed), make sure exactly one row is the Tab stop.
  useLayoutEffect(() => {
    const rows = rowsOf(listRef.current);
    if (rows.length === 0) return;
    const active = rows.find((row) => row.dataset.taskId === activeId.current) ?? rows[0]!;
    for (const row of rows) {
      const tabIndex = row === active ? 0 : -1;
      if (row.tabIndex !== tabIndex) row.tabIndex = tabIndex;
    }
  });

  return useMemo<RovingList>(() => {
    const activate = (row: HTMLElement, rows: HTMLElement[]) => {
      for (const other of rows) if (other !== row && other.tabIndex !== -1) other.tabIndex = -1;
      row.tabIndex = 0;
      activeId.current = row.dataset.taskId ?? null;
    };
    const focusRow = (row: HTMLElement, rows: HTMLElement[]) => {
      activate(row, rows);
      row.focus();
    };

    return {
      onKeyDown(event) {
        const row = event.target as HTMLElement;
        // Keys from a row's interactive children (Retry, Discard) are theirs.
        if (row.getAttribute('role') !== 'option' || event.ctrlKey || event.metaKey || event.altKey) return;
        const rows = rowsOf(listRef.current);
        const target = rovingTarget(rows.indexOf(row), rows.length, event.key);
        if (target === null) return;
        event.preventDefault();
        focusRow(rows[target]!, rows);
      },
      onFocus(event) {
        const row = event.target as HTMLElement;
        if (row.getAttribute('role') !== 'option') return;
        activate(row, rowsOf(listRef.current));
      },
      focusAfterRemoval(id) {
        const rows = rowsOf(listRef.current);
        const target = indexAfterRemoval(
          rows.map((row) => row.dataset.taskId ?? ''),
          id,
        );
        if (target === -1) {
          document.querySelector<HTMLElement>(ADD_TASK_SELECTOR)?.focus();
          return;
        }
        const remaining = rows.filter((row) => row.dataset.taskId !== id);
        focusRow(remaining[target]!, remaining);
      },
    };
  }, [listRef]);
}
