/**
 * Story 12: the image object's render states (image.upload_states).
 *
 * Rendered by the registry bridge (ImageObjectBridge) inside the world
 * layer, sized at the object's current width/height (world units):
 *
 * - uploading + uploader:   grey box, image icon, progress bar + percentage;
 * - uploading + others:     grey box, "Uploading…";
 * - ready:                  <img> (animated GIFs play natively); a load
 *                           error degrades to the unavailable box;
 * - failed + uploader:      red-bordered box, "Upload failed", Retry (while
 *                           the file is in memory) and Remove;
 * - failed + others:        grey box, broken-image icon, "Image unavailable";
 * - unfinished (stale):     grey box, "Image upload didn't finish", Remove
 *                           (anyone).
 */
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { displayStatus, type ImageSnap } from 'src/shared/objects/image';

const IMAGE_ICON = (
  <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="#8a8f98" strokeWidth="1.5" />
    <circle cx="9" cy="10" r="2" fill="#8a8f98" />
    <path d="M5 18l5-5 4 4 3-3 2 2" fill="none" stroke="#8a8f98" strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
);

const BROKEN_ICON = (
  <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="#8a8f98" strokeWidth="1.5" />
    <line x1="5" y1="5" x2="19" y2="19" stroke="#c0392b" strokeWidth="1.5" />
  </svg>
);

interface ImageObjectProps {
  image: ImageSnap;
  /** True when this tab started the upload. */
  isUploader: boolean;
  /** Upload progress fraction (0..1); undefined when not in flight. */
  progress?: number;
  /** The file is still in memory (this tab) → Retry is offered. */
  canRetry: boolean;
  /** The 5-minute stale clock (story 12: image.unfinished). */
  now: number;
  onRetry(): void;
  onRemove(): void;
  /**
   * Story 12: the generic transform gesture (sel.all_types) — press starts
   * selection / drag like every other object type.
   */
  onPointerDown(e: React.PointerEvent<HTMLElement>): void;
}

const boxStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  backgroundColor: '#e8eaed',
  color: '#5f6368',
  fontSize: 12,
  overflow: 'hidden',
  textAlign: 'center',
  padding: 4,
  boxSizing: 'border-box',
};

const buttonStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
  borderRadius: 4,
  border: '1px solid #d0d7de',
  backgroundColor: '#ffffff',
  cursor: 'pointer',
};

export function ImageObject(props: ImageObjectProps): JSX.Element {
  const { image, isUploader, progress, canRetry, now, onRetry, onRemove, onPointerDown } = props;
  // Local load error of the stored image (degrades to "Image unavailable").
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => {
    setImgFailed(false);
  }, [image.assetKey]);

  const status = displayStatus(image, now);
  const rootStyle: React.CSSProperties = {
    position: 'absolute',
    left: image.x,
    top: image.y,
    width: image.width,
    height: image.height,
    zIndex: image.z,
  };
  const rootProps = {
    'data-image-id': image.id,
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => onPointerDown(e),
  };

  if (status === 'uploading') {
    if (isUploader) {
      const percent = Math.round((progress ?? 0) * 100);
      return (
        <div style={rootStyle} data-testid="image-placeholder" {...rootProps}>
          <div style={boxStyle}>
            {IMAGE_ICON}
            <div
              data-testid="image-upload-progress"
              style={{
                width: '70%',
                height: 6,
                backgroundColor: '#c6cad1',
                borderRadius: 3,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${percent}%`,
                  height: '100%',
                  backgroundColor: '#1A73E8',
                }}
              />
            </div>
            <span>{percent}%</span>
          </div>
        </div>
      );
    }
    return (
      <div style={rootStyle} data-testid="image-placeholder" {...rootProps}>
        <div style={boxStyle} data-testid="image-uploading">
          {IMAGE_ICON}
          <span>Uploading…</span>
        </div>
      </div>
    );
  }

  if (status === 'ready' && !imgFailed) {
    return (
      <div style={rootStyle} data-testid="image-ready" {...rootProps}>
        <img
          src={`/api/assets/${image.assetKey}`}
          alt="Image"
          draggable={false}
          decoding="async"
          loading="lazy"
          onError={() => setImgFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'fill', display: 'block' }}
        />
      </div>
    );
  }

  if (status === 'failed' && isUploader) {
    return (
      <div style={rootStyle} data-testid="image-failed" {...rootProps}>
        <div style={{ ...boxStyle, border: '2px solid #c0392b' }} onPointerDown={(e) => e.stopPropagation()}>
          <span>Upload failed</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {canRetry && (
              <button type="button" data-testid="image-retry" style={buttonStyle} onClick={onRetry}>
                Retry
              </button>
            )}
            <button type="button" data-testid="image-remove" style={buttonStyle} onClick={onRemove}>
              Remove
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'unfinished') {
    return (
      <div style={rootStyle} data-testid="image-unfinished" {...rootProps}>
        <div style={boxStyle} onPointerDown={(e) => e.stopPropagation()}>
          <span>Image upload didn't finish</span>
          <button type="button" data-testid="image-remove" style={buttonStyle} onClick={onRemove}>
            Remove
          </button>
        </div>
      </div>
    );
  }

  // failed (other users) or a ready image that failed to load: unavailable.
  return (
    <div style={rootStyle} data-testid="image-unavailable" {...rootProps}>
      <div style={boxStyle}>
        {BROKEN_ICON}
        <span>Image unavailable</span>
      </div>
    </div>
  );
}
