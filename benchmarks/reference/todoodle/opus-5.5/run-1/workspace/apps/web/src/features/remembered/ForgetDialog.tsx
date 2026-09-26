import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useForgetRemembered } from './api';
import { UnsavedLinkWarning } from './UnsavedLinkWarning';

export type ForgetDialogProps = {
  workspace: { id: string; name: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once the server confirmed the forget (e.g. the switcher then goes Home). */
  onForgotten?: () => void;
};

/**
 * 'Forget <name> on this browser?' Removes the workspace from this browser's list only (optimistic,
 * rolled back with an alert toast on failure). Warns first when this browser never saved the link.
 */
export default function ForgetDialog({ workspace, open, onOpenChange, onForgotten }: ForgetDialogProps) {
  const forget = useForgetRemembered();
  // True while the Copy link request runs: the cookie entry that authorises it must still exist.
  const [linkPending, setLinkPending] = useState(false);

  function onForget() {
    onOpenChange(false);
    forget.mutateAsync(workspace.id).then(
      () => onForgotten?.(),
      () => {}, // Rollback and toast are handled by the mutation.
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogTitle className="text-lg font-semibold">{`Forget ${workspace.name} on this browser?`}</AlertDialogTitle>
        <AlertDialogDescription className="text-muted-foreground">
          This only removes it from this browser. Anyone with the link can still open it.
        </AlertDialogDescription>
        <UnsavedLinkWarning workspaceId={workspace.id} onPendingChange={setLinkPending} />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button className="touch-target" disabled={linkPending} onClick={onForget}>
            Forget
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
