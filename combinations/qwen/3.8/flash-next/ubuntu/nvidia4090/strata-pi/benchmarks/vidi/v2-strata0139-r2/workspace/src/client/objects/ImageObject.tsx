import { createContext, useContext, useState, type ReactNode } from "react";
import type { DisplayStatus, ImageStatus } from "../../shared/objects/image";
import { displayStatus, type ImageSnap } from "../../shared/objects/image";
import { objectBounds } from "../../shared/board-model";
import type { ObjectProps } from "./registry";

/**
 * `image.uploading`, `image.upload_failure`, `image.unfinished` — one object,
 * six looks.
 *
 * Which look an image has is decided by `displayStatus` (shared with the unit
 * tests): uploading, ready, failed, or unfinished — an upload this tab cannot
 * finish, because the tab that started it is gone. On top of that the uploader
 * sees what nobody else can: a percentage, and Retry.
 *
 * The box is the object's own rectangle from the start, so a placeholder does
 * not move the layout when the bytes arrive (`image.uploading`: same size and
 * position for everyone).
 */

export interface ImageObjectProps {
  id: string;
  width: number;
  height: number;
  /** The Yjs field, not the render state. */
  status: ImageStatus;
  assetKey: string;
  uploaderId: string;
  /** Whose screen this is: it decides progress, Retry, and which words appear. */
  identityId: string;
  /** `uploadStartedAt`, measured against `now` for the unfinished state. */
  startedAt: number;
  /** Shared clock: the board re-renders on an interval while anything is uploading. */
  now: number;
  /** Only the uploader has one. */
  progress?: number | undefined;
  canRetry: boolean;
  onRetry(id: string): void;
  onRemove(id: string): void;
  alt?: string;
}

export function ImageObject(props: ImageObjectProps) {
  const { id, width, height, status, assetKey, uploaderId, identityId, startedAt, now } = props;
  const isUploader = typeof identityId === "string" && identityId.length > 0 && identityId === uploaderId;
  const display: DisplayStatus = displayStatus({ status, uploadStartedAt: startedAt }, now);
  const [brokenAsset, setBrokenAsset] = useState<string | null>(null);
  const unavailable = display === "ready" && brokenAsset === assetKey;

  const style = { width: `${width}px`, height: `${height}px` };

  if (display === "ready" && !unavailable) {
    return (
      <div className="image-object image-ready" data-testid="image-ready" style={style}>
        <img
          className="image-content"
          data-testid="image-content"
          src={absoluteAssetUrl(assetKey)}
          alt={altText(props.alt)}
          draggable={false}
          onError={() => setBrokenAsset(assetKey)}
        />
      </div>
    );
  }

  if (unavailable) {
    return (
      <div className="image-object image-unavailable" data-testid="image-unavailable" style={style}>
        <BrokenImageIcon />
        <span className="image-status-text">Image unavailable</span>
      </div>
    );
  }

  if (display === "failed" && isUploader) {
    return (
      <div className="image-object image-failed" data-testid="image-failed" style={style}>
        <BrokenImageIcon />
        <span className="image-status-text">Upload failed</span>
        <span className="image-actions" onPointerDown={(event) => event.stopPropagation()}>
          {props.canRetry ? (
            <button
              type="button"
              className="image-action"
              data-testid="image-retry"
              aria-label="Retry upload"
              onClick={() => props.onRetry(id)}
            >
              Retry
            </button>
          ) : null}
          <button
            type="button"
            className="image-action"
            data-testid="image-remove"
            aria-label="Remove image"
            onClick={() => props.onRemove(id)}
          >
            Remove
          </button>
        </span>
      </div>
    );
  }

  if (display === "failed") {
    return (
      <div className="image-object image-unavailable" data-testid="image-unavailable" style={style}>
        <BrokenImageIcon />
        <span className="image-status-text">Image unavailable</span>
      </div>
    );
  }

  if (display === "unfinished") {
    return (
      <div className="image-object image-unfinished" data-testid="image-unfinished" style={style}>
        <BrokenImageIcon />
        <span className="image-status-text">Image upload didn't finish</span>
        <span className="image-actions" onPointerDown={(event) => event.stopPropagation()}>
          <button
            type="button"
            className="image-action"
            data-testid="image-remove"
            aria-label="Remove image"
            onClick={() => props.onRemove(id)}
          >
            Remove
          </button>
        </span>
      </div>
    );
  }

  // Uploading. The uploader sees how far it has got; everyone else sees that
  // something is on its way.
  const percent = percentOf(props.progress);
  if (isUploader) {
    return (
      <div className="image-object image-uploading" data-testid="image-uploading" style={style}>
        <ImageIcon />
        <span className="image-status-text">Uploading…{percent === null ? "" : ` ${percent}%`}</span>
        <span className="image-progress" data-testid="image-progress">
          <span
            className="image-progress-bar"
            role="progressbar"
            aria-label="Upload progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent ?? 0}
            style={{ width: `${percent ?? 0}%` }}
          />
        </span>
      </div>
    );
  }

  return (
    <div className="image-object image-uploading-other" data-testid="image-other-uploading" style={style}>
      <ImageIcon />
      <span className="image-status-text">Uploading…</span>
    </div>
  );
}

