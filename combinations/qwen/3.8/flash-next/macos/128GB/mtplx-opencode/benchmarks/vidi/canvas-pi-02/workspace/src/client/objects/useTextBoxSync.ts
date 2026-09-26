/**
 * useTextBoxSync (story 9).
 *
 * After a local text change, size change or fixed-width drag, measures and
 * writes the bounding box to the document. Remote updates never trigger a
 * write — that is the key constraint from Key Decision 1: five clients must
 * not race to write the same dimensions.
 */
import type { Measurer } from './textLayout';
import { layoutText } from './textLayout';
import type { TextSize } from '../../shared/config';
import {
  getTextContent,
  setTextBox,
} from '../../shared/objects/text';
import * as Y from 'yjs';

export interface UseTextBoxSync {
  remeasureAfterLocalChange(): void;
}

/**
 * Creates a box-sync object bound to a document and a text object id.
 * Call `remeasureAfterLocalChange()` only after LOCAL changes.
 */
export function createTextBoxSync(
  doc: Y.Doc,
  id: string,
  measure: Measurer,
): UseTextBoxSync {
  return {
    remeasureAfterLocalChange(): void {
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      const obj = objects.get(id);
      if (!(obj instanceof Y.Map) || obj.get('type') !== 'text') return;

      const ytext = getTextContent(doc, id);
      if (!ytext) return;

      const size = (obj.get('size') as TextSize) || 'M';
      const widthMode = (obj.get('widthMode') as 'auto' | 'fixed') || 'auto';
      const storedWidth = obj.get('width') as number | undefined;

      const text = ytext.toString();
      if (text.length === 0) return; // Don't compute box for empty text.

      const fixedWidth = widthMode === 'fixed' && typeof storedWidth === 'number'
        ? storedWidth
        : null;

      const { width, height } = layoutText(text, size, widthMode, fixedWidth, measure);

      // Only write if the box actually changed.
      const currentW = typeof storedWidth === 'number' ? storedWidth : 80;
      const currentH = typeof obj.get('height') === 'number' ? (obj.get('height') as number) : 26;

      if (Math.abs(currentW - width) < 0.5 && Math.abs(currentH - height) < 0.5) {
        return; // Box unchanged, skip write.
      }

      setTextBox(doc, id, { width, height });
    },
  };
}