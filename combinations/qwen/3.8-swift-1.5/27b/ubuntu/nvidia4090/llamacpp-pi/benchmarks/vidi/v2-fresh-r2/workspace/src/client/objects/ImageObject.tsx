/**
 * Image object rendering (story 12, image.object).
 *
 * - `ImageObject` (pure, per the design contract): renders the four display
 *   states — uploading (uploader: progress; others: "Uploading…"), ready
 *   (the served image), failed (uploader: Retry/Remove; others: "Image
 *   unavailable"), and unfinished ("Image upload didn't finish" + Remove for
 *   anyone).
 * - `ImageObjectHost` (registered in the type registry): positions the object
 *   at its x/y/width/height, wires the generic move/resize gesture, and feeds
 *   the context (progress, identity, clock, retry/remove) into `ImageObject`.
 *
 * The image fills its box with object-fit:fill (the box is already sized to
 * the image's aspect ratio, so nothing is cropped). A failed <img> load
 * (e.g. the asset was purged) degrades to the "Image unavailable" box.
 */

import { createContext, useContext, useEffect, useState } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import type { ObjectProps } from './registry';
import { displayStatus, type ImageSnap } from '../../shared/objects/image';

/** Context the board provides so images can read progress / identity / clock. */
export interface ImageContextValue {
  progress: ReadonlyMap<string, number>;
  identityId: string;
  now: number;
  canRetry(id: string): boolean;
  retry(id: string): boolean;
  remove(id: string): void;
}

export const ImageContext = createContext<ImageContextValue | null>(null);

export function useImageContext(): ImageContextValue | null {
  return useContext(ImageContext);
}

interface ImageObjectProps {
  image: ImageSnap;
  isUploader: boolean;
  progress?: number;
  canRetry: boolean;
  now: number;
  onRetry(): void;
  onRemove(): void;
}

const BOX: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  backgroundColor: '#eceae6',
  border: '1px solid #c9c7c2',
  borderRadius: 4,
  color: '#555',
  fontSize: 12,
  textAlign: 'center',
  overflow: 'hidden',
  padding: 8,
};

const BUTTON: React.CSSProperties = {
  border: '1px solid #bbb',
  backgroundColor: 'white',
  borderRadius: 4,
  padding: '2px 8px',
  cursor: 'pointer',
  fontSize: 12,
};

/**
 * The four display states (pure presentational).
 */
export function ImageObject(props: ImageObjectProps): JSX.Element {
  const { image, isUploader, progress, canRetry, now, onRetry, onRemove } = props;
  const [imgError, setImgError] = useState(false);

  // Reset the load error when the asset key changes (e.g. after a retry).
  useEffect(() => {
    setImgError(false);
  }, [image.assetKey]);

  const display = displayStatus(image, now);

  if (display === 'uploading') {
    if (isUploader) {
      const pct = Math.round((progress ?? 0) * 100);
      return (
        <div data-testid="image-uploading-uploader" style={BOX}>
          <span aria-hidden="true" style={{ fontSize: 20 }}>
            🖼
          </span>
          <div
            data-testid="image-progress"
            style={{
              width: '70%',
              height: 6,
              backgroundColor: '#d5d3ce',
              borderRadius: 3,
              overflow: 'hidden',
            }}
          >
            <div
              data-testid="image-progress-fill"
              style={{
                width: `${pct}%`,
                height: '100%',
                backgroundColor: '#4a90d9',
                transition: 'width 120ms linear',
              }}
            />
          </div>
          <span data-testid="image-progress-label">{pct}%</span>
        </div>
      );
    }
    return (
      <div data-testid="image-uploading" style={BOX}>
        <span aria-hidden="true" style={{ fontSize: 20 }}>
          🖼
        </span>
        <span data-testid="image-uploading-label">Uploading…</span>
      </div>
    );
  }

  if (display === 'ready') {
    if (imgError) {
      return (
        <div data-testid="image-unavailable" style={BOX}>
          <span aria-hidden="true" style={{ fontSize: 20 }}>
            ⚠
          </span>
          <span data-testid="image-unavailable-label">Image unavailable</span>
        </div>
      );
    }
    return (
      <img
        data-testid="image-ready"
        src={`/api/assets/${image.assetKey}`}
        alt="Image"
        draggable={false}
        decoding="async"
        loading="lazy"
        onError={() => setImgError(true)}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'fill',
          display: 'block',
          borderRadius: 4,
        }}
      />
    );
  }

  if (display === 'failed') {
    if (isUploader) {
      return (
        <div
          data-testid="image-failed-uploader"
          style={{ ...BOX, border: '2px solid #d64541' }}
        >
          <span data-testid="image-failed-label">Upload failed</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {canRetry && (
              <button data-testid="image-retry" style={BUTTON} onClick={onRetry}>
                Retry
              </button>
            )}
            <button data-testid="image-remove" style={BUTTON} onClick={onRemove}>
              Remove
            </button>
          </div>
        </div>
      );
    }
    return (
      <div data-testid="image-unavailable" style={BOX}>
        <span aria-hidden="true" style={{ fontSize: 20 }}>
          ⚠
        </span>
        <span data-testid="image-unavailable-label">Image unavailable</span>
      </div>
    );
  }

  // display === 'unfinished'
  return (
    <div data-testid="image-unfinished" style={BOX}>
      <span data-testid="image-unfinished-label">Image upload didn't finish</span>
      <button data-testid="image-remove" style={BUTTON} onClick={onRemove}>
        Remove
      </button>
    </div>
  );
}

/**
 * The registered component: positions the image and wires selection/move plus
 * the context (progress, identity, clock, retry/remove).
 */
export function ImageObjectHost(props: ObjectProps): JSX.Element | null {
  const obj = props.obj as unknown as ImageSnap;
  const ctx = useImageContext();
  if (!ctx) return null;

  const isUploader = obj.uploaderId === ctx.identityId;
  const progress = ctx.progress.get(obj.id);
  const display = displayStatus(obj, ctx.now);

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    props.onObjectPointerDown(e, obj.id);
  };

  return (
    <div
      data-testid="image-object"
      data-image-id={obj.id}
      data-selected={props.selected || undefined}
      onPointerDown={handlePointerDown}
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width: obj.width,
        height: obj.height,
        pointerEvents: 'auto',
        outline: 'none',
      }}
    >
      <ImageObject
        image={obj}
        isUploader={isUploader}
        progress={progress}
        canRetry={display === 'failed' ? ctx.canRetry(obj.id) : false}
        now={ctx.now}
        onRetry={() => ctx.retry(obj.id)}
        onRemove={() => ctx.remove(obj.id)}
      />
    </div>
  );
}
