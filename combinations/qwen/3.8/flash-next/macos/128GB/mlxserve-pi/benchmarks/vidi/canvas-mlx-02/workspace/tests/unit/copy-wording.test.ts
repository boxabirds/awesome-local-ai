// The PRD quotes these sentences in its own text, so they are product behaviour and
// not wording the code may paraphrase: a reworded error is a silent change to what a
// visitor is told. Pinned here in the exact words, character for character.
import { describe, it, expect } from 'vitest';
import { createBoardMessage } from '../../src/client/useCreateBoard.ts';
import { copyFeedbackMessage } from '../../src/client/share/SharePanel.tsx';

describe('what the start page says when a press does not make a board', () => {
  it('TC-18: a press that was told to wait is told to wait, in the sentence the PRD gives', () => {
    expect(createBoardMessage({ kind: 'rate_limited' })).toBe(
      "You're creating boards too quickly. Wait a minute and try again.",
    );
  });

  it('TC-17: a service that refused is told as a board that could not be made', () => {
    expect(createBoardMessage({ kind: 'failed' })).toBe(
      "Couldn't create a board. Please try again.",
    );
  });

  it('TC-29: a service that never answered is told the same way, because what the visitor can do is the same', () => {
    expect(createBoardMessage({ kind: 'unreachable' })).toBe(
      "Couldn't create a board. Please try again.",
    );
  });

  it('a press that worked says nothing, because the board is the answer', () => {
    expect(createBoardMessage({ kind: 'created', boardId: 'x'.repeat(22) })).toBeNull();
  });

  it('being told to wait is not being told the board could not be made', () => {
    // Two failures that read the same are a visitor pressing again when pressing
    // again is the one thing that will not work.
    expect(createBoardMessage({ kind: 'rate_limited' })).not.toBe(
      createBoardMessage({ kind: 'failed' }),
    );
  });
});

describe('what the Share panel says about a copy', () => {
  it('nothing is claimed while a copy is happening or before one', () => {
    expect(copyFeedbackMessage('idle')).toBeNull();
    expect(copyFeedbackMessage('copying')).toBeNull();
  });

  it('a copy that went through is said by the button, so the panel does not say it twice', () => {
    expect(copyFeedbackMessage('copied')).toBeNull();
  });

  it('a clipboard that refused gives the instruction the PRD gives, and nothing else', () => {
    expect(copyFeedbackMessage('manual')).toBe('Press Ctrl+C (Cmd+C on Mac) to copy');
  });
});
