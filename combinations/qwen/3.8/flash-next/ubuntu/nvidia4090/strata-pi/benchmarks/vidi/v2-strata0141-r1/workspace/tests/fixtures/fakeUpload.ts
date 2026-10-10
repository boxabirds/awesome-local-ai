/**
 * A file upload a test drives by hand.
 *
 * `src/client/images/uploadImage.ts` is one `XMLHttpRequest` and nothing else, so a
 * test that used it would be testing the network stack and waiting on it. This stands
 * in for it and hands the test the three things the real one decides: that a file was
 * offered, how far its bytes have got, and whether they arrived.
 *
 * `vi.mock('../../src/client/images/uploadImage')` in a component test returns this
 * module's `uploadImage`, so the client code under test is otherwise untouched.
 *
 * Two ways of driving it, because tests want both:
 *
 * - `uploads.plan('photo.png', { outcome: 'fail', status: 500 })` decides in advance,
 *   which is what a test that never wants an upload left hanging uses;
 * - `uploads.calls[0].ok(key)` answers a particular attempt at the moment the test
 *   chooses, which is what a test about Retry needs - a Retry has to replace an attempt
 *   that is still on the wire.
 */

export type FakeUploadOutcome = 'ok' | 'fail' | 'keep' | 'throw';

export interface FakeUploadPlan {
  outcome: FakeUploadOutcome;
  assetKey?: string;
  contentType?: string;
  /** The answer a refused upload carries (`assets.upload.response`). */
  status?: number;
  /** The transport itself broke: the promise rejects. */
  error?: string;
}

export interface FakeUploadResult {
  kind: 'ok' | 'failed';
  assetKey?: string;
  contentType?: string;
  status?: number;
  /** Set when the request itself broke rather than being answered. */
  transportError?: boolean;
}

export interface FakeUploadCall {
  readonly boardId: string;
  readonly file: File;
  /** Report how much of this file has been sent. */
  onProgress(fraction: number): void;
  /** The board stored it. */
  ok(assetKey: string, contentType?: string): void;
  /** The board refused it, or the network did. */
  fail(status?: number): void;
  /** Was this upload cancelled (the object was removed, or the board was left)? */
  aborted: boolean;
  /** Has the board answered this upload yet? */
  settled: boolean;
}

export interface FakeUploads {
  /** Every attempt, in the order the board started them. */
  readonly calls: FakeUploadCall[];
  /** Names of files whose upload was cancelled, in the order it happened. */
  readonly aborts: string[];
  /** Decide what the board will do with the next upload of `name`. */
  plan(name: string, plan: FakeUploadPlan): void;
  /** What the next upload of `name` will be answered with, if anything was planned. */
  byPlan(name: string): FakeUploadPlan | undefined;
  /** The board's answer to a file that was refused, in the shape the client expects. */
  refusal(status: number): { ok: false; error: string; retryUrl: string | null };
  byName(name: string): FakeUploadCall | undefined;
  lastCall(): FakeUploadCall | undefined;
  /** Answer every unanswered upload with success. */
  allOk(assetKey?: string, contentType?: string): void;
  /** Names of uploads that were cancelled and never answered. */
  abortedNames(): string[];
  /** Names of uploads that were cancelled while still on the wire. */
  abortsSettled(): string[];
  reset(): void;
}

const ASSET_DEFAULT = 'asset00000000000000000000';

/** The recorder one test file's runs share. */
export function fakeUploads(): FakeUploads {
  const calls: FakeUploadCall[] = [];
  const aborts: string[] = [];
  const plans = new Map<string, FakeUploadPlan>();

  return {
    calls,
    aborts,
    plan(name: string, plan: FakeUploadPlan) {
      plans.set(name, plan);
    },
    byPlan(name: string) {
      return plans.get(name);
    },
    refusal(status: number) {
      return { ok: false, error: `upload failed: ${status}`, retryUrl: null };
    },
    byName(name: string) {
      for (let index = calls.length - 1; index >= 0; index -= 1) {
        const call = calls[index];
        if (call !== undefined && call.file.name === name) {
          return call;
        }
      }
      return undefined;
    },
    lastCall() {
      return calls[calls.length - 1];
    },
    allOk(assetKey: string = ASSET_DEFAULT, contentType?: string) {
      for (const call of calls) {
        if (!call.settled) {
          call.ok(assetKey, contentType);
        }
      }
    },
    abortedNames() {
      return calls.filter((call) => call.aborted).map((call) => call.file.name);
    },
    abortsSettled() {
      return calls.filter((call) => call.aborted && call.settled).map((call) => call.file.name);
    },
    reset() {
      calls.length = 0;
      aborts.length = 0;
      plans.clear();
    },
  };
}

/**
 * The stand-in `uploadImage`.
 *
 * A planned outcome lands on the next macrotask, so a test that does not care about
 * the timing of one upload still has to let the board settle - and a test that does
 * care can answer the attempt itself instead.
 */
export function makeUploadImage(uploads: FakeUploads) {
  return function uploadImage(
    boardId: string,
    file: File,
    onProgress: (fraction: number) => void = () => undefined,
  ): { promise: Promise<FakeUploadResult>; abort(): void } {
    let finish: (result: FakeUploadResult) => void = () => undefined;
    const promise = new Promise<FakeUploadResult>((resolve) => {
      finish = resolve;
    });
    const call: FakeUploadCall = {
      boardId,
      file,
      onProgress,
      aborted: false,
      settled: false,
      ok(assetKey: string, contentType?: string) {
        if (call.settled) {
          return;
        }
        call.settled = true;
        finish({ kind: 'ok', assetKey, contentType });
      },
      fail(status?: number) {
        if (call.settled) {
          return;
        }
        call.settled = true;
        finish({ kind: 'failed', status });
      },
    };
    uploads.calls.push(call);

    const plan = uploads.byPlan(file.name);
    if (plan !== undefined && plan.outcome !== 'keep') {
      const outcome = plan;
      setTimeout(() => {
        if (call.settled || call.aborted) {
          return;
        }
        if (outcome.outcome === 'ok') {
          call.ok(outcome.assetKey ?? ASSET_DEFAULT, outcome.contentType ?? file.type);
        } else if (outcome.outcome === 'fail') {
          call.fail(outcome.status ?? 500);
        } else {
          call.settled = true;
          finish({ kind: 'failed', transportError: true });
        }
      }, 0);
    }

    return {
      promise,
      abort() {
        call.aborted = true;
        uploads.aborts.push(file.name);
      },
    };
  };
}

/**
 * The recorder and the stand-in, already paired.
 *
 * A test file mocks the real module with `uploadImage` and imports `uploads` to drive
 * it; both resolve to this module, so they are the same pair for the whole file. Test
 * files run in separate module graphs, so nothing leaks between them.
 */
export const uploads: FakeUploads = fakeUploads();
export const uploadImage = makeUploadImage(uploads);

/** The upload route, kept for tests that assert a board was addressed. */
export function uploadUrlFor(boardId: string): string {
  return `/api/boards/${boardId}/assets`;
}
