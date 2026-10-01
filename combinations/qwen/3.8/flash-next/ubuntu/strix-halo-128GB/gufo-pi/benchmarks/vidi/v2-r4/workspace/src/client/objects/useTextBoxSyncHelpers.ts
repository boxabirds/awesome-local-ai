/**
 * Internal helpers for useTextBoxSync.
 */
import type * as Y from 'yjs';

export function getTextObj(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'text') return undefined;
  return obj;
}
