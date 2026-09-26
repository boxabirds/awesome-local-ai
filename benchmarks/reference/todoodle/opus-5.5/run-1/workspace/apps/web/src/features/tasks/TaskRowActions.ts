import { createContext } from 'react';

/** Row callbacks, shared through context (built once with useMemo), so rows never get inline lambdas. */
export type TaskRowActions = {
  retry: (id: string) => void;
  discard: (id: string) => void;
  /** Story 6. */
  complete: (id: string) => void;
  reopen: (id: string) => void;
  remove: (id: string) => void;
  /** Opens the task's detail sheet; focus returns to `row` when it closes. */
  edit: (id: string, row: HTMLElement | null) => void;
};

const noop = () => {};

export const TaskRowActionsContext = createContext<TaskRowActions>({
  retry: noop,
  discard: noop,
  complete: noop,
  reopen: noop,
  remove: noop,
  edit: noop,
});
