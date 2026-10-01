// Low-level Y.Map access for tests: the raw object entries, the way a damaged
// or future board would hold them, with no help from board-model.

import * as Y from 'yjs';

/** The board's objects map, by name (the one board-model writes through). */
export function rawObjects(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap('objects');
}

/** One object entry as a raw Y.Map, or null when it is absent or not a map. */
export function rawObject(doc: Y.Doc, id: string): Y.Map<unknown> | null {
  const value = rawObjects(doc).get(id);
  return value instanceof Y.Map ? value : null;
}

/**
 * A raw object written straight into the map, bypassing every guard. The
 * fields a readable sticky needs (type, z, empty text) default when not given;
 * pass a field explicitly to override, or pass `text: null`-like damage as is.
 */
export function putRawObject(
  doc: Y.Doc,
  id: string,
  fields: Record<string, unknown>,
): Y.Map<unknown> {
  const raw = new Y.Map<unknown>();
  const withDefaults: Record<string, unknown> = {
    type: 'sticky',
    z: 1,
    createdAt: 1,
    text: new Y.Text(),
    ...fields,
  };
  for (const [key, value] of Object.entries(withDefaults)) raw.set(key, value);
  rawObjects(doc).set(id, raw);
  return raw;
}

/** A sticky's Y.Text as a string, or null when the entry holds none. */
export function stickyText(doc: Y.Doc, id: string): string | null {
  const value = rawObject(doc, id)?.get('text');
  return value instanceof Y.Text ? value.toString() : null;
}
