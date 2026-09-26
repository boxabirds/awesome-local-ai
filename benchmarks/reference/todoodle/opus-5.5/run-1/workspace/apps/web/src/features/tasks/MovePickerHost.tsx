import { Suspense } from 'react';
import { LazyMoveToPicker } from './moveToPickerLoader';
import { useMovePicker } from './movePicker';
import { useMoveShortcut } from './useMoveShortcut';

/**
 * Mounted once in the workspace shell: renders Move to… while it is open (from a task menu or M) and
 * registers the M shortcut.
 */
export function MovePickerHost({ workspaceId }: { workspaceId: string }) {
  useMoveShortcut();
  const picker = useMovePicker();
  if (!picker) return null;
  return (
    <Suspense fallback={null}>
      <LazyMoveToPicker key={picker.taskId} workspaceId={workspaceId} taskId={picker.taskId} row={picker.row} />
    </Suspense>
  );
}
