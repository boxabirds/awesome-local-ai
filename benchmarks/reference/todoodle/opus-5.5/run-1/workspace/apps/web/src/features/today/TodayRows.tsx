import { TODAY_FIRST_RENDER_ROWS } from '@todoodle/shared/limits';
import { useDeferredValue, useLayoutEffect, useRef } from 'react';
import { applyPendingRowFocus } from '@/features/tasks/focusAfterAction';
import { TaskRow } from '@/features/tasks/TaskRow';
import { useRovingList } from '@/features/tasks/useRovingList';
import type { TodayRow } from './todayCache';

function renderRow(row: TodayRow) {
  return (
    <TaskRow
      key={row.id}
      taskId={row.id}
      name={row.name}
      description={row.description}
      completedAt={row.completedAt}
      localStatus={row.localStatus}
      leaving={row.leaving}
      dueDate={row.dueDate}
      showProject
      projectName={row.projectName}
      projectColor={row.projectColor}
    />
  );
}

/**
 * One Today group's rows: a listbox of story 5's memoised TaskRow (each row carries `row-cv`, never the list), with
 * the roving tabindex (one Tab stop; ↑/↓, j/k, Home, End) and each row's project tag. The first render shows the
 * first TODAY_FIRST_RENDER_ROWS rows and the rest follow in a deferred render (prd.today_responsive).
 */
export function TodayRows({ rows, label }: { rows: TodayRow[]; label: string }) {
  const shown = useDeferredValue(rows, rows.length > TODAY_FIRST_RENDER_ROWS ? rows.slice(0, TODAY_FIRST_RENDER_ROWS) : rows);
  const listRef = useRef<HTMLUListElement>(null);
  const roving = useRovingList(listRef);
  // A rolled-back completion or delete brings focus back to its row once it is on screen again.
  useLayoutEffect(() => applyPendingRowFocus(listRef.current));
  return (
    <ul ref={listRef} role="listbox" aria-label={label} className="flex flex-col" onKeyDown={roving.onKeyDown} onFocus={roving.onFocus}>
      {shown.map(renderRow)}
    </ul>
  );
}
