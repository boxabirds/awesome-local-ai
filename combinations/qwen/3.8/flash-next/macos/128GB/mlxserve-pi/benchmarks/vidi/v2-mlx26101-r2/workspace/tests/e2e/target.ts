/**
 * Where the server under test answers.
 *
 * The address is computed here rather than in `playwright.config.ts` because the tests
 * need it too: a board is created with `POST /api/boards` before a page is pointed at one,
 * and that request is made from Node, where a relative address has no origin to be
 * relative to. One expression, one place, so a test cannot be pointed at a different
 * server from the one the suite started.
 *
 * All servers must listen inside `$AGENT_PORT_FIRST`..`$AGENT_PORT_LAST` (see NOTES.md).
 * +4 because 24210/24211 were left occupied by a `wrangler dev` this sandbox cannot signal
 * (see NOTES.md); 24212/24213 are free.
 */
const PORT_FROM_ENV = Number(process.env.E2E_PORT ?? (Number(process.env.AGENT_PORT_FIRST ?? 24208) + 4));

/** The port the suite's shared dev server serves from. */
export const PORT = PORT_FROM_ENV;
/** Its address, absolute, for requests made from the test process. */
export const BASE_URL = `http://127.0.0.1:${PORT}`;
