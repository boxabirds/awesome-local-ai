import { describe, expect, it } from 'vitest';
import { apiAnswering, type CreateOutcome } from '../../src/client/api';
import { newBoardId } from '../../src/shared/board-id';

/**
 * TC-16, TC-18, TC-19, TC-20 (`share.ask_the_service`): what the client hears when it asks.
 *
 * The client is allowed to ask the service two things about a board, and the answers are not
 * simply a JSON body: an answer can also be "no board there", "cannot get there" or "something
 * else entirely". What is tested here is that translation - a status, or no status at all, becoming
 * one of a small number of named answers - because every page of story 5 is built out of those
 * answers and a page that guessed would say something untrue.
 *
 * No server is involved. Each case hands the client an answer, including several no route in this
 * service would ever give it, and says which answer the client must pass on.
 */

/** An answer from a service that replied. */
function answered(status: number, body: unknown, asText = false): Response {
  return new Response(asText ? String(body) : JSON.stringify(body), {
    status,
    headers: { 'content-type': asText ? 'text/plain' : 'application/json' },
  });
}

/** Ask the "make one" question of a service that answers `answers`. */
async function askForBoard(...answers: readonly (Response | Error)[]): Promise<CreateOutcome> {
  const { api } = apiAnswering(answers);
  return api.createBoard();
}

describe('TC-16 asking the service for a board', () => {
  it('hands on the id of a board that was made', async () => {
    const id = newBoardId();
    expect(await askForBoard(answered(201, { id }))).toEqual({ ok: true, id });
  });

  it('says so when the service could not make one, and gives no id', async () => {
    expect(await askForBoard(answered(500, { error: 'create_failed' }))).toEqual({
      ok: false,
      reason: 'create_failed',
    });
    // A service that says "made it" without saying which board has not made one, as far as this
    // client is concerned: there is nothing to open, and an id invented here would be a lie.
    expect(await askForBoard(answered(201, {}))).toEqual({ ok: false, reason: 'create_failed' });
    expect(await askForBoard(answered(201, 'the board is ready, trust me', true))).toEqual({
      ok: false,
      reason: 'create_failed',
    });
  });

  it('says it could not get there when it could not get there', async () => {
    // The two shapes a network failure arrives in: a request that rejects, and nothing listening.
    expect(await askForBoard(new TypeError('Failed to fetch'))).toEqual({
      ok: false,
      reason: 'unreachable',
    });
    expect(await askForBoard(answered(502, 'bad gateway', true))).toEqual({
      ok: false,
      reason: 'create_failed',
    });
  });

  it('asks once, and does not go asking again by itself', async () => {
    const service = apiAnswering([answered(500, { error: 'create_failed' })]);
    expect(await service.api.createBoard()).toEqual({ ok: false, reason: 'create_failed' });
    // The retry is the person pressing the button again, not the client second-guessing an
    // answer it already got.
    expect(service.asked()).toBe(1);
  });
});

describe('TC-18, TC-19, TC-20 asking whether a board is there', () => {
  it('takes a yes for a board and a 404 for no board', async () => {
    const id = newBoardId();
    const found = apiAnswering([answered(200, { id })]);
    expect(await found.api.checkBoard(id)).toBe('found');

    const missing = apiAnswering([answered(404, { error: 'not_found' })]);
    expect(await missing.api.checkBoard(id)).toBe('not-found');
  });

  it('takes an answer it cannot get for "I do not know", which is not "it is not there"', async () => {
    const id = newBoardId();
    expect(await apiAnswering([new TypeError('no signal')]).api.checkBoard(id)).toBe('unreachable');
    // A service that is having a bad day is not a board that has gone missing, and it is not a
    // verdict either: it is a service that has not answered, so the page asks it again. The design
    // puts a 5xx on the same arrow as a request that never arrived, for exactly that reason.
    expect(await apiAnswering([answered(500, { error: 'boom' })]).api.checkBoard(id)).toBe(
      'unreachable',
    );
    expect(await apiAnswering([answered(503, { error: 'boom' })]).api.checkBoard(id)).toBe(
      'unreachable',
    );
    expect(await apiAnswering([answered(200, 'yes', true)]).api.checkBoard(id)).toBe('failed');
  });

  it('takes a status that is neither yes nor no for an answer it cannot use', async () => {
    const id = newBoardId();
    // Not a retry: whatever this is, the service is answering in a language the page does not
    // speak, and asking it again in a second is not going to teach it. The page says so, and
    // leaves the asking to the person.
    expect(await apiAnswering([answered(418, { error: 'teapot' })]).api.checkBoard(id)).toBe(
      'failed',
    );
  });

  it('does not believe a yes that is not about the board it asked for', async () => {
    const asked = newBoardId();
    const somebodyElse = newBoardId();
    // The body says a board exists, and names a different one: this is not an answer to this
    // question, and a page that took it for one would open a board the link never pointed at.
    expect(await apiAnswering([answered(200, { id: somebodyElse })]).api.checkBoard(asked)).toBe(
      'failed',
    );
  });

  it('answers an address that cannot name a board without asking anybody', async () => {
    for (const notABoard of ['abc', '', 'a'.repeat(21), 'a'.repeat(23), 'has space']) {
      const service = apiAnswering([]);
      expect(await service.api.checkBoard(notABoard)).toBe('not-found');
      // Not one request: a code the generator would never produce is not a board that might be
      // hidden, and asking about it tells a room somebody else's business.
      expect(service.asked(), notABoard).toBe(0);
    }
  });
});
