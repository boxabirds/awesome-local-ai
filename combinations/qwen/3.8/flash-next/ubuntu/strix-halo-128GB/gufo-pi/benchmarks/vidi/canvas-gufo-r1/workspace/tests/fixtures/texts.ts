/** Short phrase fixture */
export const SHORT_PHRASE = 'Faster onboarding';

/** Three-line retro item (~120 chars) */
export const RETRO_ITEM =
  'What went well:\n- Shipped the new onboarding flow\n- Team velocity improved after sprint 3 retro';

/**
 * A 1,000 character paragraph of English prose for testing text overflow.
 * Not repeated single characters — realistic words for proper layout.
 */
export const PROSE_1000: string = (() => {
  const sentences = [
    'The quick brown fox jumps over the lazy dog near the riverbank. ',
    'Many years ago, in a land far away, there lived a curious inventor. ',
    'She spent her days building machines that could sort seeds by color. ',
    'The village people admired her dedication and shared their harvest. ',
    'Every morning, birds sang from the tall oak trees surrounding her workshop. ',
    'Rain would fall gently on the tin roof, creating a soothing melody. ',
    'She believed that small improvements compound into remarkable change. ',
    'Her notebooks were filled with diagrams and equations in blue ink. ',
    'Visitors came from distant towns to see her remarkable creations work. ',
    'Together they celebrated each breakthrough with warm bread and cheese. ',
    'The seasons turned and the garden outside grew wild with tomato vines. ',
    'A young apprentice arrived seeking knowledge and a place to belong. ',
    'The inventor smiled, handed her a wrench, and pointed to the workbench. ',
    'They built wonders that no single person could have imagined alone. ',
    'And so the story continues wherever curiosity leads and hands create. ',
  ];
  let text = '';
  let i = 0;
  while (text.length < 1000) {
    text += sentences[i % sentences.length];
    i++;
  }
  return text.slice(0, 1000);
})();
