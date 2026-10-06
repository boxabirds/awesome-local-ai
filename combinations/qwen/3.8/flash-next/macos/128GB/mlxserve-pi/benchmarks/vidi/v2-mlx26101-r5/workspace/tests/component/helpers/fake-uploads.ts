/**
 * `uploadImage`, as a test can hold it.
 *
 * The upload is the one part of adding a picture that a component test cannot have for real: there is no
 * server in jsdom, and even if there were, the things these tests are about are what the board does *while
 * the bytes are in the air* — the placeholder that appears first, the percentage that arrives afterwards,
 * the failure that lands third. A test that could not choose the order of those three could not assert any
 * of them, and a test that waited on a real transfer would be measuring a network.
 *
 * So every call the hook makes is recorded here as an object with three verbs on it: `progress`, `succeed`
 * and `fail`, which are the three things an upload can be made to do, in whatever order the test wants and
 * with nothing else in between. That ordering is the reason this is not `vi.fn().mockResolvedValue(...)`: a
 * promise settles once, at a moment nobody chooses, and "the bar reached a hundred per cent and the request
 * is still waiting" is a case worth having.
 *
 * The module holds one instance, `uploadSpy`, on purpose. `vi.mock` factories are hoisted above a test's own
 * imports, so a mock cannot close over a variable the test declares — but it can import this module, and the
 * module a test imports is the same object the mock imported. The spy is the meeting point.
 */

import type { ImageUpload, UploadResult } from '../../../src/client/images/uploadImage';

/** One upload the hook started, and the three things a test can make it do. */
export interface FakeUploadCall {
  boardId: string;
  file: File;
  /** Reports a fraction, as the network's progress event would. */
  progress(fraction: number): void;
  /** Answers with a stored key — or with the key this call would have been given anyway. */
  succeed(assetKey?: string): void;
  /** Gives up, optionally with the HTTP status the server managed to send. */
  fail(status?: number): void;
  /** Whether the answer has been given. Two answers would be a lie about a promise. */
  readonly settled: boolean;
  /** Whether the hook stopped this upload — on unmount, or when the board went away. */
  readonly aborted: boolean;
}

/** Every upload a test has caused. */
export interface UploadSpy {
  /** The calls, in the order the hook made them. */
  readonly calls: readonly FakeUploadCall[];
  /** Forgets the calls. Not called for you: a test that wants a clean slate says so in `beforeEach`. */
  reset(): void;
  /** The nth call, or the failure of the test that expected one more upload than there was. */
  call(index: number): FakeUploadCall;
  /** The number of calls so far, for a test that only wants to count. */
  readonly count: number;
}

/** The key this fake answers with: a board id, a slash, and an id of the length a real one has. */
export function fakeAssetKey(boardId: string, index: number): string {
  return `${boardId}/${`${index}`.padStart(22, 'a').slice(0, 22)}`;
}

type Resolve = (result: UploadResult) => void;

/** The calls, with the resolving function kept beside each one where no test needs to see it. */
const calls: (FakeUploadCall & { settle: Resolve })[] = [];

/** The upload the hook gets instead of the real one: same signature, same never-rejects promise. */
export function fakeUploadImage(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void,
): ImageUpload {
  let settle: Resolve = () => {};
  const promise = new Promise<UploadResult>((resolve) => {
    settle = resolve;
  });

  const call = {
    boardId,
    file,
    progress(fraction: number): void {
      onProgress(fraction);
    },
    succeed(assetKey?: string): void {
      if (call.settled) return;
      done();
      settle({ kind: 'ok', assetKey: assetKey ?? fakeAssetKey(boardId, calls.length - 1) });
    },
    fail(status?: number): void {
      if (call.settled) return;
      done();
      settle({ kind: 'failed', ...(status === undefined ? {} : { status }) });
    },
    settled: false,
    aborted: false,
    settle,
  };

  /** The answer has been given: no second one, and no progress afterwards. */
  const done = (): void => {
    call.settled = true;
  };

  calls.push(call);
  return {
    promise,
    abort(): void {
      call.aborted = true;
    },
  };
}

/** The spy every component test shares. See the note about hoisting at the top of this file. */
export const uploadSpy: UploadSpy = {
  get calls(): readonly FakeUploadCall[] {
    return calls;
  },
  reset(): void {
    calls.length = 0;
  },
  call(index: number): FakeUploadCall {
    const call = calls[index];
    if (call === undefined) {
      throw new Error(`there was no upload number ${index}; there were ${calls.length}`);
    }
    return call;
  },
  get count(): number {
    return calls.length;
  },
};

/** Lets the hook's own asynchronous hops run — the decode, the placement, the answer to an upload. */
export async function flush(): Promise<void> {
  for (let hop = 0; hop < 12; hop += 1) await Promise.resolve();
}
