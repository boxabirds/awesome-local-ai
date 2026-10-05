/**
 * ImageObject: renders image board objects in all states (story 12).
 */
import { useEffect, useState } from 'react';
import {
  displayStatus,
  type ImageSnap,
} from '../../shared/objects/image';
import { IMAGE_MIN_SIZE_WORLD } from '../../shared/config';
import { hitTestBounds, type ObjectTypeSpec } from './registry';

export interface ImageObjectProps {
  image: ImageSnap;
  isUploader: boolean;
  progress?: number;
  canRetry: boolean;
  now: number;
  onRetry(): void;
  onRemove(): void;
}

/**
 * Render one image board object, switching on displayStatus.
 */
export function ImageObject(props: ImageObjectProps) {
  const { image, isUploader, progress, canRetry: canRetryFlag, now, onRetry, onRemove } = props;
  const status = displayStatus(image, now);

  if (status === 'uploading') {
    return <UploadingState image={image} isUploader={isUploader} progress={progress} />;
  }
  if (status === 'failed') {
    return <FailedState image={image} isUploader={isUploader} canRetry={canRetryFlag} onRetry={onRetry} onRemove={onRemove} />;
  }
  if (status === 'unfinished') {
    return <UnfinishedState image={image} onRemove={onRemove} />;
  }
  // ready
  return <ReadyState image={image} />;
}

function UploadingState({ image, isUploader, progress }: { image: ImageSnap; isUploader: boolean; progress?: number }) {
  const boxStyle: React.CSSProperties = {
    width: image.width,
    height: image.height,
    position: 'absolute',
    left: image.x,
    top: image.y,
    backgroundColor: '#e0e0e0',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    pointerEvents: 'auto',
  };

  if (isUploader) {
    const pct = progress != null ? Math.round(progress * 100) : 0;
    return (
      <div style={boxStyle} data-image-state="uploading" aria-label="Image">
        <span aria-hidden="true">🖼</span>
        <div className="image-progress-bar" style={{ width: '80%', height: 4, backgroundColor: '#bbb', borderRadius: 2, marginTop: 4 }}>
          <div style={{ width: `${pct}%`, height: '100%', backgroundColor: '#1976d2', borderRadius: 2, transition: 'width 0.2s' }} />
        </div>
        <span className="image-progress-text">{pct}%</span>
      </div>
    );
  }

  return (
    <div style={boxStyle} data-image-state="uploading-other" aria-label="Image">
      <span>Uploading…</span>
    </div>
  );
}

function FailedState({ image, isUploader, canRetry, onRetry, onRemove }: {
  image: ImageSnap;
  isUploader: boolean;
  canRetry: boolean;
  onRetry(): void;
  onRemove(): void;
}) {
  const boxStyle: React.CSSProperties = {
    width: image.width,
    height: image.height,
    position: 'absolute',
    left: image.x,
    top: image.y,
    backgroundColor: '#e0e0e0',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    pointerEvents: 'auto',
  };

  if (isUploader) {
    return (
      <div style={{ ...boxStyle, border: '2px solid #d32f2f' }} data-image-state="failed" aria-label="Image">
        <span>Upload failed</span>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          {canRetry && (
            <button type="button" data-image-retry="" onClick={onRetry}>Retry</button>
          )}
          <button type="button" data-image-remove="" onClick={onRemove}>Remove</button>
        </div>
      </div>
    );
  }

  return (
    <div style={boxStyle} data-image-state="unavailable" aria-label="Image">
      <span aria-hidden="true">🚫</span>
      <span>Image unavailable</span>
    </div>
  );
}

function UnfinishedState({ image, onRemove }: { image: ImageSnap; onRemove(): void }) {
  const boxStyle: React.CSSProperties = {
    width: image.width,
    height: image.height,
    position: 'absolute',
    left: image.x,
    top: image.y,
    backgroundColor: '#e0e0e0',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    pointerEvents: 'auto',
  };

  return (
    <div style={boxStyle} data-image-state="unfinished" aria-label="Image">
      <span>Image upload didn&apos;t finish</span>
      <button type="button" data-image-remove="" onClick={onRemove}>Remove</button>
    </div>
  );
}

function ReadyState({ image }: { image: ImageSnap }) {
  const [loadError, setLoadError] = useState(false);

  // Reset error state when assetKey changes
  useEffect(() => {
    setLoadError(false);
  }, [image.assetKey]);

  const boxStyle: React.CSSProperties = {
    width: image.width,
    height: image.height,
    position: 'absolute',
    left: image.x,
    top: image.y,
    overflow: 'hidden',
  };

  if (loadError || !image.assetKey) {
    return (
      <div style={{ ...boxStyle, backgroundColor: '#e0e0e0', display: 'flex', alignItems: 'center', justifyContent: 'center' }} data-image-state="unavailable" aria-label="Image">
        <span aria-hidden="true">🚫</span>
        <span>Image unavailable</span>
      </div>
    );
  }

  return (
    <div style={boxStyle} data-image-state="ready" aria-label="Image">
      <img
        src={`/api/assets/${image.assetKey}`}
        alt="Image"
        draggable={false}
        decoding="async"
        loading="lazy"
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        onError={() => setLoadError(true)}
      />
    </div>
  );
}

/**
 * The registry entry for image objects.
 *
 * Note: This component does not directly implement ObjectComponentProps.
 * The actual wrapper component (ImageObjectWrapper) reads from the snapshot
 * and connects the image-specific props.
 */
export const imageObjectType: ObjectTypeSpec = {
  Component: ImageObjectWrapper,
  resizable: true,
  aspectLocked: true,
  minSize: IMAGE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest: hitTestBounds,
};

/**
 * Wrapper that adapts ObjectComponentProps to ImageObjectProps.
 * In the full implementation, this reads image-specific fields from the snapshot.
 */
import type { ObjectComponentProps } from './registry';
import { getUploadEntry, removeUploadEntry } from '../images/retryRegistry';
import { getIdentityId } from '../identity';

function ImageObjectWrapper(props: ObjectComponentProps) {
  const { snapshot } = props;
  const image = snapshot as unknown as ImageSnap;
  const entry = getUploadEntry(image.id);
  const identityId = getIdentityId();
  const isUploader = image.uploaderId === identityId;

  const handleRetry = () => {
    entry?.retryFn();
  };

  const handleRemove = () => {
    removeUploadEntry(image.id);
    const objects = props.doc.getMap('objects');
    props.doc.transact(() => {
      objects.delete(image.id);
    });
  };

  return (
    <ImageObject
      image={image}
      isUploader={isUploader}
      progress={entry?.progress}
      canRetry={entry?.canRetry ?? false}
      now={Date.now()}
      onRetry={handleRetry}
      onRemove={handleRemove}
    />
  );
}
