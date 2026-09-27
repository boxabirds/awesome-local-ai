import { createContext, useContext } from 'react';

/** Row callbacks, provided once with a stable value so memoised rows never re-render for them. */
export type TaskActions = {
  retry(id: string): void;
  discard(id: string): void;
  /** Story 6: complete an open task, reopen a completed one. */
  toggle(id: string): void;
  /** Story 6: delete at once, with Undo (no confirmation). */
  remove(id: string, opts?: { moveFocus?: boolean }): void;
  /** Story 6: open the task's detail sheet. */
  openDetail(id: string): void;
};

const noop = () => {};
export const TaskActionsContext = createContext<TaskActions>({
  retry: noop,
  discard: noop,
  toggle: noop,
  remove: noop,
  openDetail: noop,
});

export function useTaskActions(): TaskActions {
  return useContext(TaskActionsContext);
}
