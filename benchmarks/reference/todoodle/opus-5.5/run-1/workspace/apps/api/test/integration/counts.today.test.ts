import { describe, expect, it } from 'vitest';
import { createDated, getCountsWith, member } from '../support/dates.ts';
import { createProject, deleteProject } from '../support/projects.ts';
import { deleteTask, lifecycle } from '../support/tasks.ts';

// Story 8, TC-97..TC-99: GET counts?date adds `today` (open, not deleted, due on or before the viewer's date, not in
// a deleted project), in the same statement as story 5/7's counts. Without a date the field is omitted.

async function fixture() {
  const { browser, id } = await member();
  const work = await createProject(browser, id, 'Work', 'red');
  const old = await createProject(browser, id, 'Old stuff', 'blue');
  await createDated(browser, id, 'Overdue 1', '2026-09-20');
  await createDated(browser, id, 'Overdue 2', '2026-09-24', work);
  await createDated(browser, id, 'Today 1', '2026-09-25');
  await createDated(browser, id, 'Today 2', '2026-09-25', work);
  await createDated(browser, id, 'Today 3', '2026-09-25');
  const done = await createDated(browser, id, 'Completed today', '2026-09-25');
  expect((await lifecycle(browser, id, done, 'complete')).status).toBe(200);
  const gone = await createDated(browser, id, 'Deleted today', '2026-09-25');
  expect((await deleteTask(browser, id, gone)).status).toBe(204);
  await createDated(browser, id, 'In a deleted project', '2026-09-20', old);
  expect((await deleteProject(browser, id, old)).status).toBe(200);
  await createDated(browser, id, 'Future 1', '2026-09-26');
  await createDated(browser, id, 'Future 2', '2026-12-01', work);
  await createDated(browser, id, 'Undated 1', null);
  await createDated(browser, id, 'Undated 2', null, work);
  return { browser, id, work };
}

describe('counts: today (TC-97..TC-99)', () => {
  it('TC-97 today = 5; inbox and project counts keep their story 5/7 meaning', async () => {
    const { browser, id, work } = await fixture();
    const res = await getCountsWith(browser, id, '?date=2026-09-25');
    expect(res.status).toBe(200);
    // Inbox open: Overdue 1, Today 1, Today 3, Future 1, Undated 1. Work open: Overdue 2, Today 2, Future 2, Undated 2.
    expect(await res.json()).toEqual({ inbox: 5, projects: { [work]: { open: 4, total: 4 } }, today: 5 });
  });

  it('TC-98 no date: no today field (the server clock is never used); the other counts are there', async () => {
    const { browser, id, work } = await fixture();
    const res = await getCountsWith(browser, id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ inbox: 5, projects: { [work]: { open: 4, total: 4 } } });
  });

  it.each(['?date=2026-02-30', '?date=today', '?date='])('TC-99 %j -> 400 validation', async (query) => {
    const { browser, id } = await member();
    const res = await getCountsWith(browser, id, query);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'validation' });
  });

  it('the count follows the viewer date: the day before, only overdue ones count', async () => {
    const { browser, id } = await fixture();
    expect(((await (await getCountsWith(browser, id, '?date=2026-09-24')).json()) as { today: number }).today).toBe(2);
    expect(((await (await getCountsWith(browser, id, '?date=2026-12-31')).json()) as { today: number }).today).toBe(7);
  });
});
