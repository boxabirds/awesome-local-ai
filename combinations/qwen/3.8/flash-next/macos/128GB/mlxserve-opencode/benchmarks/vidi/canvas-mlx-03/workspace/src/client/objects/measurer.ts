// The app-wide text measurer singleton (story 9).
//
// One canvas-backed `Measurer` (with an estimate fallback when no canvas exists) is
// shared by the box sync and the horizontal resize gesture, so both agree on how wide
// a piece of text is. It is created once at import; the canvas 2D context it holds is
// stateless apart from the font string set per call.

import { createCanvasMeasurer, type Measurer } from './textLayout.ts';

export const textMeasure: Measurer = createCanvasMeasurer();
