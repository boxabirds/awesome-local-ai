import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HomePage } from '../../src/client/pages/HomePage';
import { BoardPage } from '../../src/client/pages/BoardPage';
import { Root } from '../../src/client/Root';
import { HOME_PATH, boardPath } from '../../src/client/router';
import { apiWith, type BoardApi, type CheckOutcome, type CreateOutcome } from '../../src/client/api';
import { newBoardId } from '../../src/shared/board-id';
import { LINK_COPIED_MS } from '../../src/shared/config';
import { forgetProviders, providersMade } from './helpers/fake-provider';

/**
 * Story 5: the pages, and the answers they are made of.
 *
 * Nothing here reaches a network. Each page is handed a service that has been told exactly what to
 * answer - a board, no board, no answer, an answer that arrived late - and what is asserted is what
 * the page says and does in return, including the things it must not do: connect to a room nobody
 * asked for, ask twice because a button was pressed twice, or tell a person a board is gone because
 * a request was late.
 *
 * The board's own connection is stubbed (`y-websocket` is replaced by the fake provider, as in
 * every other component test here) so a page that mounts a real board can be mounted at all. What
 * is under test is *which* room a page opens, and how often - not whether jsdom can hold a socket.
 */

vi.mock('y-websocket', async () => {
  const helper = await import('./helpers/fake-provider');
  return helper.yWebsocketStub();
});

/** Set the address bar before a page is mounted, the way arriving at a link does. */
function goTo(pathname: string): void {
  window.history.pushState(null, '', pathname);
}

beforeEach(() => {
  goTo(HOME_PATH);
  forgetProviders();
});

/**
 * A service that answers the question "is this board there" out of a list, repeating the last
 * answer once the list runs out, and taking new answers on the end of it - because the interesting
 * moments for these pages are "still nothing", "still nothing", and then, suddenly, an answer.
 */
function checks(outcomes: CheckOutcome[]): {
  api: BoardApi;
  asked(): number;
  /** What the service says from now on. */
  nowSays(outcome: CheckOutcome): void;
} {
  const queue = [...outcomes];
  let asked = 0;
  return {
    api: apiWith({
      checkBoard: async () => {
        asked += 1;
        return queue.length > 1 ? (queue.shift() as CheckOutcome) : (queue[0] as CheckOutcome);
      },
    }),
    asked: () => asked,
    nowSays: (outcome: CheckOutcome) => {
      queue.length = 0;
      queue.push(outcome);
    },
  };
}

/** The same, for a service that cannot answer at all until it is told to. */
function checksThatAreLate(): {
  api: BoardApi;
  asked(): number;
  /** The answer the request that is in the air comes back with. */
  arrive(outcome: CheckOutcome): Promise<void>;
} {
  let pending: ((outcome: CheckOutcome) => void) | null = null;
  let asked = 0;
  return {
    api: apiWith({
      checkBoard: () => {
        asked += 1;
        return new Promise<CheckOutcome>((resolve) => {
          pending = resolve;
        });
      },
    }),
    asked: () => asked,
    arrive: async (outcome: CheckOutcome) => {
      const resolve = pending;
      pending = null;
      await act(async () => {
        resolve?.(outcome);
        await Promise.resolve();
        await Promise.resolve();
      });
    },
  };
}

/** A service that makes boards, and counts how many it was asked for. */
function creates(outcome?: CreateOutcome): { api: BoardApi; asked(): number; ids(): string[] } {
  const ids: string[] = [];
  let asked = 0;
  return {
    api: apiWith({
      createBoard: async () => {
        asked += 1;
        if (outcome !== undefined) {
          return outcome;
        }
        const id = newBoardId();
        ids.push(id);
        return { ok: true, id };
      },
    }),
    asked: () => asked,
    ids: () => ids,
  };
}

/** A service that does not answer the request for a board until the test says to. */
function createsThatAreSlow(): { api: BoardApi; /** The answer arrives now: there is no board. */ fail(): Promise<void> } {
  let answer: ((outcome: CreateOutcome) => void) | null = null;
  const api = apiWith({
    createBoard: () =>
      new Promise<CreateOutcome>((resolve) => {
        answer = resolve;
      }),
  });
  return {
    api,
    fail: async () => {
      const respond = answer;
      answer = null;
      await act(async () => {
        respond?.({ ok: false, reason: 'create_failed' });
        await Promise.resolve();
        await Promise.resolve();
      });
    },
  };
}

