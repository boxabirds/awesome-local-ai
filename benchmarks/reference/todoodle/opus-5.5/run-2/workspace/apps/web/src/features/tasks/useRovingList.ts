import { type FocusEvent, type KeyboardEvent, type RefObject, useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { describeShortcut } from '@/lib/shortcuts';

export type RovingAction = 'next' | 'prev' | 'first' | 'last';

// Handled by the list itself (not global shortcuts), but listed in the `?` panel.
describeShortcut({ key: '↑/↓', description: 'Move between tasks', group: 'Navigation' });
describeShortcut({ key: 'j/k', description: 'Move between tasks', group: 'Navigation' });
describeShortcut({ key: 'Home/End', description: 'Jump to the first or last task', group: 'Navigation' });

const KEY_ACTIONS: Record<string, RovingAction> = {
  ArrowDown: 'next',
  j: 'next',
  ArrowUp: 'prev',
  k: 'prev',
  Home: 'first',
  End: 'last',
};

/** The navigation a key asks for, or null. */
export function actionForKey(key: string): RovingAction | null {
  return KEY_ACTIONS[key] ?? null;
}

/** The row index an action moves to. Clamped at both ends: no wrap. */
export function rovingIndex(current: number, count: number, action: RovingAction): number {
  if (count <= 0) return -1;
  const last = count - 1;
  switch (action) {
    case 'next':
      return Math.min(Math.max(current, -1) + 1, last);
    case 'prev':
      return Math.max(Math.min(current, count) - 1, 0);
    case 'first':
      return 0;
    case 'last':
      return last;
  }
}

/** Where focus goes when `removedId` leaves the list: the next row, else the previous, else null (the add button). */
export function removalTarget(ids: readonly string[], removedId: string): string | null {
  const index = ids.indexOf(removedId);
  if (index === -1) return ids[0] ?? null;
  return ids[index + 1] ?? ids[index - 1] ?? null;
}

export type RovingList = {
  onKeyDown(event: KeyboardEvent<HTMLElement>): void;
  onFocus(event: FocusEvent<HTMLElement>): void;
  /** Story 6: after completing or deleting a row, focus its neighbour (or the add button). */
  focusAfterRemoval(id: string): void;
};

/**
 * Roving tabindex over the rows (`[data-task-id]` children of the list): exactly one row has
 * tabIndex 0 (the last focused, else the first), so the list is one tab stop. The active id lives
 * in a ref and navigation rewrites tabIndex on two DOM nodes only: rows never re-render.
 */
export function useRovingList(
  listRef: RefObject<HTMLElement | null>,
  opts: { fallback?: () => HTMLElement | null } = {},
): RovingList {
  const activeId = useRef<string | null>(null);
  const fallbackRef = useRef(opts.fallback);
  useLayoutEffect(() => {
    fallbackRef.current = opts.fallback;
  });

  const rows = useCallback((): HTMLElement[] => {
    const list = listRef.current;
    return list ? Array.from(list.querySelectorAll<HTMLElement>(':scope > [data-task-id]')) : [];
  }, [listRef]);

  const activate = useCallback(
    (row: HTMLElement) => {
      for (const other of rows()) if (other !== row && other.tabIndex !== -1) other.tabIndex = -1;
      row.tabIndex = 0;
      activeId.current = row.dataset.taskId ?? null;
    },
    [rows],
  );

  // After every render of the list: keep exactly one tab stop (the active row, or the first).
  useLayoutEffect(() => {
    const all = rows();
    if (all.length === 0) return;
    const active = all.find((row) => row.dataset.taskId === activeId.current) ?? all[0]!;
    for (const row of all) {
      const wanted = row === active ? 0 : -1;
      if (row.tabIndex !== wanted) row.tabIndex = wanted;
    }
  });

  return useMemo<RovingList>(() => {
    const isRow = (el: EventTarget | null): el is HTMLElement =>
      el instanceof HTMLElement && el.dataset.taskId !== undefined && el.parentElement === listRef.current;
    return {
      onKeyDown(event) {
        // Keys from a row's own controls (Retry, Discard) are theirs.
        if (!isRow(event.target)) return;
        if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.nativeEvent.isComposing) return;
        const action = actionForKey(event.key);
        if (!action) return;
        event.preventDefault();
        const all = rows();
        const next = all[rovingIndex(all.indexOf(event.target), all.length, action)];
        if (next && next !== event.target) {
          activate(next);
          next.focus();
        }
      },
      onFocus(event) {
        if (isRow(event.target)) activate(event.target);
      },
      focusAfterRemoval(id) {
        const all = rows();
        const targetId = removalTarget(
          all.map((row) => row.dataset.taskId!),
          id,
        );
        const target = targetId ? all.find((row) => row.dataset.taskId === targetId) : undefined;
        if (target) {
          activate(target);
          target.focus();
        } else {
          fallbackRef.current?.()?.focus();
        }
      },
    };
  }, [activate, listRef, rows]);
}
