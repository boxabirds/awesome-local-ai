import { useQuery } from '@tanstack/react-query';
import type { Counts } from '@todoodle/shared/schemas';
import { useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { countsQuery } from '@/features/tasks/queries';
import { deleteProjectQuestion } from './deleteProjectCopy';

type Props = {
  workspaceId: string;
  projectId: string;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  /** Where focus goes when the dialog closes: the '…' trigger, or (if its row is gone) the Projects heading. */
  returnFocus: () => HTMLElement | null;
};

/**
 * '…' > Delete. Confirmation is kept for projects (product-owner decision 2026-09-25): one confirm can remove
 * many tasks, and the question says how many (open and completed). Focus starts on Cancel. Lazy chunk,
 * preloaded when the row menu opens.
 */
export function DeleteProjectDialog({ workspaceId, projectId, name, open, onOpenChange, onConfirm, returnFocus }: Props) {
  const selectTotal = useCallback((counts: Counts) => counts.projects?.[projectId]?.total ?? 0, [projectId]);
  const { data: total = 0 } = useQuery({ ...countsQuery(workspaceId), select: selectTotal });
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        aria-describedby={undefined}
        data-delete-project
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus()?.focus();
        }}
      >
        <AlertDialogTitle className="text-lg font-semibold break-words">{deleteProjectQuestion(name, total)}</AlertDialogTitle>
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancelRef}>Cancel</AlertDialogCancel>
          <Button
            className="touch-target bg-destructive text-background hover:bg-destructive/90"
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
