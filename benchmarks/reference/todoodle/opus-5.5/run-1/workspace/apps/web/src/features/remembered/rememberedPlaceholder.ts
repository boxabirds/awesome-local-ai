import type { QueryClient } from '@tanstack/react-query';
import type { RememberedPublic } from '@todoodle/shared/schemas';
import { queryKeys } from '@/lib/queryKeys';

export type RememberedName = { id: string; name: string };

// One id -> entry map per cached list version (js-index-maps), keyed by the array's identity.
const indexes = new WeakMap<RememberedPublic[], Map<string, RememberedPublic>>();

function indexOf(list: RememberedPublic[]): Map<string, RememberedPublic> {
  let index = indexes.get(list);
  if (!index) {
    index = new Map(list.map((entry) => [entry.id, entry]));
    indexes.set(list, index);
  }
  return index;
}

/**
 * The workspace's name from the cached remembered list, for an instant header while the workspace
 * loads. Reads the cache only: never fetches and never writes. Undefined when the list is not cached,
 * the id is not in it, or the entry is unavailable.
 */
export function rememberedPlaceholder(queryClient: QueryClient, id: string): RememberedName | undefined {
  const list = queryClient.getQueryData<RememberedPublic[]>(queryKeys.remembered());
  if (!list) return undefined;
  const entry = indexOf(list).get(id);
  return entry?.available && entry.name !== null ? { id: entry.id, name: entry.name } : undefined;
}
