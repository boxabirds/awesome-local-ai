/**
 * Story 12, task 6 (TC-17 to TC-19, TC-29): the three ways an image gets onto
 * the board, tested through the hook that implements them.
 *
 * What is mounted is a small harness rather than the whole board: `useImageInsert`,
 * the real `ToastHost` (so a message is asserted as a person sees it), and one
 * `ImageBoardObject` per image the hook created, wired to the same `ImageContext`
 * the real board provides. That is enough to watch a drop become a placeholder, a
 * percentage, and then a picture.
 *
 * Two test-only seams are the hook's own options: `upload` replaces the transport,
 * so progress and failure are driven by hand, and `viewportSize` makes "centred in
 * the view" a number a test can predict. `createImageBitmap` is stubbed because
 * jsdom has no image decoder — and because TC-29 is about a decoder saying no.
 *
 * Run first: `npm run test:component -- useImageInsert`
 */

import { useEffect, useState } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { snapshot, type ObjectSnapshot } from "../../src/shared/board-model";
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_MAX_PLACE_SIZE_WORLD } from "../../src/shared/config";
import type { Camera } from "../../src/client/canvas/camera";
import {
  useImageInsert,
  type DropEventLike,
  type ImageInsertApi,
  type PasteEventLike,
} from "../../src/client/images/useImageInsert";
import type { UploadHandle, UploadResult } from "../../src/client/images/uploadImage";
import { clearToasts, ToastHost } from "../../src/client/ui/Toast";
import {
  ImageBoardObject,
  ImageContextProvider,
  type ImageContextValue,
} from "../../src/client/objects/ImageObject";
import { corruptPngBytes, pdfBytes, pngBytes } from "../fixtures/image-bytes";

const BOARD_ID = "Zm9vYmFyYmF6aW5nZHVwZA";
const UPLOADER = "identity-leo";
/** Zoom 1 at the origin: a screen point and a world point are the same numbers. */
const CAMERA: Camera = { x: 0, y: 0, zoom: 1 };
const VIEW = { width: 1000, height: 800 };
const OFFLINE_MESSAGE = "You're offline \u2014 images can be added when you reconnect.";
const TYPE_MESSAGE = "Only PNG, JPEG, GIF and WebP images can be added.";

/** What the stubbed decoder says each file's natural pixel size is. */
const NATURAL_SIZES: Record<string, { width: number; height: number }> = {
  "a.png": { width: 400, height: 300 },
  "b.png": { width: 200, height: 200 },
  "c.png": { width: 1600, height: 800 },
  "photo.png": { width: 400, height: 300 },
  "corrupt.png": { width: 400, height: 300 },
};

// ---- the transport, driven by hand ----------------------------------------

interface FakeUploadCall {
  readonly file: File;
  /** Reports a fraction of the file as sent. */
  progress(fraction: number): void;
  succeed(assetKey: string): void;
  fail(): void;
  aborted(): boolean;
}

interface FakeUpload {
  upload(boardId: string, file: File, onProgress: (fraction: number) => void): UploadHandle;
  /** One entry per upload the hook started, in the order it started them. */
  readonly pending: FakeUploadCall[];
}

function fakeUpload(): FakeUpload {
  const pending: FakeUploadCall[] = [];

  function upload(boardId: string, file: File, onProgress: (fraction: number) => void): UploadHandle {
    void boardId;
    let resolve: (result: UploadResult) => void = () => undefined;
    let aborted = false;

    pending.push({
      file,
      progress: (fraction) => onProgress(fraction),
      succeed: (assetKey) => resolve({ kind: "ok", assetKey }),
      fail: () => resolve({ kind: "failed", status: 500 }),
      aborted: () => aborted,
    });

    return {
      promise: new Promise<UploadResult>((done) => {
        resolve = done;
      }),
      abort() {
        aborted = true;
        resolve({ kind: "failed" });
      },
    };
  }

  return { upload, pending };
}

