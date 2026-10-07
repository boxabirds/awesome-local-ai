import * as Y from "yjs";
import { LOCAL_ORIGIN, type ObjectSnapshot } from "../board-model";
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from "../config";
import type { Point, Rect } from "../geometry";

/**
 * `image.model` — an image on the board, and the states it passes through.
 *
 * An image is an ordinary board object (position, size, z, createdAt) plus the
 * five fields that describe its upload:
 *
 *   `assetKey`        `<boardId>/<assetId>` once the file is stored; `null` while
 *                     it is not (`assets.api`)
 *   `contentType`     what the Worker sniffed and stored it as
 *   `naturalWidth/…`  the file's own pixel dimensions, kept so a later story can
 *                     show the real size and so a resize never loses the ratio
 *   `status`          `uploading` → `ready` | `failed`
 *   `uploadStartedAt` when this upload began, which is what makes an abandoned
 *                     one visible as `unfinished` (`image.unfinished`)
 *   `uploaderId`      whose upload this is, so only they see progress, Retry
 *
 * **Undo.** Creating the placeholders for one add action is one
 * `LOCAL_ORIGIN` transaction: one undo step, exactly as `undo.add` asks
 * (`image.shared`, Constraints). `markImageReady` / `markImageFailed` /
 * `markImageRetrying` are tagged with `UPLOAD_ORIGIN`, which no `UndoManager`
 * tracks — so an upload finishing later is never a second step, and undoing an
 * insertion takes the whole add back in one go.
 */

export const IMAGE_TYPE = "image";

/** Origin for upload bookkeeping. Deliberately *not* in any UndoManager's scope. */
export const UPLOAD_ORIGIN: unique symbol = Symbol("vidi6-upload");

export type ImageStatus = "uploading" | "ready" | "failed";
/** `failed` is what the document stores; `unfinished` is what a *clock* turns it into. */
export type DisplayStatus = ImageStatus | "unfinished";

/** An image as the board snapshot reports it. */
export interface ImageSnap extends ObjectSnapshot {
  readonly type: "image";
  /** A placeholder always carries its box, from the moment it is created. */
  readonly width: number;
  readonly height: number;
  readonly assetKey: string | null;
  readonly contentType: string;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly status: ImageStatus;
  readonly uploadStartedAt: number;
  readonly uploaderId: string;
}

/** A width and a height, with no position in it. */
export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

/** One image `createImagePlaceholders` is asked to place. */
export interface ImagePlacement {
  readonly rect: Rect;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly contentType: string;
}

/**
 * `image.placement_size`: an image is placed at its natural pixel size — one
 * pixel, one board unit — and scaled down (never up) so its longest side is at
 * most `IMAGE_MAX_PLACE_SIZE_WORLD`. Both sides move by the same factor, so the
 * proportions survive.
 */
export function placementSize(naturalWidth: number, naturalHeight: number): ImageSize {
  if (!isFinitePositive(naturalWidth) || !isFinitePositive(naturalHeight)) {
    return { width: 0, height: 0 };
  }
  const longest = Math.max(naturalWidth, naturalHeight);
  const factor = longest > IMAGE_MAX_PLACE_SIZE_WORLD ? IMAGE_MAX_PLACE_SIZE_WORLD / longest : 1;
  return { width: round6(naturalWidth * factor), height: round6(naturalHeight * factor) };
}

/**
 * The row several images are placed in: left to right, tops aligned, separated
 * by `IMAGE_LAYOUT_GAP_WORLD` (`image.drop`).
 *
 * `start` means two things depending on the anchor. For a **drop** it is the top
 * left corner of the first image; for a **pick or paste** the whole row — its
 * width and its tallest image — is centred on it.
 */
export function layoutRow(sizes: readonly ImageSize[], start: Point, anchor: "top-left" | "centre"): Rect[] {
  const usable = (sizes ?? []).filter((size) => isFinitePositive(size?.width) && isFinitePositive(size?.height));
  if (usable.length === 0 || !isFiniteNumber(start?.x) || !isFiniteNumber(start?.y)) return [];

  const totalWidth =
    usable.reduce((total, size) => total + size.width, 0) + IMAGE_LAYOUT_GAP_WORLD * (usable.length - 1);
  const tallest = usable.reduce((tallest, size) => Math.max(tallest, size.height), 0);

  let x = start.x;
  let y = start.y;
  if (anchor === "centre") {
    x = start.x - totalWidth / 2;
    y = start.y - tallest / 2;
  }

  const rects: Rect[] = [];
  for (const size of usable) {
    rects.push({ x: round6(x), y: round6(y), width: round6(size.width), height: round6(size.height) });
    x += size.width + IMAGE_LAYOUT_GAP_WORLD;
  }
  return rects;
}

/**
 * Creates one placeholder per placement, in a single `LOCAL_ORIGIN` transaction
 * — the whole add action is therefore one undo step and one broadcast.
 *
 * @returns the new ids, in placement order. An item whose box is not usable is
 *          skipped and gets no id.
 */
