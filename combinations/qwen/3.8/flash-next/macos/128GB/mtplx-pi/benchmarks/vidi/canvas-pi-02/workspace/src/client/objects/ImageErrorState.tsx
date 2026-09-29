/**
 * The shared error state (story 12).
 *
 * One component for both unhappy endings — a `failed` upload and a stale
 * `unfinished` one (five minutes since anybody last tried) — because they
 * get the same treatment: a box that says nothing is stored here, and a
 * button that is the only thing which may start another upload. Nobody
 * re-uploads behind your back (design §"Why an error state for unfinished
 * uploads"), and both states say so in words: the image is *not saved*.
 *
 * It is a component, not a `<p>`, because the next embed type will want the
 * same words and the same button, and a shared component makes that true
 * instead of merely intended.
 */
import type { JSX } from 'react';

export type ImageErrorKind = 'failed' | 'unfinished';

export interface ImageErrorStateProps {
  kind: ImageErrorKind;
  /** False on a board the visitor cannot edit: they see the problem, not a button. */
  canEdit: boolean;
  /** The one path back: `retryUpload`. Pressing it is the "person tried again". */
  onRetry(): void;
}

export function ImageErrorState(props: ImageErrorStateProps): JSX.Element {
  const { kind, canEdit, onRetry } = props;
  return (
    <div
      className="image-error-state"
      data-testid="image-error"
      data-kind={kind}
      role="status"
    >
      <span className="image-error-icon" aria-hidden="true">
        ▲
      </span>
      <p className="image-error-message">
        {kind === 'unfinished'
          ? 'This image has been uploading for over five minutes. '
          : 'This image could not be uploaded. '}
        It is not saved.
      </p>
      {canEdit ? (
        <button
          type="button"
          className="image-error-retry"
          data-testid="image-retry"
          onClick={onRetry}
        >
          Retry upload
        </button>
      ) : null}
    </div>
  );
}