// ---- the harness -----------------------------------------------------------

interface HarnessOptions {
  doc: Y.Doc;
  upload: FakeUpload;
  connection?: "connecting" | "connected" | "reconnecting" | "confirmed";
  canEdit?: boolean;
  identityId?: string;
}

interface Mounted {
  doc: Y.Doc;
  /** The hook's API, as of its most recent render. */
  api(): ImageInsertApi;
  upload: FakeUpload;
  images(): ObjectSnapshot[];
}

function mountInsert(options: HarnessOptions): Mounted {
  const doc = options.doc;
  const upload = options.upload;
  const identityId = options.identityId ?? UPLOADER;
  let api: ImageInsertApi | null = null;

  function Harness() {
    const insert = useImageInsert({
      doc,
      boardId: BOARD_ID,
      camera: CAMERA,
      connection: options.connection ?? "connected",
      identityId,
      canEdit: options.canEdit ?? true,
      viewportSize: VIEW,
      upload: upload.upload,
    });
    api = insert;

    // The board re-renders when its document changes; so does this harness.
    const [, tick] = useState(0);
    useEffect(() => {
      const onUpdate = () => tick((value) => value + 1);
      doc.on("update", onUpdate);
      return () => {
        doc.off("update", onUpdate);
      };
    }, [doc]);

    const context: ImageContextValue = {
      identityId,
      progress: insert.progress,
      canRetry: insert.canRetry,
      onRetry: (id) => insert.retry(id),
      onRemove: () => undefined,
      now: Date.now(),
    };

    return (
      <>
        <ToastHost />
        <ImageContextProvider value={context}>
          {imagesOf(doc).map((object) => (
            <ImageBoardObject
              key={object.id}
              object={object}
              doc={doc}
              zoom={1}
              selected={false}
              editing={false}
              dragging={false}
              onObjectPointerDown={() => undefined}
              onStartEdit={() => undefined}
              onEndEdit={() => undefined}
            />
          ))}
        </ImageContextProvider>
      </>
    );
  }

  render(<Harness />);

  return {
    doc,
    api: () => {
      if (api === null) throw new Error("useImageInsert never mounted");
      return api;
    },
    upload,
    images: () => imagesOf(doc),
  };
}

function imagesOf(doc: Y.Doc): ObjectSnapshot[] {
  return snapshot(doc).filter((object) => object.type === "image");
}

/** An image's box, with the numbers the assertions need proved to be there. */
function boxOf(image: ObjectSnapshot): { x: number; y: number; width: number; height: number } {
  const { x, y, width, height } = image;
  if (typeof x !== "number" || typeof y !== "number" || typeof width !== "number" || typeof height !== "number") {
    throw new Error(`image ${image.id} has no rectangle`);
  }
  return { x, y, width, height };
}

// ---- the events the board gets ---------------------------------------------

function dataTransferOf(files: File[]): DataTransfer {
  return {
    files,
    types: ["Files"],
    dropEffect: "none",
    effectAllowed: "none",
  } as unknown as DataTransfer;
}

function dropEventOf(files: File[], x: number, y: number): DropEventLike & { prevented(): boolean } {
  let prevented = false;
  return {
    dataTransfer: dataTransferOf(files),
    clientX: x,
    clientY: y,
    preventDefault: () => {
      prevented = true;
    },
    stopPropagation: () => undefined,
    prevented: () => prevented,
  };
}

function pasteEventOf(files: File[], target: EventTarget): PasteEventLike & { prevented(): boolean } {
  let prevented = false;
  return {
    clipboardData: dataTransferOf(files),
    target,
    preventDefault: () => {
      prevented = true;
    },
    prevented: () => prevented,
  };
}

/** A real `paste` event on the window, which is where the hook listens. */
function dispatchWindowPaste(files: File[]): void {
  const event = new Event("paste", { bubbles: true, cancelable: true }) as Event & {
    clipboardData: DataTransfer | null;
  };
  event.clipboardData = dataTransferOf(files);
  window.dispatchEvent(event);
}

