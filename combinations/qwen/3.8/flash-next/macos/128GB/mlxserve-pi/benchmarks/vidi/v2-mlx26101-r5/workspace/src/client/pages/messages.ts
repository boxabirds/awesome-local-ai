/**
 * Every word the pages say, in one file.
 *
 * These strings are the product's, not the components': the PRD quotes them, a test asserts
 * them character by character, and a person who is told "Couldn't create a board" and sees
 * "Could not create board" on screen has been told two things. Keeping them here means there is
 * one place to check them against, and no component has to be opened to find out what a page
 * says.
 */

/** What vidi6 is, in the one sentence the home page gets. */
export const TAGLINE = 'A shared board for thinking together';

/** The button that makes a board. */
export const NEW_BOARD_LABEL = 'New board';

/** The same button while the board is on its way. */
export const CREATING_LABEL = 'Creating…';

/** `share.create_failure`: creation failed, in words, under the button that failed. */
export const CREATE_FAILED_MESSAGE = "Couldn't create a board. Please try again.";

/** The board page's waiting message, while the link is being checked. */
export const OPENING_BOARD_MESSAGE = 'Opening board…';

/** `share.unreachable`: the service is not answering, and the page is going to keep trying. */
export const UNREACHABLE_MESSAGE = "Couldn't reach vidi6. Retrying…";

/** `share.not_found`: the heading of the page a link that leads nowhere opens. */
export const NOT_FOUND_HEADING = 'Board not found';

/** …and what to do about it. */
export const NOT_FOUND_DETAIL = 'Check the link, or ask the person who shared it to send it again.';

/** The way back to the page that explains what vidi6 is. */
export const HOME_LINK_LABEL = 'Back to the vidi6 home page';

/** Names the link that was asked for, in front of the link itself. */
export const NOT_FOUND_ASKED = 'There is no board called';