export function createImagePlaceholders(
  doc: Y.Doc,
  items: readonly ImagePlacement[],
  uploaderId: string,
  now: number,
): string[] {
  const usable = (items ?? []).filter(
    (item) =>
      isFiniteNumber(item?.rect?.x) &&
      isFiniteNumber(item?.rect?.y) &&
      isFinitePositive(item?.rect?.width) &&
      isFinitePositive(item?.rect?.height),
  );
  if (usable.length === 0) return [];

  const objects = doc.getMap<Y.Map<unknown>>("objects");
  const created = new Date();
  const startedAt = isFiniteNumber(now) ? now : created.getTime();
  const by = typeof uploaderId === "string" ? uploaderId : "";

  const ids: string[] = [];
  doc.transact(() => {
    let z = maxZ(objects);
    for (const item of usable) {
      const id = newId();
      z += 1;
      const entry = new Y.Map<unknown>();
      entry.set("type", IMAGE_TYPE);
      entry.set("x", item.rect.x);
      entry.set("y", item.rect.y);
      entry.set("width", item.rect.width);
      entry.set("height", item.rect.height);
      entry.set("z", z);
      entry.set("createdAt", created.getTime());
      entry.set("createdBy", by);
      entry.set("assetKey", null);
      entry.set("contentType", typeof item.contentType === "string" ? item.contentType : "image/png");
      entry.set("naturalWidth", item.naturalWidth);
      entry.set("naturalHeight", item.naturalHeight);
      entry.set("status", "uploading");
      entry.set("uploadStartedAt", startedAt);
      entry.set("uploaderId", by);
      objects.set(id, entry);
      ids.push(id);
    }
  }, LOCAL_ORIGIN);

  return ids;
}

/**
 * The upload finished: the placeholder becomes the image, for everyone.
 *
 * Tagged `UPLOAD_ORIGIN`, so it is not a second undo step.
 *
 * @returns false when the id is gone (deleted, undone, or never an image).
 */
export function markImageReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const entry = imageEntry(doc, id);
  if (!entry) return false;
  if (typeof assetKey !== "string" || assetKey.length === 0) return false;
  if (entry.get("status") === "ready" && entry.get("assetKey") === assetKey) return false;

  doc.transact(() => {
    entry.set("status", "ready");
    entry.set("assetKey", assetKey);
  }, UPLOAD_ORIGIN);
  return true;
}

/** The upload failed. The placeholder stays, and renders as a failure. */
export function markImageFailed(doc: Y.Doc, id: string): boolean {
  const entry = imageEntry(doc, id);
  if (!entry) return false;
  if (entry.get("status") === "failed") return false;

  doc.transact(() => {
    entry.set("status", "failed");
    entry.set("assetKey", null);
  }, UPLOAD_ORIGIN);
  return true;
}

/** Retry: back to `uploading`, with a fresh clock so `unfinished` cannot fire early. */
export function markImageRetrying(doc: Y.Doc, id: string, now: number): boolean {
  const entry = imageEntry(doc, id);
  if (!entry) return false;

  const startedAt = isFiniteNumber(now) ? now : Date.now();
  doc.transact(() => {
    entry.set("status", "uploading");
    entry.set("assetKey", null);
    entry.set("uploadStartedAt", startedAt);
  }, UPLOAD_ORIGIN);
  return true;
}

/**
 * What a viewer sees, which is not always what the document says: an upload
 * that has been `uploading` for more than `IMAGE_UPLOAD_STALE_MS` has been
 * abandoned (its uploader reloaded or closed the page) and is shown as
 * `unfinished` instead of a permanent "Uploading…" (`image.unfinished`).
 */
export function displayStatus(image: ImageSnap | Pick<ImageSnap, "status" | "uploadStartedAt">, now: number): DisplayStatus {
  const status = image?.status;
  if (status === "ready") return "ready";
  if (status === "failed") return "failed";
  const startedAt = isFiniteNumber(image?.uploadStartedAt) ? image.uploadStartedAt : 0;
  const age = (isFiniteNumber(now) ? now : Date.now()) - startedAt;
  return age > IMAGE_UPLOAD_STALE_MS ? "unfinished" : "uploading";
}

/** True when a snapshot is an image this client can render. */
export function isImageSnapshot(object: ObjectSnapshot | undefined): object is ImageSnap {
  return object?.type === IMAGE_TYPE;
}

// ---- internals ------------------------------------------------------------

function imageEntry(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  if (typeof id !== "string" || id.length === 0) return undefined;
  const entry = doc.getMap<Y.Map<unknown>>("objects").get(id);
  if (!(entry instanceof Y.Map)) return undefined;
  return entry.get("type") === IMAGE_TYPE ? entry : undefined;
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  for (const value of objects.values()) {
    if (!(value instanceof Y.Map)) continue;
    const z = value.get("z");
    if (isFiniteNumber(z) && z > max) max = z;
  }
  return max;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isFinitePositive(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function newId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
