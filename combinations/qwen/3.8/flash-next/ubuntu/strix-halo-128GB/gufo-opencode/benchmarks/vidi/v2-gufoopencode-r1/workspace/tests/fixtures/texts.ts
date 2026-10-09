// Realistic English text fixtures for the sticky note tests. Not repeated
// single characters — the auto-fit and diff logic must be exercised with text
// that behaves like real board content.

export const SHORT_PHRASE = 'Ship the retro board';

// A three-line retro item with explicit line breaks.
export const THREE_LINE_ITEM = 'What went well:\nDeploys were boring.\nThe board finally felt shared.';

function buildParagraph1000(): string {
  const sentence =
    'We sketched the retro on a shared board, moved the sticky notes into themes, and the whole team could finally see the same picture at once. ';
  let text = '';
  while (text.length < 1000) {
    text += sentence;
  }
  return text.slice(0, 1000);
}

export const PARAGRAPH_1000 = buildParagraph1000();
