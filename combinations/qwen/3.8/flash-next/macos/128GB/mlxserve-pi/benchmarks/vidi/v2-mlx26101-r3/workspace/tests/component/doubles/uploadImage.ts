/**
 * The upload, held still until a test decides how it went.
 *
 * This file is a stand-in for `src/client/images/uploadImage`, and it is kept away from everything
 * that imports the app so that `vi.mock` can hand it over without a cycle: it knows the shape of an
 * upload and nothing about the board.
 *
 * What it reproduces is the part the client can see: a promise that settles when the transfer ends,
 * a progress callback called with a fraction while it goes on, and an `abort` that ends it early.
 * What it deliberately cannot do is arrive at a server - so every test written against it is a test
 * of what the client *does* with an upload, which is the only thing a component test can honestly
 * claim. The real transfer, against a real bucket, is the integration suite's job.
 */
import { act } from '@testing-library/react';
import { vi } from 'vitest';

export interface UploadResult {
  readonly ok: boolean;
  readonly assetKey?: string;
  readonly reason?: string;
  readonly status?: number;
}

/** One upload the test is holding. */
export interface HeldUpload {
  readonly boardId: string;
  readonly file: File;
  /** The address this upload was sent to, so a test can check it was the board's own. */
  readonly url: string;
  /** How many times the client hung up on it. */
  aborts: number;
  /** Say how far it has got. */
  progress(fraction: number): void;
  /** Say how it ended. */
  finish(result: UploadResult): void;
}

/** Every upload since the last `forgetUploads()`, in the order they started. */
export const uploads: HeldUpload[] = [];

/** The `uploadImage` the client gets: it starts nothing, and waits to be told. */
export const uploadImage = vi.fn(
  (
    boardId: string,
    file: File,
    onProgress?: (fraction: number) => void,
  ): { promise: Promise<UploadResult>; abort(): void } => {
    let finish!: (result: UploadResult) => void;
    const promise = new Promise<UploadResult>((resolve) => {
      finish = resolve;
    });
    const held: HeldUpload = {
      boardId,
      file,
      url: `/api/boards/${encodeURIComponent(boardId)}/assets`,
      aborts: 0,
      progress(fraction: number) {
        onProgress?.(fraction);
      },
      finish(result: UploadResult) {
        finish(result);
      },
    };
    uploads.push(held);
    return {
      promise,
      abort() {
        held.aborts += 1;
        finish({ ok: false, reason: 'aborted', status: 0 });
      },
    };
  },
);

export function forgetUploads(): void {
  uploads.length = 0;
}

/** The nth upload; throws when there are not that many, rather than testing nothing. */
export function upload(index: number): HeldUpload {
  const held = uploads[index];
  if (held === undefined) {
    throw new Error(`expected at least ${String(index + 1)} upload(s), there ${String(uploads.length)}`);
  }
  return held;
}

/** The upload of the file called `name`. */
export function uploadOf(name: string): HeldUpload {
  const held = uploads.find((candidate) => candidate.file.name === name);
  if (held === undefined) {
    throw new Error(`no upload for "${name}" (of ${String(uploads.length)})`);
  }
  return held;
}

/** A transfer that arrived; `assetKey` is what the room sent back. */
export function arrived(assetKey: string): UploadResult {
  return { ok: true, assetKey };
}

/** A transfer that did not arrive at all. */
export function lost(): UploadResult {
  return { ok: false, reason: 'network', status: 0 };
}

/** A transfer that the far end refused because it was too big, or not a picture. */
export function refused(status: number): UploadResult {
  return { ok: false, reason: 'rejected_by_server', status };
}

/* Everything below is the same three things a test would otherwise wrap in `act` forty times: the
 * board reacts to an upload by writing to the document, and a React update that arrives outside
 * `act` is an update nobody waited for. */

/**
 * Report progress, and let the board draw it.
 *
 * The waits below all go through a timer for the same reason `helpers/images.tsx` does - see the note
 * there about counting promises. They are kept here rather than imported from there because this module
 * is handed to `vi.mock` and must stay free of the app's own imports.
 */
export async function settleWork(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

/** Report progress, and let the board draw it. */
export async function reportProgress(index: number, fraction: number): Promise<void> {
  upload(index).progress(fraction);
  await settleWork();
}

/** End a transfer, and let the board react. */
export async function settleUpload(index: number, result: UploadResult): Promise<void> {
  upload(index).finish(result);
  await settleWork();
}

/** End every open transfer, in order, the way they arrived. */
export async function settleAll(result: UploadResult): Promise<void> {
  uploads.forEach((held) => held.finish(result));
  await settleWork();
}

/** Hang up on a transfer, and let the board notice. */
export async function hangUp(index: number): Promise<void> {
  const held = upload(index);
  held.aborts += 1;
  held.finish({ ok: false, reason: 'aborted', status: 0 });
  await settleWork();
}
