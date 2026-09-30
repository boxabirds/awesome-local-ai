/**
 * ImageObject: renders an image in its display states (story 12).
 * - uploading (uploader): grey placeholder, image icon, progress bar + percentage
 * - uploading (others): grey placeholder, "Uploading…"
 * - ready: <img> via blob URL, "Image unavailable" on load error
 * - failed (uploader): red-bordered box "Upload failed", Retry + Remove
 * - failed (others): grey box, broken-image icon, "Image unavailable"
 * - unfinished (anyone): grey box "Image upload didn't finish" + Remove
 */

import React, { useRef, useEffect, useState } from 'react';

import type { ImageSnap, DisplayStatus } from '../../shared/objects/image';
import { displayStatus } from '../../shared/objects/image';
import type { Camera } from '../canvas/camera';

interface ImageObjectProps {
  snap: ImageSnap;
  camera: Camera;
  isSelected: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
  onRetry?: (id: string) => void;
  /** Whether the current identity is the uploader of this image. */
  isUploader?: boolean;
  /** Upload progress as a percentage 0–100 (uploader only). */
  progress?: number;
  /** Whether Retry can be offered (file still in memory). */
  canRetry?: boolean;
  /** Clock value for displayStatus; defaults to Date.now(). */
  now?: number;
  /** Remove the placeholder object. */
  onRemove?: (id: string) => void;
}

