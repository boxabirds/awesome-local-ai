// Local-only text box sync (story 9, text.layout). After a local change to a
// text object's content, size or width, re-measure the layout and persist the
// box — and only then. Remote changes never trigger a local box write
// (text.layout: "Local changes → ... re-measure and write width/height;
// Remote changes → never").
//
// Tracked local changes: the Y.Text content, and the object's size /
// width / widthMode fields (a handle drag re-wraps the text and grows the
// height). Every tracked local change funnels through
// remeasureAfterLocalChange, which writes only when the box actually changed,
// so redundant writes are impossible.

import { useCallback, useEffect, useRef } from 'react';
import * as Y from 'yjs';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_MIN_WIDTH_WORLD,
  type TextSize,
} from '../../shared/config';
import { getObject, LOCAL_ORIGIN } from '../../shared/board-model';
import { isTextSize, setTextBox } from '../../shared/objects/text';
import { layoutText, type Measurer } from './textLayout';

export interface TextBoxSyncApi {
  /**
   * Re-measure the text and persist the box if it changed. Called by the
   * editor after local input; also called automatically by this hook for
   * local size/width/widthMode changes (handle drags, size presets).
   */
  remeasureAfterLocalChange(): void;
}

export function useTextBoxSync(doc: Y.Doc, id: string, measure: Measurer): TextBoxSyncApi {
  const measureRef = useRef(measure);
  measureRef.current = measure;

  const remeasureAfterLocalChange = useCallback((): void => {
    const obj = getObject(doc, id);
    if (obj === undefined || obj.get('type') !== 'text') return;
    const ytext = obj.get('text');
    if (!(ytext instanceof Y.Text)) return;

    const sizeRaw = obj.get('size');
    const size: TextSize = isTextSize(sizeRaw) ? sizeRaw : DEFAULT_TEXT_SIZE;
    const mode = obj.get('widthMode');
    const fixed = mode === 'fixed';
    const widthRaw = obj.get('width');
    const fixedWidth =
      typeof widthRaw === 'number' && Number.isFinite(widthRaw)
        ? widthRaw
        : TEXT_MIN_WIDTH_WORLD;

    const layout = layoutText(
      ytext.toString(),
      size,
      fixed ? 'fixed' : 'auto',
      fixed ? fixedWidth : null,
      measureRef.current,
    );
    setTextBox(doc, id, layout);
  }, [doc, id]);

  const remeasureRef = useRef(remeasureAfterLocalChange);
  remeasureRef.current = remeasureAfterLocalChange;

  // Observe the object (size/width/widthMode) and its Y.Text (content);
  // react only to local-origin transactions. Position (x/y) changes never
  // re-wrap the text, so they are ignored — a move must not write the box.
  useEffect(() => {
    const obj = getObject(doc, id);
    if (obj === undefined || obj.get('type') !== 'text') return;
    const ytext = obj.get('text') instanceof Y.Text ? (obj.get('text') as Y.Text) : null;

    const onObjLocal = (event: Y.YMapEvent<unknown>, txn: Y.Transaction): void => {
      if (txn.origin !== LOCAL_ORIGIN) return;
      // The set of changed top-level keys (yjs 13: keysChanged).
      const keys = event.keysChanged;
      if (keys.has('size') || keys.has('width') || keys.has('widthMode')) {
        remeasureRef.current();
      }
    };
    const onTextLocal = (_event: unknown, txn: Y.Transaction): void => {
      if (txn.origin === LOCAL_ORIGIN) remeasureRef.current();
    };

    obj.observe(onObjLocal);
    ytext?.observe(onTextLocal);
    return () => {
      obj.unobserve(onObjLocal);
      ytext?.unobserve(onTextLocal);
    };
  }, [doc, id]);

  return { remeasureAfterLocalChange };
}
