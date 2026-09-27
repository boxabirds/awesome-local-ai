import { useRef } from 'react';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

/** 'Move 7 overdue tasks to today?' (prd.reschedule_confirm). */
export function rescheduleQuestion(count: number): string {
  return `Move ${count} overdue ${count === 1 ? 'task' : 'tasks'} to today?`;
}

type Props = {
  count: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  /** Where focus goes when the dialog closes (the Reschedule button, or the view heading once it is gone). */
  returnFocus: () => HTMLElement | null;
};

/**
 * Asked before Reschedule moves more than one overdue task. Cancel or Escape sends nothing and changes nothing;
 * Move confirms. Focus starts on Cancel. Lazy chunk, preloaded from the Reschedule button.
 */
export function RescheduleConfirm({ count, open, onOpenChange, onConfirm, returnFocus }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        aria-describedby={undefined}
        data-reschedule-confirm
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus()?.focus();
        }}
      >
        <AlertDialogTitle className="text-lg font-semibold">{rescheduleQuestion(count)}</AlertDialogTitle>
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancelRef}>Cancel</AlertDialogCancel>
          <Button
            className="touch-target"
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            Move
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
