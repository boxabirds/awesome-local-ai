import { isValidBoardId } from '../shared/board-id';

/**
 * The two questions the client is allowed to ask the service about a board: "make one" and
 * "is this one there?".
 *
 * Everything else the client knows about a board it learns over a WebSocket, from the room
 * itself. These two are here because they are the only requests a page makes *about* a board
 * rather than *to* one, and because the answers are not simply JSON: an answer can also be "no
 * board there", "cannot get there" or "something else entirely", and those three are what the
 * pages are built out of. A page must never guess which of them it got, so the guessing happens
 * once, here, and comes back as one of four named answers.
 *
 * `liveApi` is what the app uses; `apiWith` is what a component test uses, so a test can hand a
 * page an answer - including one no server would ever send - without a server anywhere.
 */

/** What came back from "make me a board". */
export type CreateOutcome =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly reason: CreateFailure };

export type CreateFailure =
  /** The service answered, and said it could not make one. */
  | 'create_failed'
  /** The service could not be reached at all. */
  | 'unreachable';

/** What came back from "is this board there". */
export type CheckOutcome =
  /** The board exists. */
  | 'found'
  /** The service is certain there is no board by that name. */
  | 'not-found'
  /** Nothing was learned about the board: no answer at all, or the kind a service gives when it is unwell. */
  | 'unreachable'
  /** An answer that is none of the above: a body that is not an answer, or a status that is neither yes nor no. */
  | 'failed';

export interface BoardApi {
  createBoard(): Promise<CreateOutcome>;
  checkBoard(boardId: string): Promise<CheckOutcome>;
}

/** The address of the board API, relative to the page that asks. */
const BOARDS = '/api/boards';

/**
 * Ask for a board, and mean it exactly once per click.
 *
 * A request that fails is not retried here: the home page's button is the retry, and it is the
 * person holding it who decides. What this does guarantee is that the answer is one of the two
 * - a board's id, or a reason there is not one - because a page that was handed `undefined`
 * would have to decide what an id it never got points at.
 */
async function requestCreate(fetcher: typeof fetch): Promise<CreateOutcome> {
  let response: Response;
  try {
    response = await fetcher(BOARDS, { method: 'POST' });
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
  if (!response.ok) {
    return { ok: false, reason: 'create_failed' };
  }
  const id = await idIn(response);
  return id === null ? { ok: false, reason: 'create_failed' } : { ok: true, id };
}

/**
 * Ask whether a board is there.
 *
 * A code that cannot be a board's is answered without asking at all, which is what the Worker
 * does too and what keeps a page from connecting to a room nobody could be in.
 */
async function requestCheck(fetcher: typeof fetch, boardId: string): Promise<CheckOutcome> {
  if (!isValidBoardId(boardId)) {
    return 'not-found';
  }
  let response: Response;
  try {
    response = await fetcher(`${BOARDS}/${encodeURIComponent(boardId)}`);
  } catch {
    return 'unreachable';
  }
  if (response.status === 404) {
    return 'not-found';
  }
  // A service that answers 500 has not said the board is missing, and it has not said it is there
  // either - which is exactly the state a page is in when the request never arrived. So both go to
  // the same answer, and the page asks again. It is the difference between a cold server that takes
  // a few seconds to wake up and a person being told their board is gone, and the design (state
  // diagram, "Checking --> Unreachable: network error or 5xx") puts it the same way.
  if (response.status >= 500) {
    return 'unreachable';
  }
  if (!response.ok) {
    return 'failed';
  }
  // 200 means the board is there - the id in the body is the same one that was asked for, and
  // this is the one place that would notice if it were not.
  const id = await idIn(response);
  return id === boardId ? 'found' : 'failed';
}

/**
 * The id in a JSON body, or null when the body is not JSON or holds no id.
 *
 * A service that answers "yes" and does not say which board it means has not answered, so this
 * treats a body it cannot read exactly like a body that says something else.
 */
async function idIn(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    return typeof body === 'object' && body !== null && 'id' in body && typeof body.id === 'string'
      ? body.id
      : null;
  } catch {
    return null;
  }
}

/** The API the app uses: the service that served this page. */
export const liveApi: BoardApi = {
  createBoard: () => requestCreate((input, init) => fetch(input, init)),
  checkBoard: (boardId: string) => requestCheck((input, init) => fetch(input, init), boardId),
};

/**
 * The half an API you need, with the rest said for you.
 *
 * A test that only cares what a page does when a board is missing should not have to say what
 * making one does as well; it gets a `createBoard` that fails, and if it ever calls that, the
 * failure is loud rather than a hang.
 */
export function apiWith(stub: Partial<BoardApi>): BoardApi {
  return {
    createBoard: stub.createBoard ?? (async () => ({ ok: false, reason: 'create_failed' })),
    checkBoard: stub.checkBoard ?? (async () => 'failed'),
  };
}

/**
 * A `BoardApi` in front of a fake `fetch`, which is how a component test gives a page an exact
 * set of answers - including a body that is not JSON, or a status no route in this service
 * returns. The answers are handed out in order; once they run out, so does the test's patience,
 * which is the point of counting them.
 */
export function apiAnswering(answers: readonly (Response | Error)[]): {
  api: BoardApi;
  /** How many times the fake was asked, for either question. */
  asked(): number;
} {
  let asked = 0;
  const fetcher = (async (): Promise<Response> => {
    const answer = answers[asked];
    asked += 1;
    if (answer === undefined) {
      throw new Error(`the fake service was asked ${asked} times and only has ${answers.length}`);
    }
    if (answer instanceof Error) {
      throw answer;
    }
    return answer;
  }) as unknown as typeof fetch;
  return {
    api: { createBoard: () => requestCreate(fetcher), checkBoard: (id) => requestCheck(fetcher, id) },
    asked: () => asked,
  };
}
