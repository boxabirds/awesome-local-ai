/**
 * The one place that turns "the words changed" into "the box changed".
 *
 * Key decision 1 of the design is that a text object's box is written by the client that changed its text,
 * and by nobody else. That rule is easy to state and easy to lose: the obvious implementation is an observer
 * on the text, and an observer fires for everybody's changes, so five people looking at one board would each
 * measure every keystroke and each write a box in a font that suits their own machine. The last message would
 * win, and the frame around a heading would be a race.
 *
 * So this is not an observer. It is a function a component calls *after it has changed the text itself* —
 * from the text editor, and from nowhere else — which is the difference between "one write per keystroke" and
 * "one write per keystroke per client". The remote case is not handled here, because in the remote case there
 * is nothing to do: the box that arrived in the document is the answer somebody else already measured, and
 * drawing that answer is `TextObject`'s business, not this hook's.
 *
 * What it does hold on to is the measurement it wrote: which text it was a measurement of, at which size and
 * width mode. That is what makes a late-arriving font fixable — the box can be corrected when the font it was
 * measured without finally turns up, because the hook can tell that the text has not changed underneath the
 * measurement, which is the only condition under which correcting it is not arguing with somebody else.
 */
import { useCallback, useEffect, useRef } from 'react';
import type * as Y from 'yjs';

import { readText } from '../../shared/objects/text';
import type { TextWidthMode } from '../../shared/objects/text';
import type { TextSize } from '../../shared/config';
import { getMeasurer, remeasureTextBox } from './textLayout';

/** Ask the board to measure this text object again and store the box it comes up with. */
export type MeasureTextBox = () => void;

/** What a measurement was taken of — the thing a corrected measurement has to still match. */
interface Measured {
  text: string;
  size: TextSize;
  widthMode: TextWidthMode;
}

const measurementOf = (text: string, size: TextSize, widthMode: TextWidthMode): Measured => ({ text, size, widthMode });

/** The same measurement, from a text object that may since have been changed or deleted. */
function sameMeasurement(measured: Measured, text: string, size: TextSize, widthMode: TextWidthMode): boolean {
  return measured.text === text && measured.size === size && measured.widthMode === widthMode;
}

/**
 * The promise a font loads against, or null where there is no font loader to wait for.
 *
 * A board that draws text in a webfont measures it first in whatever fallback font the browser had ready,
 * and the numbers it got are then wrong by a few percent — enough for the selection frame to be slightly too
 * small around a heading, which is the sort of defect nobody can name and everybody sees. When the font
 * arrives, the measurement that was taken without it is worth taking again.
 */
function fontsReady(): Promise<unknown> | null {
  const fonts = typeof document !== 'undefined' ? (document as Document).fonts : null;
  if (!fonts || typeof fonts.ready?.then !== 'function') return null;
  return fonts.ready;
}

/**
 * Measure this text object's box after this client changed its text.
 *
 * Call it from the edit path, not from an observer, and call it after the write that changed the text: the
 * measurement is synchronous, so the element is styled from the box that matches what is on the screen by the
 * time the browser paints. Deferring it to the next frame would draw the words at yesterday's width for one
 * frame, which is a caret jumping about once a keystroke.
 */
export function useTextBoxSync(doc: Y.Doc, id: string): MeasureTextBox {
  // What the last measurement was taken of, and whether it is ours to correct.
  const measured = useRef<Measured | null>(null);

  const measure = useCallback<MeasureTextBox>(() => {
    const read = readText(doc, id);
    if (read === null) return;

    const laid = remeasureTextBox(doc, id, getMeasurer());
    if (laid !== null) measured.current = measurementOf(read.text, read.size, read.widthMode);
  }, [doc, id]);

  useEffect(() => {
    const ready = fontsReady();
    if (ready === null) return;

    let cancelled = false;
    ready.then(() => {
      // Only a measurement this component wrote, of text that has not changed since, is corrected: anything
      // else belongs to a different client's answer, and a second answer is the churn this hook exists to
      // avoid.
      const ours = measured.current;
      if (cancelled || ours === null) return;

      const read = readText(doc, id);
      if (read === null) return;
      if (!sameMeasurement(ours, read.text, read.size, read.widthMode)) return;

      // The measurer is asked for again rather than reused: the cached canvas measurer measures in the font
      // that is loaded now, which is the entire point.
      remeasureTextBox(doc, id, getMeasurer());
    });

    return () => {
      cancelled = true;
    };
  }, [doc, id]);

  return measure;
}
