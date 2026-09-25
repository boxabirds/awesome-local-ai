/**
 * useTextBoxSync (story 9): keeps the text object's stored box in sync with
 * its content and size in auto mode.
 *
 * The sync runs on a requestAnimationFrame debounce so rapid typing doesn't
 * cause a storm of transactions. In fixed mode the box is not auto-synced
 * (the user controls the width via the e/w handles or the toolbar).
 */

import { useEffect, useMemo, useRef } from 'react';
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { setTextBox } from '../../shared/objects/text';
import type { ObjectSnapshot } from '../../shared/board-model';
import { layoutText, type Measurer } from './textLayout';

export function useTextBoxSync(
  doc: Y.Doc,
  id: string,
  measurer: Measurer,
  textObj: ObjectSnapshot | undefined,
): void {
  const rafRef = useRef(0);

  const content = textObj?.text ?? '';
  const size = textObj?.size ?? 'M';
  const widthMode = textObj?.widthMode ?? 'auto';

  // Compute the layout (only when content, size, or width mode changes).
  const layout = useMemo(() => {
    if (!textObj) return null;
    return layoutText(content, {
      measurer,
      size,
      widthMode,
      width: textObj.width ?? 0,
    });
    // In auto mode the `width` param is ignored by layoutText; in fixed mode
    // it determines the wrap. We include it in deps so fixed-mode reflows
    // pick up width changes from the gesture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, size, widthMode, textObj?.width, measurer]);

  // Sync the box in auto mode (debounced via rAF).
  useEffect(() => {
    if (!textObj || widthMode !== 'auto' || !layout) return;

    const newW = layout.width;
    const newH = layout.height;

    // No-op when the box already matches.
    if (textObj.width === newW && textObj.height === newH) return;

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      setTextBox(doc, LOCAL_ORIGIN, id, {
        x: textObj.x,
        y: textObj.y,
        width: newW,
        height: newH,
      });
    });

    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout?.width, layout?.height, widthMode, textObj?.x, textObj?.y, textObj?.width, textObj?.height, doc, id]);
}
