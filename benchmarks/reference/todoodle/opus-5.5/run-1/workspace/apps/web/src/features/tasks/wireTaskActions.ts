import { TASK_COMPLETED_TEXT, TASK_DELETED_TEXT, showUndoToast } from '@/features/undo/showUndoToast';
import { moveFocusBeforeRemoval, refocusAfterRollback } from './focusAfterAction';
import { setTaskActionHooks } from './useTaskMutations';

// Plugs focus management and the undo toast into the task actions (the actions module knows nothing about
// either). Imported for its side effect by the views that use task actions.
setTaskActionHooks({
  beforeRemoval: moveFocusBeforeRemoval,
  afterRollback: refocusAfterRollback,
  offerUndo: (kind, inverse) => showUndoToast({ message: kind === 'completed' ? TASK_COMPLETED_TEXT : TASK_DELETED_TEXT, inverse }),
});
