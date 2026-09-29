export const SHORT_TEXT = 'Faster onboarding';

export const MULTI_LINE_TEXT = 'What went well:\n- Team shipped on time\n- Good communication\n- Tests covered the edge cases';

// 1000 character English paragraph
export const LONG_TEXT_1000 = (() => {
  const base = 'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. How vexingly quick daft zebras jump! The five boxing wizards jump quickly. Jackdaws love my big sphinx of quartz. The jay, pik, and dex quiz; the whifflums study big art. A mad boxer shot a quick, jumping few: "Gloves," said the wizard, "box a quiet thief." In the realm of software engineering, the art of crafting elegant solutions requires both creativity and discipline. Developers must balance the immediate needs of their teams with the long-term health of the codebase. Every decision carries consequences that ripple through the system, affecting performance, maintainability, and the experience of those who will inherit the code. The best engineers understand that software is not merely a collection of functions and classes, but a living document that communicates intent and constraints to its readers. They write code that speaks clearly, that reveals its purpose at every level of abstraction, and that resists the pull of premature optimization. They know that the best code is not the cleverest code, but the code that the next person will understand without having to ask. This is the quiet art of software engineering: making the complex seem simple, the intricate seem obvious, and the impossible seem inevitable.';
  if (base.length >= 1000) return base.slice(0, 1000);
  let result = base;
  while (result.length < 1000) {
    result += ' More prose to reach the target length for testing purposes. ';
  }
  return result.slice(0, 1000);
})();
