import { MAX_PROJECTS_PER_WORKSPACE } from '@todoodle/shared/limits';
import { normaliseForSearch } from '@todoodle/shared/search';
import { describe, expect, it } from 'vitest';
import { type Destination, INBOX_DESTINATION, filterDestinations } from '@/features/tasks/filterDestinations';

// Story 7, TC-80 and TC-81: Move to…'s filtering (prd.move_search). Pure; realistic, accented names.

function project(id: string, name: string): Destination {
  return { id, name, colorKey: 'red', searchKey: normaliseForSearch(name) };
}

const WORK = project('a'.repeat(32), 'Work');
const WOODWORK = project('b'.repeat(32), 'Woodwork');
const CAFE = project('c'.repeat(32), 'Café');
const HOME = project('d'.repeat(32), 'Home');
const OPTIONS = [INBOX_DESTINATION, WORK, WOODWORK, CAFE, HOME];

const names = (query: string, current: string | null = null) => filterDestinations(OPTIONS, query, current).map((o) => o.name);

describe('TC-80 filterDestinations: queries', () => {
  it("'' -> every option, the Inbox first", () => {
    expect(names('')).toEqual(['Inbox', 'Work', 'Woodwork', 'Café', 'Home']);
  });

  it("'WORK' -> names containing 'work', ignoring case (PRD: 'contain the typed text')", () => {
    expect(names('WORK')).toEqual(['Work', 'Woodwork']);
    expect(names('wOrK')).toEqual(['Work', 'Woodwork']);
  });

  it("'cafe' finds 'Café' (accents ignored), and so does 'CAFÉ'", () => {
    expect(names('cafe')).toEqual(['Café']);
    expect(names('CAFÉ')).toEqual(['Café']);
  });

  it("'inb' -> the Inbox (matched by name like any project)", () => {
    expect(names('inb')).toEqual(['Inbox']);
  });

  it("'zzz' -> nothing (the picker says 'No matching projects')", () => {
    expect(names('zzz')).toEqual([]);
  });

  it("'  wo  ' -> Work and Woodwork (surrounding whitespace ignored)", () => {
    expect(names('  wo  ')).toEqual(['Work', 'Woodwork']);
  });
});

describe('TC-81 filterDestinations: boundaries', () => {
  it('0 projects -> [Inbox]', () => {
    expect(filterDestinations([INBOX_DESTINATION], '', null).map((o) => o.name)).toEqual(['Inbox']);
  });

  it(`${MAX_PROJECTS_PER_WORKSPACE} projects -> ${MAX_PROJECTS_PER_WORKSPACE + 1} options in sort order, the Inbox first`, () => {
    const many = Array.from({ length: MAX_PROJECTS_PER_WORKSPACE }, (_, i) => project(i.toString(16).padStart(32, '0'), `Project ${i + 1}`));
    // Even if the Inbox is not given first, it comes first.
    const result = filterDestinations([...many, INBOX_DESTINATION], '', null);
    expect(result).toHaveLength(MAX_PROJECTS_PER_WORKSPACE + 1);
    expect(result[0]!.name).toBe('Inbox');
    expect(result.slice(1).map((o) => o.name)).toEqual(many.map((p) => p.name));
  });

  it('the current list (a project, or the Inbox) is offered but disabled; all others are enabled', () => {
    const inWork = filterDestinations(OPTIONS, '', WORK.id);
    expect(inWork.filter((o) => o.disabled).map((o) => o.name)).toEqual(['Work']);
    const inInbox = filterDestinations(OPTIONS, '', null);
    expect(inInbox.filter((o) => o.disabled).map((o) => o.name)).toEqual(['Inbox']);
  });
});
