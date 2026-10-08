/**
 * Automatic box re-measurement for one text object (story 9, text.wrap /
 * text.fixed_width).
 *
 * A text object's stored width/height is a cache of the measured layout:
 * whenever a LOCAL change alters what the layout depends on (text content,
 * size preset, fixed width / width mode), the box is re-measured and
 * written back with setTextBox — but only when the re-measured box
 * actually differs from the stored one (no redundant updates).
 *
 * Remote changes never trigger a write: a peer's layout is computed on
 * their client with their measurement and arrives as the box update itself.
 * The hook observes the object's Y.Map (size/width/widthMode) and Y.Text
 * for LOCAL_ORIGIN transactions, and also exposes
 * `remeasureAfterLocalChange()` for the editor to call explicitly after an
 * input commit (both paths are idempotent — the second call finds the box
 * already in sync and writes nothing).
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import {
  getTextContent,
  getTextSize,
  getTextWidthMode,
  setTextBox,
  textEntry,
} from '../../shared/objects/text';
import { layoutText, type Measurer } from './textLayout';

/** Entry-map keys whose local change alters the measured layout. */
const WATCHED_KEYS = new Set(['size', 'width', 'widthMode']);

export function useTextBoxSync(
  doc: Y.Doc,
  id: string,
  measure: Measurer,
): {
  /** Re-measure and sync the box after a local change (idempotent). */
  remeasureAfterLocalChange(): void;
} {
  // Latest measurer without re-subscribing observers.
  const measureRef = useRef(measure);
  measureRef.current = measure;

  const remeasure = useCallback((): void => {
    const content = getTextContent(doc, id);
    if (content === undefined) {
      return; // object gone (deleted) or not a text
    }
    const size = getTextSize(doc, id);
    const mode = getTextWidthMode(doc, id);
    const entry = textEntry(doc, id);
    const storedWidth =
      entry !== undefined && typeof entry.get('width') === 'number'
        ? (entry.get('width') as number)
        : null;
    const layout =
      mode === 'fixed'
        ? layoutText(content.toString(), size, 'fixed', storedWidth, measureRef.current)
        : layoutText(content.toString(), size, 'auto', null, measureRef.current);
    // setTextBox writes nothing when the box is unchanged.
    setTextBox(doc, id, { width: layout.width, height: layout.height });
  }, [doc, id]);

  // Observe local changes for this object's lifetime.
  useEffect(() => {
    const entry = textEntry(doc, id);
    const content = getTextContent(doc, id);
    if (entry === undefined || content === undefined) {
      return; // not a text object (or gone): nothing to sync
    }

    // Only local transactions matter: remote changes arrive as the box
    // update itself and must never be re-measured (or overwritten).
    // (Y.Map.observe passes a single YMapEvent with a keysChanged set.)
    const entryHandler = (event: Y.YMapEvent<unknown>, tr: Y.Transaction): void => {
      if (tr.origin === LOCAL_ORIGIN && event.keysChanged !== null && [...event.keysChanged].some((k) => WATCHED_KEYS.has(String(k)))) {
        remeasure();
      }
    };
    // Y.Text.observe passes (event, transaction) — the transaction is the
    // second argument (unlike Y.Map's (events, transaction), both are
    // needed only for the origin check here).
    const textHandler = (_event: Y.YTextEvent, tr: Y.Transaction): void => {
      if (tr.origin === LOCAL_ORIGIN) {
        remeasure();
      }
    };
    entry.observe(entryHandler);
    content.observe(textHandler);
    return () => {
      entry.unobserve(entryHandler);
      content.unobserve(textHandler);
    };
  }, [doc, id, remeasure]);

  return useMemo(
    () => ({ remeasureAfterLocalChange: remeasure }),
    [remeasure],
  );
}
