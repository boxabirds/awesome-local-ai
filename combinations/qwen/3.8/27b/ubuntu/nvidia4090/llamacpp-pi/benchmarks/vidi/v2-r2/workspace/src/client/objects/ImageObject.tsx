/**
 * ImageObject component (story 12, image.object).
 *
 * Renders one of five states based on displayStatus:
 * - uploading: grey box with progress (uploader) or "Uploading…" (others)
 * - ready: the actual <img> element
 * - failed: red-bordered "Upload failed" + Retry/Remove (uploader),
 *           or "Image unavailable" (others)
 * - unfinished: "Image upload didn't finish" + Remove (anyone)
 * - unavailable: grey box with broken-image icon, "Image unavailable"
 *
 * Receives standard ObjectProps from the registry + reads image-specific
 * state (progress, retry, identity) from ImageInsertContext.
 */

import { useCallback, useRef, useState, type JSX } from 'react';
import type { ObjectProps } from './registry';
import type { ImageSnap } from '../../shared/objects/image';
import { displayStatus, imageSnapshot } from '../../shared/objects/image';
import { useImageInsertContext } from '../images/ImageContext';

export function ImageObject(props: ObjectProps): JSX.Element | null {
  const { doc, obj, selected, onPointerDown } = props;
  const { uploaderId, progress, canRetry, retry, remove, now } = useImageInsertContext();

  // Read image-specific fields from the Y.Doc (not in the generic snapshot).
  const snap = imageSnapshot(doc, obj.id);
  const image: ImageSnap = snap ?? ({
    id: obj.id,
    x: obj.x,
    y: obj.y,
    z: obj.z,
    width: obj.width ?? 1,
    height: obj.height ?? 1,
    status: 'ready',
    uploadStartedAt: 0,
    uploaderId: '',
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: obj.width ?? 1,
    naturalHeight: obj.height ?? 1,
  } as ImageSnap);
  const isUploader = image.uploaderId === uploaderId;
  const imageProgress = progress.get(image.id) ?? 0;
  const canRetryId = canRetry(image.id);

  const status = displayStatus(image, now);
  const [loadError, setLoadError] = useState(false);

  // Reset loadError when the assetKey changes
  const assetKeyRef = useRef(image.assetKey);
  if (assetKeyRef.current !== image.assetKey) {
    assetKeyRef.current = image.assetKey;
    if (loadError) {
      setLoadError(false);
    }
  }

  const width = image.width ?? image.naturalWidth;
  const height = image.height ?? image.naturalHeight;

  const handleRetry = useCallback((): void => {
    retry(image.id);
  }, [image.id, retry]);

  const handleRemove = useCallback((): void => {
    remove(image.id);
  }, [image.id, remove]);

  const imgError = useCallback(() => {
    setLoadError(true);
  }, []);

  // Common box style (position in world coordinates)
  const boxStyle: React.CSSProperties = {
    position: 'absolute',
    left: image.x,
    top: image.y,
    width,
    height,
    borderRadius: 4,
    overflow: 'hidden',
  };

  // Selection outline
  if (selected) {
    boxStyle.outline = '2px solid #1a73e8';
    boxStyle.outlineOffset = 1;
  }

  switch (status) {
    case 'uploading': {
      return (
        <div
          data-testid="image-uploading"
          data-image-id={image.id}
          onPointerDown={(e) => onPointerDown(e as never, image.id)}
          style={{
            ...boxStyle,
            background: '#e8e8e4',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            border: '1px solid #d0d0c8',
          }}
          aria-label="Image"
        >
          {isUploader ? (
            <>
              <ImageIcon />
              <div
                data-testid="image-progress"
                style={{
                  width: '80%',
                  height: 6,
                  background: '#d0d0c8',
                  borderRadius: 3,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${Math.round(imageProgress * 100)}%`,
                    height: '100%',
                    background: '#1a73e8',
                    transition: 'width 0.1s',
                  }}
                />
              </div>
              <span data-testid="image-progress-text" style={{ fontSize: 12, color: '#555' }}>
                {Math.round(imageProgress * 100)}%
              </span>
            </>
          ) : (
            <span data-testid="image-uploading-text" style={{ fontSize: 14, color: '#555' }}>
              Uploading…
            </span>
          )}
        </div>
      );
    }

    case 'ready': {
      if (image.assetKey === null || loadError) {
        return (
          <div
            data-testid="image-unavailable"
            data-image-id={image.id}
            onPointerDown={(e) => onPointerDown(e as never, image.id)}
            style={{
              ...boxStyle,
              background: '#f0f0ec',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              border: '1px solid #d0d0c8',
            }}
            aria-label="Image unavailable"
          >
            <BrokenImageIcon />
            <span style={{ fontSize: 13, color: '#777' }}>Image unavailable</span>
          </div>
        );
      }
      return (
        <div
          data-testid="image-ready"
          data-image-id={image.id}
          onPointerDown={(e) => onPointerDown(e as never, image.id)}
          style={boxStyle}
          aria-label="Image"
        >
          <img
            src={`/api/assets/${image.assetKey}`}
            alt="Image"
            draggable={false}
            decoding="async"
            loading="lazy"
            onError={imgError}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'fill',
              display: 'block',
              pointerEvents: 'none',
            }}
          />
        </div>
      );
    }

    case 'failed': {
      if (isUploader) {
        return (
          <div
            data-testid="image-failed"
            data-image-id={image.id}
            style={{
              ...boxStyle,
              background: '#fff5f5',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              border: '2px solid #dc2626',
            }}
            aria-label="Upload failed"
          >
            <span data-testid="image-failed-text" style={{ fontSize: 14, color: '#dc2626', fontWeight: 500 }}>
              Upload failed
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              {canRetryId && (
                <button
                  type="button"
                  data-testid="image-retry"
                  onClick={handleRetry}
                  style={{
                    padding: '4px 12px',
                    fontSize: 13,
                    border: '1px solid #ccc',
                    borderRadius: 4,
                    background: '#fff',
                    cursor: 'pointer',
                  }}
                >
                  Retry
                </button>
              )}
              <button
                type="button"
                data-testid="image-remove"
                onClick={handleRemove}
                style={{
                  padding: '4px 12px',
                  fontSize: 13,
                  border: '1px solid #ccc',
                  borderRadius: 4,
                  background: '#fff',
                  cursor: 'pointer',
                }}
              >
                Remove
              </button>
            </div>
          </div>
        );
      }
      return (
        <div
          data-testid="image-unavailable"
          data-image-id={image.id}
          style={{
            ...boxStyle,
            background: '#f0f0ec',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            border: '1px solid #d0d0c8',
          }}
          aria-label="Image unavailable"
        >
          <BrokenImageIcon />
          <span style={{ fontSize: 13, color: '#777' }}>Image unavailable</span>
        </div>
      );
    }

    case 'unfinished': {
      return (
        <div
          data-testid="image-unfinished"
          data-image-id={image.id}
          style={{
            ...boxStyle,
            background: '#f0f0ec',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            border: '1px solid #d0d0c8',
          }}
          aria-label="Image upload didn't finish"
        >
          <BrokenImageIcon />
          <span data-testid="image-unfinished-text" style={{ fontSize: 13, color: '#777' }}>
            Image upload didn't finish
          </span>
          <button
            type="button"
            data-testid="image-remove"
            onClick={handleRemove}
            style={{
              padding: '4px 12px',
              fontSize: 13,
              border: '1px solid #ccc',
              borderRadius: 4,
              background: '#fff',
              cursor: 'pointer',
            }}
          >
            Remove
          </button>
        </div>
      );
    }
    default:
      return null;
  }
}

function ImageIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="1.5">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  );
}

function BrokenImageIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#aaa" strokeWidth="1.5">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 3l18 18" />
      <path d="M21 3l-18 18" />
    </svg>
  );
}
