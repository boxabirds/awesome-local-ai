/**
 * Story 12: the upload stand-in, on its own so the mock factory can reach it without
 * importing anything else.
 *
 * A vitest mock factory runs while the module graph is still being built, so a factory that
 * imports a module which itself imports the mocked module deadlocks. This file therefore
 * imports nothing but the test library and a type — which is also the right split: it knows
 * what an upload *would have been*, and nothing about boards.
 */
import { act } from '@testing-library/react';
import type { UploadResult } from '../../../src/client/images/uploadImage';

/** One upload the board started, waiting for the test to say how it went. */
export interface StubUpload {
  readonly boardId: string;
  readonly file: File;
  /** Report progress, the way `upload.onprogress` does. */
  progress(fraction: number): void;
  /** The bytes landed, at the address the server would have answered with. */
  ok(assetKey: string): Promise<void>;
  /** The server answered badly, or did not answer at all. */
  failed(status?: number): Promise<void>;
  /** Did this tab give up on the attempt (a retry abandons the one it replaced)? */
  readonly aborted: boolean;
}

interface Pending {
  settle(result: UploadResult): void;
  abort(): void;
}

const pending = new Map<string, Pending>();
const records: StubUpload[] = [];
const givenUp: boolean[] = [];

/**
 * The stand-in for `uploadImage`: it never touches the network, and every upload it starts
 * waits for the test to finish it. `boardId` and `file` are recorded so a test can see what
 * would have gone over the wire — including, in TC-19, that nothing did.
 */
export function uploadImageStub(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void,
): { promise: Promise<UploadResult>; abort(): void } {
  const key = `${boardId}::${file.name}`;
  let settled = false;
  const record = { aborted: false };
  const promise = new Promise<UploadResult>((resolve) => {
    pending.set(key, {
      settle(result) {
        if (settled) return;
        settled = true;
        pending.delete(key);
        resolve(result);
      },
      abort() {
        record.aborted = true;
      },
    });
  });
  const upload: StubUpload = {
    boardId,
    file,
    get aborted() {
      return record.aborted;
    },
    progress(fraction) {
      act(() => onProgress(fraction));
    },
    async ok(assetKey) {
      await settle(key, { kind: 'ok', assetKey });
    },
    async failed(status) {
      await settle(key, { kind: 'failed', status });
    },
  };
  records.push(upload);
  return {
    promise,
    abort() {
      givenUp.push(true);
      pending.get(key)?.abort();
    },
  };
}

/**
 * Uploads are settled one at a time, however the test asks. `act` cannot be entered twice at
 * once, and a test that finishes three uploads at once would otherwise do exactly that.
 */
let settling: Promise<void> = Promise.resolve();

async function settle(key: string, result: UploadResult): Promise<void> {
  const inFlight = pending.get(key);
  if (!inFlight) throw new Error(`no upload is in flight for ${key}`);
  settling = settling.then(async () => {
    // The document write the answer causes happens in the promise reaction, so both the state
    // change and the microtasks it runs on are wrapped, and the test sees a settled board.
    await act(async () => {
      inFlight.settle(result);
      await Promise.resolve();
      await Promise.resolve();
    });
  });
  await settling;
}

/** Every upload this test has been asked for, in order. */
export function uploads(): readonly StubUpload[] {
  return records;
}

export function lastUpload(): StubUpload {
  const upload = records[records.length - 1];
  if (!upload) throw new Error('no upload was started');
  return upload;
}

/** How many times the board abandoned an upload it had started. */
export function abortedUploads(): number {
  return givenUp.length;
}

export function resetUploads(): void {
  records.length = 0;
  settling = Promise.resolve();
  givenUp.length = 0;
  pending.clear();
}
