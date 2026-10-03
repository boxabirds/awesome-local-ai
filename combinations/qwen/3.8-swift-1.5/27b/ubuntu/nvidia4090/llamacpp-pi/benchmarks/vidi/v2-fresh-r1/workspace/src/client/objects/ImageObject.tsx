// ImageObject: renders an image in its various states.
// Story 12.

import { useState, useCallback } from 'react';
import type { ObjectProps } from './registry';
import type { ObjectSnapshot } from '../../shared/board-model';
import { displayStatus, type ImageSnap } from '../../shared/objects/image';

interface ImageObjectExtraProps {
  isUploader: boolean;
  progress?: number;
  canRetry: boolean;
  now: number;
  onRetry: () => void;
  onRemove: () => void;
}

type ImageObjectProps = ObjectProps & ImageObjectExtraProps;

function toImageSnap(obj: ObjectSnapshot): ImageSnap {
  return {
    id: obj.id,
    type: 'image',
    x: obj.x,
    y: obj.y,
    z: obj.z,
    createdAt: obj.createdAt,
    width: obj.width ?? 0,
    height: obj.height ?? 0,
    assetKey: (obj as any).assetKey ?? null,
    contentType: (obj as any).contentType ?? '',
    naturalWidth: (obj as any).naturalWidth ?? 0,
    naturalHeight: (obj as any).naturalHeight ?? 0,
    status: (obj as any).status ?? 'uploading',
    uploadStartedAt: (obj as any).uploadStartedAt ?? 0,
    uploaderId: (obj as any).uploaderId ?? '',
  };
}

export function ImageObject(props: ImageObjectProps) {
  const { obj, selected, isUploader, progress, canRetry, now, onRetry, onRemove, onObjectPointerDown } = props;
  const [loadError, setLoadError] = useState(false);

  const snap = toImageSnap(obj);
  const status = displayStatus(snap, now);

  // Reset load error when assetKey changes (e.g. after retry)
  const handleAssetKeyChange = useCallback(() => {
    setLoadError(false);
  }, []);

  const handleImgError = useCallback(() => {
    setLoadError(true);
  }, []);

  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  };

  let content: React.ReactNode;

  switch (status) {
    case 'uploading':
      if (isUploader) {
        const pct = Math.round((progress ?? 0) * 100);
        content = (
          <div data-testid="image-uploading-uploader" style={{
            ...baseStyle,
            backgroundColor: '#E0E0E0',
            flexDirection: 'column',
            gap: '8px',
          }}>
            <span style={{ fontSize: '24px' }}>🖼️</span>
            <div
              data-testid="image-progress-bar"
              style={{
                width: '60%',
                height: '6px',
                backgroundColor: '#BDBDBD',
                borderRadius: '3px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  backgroundColor: '#1976D2',
                  transition: 'width 0.2s',
                }}
              />
            </div>
            <span data-testid="image-progress-text" style={{ fontSize: '12px', color: '#555' }}>
              {pct}%
            </span>
          </div>
        );
      } else {
        content = (
          <div data-testid="image-uploading-other" style={{
            ...baseStyle,
            backgroundColor: '#E0E0E0',
          }}>
            <span style={{ fontSize: '13px', color: '#555' }}>Uploading…</span>
          </div>
        );
      }
      break;

    case 'ready':
      if (loadError || !snap.assetKey) {
        content = <UnavailableBox />;
      } else {
        content = (
          <img
            src={`/api/assets/${snap.assetKey}`}
            alt="Image"
            draggable={false}
            decoding="async"
            loading="lazy"
            onError={handleImgError}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'fill',
            }}
          />
        );
      }
      break;

    case 'failed':
      if (isUploader) {
        content = (
          <div
            data-testid="image-failed-uploader"
            style={{
              ...baseStyle,
              backgroundColor: '#FFEBEE',
              border: '2px solid #E53935',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            <span style={{ fontSize: '12px', color: '#C62828' }}>Upload failed</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              {canRetry && (
                <button
                  data-testid="image-retry-btn"
                  onClick={(e) => { e.stopPropagation(); onRetry(); }}
                  style={smallBtnStyle}
                >
                  Retry
                </button>
              )}
              <button
                data-testid="image-remove-btn"
                onClick={(e) => { e.stopPropagation(); onRemove(); }}
                style={smallBtnStyle}
              >
                Remove
              </button>
            </div>
          </div>
        );
      } else {
        content = <UnavailableBox />;
      }
      break;

    case 'unfinished':
      content = (
        <div
          data-testid="image-unfinished"
          style={{
            ...baseStyle,
            backgroundColor: '#E0E0E0',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          <span style={{ fontSize: '12px', color: '#555' }}>Image upload didn't finish</span>
          <button
            data-testid="image-remove-btn"
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            style={smallBtnStyle}
          >
            Remove
          </button>
        </div>
      );
      break;
  }

  return (
    <div
      data-testid={`image-object-${obj.id}`}
      data-image-id={obj.id}
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width: obj.width,
        height: obj.height,
        pointerEvents: 'auto',
        cursor: 'move',
        outline: selected ? '2px solid #1976D2' : 'none',
      }}
      onPointerDown={(e) => onObjectPointerDown(e, obj.id)}
    >
      {content}
    </div>
  );
}

function UnavailableBox() {
  return (
    <div
      data-testid="image-unavailable"
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#E0E0E0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: '4px',
      }}
    >
      <span style={{ fontSize: '20px' }}>⚠️</span>
      <span style={{ fontSize: '12px', color: '#555' }}>Image unavailable</span>
    </div>
  );
}

const smallBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: '11px',
  border: '1px solid #999',
  borderRadius: '4px',
  backgroundColor: 'white',
  cursor: 'pointer',
};
