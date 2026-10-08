// Toast (story 12, image.insert): a short message at the bottom of the
// screen (role=status for screen readers), auto-dismissed by the caller
// (useImageInsert).

import type { JSX } from 'react';

export function Toast({ message }: { message: string }): JSX.Element {
  return (
    <div className="toast" role="status" data-testid="toast">
      {message}
    </div>
  );
}
