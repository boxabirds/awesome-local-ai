/**
 * One image on the board, in whichever of its five states it is in (`image.object`).
 *
 * The file has two halves, and the split is the one the board already makes: `ImageObject` is
 * a rendering of a state — give it a snapshot, a clock and two callbacks and it says what this
 * image currently is — and `BoardImageObject` is the object the board draws: positioned in the
 * world layer, selectable, movable, resizable, with its size taken from the document like
 * every other type's. The first is testable without a board; the second is what makes an image
 * behave like a note when a person drags it.
 *
 * The states come from `displayStatus`, which is where the document's three statuses and the
 * clock meet. What each one *says* is a decision worth spelling out, because a person looking
 * at a grey box has no other way to know what it means:
 *
 * | Status       | The uploader, this tab                     | Everybody else              |
 * |--------------|--------------------------------------------|-----------------------------|
 * | `uploading`  | "Uploading 42%" — bytes sent               | "Uploading…"                |
 * | `ready`      | the picture                                | the picture                 |
 * | `failed`     | "Upload failed", Retry, Remove             | "Image unavailable"         |
 * | `unfinished` | "Image upload didn't finish", Remove       | the same                    |
 * | load error   | "Image unavailable"                        | the same                    |
 *
 * Progress is only shown where it exists: it is this tab's XHR reporting (`image.uploading`),
 * and everybody else is told the truth they can act on — that something is coming — without a
 * number that would have to be synced to be seen.
 *
 * The last row is the reason this component owns an `onError`. A stored key that 404s, or a
 * file that turned out not to decode, fails *on the way in*, long after the document said it
 * was ready — and the board's job then is to mark that one rectangle as unavailable and let
 * the other nineteen pictures and notes on the board carry on (`image.unavailable`).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

import { displayStatus, type ImageSnapshot } from '../../shared/objects/image';
import { assetUrl } from '../../shared/image-format';
import type { ObjectProps } from './registry';

/** How often a board with an upload running re-checks the clock for `unfinished`. */
const IMAGE_STATUS_TICK_MS = 30_000;

/** What `ImageObject` needs to render one image. */
export interface ImageObjectProps {
  image: ImageSnapshot;
  /** Is this the person whose upload it is? Only they get Retry and a percentage. */
  isUploader: boolean;
  /** 0–1 for an upload this tab is running. */
  progress?: number;
  /** Retry has a file to retry (`image.upload_failure`). */
  canRetry: boolean;
  /** The clock `displayStatus` is read against. */
  now: number;
  onRetry(): void;
  onRemove(): void;
}

/** A grey box with a line of words in it: every state that is not a picture looks like this. */
function StateBox({
  status,
  tone,
  children,
}: {
  status: string;
  tone?: 'failed';
  children: ReactNode;
}) {
  return (
    <div
      className={`image-object__state${tone ? ` image-object__state--${tone}` : ''}`}
      data-image-state={status}
    >
      {children}
    </div>
  );
}

