/**
 * The Share panel's wording (story 2's panel, pinned by story 4's prd.share_panel). Tests import
 * these, so a wording change breaks them deliberately.
 */
export const ACCESS_KEY_SENTENCE = 'This link is the key to this workspace — for you and anyone you send it to.';
export const ACCESS_EDIT_SENTENCE = "Anyone with it can see and change everything. Access can't be removed yet.";

/** The full access statement, as the PRD words it. */
export const ACCESS_STATEMENT = `${ACCESS_KEY_SENTENCE} ${ACCESS_EDIT_SENTENCE}`;

/** Shown only in the first-run 'Save your link' mode, between the two access sentences. */
export const SAVE_WARNING = "It's the only way back in: if you lose it, you lose access.";
