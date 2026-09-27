import { WarningIcon } from '@/components/icons';
import { RescheduleButton } from './RescheduleButton';
import type { TodayRow } from './todayCache';
import { TodayRows } from './TodayRows';

// Hoisted: the same warning icon as overdue chips, so the heading never relies on colour alone.
const warningIcon = <WarningIcon aria-hidden="true" data-overdue-icon className="size-4 shrink-0" />;

/** The Overdue group (prd.overdue_group): heading with the warning icon and count, Reschedule, then its rows. */
export function OverdueSection({ workspaceId, rows, ids }: { workspaceId: string; rows: TodayRow[]; ids: readonly string[] }) {
  return (
    <section aria-labelledby="today-overdue-title" data-today-section="overdue" className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 px-2">
        <h2 id="today-overdue-title" className="flex items-center gap-1.5 text-sm font-semibold text-chip-overdue">
          {warningIcon}
          Overdue
          <span data-overdue-count className="font-normal text-muted-foreground">
            {rows.length}
          </span>
        </h2>
        <RescheduleButton workspaceId={workspaceId} ids={ids} />
      </div>
      <TodayRows rows={rows} label="Overdue tasks" />
    </section>
  );
}
