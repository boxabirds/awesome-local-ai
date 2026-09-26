import { createContext } from 'react';

/** Row callbacks, shared through context (built once with useMemo), so rows never get inline lambdas. */
export type TaskRowActions = {
  retry: (id: string) => void;
  discard: (id: string) => void;
};

const noop = () => {};

export const TaskRowActionsContext = createContext<TaskRowActions>({ retry: noop, discard: noop });
