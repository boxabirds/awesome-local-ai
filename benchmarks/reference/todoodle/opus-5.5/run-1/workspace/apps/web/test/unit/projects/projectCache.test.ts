import type { Counts } from '@todoodle/shared/schemas';
import { describe, expect, it } from 'vitest';
import { adjustCounts, applyProjectEvent, moveCountsDelta, taskCountsDelta } from '@/features/projects/projectCache';
import { makeProject } from '../../msw/projects.ts';

// Story 7, TC-49 (live-event reducer) and TC-50 (counts deltas): pure, no I/O.

const work = makeProject({ name: 'Work', sortOrder: 1, version: 2 });
const home = makeProject({ name: 'Home', sortOrder: 2 });
const trip = makeProject({ name: 'Trip to Lisbon', sortOrder: 3 });

describe('TC-49 applyProjectEvent', () => {
  it('ignores an event whose version is not newer than the cached copy (same reference back)', () => {
    const list = [work, home];
    expect(applyProjectEvent(list, { type: 'project.upserted', project: { ...work, name: 'Old' }, version: 1 })).toBe(list);
    expect(applyProjectEvent(list, { type: 'project.upserted', project: { ...work, name: 'Same' }, version: 2 })).toBe(list);
    expect(applyProjectEvent(list, { type: 'project.deleted', id: work.id, version: 2 })).toBe(list);
  });

  it('replaces a cached project with a newer version in place, keeping other references', () => {
    const list = [work, home];
    const next = applyProjectEvent(list, { type: 'project.upserted', project: { ...work, name: 'Job' }, version: 3 })!;
    expect(next.map((p) => p.name)).toEqual(['Job', 'Home']);
    expect(next[0]!.version).toBe(3);
    expect(next[1]).toBe(home);
  });

  it('inserts a new project in creation order', () => {
    const next = applyProjectEvent([work, trip], { type: 'project.upserted', project: home, version: 1 })!;
    expect(next.map((p) => p.name)).toEqual(['Work', 'Home', 'Trip to Lisbon']);
  });

  it('removes a deleted project; an unknown id changes nothing', () => {
    const list = [work, home, trip];
    expect(applyProjectEvent(list, { type: 'project.deleted', id: home.id, version: 2 })!.map((p) => p.name)).toEqual(['Work', 'Trip to Lisbon']);
    expect(applyProjectEvent(list, { type: 'project.deleted', id: 'f'.repeat(32), version: 9 })).toBe(list);
  });

  it('puts a restored project back at its sort position', () => {
    const next = applyProjectEvent([work, trip], { type: 'project.restored', project: { ...home, version: 3 }, version: 3 })!;
    expect(next.map((p) => p.name)).toEqual(['Work', 'Home', 'Trip to Lisbon']);
  });

  it('leaves an uncached list uncached', () => {
    expect(applyProjectEvent(undefined, { type: 'project.upserted', project: work, version: 5 })).toBeUndefined();
  });
});

describe('TC-50 adjustCounts', () => {
  const counts: Counts = { inbox: 4, projects: { [work.id]: { open: 3, total: 5 }, [home.id]: { open: 0, total: 0 } } };

  it('a move from the Inbox to Work: Inbox -1, Work open +1 and total +1', () => {
    const next = adjustCounts(counts, moveCountsDelta({ completedAt: null, projectId: null }, work.id))!;
    expect(next).toEqual({ inbox: 3, projects: { [work.id]: { open: 4, total: 6 }, [home.id]: { open: 0, total: 0 } } });
  });

  it('a completed task moving between projects moves only the total', () => {
    const next = adjustCounts(counts, moveCountsDelta({ completedAt: '2026-09-24T17:30:00.000Z', projectId: work.id }, home.id))!;
    expect(next.projects![work.id]).toEqual({ open: 3, total: 4 });
    expect(next.projects![home.id]).toEqual({ open: 0, total: 1 });
    expect(next.inbox).toBe(4);
  });

  it('a project delete removes its entry; a restore brings it back', () => {
    const deleted = adjustCounts(counts, { remove: [work.id] })!;
    expect(deleted.projects).toEqual({ [home.id]: { open: 0, total: 0 } });
    expect(adjustCounts(deleted, { projects: { [work.id]: { open: 3, total: 5 } } })!.projects![work.id]).toEqual({ open: 3, total: 5 });
  });

  it('never goes below zero', () => {
    expect(adjustCounts(counts, { inbox: -10, projects: { [home.id]: { open: -1, total: -1 } } })).toEqual({
      inbox: 0,
      projects: { [work.id]: { open: 3, total: 5 }, [home.id]: { open: 0, total: 0 } },
    });
  });

  it('no change -> the same reference; no counts -> undefined; a moved task to its own list -> nothing', () => {
    expect(adjustCounts(counts, {})).toBe(counts);
    expect(adjustCounts(undefined, { inbox: 1 })).toBeUndefined();
    expect(moveCountsDelta({ completedAt: null, projectId: work.id }, work.id)).toEqual({});
    expect(taskCountsDelta({ completedAt: null, projectId: null }, -1)).toEqual({ inbox: -1 });
  });
});
