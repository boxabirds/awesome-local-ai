// Text of the Share panel (prd.share_panel). Tests import these, so a wording change breaks them deliberately.

/** First sentence of the access statement: the link is the key. */
export const SHARE_KEY_TEXT = 'This link is the key to this workspace — for you and anyone you send it to.';
/** Shown only in 'Save your link' mode, between the two access sentences. */
export const SAVE_ONLY_WAY_BACK_TEXT = "It's the only way back in: if you lose it, you lose access.";
/** Second part of the access statement: full edit access that cannot be revoked. */
export const SHARE_ACCESS_TEXT = "Anyone with it can see and change everything. Access can't be removed yet.";
/** The full access statement shown when the panel is opened with Share. */
export const SHARE_STATEMENT = `${SHARE_KEY_TEXT} ${SHARE_ACCESS_TEXT}`;