/** A broken-image glyph. */
function BrokenImageIcon({ size }: { size: number }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      style={{ opacity: 0.6 }}
    >
      <rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="9" cy="9" r="1.8" fill="currentColor" />
      <path d="M4 17l4.5-4.5 3 3L16 11l4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** An image glyph. */
function ImageIcon({ size }: { size: number }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      style={{ opacity: 0.5 }}
    >
      <rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="9" cy="9" r="1.8" fill="currentColor" />
      <path d="M4 17l4.5-4.5 3 3L16 11l4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

const BTN_STYLE: React.CSSProperties = {
  fontSize: 12,
  padding: '2px 8px',
  cursor: 'pointer',
  pointerEvents: 'auto',
  border: '1px solid #999',
  borderRadius: 4,
  background: '#fff',
  color: '#222',
};

export function ImageObject({
  snap,
  isSelected,
  onPointerDown,
  onRetry,
  isUploader = false,
  progress,
  canRetry = false,
  now,
  onRemove,
}: ImageObjectProps): React.JSX.Element {
  const status: DisplayStatus = displayStatus(snap, now ?? Date.now());

  return (
    <div
      data-testid={`image-${snap.id}`}
      data-image-status={status}
      role="img"
      aria-label="Image"
      style={{
        position: 'absolute',
        left: snap.x,
        top: snap.y,
        width: snap.width,
        height: snap.height,
        zIndex: Math.round(snap.z),
        outline: isSelected ? '2px solid #4A90D9' : undefined,
        outlineOffset: 0,
        borderRadius: 2,
        overflow: 'hidden',
      }}
      onPointerDown={onPointerDown}
    >
      {status === 'ready' && snap.assetKey && (
        <ReadyImage assetKey={snap.assetKey} width={snap.width} height={snap.height} />
      )}
      {status === 'uploading' && (
        <UploadingPlaceholder
          width={snap.width}
          height={snap.height}
          isUploader={isUploader}
          progress={progress}
        />
      )}
      {status === 'failed' && (
        <FailedPlaceholder
          width={snap.width}
          height={snap.height}
          isUploader={isUploader}
          canRetry={canRetry}
          onRetry={() => onRetry?.(snap.id)}
          onRemove={() => onRemove?.(snap.id)}
        />
      )}
      {status === 'unfinished' && (
        <UnfinishedPlaceholder
          width={snap.width}
          height={snap.height}
          onRemove={() => onRemove?.(snap.id)}
        />
      )}
    </div>
  );
}

function ReadyImage({ assetKey, width, height }: { assetKey: string; width: number; height: number }) {
  const url = `/api/assets/${assetKey}`;
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const blobCacheRef = useRef<string | null>(null);

  useEffect(() => {
    // Reset local state when the asset changes.
    setError(false);

    if (blobCacheRef.current) {
      setImgSrc(blobCacheRef.current);
      return;
    }

    let cancelled = false;
    fetch(url)
      .then((resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        blobCacheRef.current = objectUrl;
        setImgSrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  // Clean up object URL on unmount
  useEffect(() => {
    return () => {
      if (blobCacheRef.current) {
        URL.revokeObjectURL(blobCacheRef.current);
      }
    };
  }, []);

  if (error) {
    return <UnavailablePlaceholder width={width} height={height} />;
  }

  if (!imgSrc) {
    return <LoadingBox width={width} height={height} />;
  }

  return (
    <img
      src={imgSrc}
      alt="Image"
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'contain',
        display: 'block',
        pointerEvents: 'auto',
      }}
      draggable={false}
      decoding="async"
      loading="lazy"
    />
  );
}

/** A neutral grey box while the ready image is still being fetched. */
function LoadingBox({ width, height }: { width: number; height: number }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#e0e0e0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#666',
      }}
    >
      <ImageIcon size={Math.max(16, Math.min(32, width / 4, height / 4))} />
    </div>
  );
}

function UploadingPlaceholder({
  width,
  height,
  isUploader,
  progress,
}: {
  width: number;
  height: number;
  isUploader: boolean;
  progress?: number;
}) {
  const iconSize = Math.max(16, Math.min(32, width / 4, height / 4));
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#e0e0e0',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: 4,
        boxSizing: 'border-box',
        color: '#555',
      }}
    >
      <ImageIcon size={iconSize} />
      {isUploader ? (
        <>
          <div
            data-testid="image-progress-bar"
            style={{
              width: '80%',
              maxWidth: 160,
              height: 6,
              backgroundColor: '#bbb',
              borderRadius: 3,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${Math.round(progress ?? 0)}%`,
                height: '100%',
                backgroundColor: '#4A90D9',
                transition: 'width 0.15s',
              }}
            />
          </div>
          <span data-testid="image-progress" style={{ fontSize: 11, color: '#444' }}>
            {Math.round(progress ?? 0)}%
          </span>
        </>
      ) : (
        <span data-testid="image-uploading-label" style={{ fontSize: 12 }}>
          Uploading…
        </span>
      )}
    </div>
  );
}

function FailedPlaceholder({
  width,
  height,
  isUploader,
  canRetry,
  onRetry,
  onRemove,
}: {
  width: number;
  height: number;
  isUploader: boolean;
  canRetry: boolean;
  onRetry(): void;
  onRemove(): void;
}) {
  // Others see "Image unavailable" for failed uploads.
  if (!isUploader) {
    return <UnavailablePlaceholder width={width} height={height} />;
  }

  const iconSize = Math.max(16, Math.min(28, width / 4, height / 4));
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        backgroundColor: '#f5e0e0',
        border: '2px solid #c00',
        borderRadius: 2,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        padding: 4,
        color: '#900',
        pointerEvents: 'auto',
      }}
    >
      <BrokenImageIcon size={iconSize} />
      <span data-testid="image-failed-label" style={{ fontSize: 12 }}>
        Upload failed
      </span>
      <div style={{ display: 'flex', gap: 6 }}>
        {canRetry && (
          <button
            data-testid="image-retry"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onRetry();
            }}
            style={BTN_STYLE}
          >
            Retry
          </button>
        )}
        <button
          data-testid="image-remove"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          style={BTN_STYLE}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

function UnfinishedPlaceholder({
  width,
  height,
  onRemove,
}: {
  width: number;
  height: number;
  onRemove(): void;
}) {
  const iconSize = Math.max(16, Math.min(28, width / 4, height / 4));
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#e0e0e0',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        padding: 4,
        boxSizing: 'border-box',
        color: '#555',
        pointerEvents: 'auto',
      }}
    >
      <BrokenImageIcon size={iconSize} />
      <span data-testid="image-unfinished-label" style={{ fontSize: 12, textAlign: 'center' }}>
        Image upload didn't finish
      </span>
      <button
        data-testid="image-remove"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        style={BTN_STYLE}
      >
        Remove
      </button>
    </div>
  );
}

function UnavailablePlaceholder({ width, height }: { width: number; height: number }) {
  const iconSize = Math.max(16, Math.min(28, width / 4, height / 4));
  return (
    <div
      data-testid="image-unavailable"
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#e0e0e0',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        color: '#666',
      }}
    >
      <BrokenImageIcon size={iconSize} />
      <span style={{ fontSize: 12 }}>Image unavailable</span>
    </div>
  );
}
