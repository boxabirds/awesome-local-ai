import { normaliseForSearch } from '@todoodle/shared/search';

/** A place a task can move to: the Inbox (id null) or a project. searchKey = normaliseForSearch(name), precomputed. */
export type Destination = { id: string | null; name: string; colorKey: string | null; searchKey: string };

/** One option in Move to…: the task's current list is shown but disabled (marked with a check). */
export type DestinationOption = { id: string | null; name: string; colorKey: string | null; disabled: boolean };

/** The Inbox as a destination (it is not a project, but it is matched by name like one). */
export const INBOX_DESTINATION: Destination = { id: null, name: 'Inbox', colorKey: null, searchKey: normaliseForSearch('Inbox') };

/**
 * Move to…'s options for a query (tasks.ui_move_picker): the Inbox first, then projects in the given (creation)
 * order, keeping those whose name contains the query, ignoring case, accents and surrounding whitespace. An
 * empty query keeps everything. The task's current list (`currentListId`, null = Inbox) stays in the list,
 * disabled. Pure: one pass over at most MAX_PROJECTS_PER_WORKSPACE + 1 options.
 */
export function filterDestinations(options: readonly Destination[], query: string, currentListId: string | null): DestinationOption[] {
  const needle = normaliseForSearch(query);
  const result: DestinationOption[] = [];
  let inbox: DestinationOption | null = null;
  for (const option of options) {
    if (needle !== '' && !option.searchKey.includes(needle)) continue;
    const entry = { id: option.id, name: option.name, colorKey: option.colorKey, disabled: option.id === currentListId };
    if (option.id === null) inbox = entry;
    else result.push(entry);
  }
  return inbox ? [inbox, ...result] : result;
}
