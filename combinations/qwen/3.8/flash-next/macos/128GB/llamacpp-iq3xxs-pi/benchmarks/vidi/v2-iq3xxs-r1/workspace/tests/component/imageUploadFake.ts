import type { UploadHandle, UploadResult } from '../../src/client/images/uploadImage';

/**
 * The upload the component tests are handed (design "Mock vs real boundaries":
 * *`uploadImage` in ui-component tests — mocked with controllable progress: the flows
 * are under test, not the network*).
 *
 * Every call is recorded and stays under the test's thumb: nothing settles until a test
 * says so, which is the only way to look at a placeholder *while* it uploads, and the
 * way to make an upload fail on purpose — with a status, or with none, which is what a
 * network error looks like from the caller's seat.
 */
export interface FakeUpload {
  /** Which board the file was sent to. */
  readonly boardId: string;
  /** Which file was sent, so a retry can be recognised as the same one. */
  readonly file: File;
  /** Progress values reported to the placeholder, in order. */
  readonly reported: number[];
  /** Whether the caller aborted. */
  readonly aborted: boolean;
  /** The handle the caller holds. */
  readonly handle: UploadHandle;
  /** Report progress, as XHR's upload progress events would. */
  progress(fraction: number): void;
  /** Storage answered 201 with this key. */
  succeed(assetKey?: string): void;
  /** Storage answered an error — 500 by default, `0` meaning "no answer at all". */
  fail(status?: number): void;
}

class StartedUpload implements FakeUpload {
  readonly reported: number[] = [];
  aborted = false;
  readonly handle: UploadHandle;
  private settle: (result: UploadResult) => void = () => {};

  constructor(
    readonly boardId: string,
    readonly file: File,
    private readonly onProgress?: (fraction: number) => void,
  ) {
    this.handle = {
      promise: new Promise<UploadResult>((resolve) => {
        this.settle = resolve;
      }),
      abort: (): void => {
        this.aborted = true;
        // A real aborted request settles as a failure with no status, and the caller is
        // expected to ignore it — which is part of what the abort test checks.
        this.settle({ kind: 'failed', status: 0 });
      },
    };
  }

  progress(fraction: number): void {
    this.reported.push(fraction);
    this.onProgress?.(fraction);
  }

  succeed(assetKey = fakeAssetKey(this.boardId, this.file.name)): void {
    this.settle({ kind: 'ok', assetKey });
  }

  fail(status = 500): void {
    this.settle(status === 0 ? { kind: 'failed' } : { kind: 'failed', status });
  }
}

/**
 * A key shaped exactly like a real one: `<board id>/<22 characters of the base64url set>`.
 * A picture is only ever built from a key that `isAssetKey` accepts — the document this
 * tab reads was written by whoever holds the link — so a fake key that was not shaped
 * like one would render no picture at all, and a test that says "the picture appeared"
 * would be describing something it never checked.
 */
export function fakeAssetKey(boardId: string, label: string): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const letters = label.toLowerCase().replace(/[^a-z0-9]/g, '');
  let id = letters;
  for (let at = 0; id.length < 22; at++) id += alphabet[(at * 7 + letters.length) % alphabet.length];
  return `${boardId}/${id.slice(0, 22)}`;
}

class UploadFake {
  private readonly _started: StartedUpload[] = [];

  /** Every upload since the last `reset`, in the order they started. */
  get started(): readonly FakeUpload[] {
    return this._started;
  }

  reset(): void {
    this._started.length = 0;
  }

  /** What `uploadImage` becomes in these tests. */
  upload(
    boardId: string,
    file: File,
    onProgress?: (fraction: number) => void,
  ): UploadHandle {
    const entry = new StartedUpload(boardId, file, onProgress);
    this._started.push(entry);
    return entry.handle;
  }
}

/** Give this to `vi.mock` for `src/client/images/uploadImage`. */
export const uploadFake = new UploadFake();

/**
 * The `i`th upload that has started — the handle for reporting progress to a
 * placeholder, or for making it succeed or fail.
 */
export function uploadFor(i: number): FakeUpload {
  const entry = uploadFake.started[i];
  if (!entry) throw new Error(`upload ${i} has not started (${uploadFake.started.length} have)`);
  return entry;
}
