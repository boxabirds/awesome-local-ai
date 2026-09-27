import { RESCHEDULE_CONFIRM_MIN } from '@todoodle/shared/limits';
import { Suspense, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useLocalDate } from '@/features/dates/useLocalDate';
import { LazyRescheduleConfirm, preloadRescheduleConfirm } from './rescheduleConfirmLoader';
import { useReschedule } from './useReschedule';

function preload() {
  preloadRescheduleConfirm().catch(() => undefined);
}

/**
 * Reschedule on the Overdue group (prd.reschedule_overdue): moves exactly the overdue tasks on screen to the viewer's
 * local date. One task moves at once; RESCHEDULE_CONFIRM_MIN or more first ask 'Move N overdue tasks to today?'
 * (prd.reschedule_confirm), and Cancel or Escape sends nothing. The move is optimistic, with Undo.
 */
export function RescheduleButton({ workspaceId, ids }: { workspaceId: string; ids: readonly string[] }) {
  const to = useLocalDate();
  const { reschedule } = useReschedule(workspaceId);
  // The ids on screen when the user chose Reschedule: exactly what the confirmation counts and Move sends.
  const [confirming, setConfirming] = useState<string[] | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const onClick = () => {
    const shown = [...ids];
    if (shown.length === 0) return;
    if (shown.length >= RESCHEDULE_CONFIRM_MIN) setConfirming(shown);
    else void reschedule(shown, to);
  };

  return (
    <>
      <Button ref={buttonRef} variant="outline" size="sm" data-reschedule onClick={onClick} onPointerEnter={preload} onFocus={preload}>
        Reschedule
      </Button>
      {confirming ? (
        <Suspense fallback={null}>
          <LazyRescheduleConfirm
            count={confirming.length}
            open
            onOpenChange={(open) => {
              if (!open) setConfirming(null);
            }}
            onConfirm={() => void reschedule(confirming, to)}
            returnFocus={() => (buttonRef.current?.isConnected ? buttonRef.current : document.getElementById('view-title'))}
          />
        </Suspense>
      ) : null}
    </>
  );
}
