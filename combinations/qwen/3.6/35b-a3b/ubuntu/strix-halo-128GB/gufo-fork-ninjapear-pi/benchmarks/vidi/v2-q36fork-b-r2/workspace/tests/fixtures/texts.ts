// Text fixtures for sticky note E2E tests.
// All text is realistic English prose, not repeated characters.

export const shortPhrase = 'Hello';

export const threeLineRetroItem = `TODO: Build a collaborative whiteboard app with infinite canvas support`;

// A 1,000-character English paragraph for overflow testing.
// The exact length is trimmed to STICKY_TEXT_MAX_CHARS (1,000) in tests.
function generateLongText(): string {
  const sentences = [
    'The quick brown fox jumps over the lazy dog near the old stone bridge.',
    'A team of ten engineers spent months building a collaborative whiteboard application.',
    'They designed it with real-time synchronization using Yjs for conflict-free editing.',
    'The interface uses an infinite canvas with pan and zoom navigation.',
    'Sticky notes are placed by double-clicking empty space on the board.',
    'Users can drag notes around, change their colors, and reorganise them freely.',
    'The system handles concurrent edits gracefully without any conflicts.',
    'TypeScript ensures type safety throughout the entire codebase and dependencies.',
    'Playwright end-to-end tests verify every critical user workflow in all browsers.',
    'The design keeps things simple while providing powerful collaboration features.',
    'Every commit message follows a structured format with story numbering.',
    'Unit tests cover the core logic before any implementation begins development.',
    'Component tests verify React rendering and interaction patterns precisely.',
    'E2E tests run against chromium firefox and webkit each time changes occur.',
    'This project demonstrates best practices for modern web application architecture.',
  ];
  let result = '';
  while (result.length < 1000) {
    for (const s of sentences) {
      if (result.length >= 1000) break;
      result += s + ' ';
    }
  }
  return result.trimEnd().slice(0, 1000);
}

export const longProseFixture = generateLongText();