// ---- board wiring -----------------------------------------------------------

/**
 * What the board provides so an image can render: whose screen this is, how far
 * each upload has got, and the two controls. The registry adapter reads it, so
 * the presentational component above needs nothing from the board itself.
 */
export interface ImageContextValue {
  identityId: string;
  progress: ReadonlyMap<string, number>;
  canRetry(id: string): boolean;
  onRetry(id: string): void;
  onRemove(id: string): void;
  /** One clock for the whole board, ticked while anything is uploading. */
  now: number;
}

const ImageContext = createContext<ImageContextValue | null>(null);

export function ImageContextProvider({
  value,
  children,
}: {
  value: ImageContextValue;
  children: ReactNode;
}) {
  return <ImageContext.Provider value={value}>{children}</ImageContext.Provider>;
}

/**
 * The registry adapter: `ObjectSnapshot` + board wiring → `ImageObject`.
 *
 * The positioned, selectable *thing on the board* is built here — the box the
 * generic gestures move and resize, the `data-note-id` the board's own tests look
 * for — and the presentational component inside it is given nothing but what a
 * picture and its state are.
 */
export function ImageBoardObject(props: ObjectProps) {
  const context = useContext(ImageContext);
  const snapshot = props.object as ImageSnap;
  const box = objectBounds(props.object);
  const status = snapshot.status ?? "uploading";
  const startedAt = snapshot.uploadStartedAt ?? 0;
  const now = context?.now ?? Date.now();
  const display = displayStatus({ status, uploadStartedAt: startedAt }, now);

  return (
    <div
      className="image-object"
      data-testid="image-object"
      data-object-type="image"
      data-note-id={snapshot.id}
      data-selected={props.selected ? "true" : "false"}
      data-dragging={props.dragging ? "true" : "false"}
      data-image-status={display}
      role="group"
      aria-label="Image"
      tabIndex={-1}
      style={{
        left: `${round(box.x)}px`,
        top: `${round(box.y)}px`,
        width: `${round(box.width)}px`,
        height: `${round(box.height)}px`,
        zIndex: snapshot.z,
      }}
      onPointerDown={(event) => props.onObjectPointerDown(event, snapshot.id)}
    >
      <ImageObject
        id={snapshot.id}
        width={box.width}
        height={box.height}
        status={status}
        assetKey={snapshot.assetKey ?? ""}
        uploaderId={snapshot.uploaderId ?? ""}
        startedAt={startedAt}
        identityId={context?.identityId ?? ""}
        now={now}
        progress={context?.progress.get(snapshot.id)}
        canRetry={context?.canRetry(snapshot.id) ?? false}
        onRetry={context?.onRetry ?? (() => undefined)}
        onRemove={context?.onRemove ?? (() => undefined)}
      />
    </div>
  );
}

// ---- small parts ------------------------------------------------------------

/** Board units become CSS pixels through the viewport's own transform. */
function absoluteAssetUrl(assetKey: string): string {
  const path = assetServeUrl(assetKey);
  if (path.length === 0) return "";
  const origin = typeof window === "undefined" ? undefined : window.location?.origin;
  if (!origin) return path;
  try {
    return new URL(path, origin).toString();
  } catch {
    return path;
  }
}

/** `GET /api/assets/<boardId>/<assetId>` — the same route the Worker serves (assets.api). */
function assetServeUrl(assetKey: string): string {
  if (typeof assetKey !== "string" || assetKey.length === 0) return "";
  return `/api/assets/${assetKey}`;
}

function percentOf(progress: number | undefined): number | null {
  if (typeof progress !== "number" || !Number.isFinite(progress)) return null;
  return Math.round(Math.min(1, Math.max(0, progress)) * 100);
}

function altText(alt: string | undefined): string {
  return typeof alt === "string" && alt.length > 0 ? alt : "Board image";
}

function ImageIcon() {
  return (
    <svg className="image-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 17l4-5 3 3.5 2-2 3 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="9" cy="9" r="1.6" fill="currentColor" />
    </svg>
  );
}

function BrokenImageIcon() {
  return (
    <svg className="image-icon image-icon-broken" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 4l16 16" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Board units to CSS pixels, the same rounding every other board object uses. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
