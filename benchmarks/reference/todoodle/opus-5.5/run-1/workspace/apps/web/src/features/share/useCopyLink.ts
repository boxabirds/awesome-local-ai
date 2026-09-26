import { COPY_CONFIRM_MS } from '@todoodle/shared/limits';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type CopyResult, copyText } from './copyText';
import { markLinkSaved } from './linkSaved';

/**
 * Copy action for the Share panel. A successful copy marks the link saved and shows 'Copied' for
 * COPY_CONFIRM_MS. If the clipboard is unavailable the field is selected, and a manual copy of it
 * also marks the link saved.
 */
export function useCopyLink(workspaceId: string): {
  copy(link: string, field?: HTMLInputElement | null): Promise<CopyResult>;
  copied: boolean;
} {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(
    async (link: string, field?: HTMLInputElement | null) => {
      const result = await copyText(link, field);
      if (result === 'copied') {
        markLinkSaved(workspaceId);
        clearTimeout(timer.current);
        setCopied(true);
        timer.current = setTimeout(() => setCopied(false), COPY_CONFIRM_MS);
      } else {
        field?.addEventListener('copy', () => markLinkSaved(workspaceId), { once: true });
      }
      return result;
    },
    [workspaceId],
  );

  return { copy, copied };
}
