import { createContext, useContext } from 'react';

/** Row callbacks, provided once with a stable value so memoised rows never re-render for them. */
export type TaskActions = { retry(id: string): void; discard(id: string): void };

const noop = () => {};
export const TaskActionsContext = createContext<TaskActions>({ retry: noop, discard: noop });

export function useTaskActions(): TaskActions {
  return useContext(TaskActionsContext);
}
