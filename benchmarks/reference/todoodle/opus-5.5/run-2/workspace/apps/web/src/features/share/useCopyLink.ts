import { COPY_CONFIRM_MS } from '@todoodle/shared/limits';
import { useEffect, useRef, useState } from 'react';
import { copyText } from './copyText';
import { markLinkSaved } from './linkSaved';

/**
 * Copy for the link panel. A successful copy marks the link saved and shows 'Copied' for
 * COPY_CONFIRM_MS. If the clipboard refuses, the field is selected and a manual copy of it
 * (one native `copy` event) marks the link saved instead.
 */
export function useCopyLink(workspaceId: string) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy(link: string, field?: HTMLInputElement | null) {
    const result = await copyText(link, field);
    if (result === 'copied') {
      markLinkSaved(workspaceId);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPY_CONFIRM_MS);
    } else if (field) {
      field.addEventListener('copy', () => markLinkSaved(workspaceId), { once: true });
    }
    return result;
  }

  return { copy, copied };
}
