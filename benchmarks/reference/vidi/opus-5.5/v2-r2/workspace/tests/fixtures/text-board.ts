// Story 9 fixture: a retro board with two clusters of notes, headings for them,
// a 300-character annotation and a 5,001-character pasted paragraph.
import { prose } from './texts';

/** Note top-left positions (world units), two clusters of three. */
export const RETRO_NOTES = [
  { x: 200, y: 300, text: 'Pairing on the release checklist', color: 'green' },
  { x: 420, y: 300, text: 'Zero incidents this sprint', color: 'green' },
  { x: 640, y: 300, text: 'Onboarding guide saved two days', color: 'green' },
  { x: 200, y: 620, text: 'Flaky end-to-end tests', color: 'pink' },
  { x: 420, y: 620, text: 'Standups run long', color: 'pink' },
  { x: 640, y: 620, text: 'Billing docs out of date', color: 'pink' },
] as const;

export const HEADINGS = ['Went well', 'To improve'] as const;

/** A 300-character English annotation (longer than one 600-unit line at size M). */
export const ANNOTATION_300 = prose(300);

/** A 5,001-character paragraph (one over the text limit). */
export const PARAGRAPH_5001 = prose(5001);
