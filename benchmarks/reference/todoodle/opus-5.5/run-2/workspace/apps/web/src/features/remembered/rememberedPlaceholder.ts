import type { RememberedPublic } from '@todoodle/shared/schemas';
import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';

type Named = { id: string; name: string };

/** One id -> entry map per cached list (keyed by the array itself, so it rebuilds when the list changes). */
const indexes = new WeakMap<RememberedPublic[], Map<string, Named>>();

function indexOf(list: RememberedPublic[]): Map<string, Named> {
  let index = indexes.get(list);
  if (!index) {
    index = new Map();
    for (const entry of list) {
      if (entry.available && entry.name !== null) index.set(entry.id, { id: entry.id, name: entry.name });
    }
    indexes.set(list, index);
  }
  return index;
}

/**
 * The name this browser already knows for `id`, from the cached remembered list. Read-only: it
 * never fetches and never writes the cache. Undefined when the list isn't cached or the entry is
 * missing or unavailable.
 */
export function rememberedPlaceholder(queryClient: QueryClient, id: string): Named | undefined {
  const list = queryClient.getQueryData<RememberedPublic[]>(queryKeys.remembered());
  return list ? indexOf(list).get(id) : undefined;
}