/** The cracked frame that stands in for a picture that will not load. */
function BrokenImageIcon() {
  return (
    <svg
      className="image-object__icon"
      width="28"
      height="28"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="2.5"
        y="4.5"
        width="19"
        height="15"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M3 16l5-5 4 4 2.5-2.5L21 17"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M4 20L20 4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/** "Uploading 42%" here, "Uploading…" everywhere else (`image.uploading`). */
function Uploading({ isUploader, progress }: { isUploader: boolean; progress?: number }) {
  const percent =
    typeof progress === 'number' && Number.isFinite(progress)
      ? Math.max(0, Math.min(100, Math.round(progress * 100)))
      : null;
  return (
    <StateBox status="uploading">
      <span className="image-object__text">
        {isUploader && percent !== null ? `Uploading ${percent}%` : 'Uploading\u2026'}
      </span>
      {isUploader && percent !== null ? (
        <span className="image-object__bar" aria-hidden="true">
          <span className="image-object__bar-fill" style={{ width: `${percent}%` }} />
        </span>
      ) : null}
    </StateBox>
  );
}

/** The controls that live inside a failed or unfinished image. */
function ImageActions({
  onRetry,
  onRemove,
  showRetry,
}: {
  onRetry(): void;
  onRemove(): void;
  showRetry: boolean;
}) {
  return (
    <span className="image-object__actions">
      {showRetry ? (
        <button
          type="button"
          className="image-object__button"
          data-testid="image-retry"
          onClick={onRetry}
        >
          Retry
        </button>
      ) : null}
      <button
        type="button"
        className="image-object__button"
        data-testid="image-remove"
        onClick={onRemove}
      >
        Remove
      </button>
    </span>
  );
}

/**
 * The state renderer. It fills whatever box it is put in, so `BoardImageObject` decides the
 * size and this decides the meaning.
 */
export function ImageObject(props: ImageObjectProps): JSX.Element {
  const { image, isUploader, progress, canRetry, now, onRetry, onRemove } = props;
  // A picture that fails to load fails on this screen only: the document still says `ready`,
  // because the document is not wrong about the bytes it was given (`image.unavailable`).
  const [loadFailed, setLoadFailed] = useState(false);
  const status = displayStatus(image, now);

  useEffect(() => {
    // A Retry that worked, or an object whose key changed, deserves another attempt at the
    // URL rather than keeping the grey box from the last one.
    setLoadFailed(false);
  }, [image.assetKey, status]);

  if (status === 'uploading') return <Uploading isUploader={isUploader} progress={progress} />;

  if (status === 'unfinished') {
    return (
      <StateBox status="unfinished">
        <BrokenImageIcon />
        <span className="image-object__text">Image upload didn&rsquo;t finish</span>
        <ImageActions onRetry={onRetry} onRemove={onRemove} showRetry={false} />
      </StateBox>
    );
  }

  if (status === 'failed') {
    if (!isUploader) {
      return (
        <StateBox status="unavailable">
          <BrokenImageIcon />
          <span className="image-object__text">Image unavailable</span>
        </StateBox>
      );
    }
    return (
      <StateBox status="failed" tone="failed">
        <span className="image-object__text">Upload failed</span>
        <ImageActions onRetry={onRetry} onRemove={onRemove} showRetry={canRetry} />
      </StateBox>
    );
  }

  if (image.assetKey === null || loadFailed) {
    return (
      <StateBox status="unavailable">
        <BrokenImageIcon />
        <span className="image-object__text">Image unavailable</span>
      </StateBox>
    );
  }

  return (
    <img
      className="image-object__img"
      data-testid="image-picture"
      src={assetUrl(image.assetKey)}
      alt="Image"
      // Not draggable: a picture on a board is dragged to move it, and the browser's own
      // image-drag would take the gesture out of the board's hands.
      draggable={false}
      decoding="async"
      loading="lazy"
      onError={() => {
        setLoadFailed(true);
      }}
    />
  );
}

/** What an image needs from the running board, beyond its own snapshot. */
export interface ImageRuntimeObject extends ImageRuntimeSource {
  /** The clock every image's `displayStatus` is read against. The provider owns this one. */
  now: number;
}

/** The part of the runtime the board supplies; `now` is added by the provider. */
export interface ImageRuntimeSource {
  /** Whose uploads these are: the local identity (`image.upload_failure`). */
  identityId: string;
  /** This tab's upload progress for an object, if it is running one. */
  progressOf(id: string): number | undefined;
  canRetry(id: string): boolean;
  retry(id: string): void;
  remove(id: string): void;
}

const ImageRuntimeContext = createContext<ImageRuntimeObject | null>(null);

export interface ImageRuntimeProviderProps {
  /** Read on every render, so the board never has to rebuild this for a fresh closure. */
  runtime: () => ImageRuntimeSource;
  /**
   * Is anything uploading? The clock only needs to tick while the answer is yes: `unfinished`
   * is the one state that arrives by itself, with no event to announce it (`image.unfinished`).
   */
  hasUploading: boolean;
  children: ReactNode;
}

/**
 * The bridge between the board's one set of object props and what an image needs.
 *
 * The board hands every object the same `ObjectProps` (`sel.registry`), and an image needs
 * four things no other type does: whose upload this was, how far it has got, whether Retry has
 * anything to retry, and a clock that keeps moving while it waits. Passing them through `App`
 * would mean either widening `ObjectProps` for every type or threading them by hand, and this
 * is neither: the provider sits between the board and its objects, holds the clock, and hands
 * the rest to whichever components ask.
 */
export function ImageRuntimeProvider({
  runtime,
  hasUploading,
  children,
}: ImageRuntimeProviderProps) {
  const [now, setNow] = useState(() => Date.now());
  const latest = useRef(runtime);
  latest.current = runtime;

  useEffect(() => {
    if (!hasUploading) return;
    setNow(Date.now());
    const timer = setInterval(() => {
      setNow(Date.now());
    }, IMAGE_STATUS_TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [hasUploading]);

  const source = latest.current();
  const value: ImageRuntimeObject = {
    now,
    identityId: source.identityId,
    progressOf: (id) => source.progressOf(id),
    canRetry: (id) => source.canRetry(id),
    retry: (id) => source.retry(id),
    remove: (id) => source.remove(id),
  };

  return <ImageRuntimeContext.Provider value={value}>{children}</ImageRuntimeContext.Provider>;
}

/** The running board's image services. An image rendered without a board has none. */
export function useImageRuntime(): ImageRuntimeObject | null {
  return useContext(ImageRuntimeContext);
}

/**
 * The object the board draws (`image.aspect_resize`, and every gesture story 7 made generic).
 *
 * The rectangle is the document's: `x`, `y`, `width` and `height` are written when the
 * placeholder is created — at the size the decoded picture will be shown at — and after that
 * only the person resizing it changes them. Which is what lets a colleague see a placeholder
 * of the right shape before a byte has arrived, and why resizing keeps the proportions: an
 * image stretched out of shape cannot be un-stretched, since the box no longer knows what was
 * inside it.
 */
export function BoardImageObject(props: ObjectProps): JSX.Element | null {
  const { obj, zoom, selected, onObjectPointerDown } = props;
  const image = obj as ImageSnapshot;
  const runtime = useImageRuntime();

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.stopPropagation();
      // A press that began on one of this object's own buttons belongs to the button.
      //
      // The gesture below captures the pointer, which is right for a drag and wrong for a
      // click: a captured pointer takes the `click` away from the control that was pressed and
      // gives it to the box that captured it, so Retry would never be told. A failed picture is
      // the one object on this board that carries buttons, and the only way to fix that is to
      // leave the press where it started (`image.upload_failure`).
      if ((event.target as HTMLElement | null)?.closest('button') !== null) return;
      onObjectPointerDown(event, obj.id);
    },
    [obj.id, onObjectPointerDown],
  );

  if (runtime === null) return null;
  const status = displayStatus(image, runtime.now);

  return (
    <div
      className={`image-object${selected ? ' image-object--selected' : ''}`}
      data-testid="image-object"
      data-object-id={obj.id}
      data-selected={selected}
      data-image-status={status}
      data-image-uploader={image.uploaderId}
      data-image-key={image.assetKey ?? ''}
      data-zoom={zoom}
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width: obj.width,
        height: obj.height,
      }}
      onPointerDown={handlePointerDown}
    >
      <ImageObject
        image={image}
        isUploader={image.uploaderId === runtime.identityId}
        progress={runtime.progressOf(obj.id)}
        canRetry={runtime.canRetry(obj.id)}
        now={runtime.now}
        onRetry={() => {
          runtime.retry(obj.id);
        }}
        onRemove={() => {
          runtime.remove(obj.id);
        }}
      />
    </div>
  );
}
