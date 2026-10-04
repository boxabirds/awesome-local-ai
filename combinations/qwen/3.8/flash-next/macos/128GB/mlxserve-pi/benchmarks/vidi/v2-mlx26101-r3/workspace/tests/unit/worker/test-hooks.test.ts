import { describe, expect, it } from 'vitest';
import { areEnabled, roomTestStepIn, testSwitchIn } from '../../../src/worker/test-hooks';

/**
 * The routing of the test switches, and the gate in front of it.
 *
 * These two functions are the whole of what stands between a board's stored snapshot and a request
 * that writes bytes over it, and the same code ships to production - which is why the gate is
 * tested as a fact about these functions rather than as a fact about how the test server happens
 * to be started. What they are asked for:
 *
 * - The switch is on for one value and off for everything else, including values that mean "on" to
 *   a human, because a variable that is easy to set by accident is a variable that will be.
 * - A path either names a board and a step that exist, or it is not a switch and falls through to
 *   the app.
 *
 * What the steps themselves do to storage is a different kind of thing to test, and is tested
 * against real storage in tests/integration/test-hooks.test.ts.
 */
const BOARD = 'Qk1n2sT4vX7yZ0aBcDeFgH';

describe('the test switches and their gate (TC-24)', () => {
  describe('areEnabled', () => {
    it('is on only when the environment says 1', () => {
      expect(areEnabled({ TEST_HOOKS: '1' })).toBe(true);
    });

    it('is off when the variable is missing, and when it says anything else (negative)', () => {
      // Every one of these is a way the variable could end up set on a server that was not meant
      // to have the switches: unset, set to something that is not 1, or set to a word that means
      // yes to a person reading the command line.
      for (const value of [undefined, '', '0', 'true', 'yes', 'on', ' 1', '1 ', '11', 1 as unknown as string]) {
        expect(areEnabled({ TEST_HOOKS: value })).toBe(false);
      }
      expect(areEnabled({})).toBe(false);
    });
  });

  describe('testSwitchIn', () => {
    it('names the board and the step of a switch path', () => {
      expect(testSwitchIn(`/__test/boards/${BOARD}/corrupt-snapshot`)).toEqual({
        boardId: BOARD,
        step: 'corrupt-snapshot',
      });
      for (const step of ['compact', 'corrupt-snapshot', 'repair-snapshot', 'read-again']) {
        expect(testSwitchIn(`/__test/boards/${BOARD}/${step}`)?.step).toBe(step);
      }
    });

    it('takes the board from the path the same way a connection does', () => {
      // The id is percent-decoded here exactly as it is for /api/rooms/..., so one id cannot mean
      // one board over a websocket and a different board under a switch.
      expect(testSwitchIn(`/__test/boards/${encodeURIComponent(BOARD)}/compact`)?.boardId).toBe(
        BOARD,
      );
      expect(testSwitchIn('/__test/boards/%E0%A4%A/compact')).toBeNull();
    });

    it('is not a switch for any other path (negative)', () => {
      const notSwitches = [
        '/',
        '/board',
        `/api/rooms/${BOARD}`,
        // A step that does not exist is not a switch with an unknown step; it is nothing, and the
        // request goes on to the app rather than to a room.
        `/__test/boards/${BOARD}/delete-everything`,
        `/__test/boards/${BOARD}`,
        `/__test/boards//compact`,
        `/__test/boards/${BOARD}/compact/extra`,
        `/__test/${BOARD}/compact`,
        `/api/test/boards/${BOARD}/compact`,
      ];
      for (const pathname of notSwitches) {
        expect(testSwitchIn(pathname)).toBeNull();
      }
    });
  });

  describe('roomTestStepIn', () => {
    it('recognises the door a room is asked through, and nothing else', () => {
      expect(roomTestStepIn('/internal/test/read-again')).toBe('read-again');
      expect(roomTestStepIn('/internal/test/delete-everything')).toBeNull();
      // The door a board's clients come through is not this door.
      expect(roomTestStepIn(`/api/rooms/${BOARD}`)).toBeNull();
      expect(roomTestStepIn('/')).toBeNull();
    });
  });
});