/** Let queued promises run, and let React render what they decided. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 4; i += 1) {
      await Promise.resolve();
    }
  });
}

/** Move the fake clock on, and let whatever it releases be rendered. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/**
 * Take the clock for a test.
 *
 * The file's setup puts the animation frame under test control and deliberately leaves wall-clock
 * time real, because a component test that waited a minute for a reconnect would be a bad test.
 * A page that has to be watched over a backoff schedule is the exception, and taking the whole
 * clock means saying so to the setup first - asking for it on top of what is already installed
 * leaves the two clocks disagreeing, and the retry timer lands on whichever one nobody is
 * turning.
 */
function takeTheClock(): void {
  vi.useRealTimers();
  vi.useFakeTimers();
}

/** The rooms the page opened, by name - which is the question "did it connect to a board". */
function roomsOpened(): string[] {
  return providersMade().map((provider) => provider.roomName);
}

/**
 * A clipboard, in the browser's shape: it takes the link, or it does not.
 *
 * jsdom has no clipboard at all, so a test that wants the copy attempted has to say what kind of
 * browser this is - one with a clipboard, one whose clipboard refuses, one with none - which is
 * what the panel is checked on. What is kept is whether the link was handed over, and nothing of
 * what the operating system then did with it.
 */
function clipboard(writeText: (link: string) => Promise<void>): {
  writeText: ReturnType<typeof vi.fn>;
} {
  const spy = vi.fn(writeText);
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: spy },
  });
  return { writeText: spy };
}

/** A browser whose clipboard says no to every write, which is what a refused permission is. */
function clipboardThatRefuses(): void {
  clipboard(async () => {
    throw new Error('the document is not focused');
  });
}

describe('TC-16, TC-21 the home page asks for a board', () => {
  it('makes one board, however many times the button is pressed', async () => {
    const service = creates();
    render(<HomePage api={service.api} />);
    const button = screen.getByRole('button', { name: 'New board' });

    await act(async () => {
      button.click();
      button.click();
      button.click();
      await settle();
    });

    // One board, not three. The request goes out once per click that meant it, and the button
    // sits the wait out - which is the whole of "double-clicking New board makes one board".
    expect(service.asked()).toBe(1);
    expect(service.ids()).toHaveLength(1);
    // And the address went with the board: this tab is now at the board it made, which is the
    // address it can paste to somebody else.
    expect(window.location.pathname).toBe(boardPath(service.ids()[0] as string));
    // No room was opened for a board that was only being asked for.
    expect(roomsOpened()).toEqual([]);
  });

  it('sits the wait out, and gives the button back when there is no board to be had', async () => {
    const slow = createsThatAreSlow();
    render(<HomePage api={slow.api} />);
    const button = screen.getByRole('button', { name: 'New board' });

    await act(async () => {
      button.click();
      await Promise.resolve();
    });
    // Not the kind of control that can be asked twice while it is thinking.
    expect(button).toBeDisabled();

    await slow.fail();
    expect(screen.getByTestId('create-failure')).toHaveTextContent(
      "Couldn't create a board. Please try again.",
    );
    // The failure is not the end of the conversation: the same button is the retry, and pressing
    // it is the person's decision, not the page's.
    expect(screen.getByRole('button', { name: 'New board' })).toBeEnabled();
    expect(window.location.pathname).toBe(HOME_PATH);
  });

  it('does not show a board it was not given', async () => {
    const service = creates({ ok: false, reason: 'unreachable' });
    render(<HomePage api={service.api} />);
    await act(async () => {
      screen.getByRole('button', { name: 'New board' }).click();
      await settle();
    });
    expect(screen.getByTestId('create-failure')).toHaveTextContent(
      "Couldn't create a board. Please try again.",
    );
    expect(window.location.pathname).toBe(HOME_PATH);
    expect(screen.queryByTestId('board-viewport')).toBeNull();
    expect(roomsOpened()).toEqual([]);
  });
});

