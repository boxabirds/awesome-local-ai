import { describe, expect, it } from 'vitest';
import {
  BOARD_CHECK_MAX_ATTEMPTS,
  BOARD_CHECK_RETRY_MAX_MS,
  boardPage,
  homeAfter,
  homeBusy,
  pageAfter,
  pageRetrying,
  pageWantsRetry,
  retryDelayFor,
  type BoardPage,
} from '../../src/client/pages/state';
import { BOARD_CHECK_RETRY_BASE_MS, LINK_COPIED_MS } from '../../src/shared/config';
import type { CheckOutcome } from '../../src/client/api';

/**
 * TC-30 (share.page_states): the two pages of story 5 as decisions on paper.
 *
 * Both pages spend their lives waiting for one answer from the service, and what they show - a
 * board, "not found", "can't get there", "something went wrong" - comes out of a state machine
 * rather than out of whatever the component happened to be holding. So the machine is written
 * somewhere it can be asked about directly: every transition the pages can take, including the
 * ones that only a train tunnel produces, and the shape of the waiting that goes with them.
 *
 * The one transition worth reading twice is the last: a check that cannot get through is *not*
 * a missing board, and a page that mixed those two up would tell a person their work is gone
 * because the signal was.
 */

/** The page, after a run of answers. */
function after(...outcomes: readonly CheckOutcome[]): BoardPage {
  return outcomes.reduce<BoardPage>((page, outcome) => pageAfter(page, outcome), boardPage());
}

describe('TC-30 the page a board link leads to', () => {
  it('starts by asking, and shows a board as soon as it is told there is one', () => {
    expect(boardPage()).toEqual({ state: 'checking', attempts: 0 });
    expect(pageAfter(boardPage(), 'found').state).toBe('ready');
  });

  it('settles into each of its four endings from each of its three waiting states', () => {
    const waiting: readonly BoardPage[] = [boardPage(), after('unreachable'), pageRetrying(after('failed'))];
    const expected: Record<CheckOutcome, string> = {
      found: 'ready',
      'not-found': 'absent',
      unreachable: 'unreachable',
      failed: 'error',
    };
    for (const page of waiting) {
      for (const outcome of Object.keys(expected) as CheckOutcome[]) {
        const state = pageAfter(page, outcome).state;
        // The one state that keeps counting, because it is the one that is not an answer.
        expect(state, `${page.state} + ${outcome}`).toBe(
          outcome === 'unreachable' && page.attempts + 1 >= BOARD_CHECK_MAX_ATTEMPTS
            ? 'error'
            : expected[outcome],
        );
      }
    }
  });

  it('stops asking once the service has answered, either way', () => {
    // "There is no board here" is a verdict; asking again would ask the same question of a
    // service that has already replied.
    expect(pageWantsRetry(after('not-found'))).toBe(false);
    expect(pageWantsRetry(after('failed'))).toBe(false);
    // A board that is there has nothing left to ask about either.
    expect(pageWantsRetry(after('found'))).toBe(false);
    // And the one state that does keep asking is the one that got no answer at all.
    expect(pageWantsRetry(after('unreachable'))).toBe(true);
  });

  it('waits longer each time it cannot get through, and never past half a minute', () => {
    const waits: number[] = [];
    let page = pageAfter(boardPage(), 'unreachable');
    while (pageWantsRetry(page)) {
      waits.push(retryDelayFor(page.attempts));
      page = pageAfter(page, 'unreachable');
    }
    expect(waits.slice(0, 3)).toEqual([
      BOARD_CHECK_RETRY_BASE_MS,
      BOARD_CHECK_RETRY_BASE_MS * 2,
      BOARD_CHECK_RETRY_BASE_MS * 4,
    ]);
    // Doubling is the point; so is stopping. Six tries, which is about half a minute of trying
    // before the page says so and offers a button.
    expect(waits).toHaveLength(BOARD_CHECK_MAX_ATTEMPTS - 1);
    for (const wait of waits) {
      expect(wait).toBeLessThanOrEqual(BOARD_CHECK_RETRY_MAX_MS);
    }
    // The cap is the reason the schedule can be left running: the next wait would be 32 s,
    // and it is held down to half a minute.
    expect(retryDelayFor(BOARD_CHECK_MAX_ATTEMPTS)).toBe(BOARD_CHECK_RETRY_MAX_MS);
    expect(retryDelayFor(20)).toBe(BOARD_CHECK_RETRY_MAX_MS);
    expect(page.state).toBe('error');
  });

  it('counts the tries it made before a late answer came, and starts from the beginning after one', () => {
    const tired = after('unreachable', 'unreachable', 'unreachable');
    expect(tired.attempts).toBe(3);
    // The answer that arrives after three failures is still the answer, and the board is shown.
    expect(pageAfter(tired, 'found')).toEqual({ state: 'ready', attempts: 0 });
    // A second visit to the same page starts its counting again: the person is not made to pay
    // for the last attempt's bad luck.
    expect(pageRetrying(tired)).toEqual({ state: 'checking', attempts: tired.attempts });
    expect(boardPage().attempts).toBe(0);
  });

  it('never turns a service it cannot reach into a board that is missing', () => {
    // The whole reason this file exists, written as one assertion.
    const unreachable = after('unreachable', 'unreachable');
    expect(unreachable.state).not.toBe('absent');
    expect(unreachable.state).toBe('unreachable');
    // And the state that says "not there" is only ever arrived at from an answer that says so.
    expect(after('not-found').state).toBe('absent');
  });
});

describe('TC-30 the home page', () => {
  it('takes one click at a time, and says so by sitting the second one out', () => {
    expect(homeAfter('idle', 'start')).toBe('creating');
    // A double-click is two clicks; this one line is what makes it one board.
    expect(homeAfter('creating', 'start')).toBe('creating');
    expect(homeBusy('creating')).toBe(true);
    expect(homeBusy('idle')).toBe(false);
    expect(homeBusy('failed')).toBe(false);
  });

  it('gives the button back when it did not work, and takes the page to the board when it did', () => {
    expect(homeAfter('creating', 'failed')).toBe('failed');
    // The failure is not the end of anything: the same button is the retry.
    expect(homeAfter('failed', 'start')).toBe('creating');
    expect(homeAfter('creating', 'created')).toBe('idle');
    // A page that is not waiting for anything does not become a page that failed.
    expect(homeAfter('idle', 'failed')).toBe('idle');
  });
});

describe('the lengths of time the story names', () => {
  it('keeps "Link copied" up long enough to be read, and no longer', () => {
    expect(LINK_COPIED_MS).toBe(2_000);
  });

  it('starts the waiting for a board check at a second', () => {
    expect(BOARD_CHECK_RETRY_BASE_MS).toBe(1_000);
    expect(retryDelayFor(1)).toBe(1_000);
  });
});
