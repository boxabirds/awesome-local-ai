import * as Y from 'yjs';

import { OBJECTS_KEY, TEXT_TYPE } from '../../../src/shared/board-model.js';
import type { TextSize } from '../../../src/shared/config.js';
import { createText, getTextContent, setTextSize, setTextWidthMode } from '../../../src/shared/objects/text.js';

/** The `objects` map, typed the way the model types it. */
export function objectEntriesOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(OBJECTS_KEY);
}

/** One object entry's fields as plain values, with a `Y.Text` read out. */
export function readObjectEntry(doc: Y.Doc, id: string): Record<string, unknown> {
  const entry = objectEntriesOf(doc).get(id);
  if (!entry) throw new Error(`no object entry ${id}`);
  const fields: Record<string, unknown> = {};
  for (const [key, value] of entry) {
    fields[key] = value instanceof Y.Text ? value.toString() : value;
  }
  return fields;
}

/** The raw entry, for a test that wants to corrupt or inspect a field. */
export function textEntry(doc: Y.Doc, id: string): Y.Map<unknown> {
  const entry = objectEntriesOf(doc).get(id);
  if (!entry) throw new Error(`no object entry ${id}`);
  return entry;
}

export interface SeedText {
  x?: number;
  y?: number;
  text?: string;
  size?: TextSize;
  widthMode?: 'auto' | 'fixed';
}

/**
 * Put a text object on the board the way another client would: in one
 * transaction, with no transaction origin, so nothing in it counts as this
 * client's own work (`useTextBoxSync` and the undo tests depend on that).
 */
export function seedText(doc: Y.Doc, opts: SeedText = {}): string {
  const { x = 0, y = 0, text = '', size, widthMode = 'auto' } = opts;
  return doc.transact(() => {
    const id = createText(doc, { x, y });
    if (typeof id !== 'string') throw new Error('seedText: non-finite point');
    if (text !== '') getTextContent(doc, id)?.insert(0, text);
    if (size !== undefined) setTextSize(doc, id, size);
    if (widthMode === 'fixed') setTextWidthMode(doc, id, 'fixed');
    return id;
  });
}

/** Every text object on the board, by id, sorted so tests need not care. */
export function textIdsOf(doc: Y.Doc): string[] {
  const ids: string[] = [];
  for (const [id, entry] of objectEntriesOf(doc)) {
    if (entry.get('type') === TEXT_TYPE) ids.push(id);
  }
  return ids.sort();
}
