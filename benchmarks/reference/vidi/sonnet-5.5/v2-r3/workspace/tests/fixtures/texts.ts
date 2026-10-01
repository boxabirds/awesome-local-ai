export const SHORT_TEXT = 'Faster onboarding';

export const RETRO_TEXT = 'Deploys are too slow\nReviews wait for days\nPair more on risky changes';

const PARAGRAPH =
  'A whiteboard session works best when everyone can add ideas without waiting for a turn. People jot down a thought, ' +
  'move it next to a related one, and the structure emerges from the grouping rather than from a prepared agenda. ' +
  'Later the team colours the notes by theme, discusses the clusters, and decides which of them deserve follow-up work. ';

/** Exactly 1,000 characters of English prose. */
export const LONG_TEXT = PARAGRAPH.repeat(4).slice(0, 1000);

/** 1,200 characters of English prose (for paste-limit tests). */
export const OVER_LIMIT_TEXT = PARAGRAPH.repeat(6).slice(0, 1200);
