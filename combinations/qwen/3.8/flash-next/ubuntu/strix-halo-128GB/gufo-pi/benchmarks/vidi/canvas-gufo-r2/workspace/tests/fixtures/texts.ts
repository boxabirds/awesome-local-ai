/**
 * Realistic note text fixtures for tests.
 */

export const SHORT_PHRASE = 'Faster onboarding';

export const MULTILINE_RETRO = `Keep daily stand-ups short and focused.
Rotate the facilitator role weekly so everyone stays engaged.
Capture blockers immediately and follow up in small groups after.`;

// A 1000-character paragraph of realistic English prose.
const prose =
  'The quick brown fox jumps over the lazy dog while the sun sets behind the distant mountains. ' +
  'Collaborative whiteboards help teams organize their thinking during brainstorming sessions. ' +
  'Sticky notes are a familiar metaphor that anyone can pick up without any formal training today. ' +
  'Ideas flow more freely when the tools stay out of the way and respond instantly to every gesture. ' +
  'Colour coding lets groups separate themes, owners and priorities at a single glance across the wall. ' +
  'Retropectives work best when participants can rearrange items as new connections and insights emerge. ' +
  'A shared sense of progress keeps everyone motivated through the long middle of any difficult project. ' +
  'Design teams iterate quickly by clustering related feedback and removing items that no longer apply. ' +
  'Clear visual hierarchy guides the eye toward the most important questions that demand attention now. ' +
  'Working together in real time builds trust and reduces the misunderstandings that emails often create.';

// 987 chars; pad to exactly 1000 with a trailing sentence fragment.
export const LONG_PARAGRAPH_1000 = (prose + ' Together we build better software').slice(0, 1000);