describe('TC-17, TC-18, TC-19 the page a board link leads to', () => {
  it('shows the board, and the way to share it, as soon as it is told the board is there', async () => {
    const id = newBoardId();
    const service = checks(['found']);
    render(<BoardPage boardId={id} api={service.api} />);
    await settle();

    // The share button is there as soon as the board is, whatever the board's own connection is
    // doing at the time: a board still being loaded is a board worth sending a link to.
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
    expect(screen.getByTestId('board-viewport')).toBeInTheDocument();
    // And the room it opened is this board's, named by the address - not one made up here.
    expect(roomsOpened()).toEqual([id]);
    expect(screen.queryByText('Board not found')).toBeNull();
    expect(screen.queryByText('Opening board…')).toBeNull();
  });

  it('says there is no board there, and does not knock on any room door', async () => {
    const id = newBoardId();
    const service = checks(['not-found']);
    render(<BoardPage boardId={id} api={service.api} />);
    await settle();

    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeInTheDocument();
    // The difference between this page and the way it used to work: a link to nothing used to open
    // a room, write into it, and call the result a board.
    expect(roomsOpened()).toEqual([]);
    expect(service.asked()).toBe(1);
    // "Not there" is an answer, so nothing is asked again - not in a minute, not ever.
    await advance(60_000);
    expect(service.asked()).toBe(1);
    // And both ways out of a dead link are on the page: a board of their own, which is the same
    // wish the home page makes, or the home page itself.
    expect(screen.getByRole('button', { name: 'New board' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the home page' })).toHaveAttribute('href', '/');
  });

  it('keeps trying when it cannot get through, on the schedule, and never blames the board', async () => {
    takeTheClock();
    const id = newBoardId();
    const service = checks(['unreachable']);
    render(<BoardPage boardId={id} api={service.api} />);
    await settle();

    expect(screen.getByRole('status')).toHaveTextContent("Couldn't reach vidi6. Retrying");
    // Not a "Board not found" page. A person on a train with a bad signal must not be told their
    // board is gone; every state in this test is one answer short of that lie.
    expect(screen.queryByRole('heading', { name: 'Board not found' })).toBeNull();
    expect(roomsOpened()).toEqual([]);

    // One question at a time, each later one no sooner than double the wait before it, and none of
    // them past half a minute.
    const waits = [1_000, 2_000, 4_000, 8_000, 16_000];
    expect(service.asked()).toBe(1);
    for (const [index, wait] of waits.entries()) {
      await advance(wait - 1);
      expect(service.asked(), `nothing before ${String(wait)}ms`).toBe(index + 1);
      await advance(1);
      expect(service.asked(), `a try at ${String(wait)}ms`).toBe(index + 2);
    }
    expect(service.asked()).toBe(6);

    // Out of attempts, the page says so and hands over a button, rather than going quiet with a
    // board it might have reached.
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();

    // And the button means it: the service is reachable again, one press, and the board is there.
    service.nowSays('found');
    await act(async () => {
      screen.getByRole('button', { name: 'Try again' }).click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(roomsOpened()).toEqual([id]);
    expect(screen.getByTestId('board-viewport')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('waits for an answer that is late, and shows nothing in the meantime', async () => {
    takeTheClock();
    const id = newBoardId();
    const late = checksThatAreLate();
    render(<BoardPage boardId={id} api={late.api} />);
    await settle();

    // Nothing has come back, and nothing has been assumed in the meantime: no room, no board, and
    // no verdict about whether there is one.
    expect(late.asked()).toBe(1);
    expect(roomsOpened()).toEqual([]);
    expect(screen.queryByRole('heading', { name: 'Board not found' })).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Opening board');

    await late.arrive('found');
    expect(screen.getByTestId('board-viewport')).toBeInTheDocument();
    expect(roomsOpened()).toEqual([id]);
    vi.useRealTimers();
  });

  it('answers an address that cannot name a board without asking about it at all', async () => {
    // The route, not the page: this is the address a person types, so the whole app is what is
    // mounted, with a `fetch` that would notice if the app thought it had a board to ask about.
    const asked = vi.fn(async (): Promise<Response> => new Response('{}', { status: 200 }));
    Object.defineProperty(window, 'fetch', { configurable: true, value: asked });
    goTo('/b/garbage');
    render(<Root />);
    await settle();

    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeInTheDocument();
    expect(asked).not.toHaveBeenCalled();
    expect(roomsOpened()).toEqual([]);
  });
});

describe('TC-22 to TC-25 sharing a board that is there', () => {
  /** Open the share panel on a board whose link is known. */
  async function openShare(api: BoardApi = checks(['found']).api): Promise<{
    id: string;
    link: HTMLInputElement;
    trigger: HTMLButtonElement;
  }> {
    const id = newBoardId();
    render(<BoardPage boardId={id} api={api} />);
    await settle();
    const trigger = screen.getByRole('button', { name: 'Share' }) as HTMLButtonElement;
    await act(async () => {
      trigger.click();
      await settle();
    });
    return {
      id,
      link: screen.getByTestId('share-link') as HTMLInputElement,
      trigger,
    };
  }

  /** The full link of a board, as this browser's address bar would show it. */
  function fullLink(id: string): string {
    return `${window.location.origin}${boardPath(id)}`;
  }

  it('hands over the link of this board, and only this board', async () => {
    const { id, link } = await openShare();
    expect(link.readOnly).toBe(true);
    expect(link.value).toBe(fullLink(id));
    // What a link means, said plainly: whoever has it can look, and can change. A board has no
    // other way in, so there is nothing else to explain, and nothing to hide here either.
    const panel = screen.getByTestId('share-panel').textContent ?? '';
    expect(panel).toContain('Anyone with this link can view and edit this board.');
    // The words this panel must never use: a board's link is not a code that expires, and not a
    // thing that happens once and is forgotten.
    expect(panel).not.toMatch(/room link/i);
    expect(panel).not.toMatch(/meeting code/i);
  });

  it('copies the link, says it did, and then stops saying it', async () => {
    takeTheClock();
    const written: string[] = [];
    clipboard(async (text) => {
      written.push(text);
    });
    const { id } = await openShare();

    await act(async () => {
      screen.getByTestId('copy-link').click();
      await vi.advanceTimersByTimeAsync(0);
    });
    // The whole link, and nothing else: the https, the address, the board's code.
    expect(written).toEqual([fullLink(id)]);
    expect(screen.getByTestId('copy-link')).toHaveTextContent('Link copied');

    // Long enough to read, and then out of the way: the link is the thing, the message about it
    // was a moment.
    await advance(LINK_COPIED_MS - 1);
    expect(screen.getByTestId('copy-link')).toHaveTextContent('Link copied');
    await advance(1);
    await settle();
    expect(screen.getByTestId('copy-link')).toHaveTextContent('Copy link');
    // The panel is still open, and the link is still in it: the message went away, not the board.
    expect(screen.getByTestId('share-link')).toHaveValue(fullLink(id));
    vi.useRealTimers();
  });

  it('says to copy it by hand when the clipboard will not take it', async () => {
    clipboardThatRefuses();
    const { id, link } = await openShare();

    await act(async () => {
      screen.getByTestId('copy-link').click();
      await settle();
    });
    expect(screen.getByTestId('share-manual')).toHaveTextContent(
      'Press Ctrl+C (Cmd+C on Mac) to copy',
    );
    // Nothing was claimed. A person told "Link copied" who pasted nothing would blame the board,
    // not the browser that refused to take the link.
    expect(screen.getByTestId('copy-link')).toHaveTextContent('Copy link');
    // And the link is still there to be taken - selected, and holding the keyboard, so the one
    // keystroke left is the familiar one.
    expect(link).toHaveValue(fullLink(id));
    expect(link.selectionStart).toBe(0);
    expect(link.selectionEnd).toBe(link.value.length);
    expect(document.activeElement).toBe(link);
  });

  it('says to copy it by hand when this browser has no clipboard at all', async () => {
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: undefined });
    await openShare();
    await act(async () => {
      screen.getByTestId('copy-link').click();
      await settle();
    });
    expect(screen.getByTestId('share-manual')).toBeInTheDocument();
    expect(screen.getByTestId('copy-link')).toHaveTextContent('Copy link');
  });

  it('says nothing about sharing until it is asked', async () => {
    const { trigger } = await openShare();
    // The panel is open here - which is the asking. Before it, a board page says nothing about
    // sharing: the words belong to the panel, not to the board.
    expect(
      screen.getByText('Anyone with this link can view and edit this board.'),
    ).toBeInTheDocument();
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
      await settle();
    });
    expect(
      screen.queryByText('Anyone with this link can view and edit this board.'),
    ).toBeNull();
    expect(screen.queryByTestId('share-link')).toBeNull();
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
    expect(trigger).toBeInTheDocument();
  });

  it('closes when it is finished with, and gives the keyboard back where it came from', async () => {
    const { trigger } = await openShare();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    trigger.focus();

    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
      await settle();
    });
    expect(screen.queryByTestId('share-link')).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(trigger);

    // The same from a click anywhere else on the board: the panel does not own the screen.
    await act(async () => {
      trigger.click();
      await settle();
    });
    expect(screen.getByTestId('share-link')).toBeInTheDocument();
    await act(async () => {
      fireEvent.pointerDown(screen.getByTestId('board-viewport'));
      await settle();
    });
    expect(screen.queryByTestId('share-link')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('stays open when the click was inside it', async () => {
    await openShare();
    fireEvent.pointerDown(screen.getByTestId('copy-link'));
    await settle();
    expect(screen.getByTestId('share-link')).toBeInTheDocument();
  });

  it('is reached from the address bar, not from a page that was already open', async () => {
    // The whole story in one test: a board opened by its address - the way the next person will
    // open it - shows the same board and offers the same link, with nothing carried over from the
    // tab that made it. The service is `window.fetch`, because that is all a page has.
    const id = newBoardId();
    Object.defineProperty(window, 'fetch', {
      configurable: true,
      value: vi.fn(async (): Promise<Response> =>
        new Response(JSON.stringify({ id }), { status: 200 }),
      ),
    });
    goTo(boardPath(id));
    render(<Root />);
    await settle();

    expect(screen.getByTestId('board-viewport')).toBeInTheDocument();
    expect(roomsOpened()).toEqual([id]);
    expect(window.location.pathname).toBe(boardPath(id));
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
  });
});