// ---- files, as a browser hands them over -----------------------------------

function imageFile(name: string): File {
  return new File([pngBytes(4, 4)], name, { type: "image/png" });
}

function corruptImageFile(): File {
  return new File([corruptPngBytes()], "corrupt.png", { type: "image/png" });
}

// ---- the decoder jsdom does not have ---------------------------------------

beforeEach(() => {
  clearToasts();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async (source: Blob) => {
      const name = (source as { name?: string }).name ?? "";
      const size = NATURAL_SIZES[name] ?? { width: 320, height: 240 };
      if (name === "corrupt.png") throw new Error("the decoder refuses these bytes");
      return { width: size.width, height: size.height, close: () => undefined };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---- TC-17: several files, dropped at once ---------------------------------

describe("TC-17: a drop of three files", () => {
  it("creates three placeholders in a row, at the sizes they will be shown at", async () => {
    const board = mountInsert({ doc: new Y.Doc(), upload: fakeUpload() });
    expect(board.images()).toHaveLength(0);

    // Dropped with its top-left corner at (100, 200); the camera is at the origin
    // at zoom 1, so those are also board units.
    board.api().onDrop(dropEventOf([imageFile("a.png"), imageFile("b.png"), imageFile("c.png")], 100, 200));

    await waitFor(() => expect(board.images()).toHaveLength(3));
    const [first, second, third] = board.images().map(boxOf);

    // `image.drop`: left to right, tops aligned, `IMAGE_LAYOUT_GAP_WORLD` apart.
    expect([first.x, first.y]).toEqual([100, 200]);
    expect(second.x).toBe(100 + first.width + IMAGE_LAYOUT_GAP_WORLD);
    expect(third.x).toBe(second.x + second.width + IMAGE_LAYOUT_GAP_WORLD);
    expect([second.y, third.y]).toEqual([200, 200]);

    // `image.placement_size`: natural size, scaled down to 800 on the longest side.
    expect({ width: first.width, height: first.height }).toEqual({ width: 400, height: 300 });
    expect({ width: second.width, height: second.height }).toEqual({ width: 200, height: 200 });
    expect({ width: third.width, height: third.height }).toEqual({
      width: IMAGE_MAX_PLACE_SIZE_WORLD,
      height: 400,
    });

    // A placeholder is a placeholder: no asset yet, this tab is the uploader.
    for (const image of board.images()) {
      expect(image.status).toBe("uploading");
      expect(image.assetKey).toBeNull();
      expect(image.uploaderId).toBe(UPLOADER);
    }
  });

  it("reports progress to the uploader, as a percentage they can read", async () => {
    const board = mountInsert({ doc: new Y.Doc(), upload: fakeUpload() });
    board.api().onDrop(dropEventOf([imageFile("a.png")], 0, 0));
    await waitFor(() => expect(board.upload.pending).toHaveLength(1));

    const id = board.images()[0]!.id;
    expect(board.upload.pending[0]!.file.name).toBe("a.png");

    act(() => board.upload.pending[0]!.progress(0.5));
    await waitFor(() => expect(board.api().progress.get(id)).toBe(0.5));
    const uploading = await screen.findByTestId("image-uploading");
    expect(uploading.textContent).toContain("Uploading\u2026 50%");

    act(() => board.upload.pending[0]!.progress(0.937));
    await waitFor(() => expect(screen.getByTestId("image-uploading")?.textContent).toContain("94%"));
    const bar = screen.getByTestId("image-progress").firstElementChild as HTMLElement;
    expect(bar.getAttribute("aria-valuenow")).toBe("94");
  });

  it("turns the placeholder into the image for everyone when the upload answers", async () => {
    const board = mountInsert({ doc: new Y.Doc(), upload: fakeUpload() });
    board.api().onDrop(dropEventOf([imageFile("a.png")], 0, 0));
    await waitFor(() => expect(board.upload.pending).toHaveLength(1));

    const assetKey = `${BOARD_ID}/${"RmlsZU9uZTIyY2hhcnMxMg"}`;
    act(() => board.upload.pending[0]!.succeed(assetKey));

    await waitFor(() => expect(board.images()[0]!.status).toBe("ready"));
    expect(board.images()[0]!.assetKey).toBe(assetKey);
    // The progress bookkeeping is gone with the upload that produced it.
    expect(board.api().progress.size).toBe(0);

    const img = (await screen.findByTestId("image-content")) as HTMLImageElement;
    expect(img.getAttribute("src")).toContain(`/api/assets/${assetKey}`);
    expect(screen.queryByTestId("image-uploading")).toBeNull();
  });

  it("starts one upload per file, all of them on the same board", async () => {
    const board = mountInsert({ doc: new Y.Doc(), upload: fakeUpload() });
    board.api().onDrop(dropEventOf([imageFile("a.png"), imageFile("b.png")], 0, 0));
    await waitFor(() => expect(board.upload.pending).toHaveLength(2));
    expect(board.upload.pending.map((call) => call.file.name)).toEqual(["a.png", "b.png"]);
  });
});

// ---- TC-18: paste -----------------------------------------------------------

describe("TC-18: an image in the clipboard", () => {
  it("does not add anything while a text field has the paste", async () => {
    const board = mountInsert({ doc: new Y.Doc(), upload: fakeUpload() });

    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    textarea.focus();

    board.api().onPaste(pasteEventOf([imageFile("photo.png")], textarea));
    expect(board.images()).toHaveLength(0);
    expect(board.upload.pending).toHaveLength(0);

    // A real paste event aimed at the field the person is typing in.
    dispatchWindowPaste([imageFile("photo.png")]);
    expect(board.images()).toHaveLength(0);

    textarea.remove();
  });

  it("adds one centred in the view when the board has it", async () => {
    const board = mountInsert({ doc: new Y.Doc(), upload: fakeUpload() });

    dispatchWindowPaste([imageFile("photo.png")]);
    await waitFor(() => expect(board.images()).toHaveLength(1));

    const image = boxOf(board.images()[0]!);
    // `image.paste`: centred in the view — the view here is 1000 × 800 at the
    // origin, and the image is 400 × 300.
    expect([image.x, image.y]).toEqual([
      VIEW.width / 2 - image.width / 2,
      VIEW.height / 2 - image.height / 2,
    ]);
    expect(board.upload.pending).toHaveLength(1);
  });

  it("leaves a clipboard with no image alone", () => {
    const board = mountInsert({ doc: new Y.Doc(), upload: fakeUpload() });
    const event = pasteEventOf([], document.body);
    board.api().onPaste(event);
    expect(board.images()).toHaveLength(0);
    expect(event.prevented()).toBe(false);
  });
});

// ---- TC-19: offline ---------------------------------------------------------

describe("TC-19: nothing can be added while offline", () => {
  it("says so instead of creating a placeholder nobody can finish", async () => {
    const board = mountInsert({ doc: new Y.Doc(), upload: fakeUpload(), connection: "reconnecting" });

    board.api().onDrop(dropEventOf([imageFile("a.png"), imageFile("b.png")], 10, 10));

    expect(await screen.findByText(OFFLINE_MESSAGE)).toBeTruthy();
    expect(board.images()).toHaveLength(0);
    expect(board.upload.pending).toHaveLength(0);

    // The picker stays shut for the same reason.
    board.api().openPicker();
    expect(board.images()).toHaveLength(0);
    expect(board.upload.pending).toHaveLength(0);
  });

  it("and the same for a paste", async () => {
    const board = mountInsert({ doc: new Y.Doc(), upload: fakeUpload(), connection: "connecting" });
    dispatchWindowPaste([imageFile("photo.png")]);
    expect(await screen.findByText(OFFLINE_MESSAGE)).toBeTruthy();
    expect(board.images()).toHaveLength(0);
  });

  it("opens the system picker when the board is in sync", () => {
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => undefined);
    const board = mountInsert({ doc: new Y.Doc(), upload: fakeUpload(), connection: "confirmed" });

    board.api().openPicker();

    expect(click).toHaveBeenCalledTimes(1);
    const input = click.mock.instances[0] as HTMLInputElement;
    expect(input.type).toBe("file");
    expect(input.multiple).toBe(true);
    expect(input.accept).toBe("image/png,image/jpeg,image/gif,image/webp");
    click.mockRestore();
  });
});

// ---- Retry: the same file, again -------------------------------------------

describe("Retry (TC-24, the half that re-uploads)", () => {
  it("re-uploads the file this tab still has, and puts the placeholder back to uploading", async () => {
    const board = mountInsert({ doc: new Y.Doc(), upload: fakeUpload() });
    board.api().onDrop(dropEventOf([imageFile("a.png")], 0, 0));
    await waitFor(() => expect(board.upload.pending).toHaveLength(1));

    const id = board.images()[0]!.id;
    act(() => board.upload.pending[0]!.fail());
    await waitFor(() => expect(board.images()[0]!.status).toBe("failed"));

    expect(board.api().canRetry(id)).toBe(true);
    expect(board.api().retry(id)).toBe(true);

    // A new upload of the same file, and the placeholder is uploading again.
    await waitFor(() => expect(board.upload.pending).toHaveLength(2));
    expect(board.upload.pending[1]!.file.name).toBe("a.png");
    expect(board.images()[0]!.status).toBe("uploading");
    expect(board.images()[0]!.assetKey).toBeNull();
  });

  it("has nothing to retry after a reload took the file away", async () => {
    const doc = new Y.Doc();

    const first = mountInsert({ doc, upload: fakeUpload() });
    first.api().onDrop(dropEventOf([imageFile("a.png")], 0, 0));
    await waitFor(() => expect(first.upload.pending).toHaveLength(1));
    const id = first.images()[0]!.id;
    act(() => first.upload.pending[0]!.fail());
    await waitFor(() => expect(first.images()[0]!.status).toBe("failed"));

    // The page reloads: the same document, a hook with no memory of the file.
    const second = mountInsert({ doc, upload: fakeUpload() });
    expect(second.images()[0]!.id).toBe(id);
    expect(second.api().canRetry(id)).toBe(false);
    expect(second.api().retry(id)).toBe(false);
    expect(second.upload.pending).toHaveLength(0);
  });
});

// ---- TC-29: the decoder says no --------------------------------------------

describe("TC-29: a file whose bytes are not a decodable image", () => {
  it("refuses the undecodable file and still adds the good one from the same drop", async () => {
    const board = mountInsert({ doc: new Y.Doc(), upload: fakeUpload() });

    board.api().onDrop(dropEventOf([corruptImageFile(), imageFile("photo.png")], 0, 0));

    expect(await screen.findByText(TYPE_MESSAGE)).toBeTruthy();
    await waitFor(() => expect(board.images()).toHaveLength(1));
    expect(board.upload.pending.map((call) => call.file.name)).toEqual(["photo.png"]);

    // Nothing was uploaded for the refused file, and nothing is on the board.
    expect(board.images()[0]!.status).toBe("uploading");
  });

  it("refuses a file the browser calls an image but whose bytes are not one", async () => {
    const board = mountInsert({ doc: new Y.Doc(), upload: fakeUpload() });
    // A PDF with an image type declared on it: `validateFiles` cannot tell, the
    // sniffer can.
    const sneaky = new File([pdfBytes()], "sneaky.png", { type: "image/png" });

    board.api().onDrop(dropEventOf([sneaky], 0, 0));

    expect(await screen.findByText(TYPE_MESSAGE)).toBeTruthy();
    expect(board.images()).toHaveLength(0);
    expect(board.upload.pending).toHaveLength(0);
  });
});
