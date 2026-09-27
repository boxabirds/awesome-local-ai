import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { hasSavedLink } from '@/features/share/linkSaved';
import { useForgetRemembered } from './api';
import { UnsavedLinkWarning } from './UnsavedLinkWarning';

export const FORGET_BODY = 'This only removes it from this browser. Anyone with the link can still open it.';

export type ForgetDialogProps = {
  workspace: { id: string; name: string };
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Called right after Forget is confirmed (the removal is optimistic). */
  onForgotten?(): void;
  /** Where focus goes when the dialog closes (the row's "..." button or the switcher). */
  returnFocusTo?: HTMLElement | null;
};

/** "Forget <name> on this browser?" Loaded on demand through forgetDialogLoader. */
export default function ForgetDialog({ workspace, open, onOpenChange, onForgotten, returnFocusTo }: ForgetDialogProps) {
  const forget = useForgetRemembered();

  function confirm() {
    forget.mutate(workspace.id);
    onOpenChange(false);
    onForgotten?.();
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            // Opened from a menu item (no Radix Trigger), so hand focus back explicitly.
            event.preventDefault();
            if (returnFocusTo?.isConnected) returnFocusTo.focus();
          }}
        >
          <ForgetDialogBody workspace={workspace} onConfirm={confirm} />
        </AlertDialogContent>
      ) : null}
    </AlertDialog>
  );
}

/** Mounted per open, so the saved flag is read fresh each time the dialog opens. */
function ForgetDialogBody({ workspace, onConfirm }: { workspace: { id: string; name: string }; onConfirm(): void }) {
  const [saved] = useState(() => hasSavedLink(workspace.id));
  const [linkPending, setLinkPending] = useState(false);
  return (
    <>
      <AlertDialogTitle className="text-xl font-semibold">{`Forget ${workspace.name} on this browser?`}</AlertDialogTitle>
      <AlertDialogDescription className="text-sm">{FORGET_BODY}</AlertDialogDescription>
      {saved ? null : <UnsavedLinkWarning workspaceId={workspace.id} onPendingChange={setLinkPending} />}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <AlertDialogCancel asChild>
          <Button variant="secondary" className="w-full sm:w-auto">
            Cancel
          </Button>
        </AlertDialogCancel>
        <Button className="w-full sm:w-auto" disabled={linkPending} onClick={onConfirm}>
          Forget
        </Button>
      </div>
    </>
  );
}
