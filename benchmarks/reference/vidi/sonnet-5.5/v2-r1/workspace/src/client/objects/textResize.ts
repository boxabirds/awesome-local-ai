import type * as Y from 'yjs';
import { moveObjects, objectsOf } from '../../shared/board-model';
import { setTextWidthFixed } from '../../shared/objects/text';
import type { Rect } from '../../shared/geometry';
import { remeasureText } from './useTextBoxSync';
import type { Measurer } from './textLayout';

/**
 * Applies resize-gesture rects to text objects. Height always follows the content, so only x, y and (for fixed
 * width) width are taken from the rect. When only text is selected a side-handle drag fixes the width; in a mixed
 * selection automatic-width text is just repositioned and fixed-width text scales. Font size never changes.
 */
export function applyTextResize(doc: Y.Doc, rects: ReadonlyMap<string, Rect>, onlyText: boolean, measure: Measurer): void {
  for (const [id, r] of rects) {
    const fixed = onlyText || objectsOf(doc).get(id)?.get('widthMode') === 'fixed';
    if (fixed) setTextWidthFixed(doc, id, r.width, r.x);
    moveObjects(doc, new Map([[id, { x: r.x, y: r.y }]]));
    remeasureText(doc, id, measure);
  }
}
