import { useEffect, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react';
import { displayStatus, type ImageSnap } from '../../shared/objects/image';
import { useImageContext } from '../images/useImageInsert';
import type { ObjectProps } from './registry';

/**
 * Image object rendering (story 12, image.object). One rendering per
 * displayStatus:
 *
 * - uploading: grey box of the object size; the uploader sees an image icon
 *   + progress bar with the percentage, everyone else "Uploading…".
 * - ready: the stored image (`/api/assets/<assetKey>`); a load error swaps in
 *   the "Image unavailable" box locally (and clears when the assetKey changes).
 * - failed: the uploader sees a red-bordered "Upload failed" with Retry (only
 *   while the file is still in memory) and Remove; everyone else sees
 *   "Image unavailable".
 * - unfinished: "Image upload didn't finish" with Remove (anyone).
 *
 * Errors are handled locally and never propagate (image.unavailable).
 */

export interface ImageObjectProps {
  image: ImageSnap;
  /** True when this client is the uploader of this image. */
  isUploader: boolean;
  /** Upload progress 0..1 (uploader only). */
  progress?: number;
  /** True while the failed upload's file is still in memory (Retry offered). */
  canRetry: boolean;
  /** The render clock (for the derived `unfinished` status). */
  now: number;
  onRetry(): void;
  onRemove(): void;
}

const BOX: React.CSSProperties = {
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  fontFamily: 'system-ui, sans-serif',
};

/** A small broken-image glyph (shared by the unavailable/failed-other states). */
function BrokenImageIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="#9E9E9E" strokeWidth="1.5" />
      <path d="M3 17l5-5 4 4 3-3 6 6" fill="none" stroke="#9E9E9E" strokeWidth="1.5" />
      <line x1="4" y1="3" x2="20" y2="21" stroke="#E53935" strokeWidth="1.5" />
    </svg>
  );
}

/** The "Image unavailable" box at the image's size (image.unavailable). */
function UnavailableBox({ width, height }: { width: number; height: number }) {
  return (
    <div
      data-testid="image-unavailable"
      role="img"
      aria-label="Image unavailable"
      style={{
        ...BOX,
        width,
        height,
        background: '#EEEEEE',
        border: '1px solid #BDBDBD',
        color: '#616161',
        fontSize: 12,
      }}
    >
      <BrokenImageIcon />
      <span>Image unavailable</span>
    </div>
  );
}

export function ImageObject(props: ImageObjectProps): JSX.Element {
  const { image, isUploader, progress, canRetry, now, onRetry, onRemove } = props;
  const width = image.width ?? 0;
  const height = image.height ?? 0;
  const status = displayStatus(image, now);

  // Local load error (ready → unavailable). Reset when the asset changes so a
  // later load can succeed again (Unavailable → Ready in the state diagram).
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    setLoadError(false);
  }, [image.assetKey]);

  switch (status) {
    case 'uploading': {
      if (isUploader) {
        const pct = Math.round((progress ?? 0) * 100);
        return (
          <div
            data-testid="image-uploading"
            style={{
              ...BOX,
              width,
              height,
              background: '#E0E0E0',
              color: '#424242',
              fontSize: 12,
            }}
          >
            <span aria-hidden="true" style={{ fontSize: 24 }}>
              🖼️
            </span>
            <div
              data-testid="image-progress-bar"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Upload progress"
              style={{ width: '60%', height: 6, background: '#BDBDBD', borderRadius: 3, overflow: 'hidden' }}
            >
              <div style={{ width: `${pct}%`, height: '100%', background: '#1A73E8' }} />
            </div>
            <span data-testid="image-progress">{pct}%</span>
          </div>
        );
      }
      return (
        <div
          data-testid="image-uploading"
          style={{ ...BOX, width, height, background: '#E0E0E0', color: '#424242', fontSize: 12 }}
        >
          Uploading…
        </div>
      );
    }
    case 'ready': {
      if (loadError || !image.assetKey) {
        return <UnavailableBox width={width} height={height} />;
      }
      return (
        <img
          data-testid="image-ready"
          src={`/api/assets/${image.assetKey}`}
          alt="Image"
          draggable={false}
          decoding="async"
          loading="lazy"
          onError={() => setLoadError(true)}
          style={{ width, height, display: 'block', objectFit: 'fill' }}
        />
      );
    }
    case 'failed': {
      if (isUploader) {
        return (
          <div
            data-testid="image-failed"
            style={{
              ...BOX,
              width,
              height,
              background: '#FFEBEE',
              border: '2px solid #E53935',
              color: '#B71C1C',
              fontSize: 12,
            }}
          >
            <span>Upload failed</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {canRetry && (
                <button
                  type="button"
                  data-testid="image-retry"
                  aria-label="Retry"
                  onClick={onRetry}
                  style={buttonStyle}
                >
                  Retry
                </button>
              )}
              <button
                type="button"
                data-testid="image-remove"
                aria-label="Remove"
                onClick={onRemove}
                style={buttonStyle}
              >
                Remove
              </button>
            </div>
          </div>
        );
      }
      return <UnavailableBox width={width} height={height} />;
    }
    case 'unfinished':
      return (
        <div
          data-testid="image-unfinished"
          style={{ ...BOX, width, height, background: '#EEEEEE', color: '#616161', fontSize: 12 }}
        >
          <span>Image upload didn&apos;t finish</span>
          <button
            type="button"
            data-testid="image-remove"
            aria-label="Remove"
            onClick={onRemove}
            style={buttonStyle}
          >
            Remove
          </button>
        </div>
      );
  }
}

const buttonStyle: React.CSSProperties = {
  border: '1px solid #9E9E9E',
  background: 'white',
  borderRadius: 4,
  padding: '2px 10px',
  cursor: 'pointer',
  fontSize: 12,
};

// ---------------------------------------------------------------------------
// Registry adapter: ObjectProps → ImageObject. Adds the positioned container
// (selection/drag via the generic story 7 gesture), the uploader identity and
// the 30-second clock that makes `unfinished` appear without interaction.
// ---------------------------------------------------------------------------

const UNFINISHED_TICK_MS = 30_000;

export function ImageObjectAdapter(props: ObjectProps): JSX.Element {
  const ctx = useImageContext();
  const image = props.obj as ImageSnap;
  const [now, setNow] = useState(() => Date.now());
  const status = displayStatus(image, now);

  // While any image is uploading, tick every 30 s so the stale placeholder
  // flips to "didn't finish" without interaction.
  useEffect(() => {
    if (status !== 'uploading') return;
    const t = setInterval(() => setNow(Date.now()), UNFINISHED_TICK_MS);
    return () => clearInterval(t);
  }, [status]);

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation(); // interacting with an image never pans the board
    e.preventDefault();
    props.onObjectPointerDown(e, image.id);
  };

  return (
    <div
      data-image-id={image.id}
      data-selected={props.selected ? 'true' : undefined}
      data-dragging={props.dragging || undefined}
      onPointerDown={handlePointerDown}
      style={{
        position: 'absolute',
        left: image.x,
        top: image.y,
        width: image.width,
        height: image.height,
        cursor: props.dragging ? 'grabbing' : 'grab',
        userSelect: 'none',
      }}
    >
      <ImageObject
        image={image}
        isUploader={image.uploaderId === ctx.identityId}
        progress={ctx.progress.get(image.id)}
        canRetry={ctx.canRetry(image.id)}
        now={now}
        onRetry={() => ctx.retry(image.id)}
        onRemove={() => ctx.onRemoveImage(image.id)}
      />
    </div>
  );
}
