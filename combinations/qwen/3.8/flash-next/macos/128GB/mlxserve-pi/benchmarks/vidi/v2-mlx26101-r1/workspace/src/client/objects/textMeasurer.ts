// The measurer a text object lays out with (story 9).
//
// `createCanvasMeasurer()` builds the real one — a canvas `measureText` where the
// environment has a canvas, a character-count estimate where it does not. Which of the
// two you get is a property of the *environment*, so a test that wants exact numbers
// cannot ask for them: this context is the seam. A test wraps the board in
// `<MeasurerProvider value={fake}>` and every text object in it lays out with the fake;
// production renders no provider at all and every object builds its own canvas measurer.
//
// The measurer is pure (text + font size in, world units out), so one instance is shared
// by every object in the tree.

import { createContext, useContext, useMemo, type Context } from 'react';
import { createCanvasMeasurer, type Measurer } from './textLayout';

const MeasurerContext: Context<Measurer | null> = createContext<Measurer | null>(null);

/** Render the board (or a single object) with `measurer` instead of a real canvas. */
export const MeasurerProvider = MeasurerContext.Provider;

/** The injected measurer, or this client's own canvas-backed one. */
export function useTextMeasurer(): Measurer {
  const injected = useContext(MeasurerContext);
  // Built whether or not it is used: hooks cannot be conditional. It is lazy inside,
  // so an object that never measures never touches a canvas.
  const own = useMemo(() => createCanvasMeasurer(), []);
  return injected ?? own;
}
