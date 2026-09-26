import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { copyText } from '@/features/share/copyText';
import { hasSavedLink, markLinkSaved } from '@/features/share/linkSaved';
import { useWorkspaceLink } from '@/features/share/useWorkspaceLink';

type Step = 'idle' | 'fetching' | 'fetch-failed' | 'manual' | 'copied';

type Props = { workspaceId: string; onPendingChange: (pending: boolean) => void };

function selectOnMount(field: HTMLInputElement | null) {
  field?.focus();
  field?.select();
}

/**
 * Inside the forget dialog, only when this browser never copied or emailed the link. The link is fetched
 * only when the user presses Copy link, never on render. The saved flag is set only after a clipboard
 * write succeeded.
 */
export function UnsavedLinkWarning({ workspaceId, onPendingChange }: Props) {
  // Read once per dialog open (the dialog content remounts each time); a throwing storage reads as unsaved.
  const [initiallySaved] = useState(() => hasSavedLink(workspaceId));
  const [step, setStep] = useState<Step>('idle');
  const [manualLink, setManualLink] = useState('');
  const { fetchLink } = useWorkspaceLink(workspaceId, { enabled: false });
  const fieldRef = useCallback(selectOnMount, []);

  if (initiallySaved) return null;

  async function onCopy() {
    setStep('fetching');
    onPendingChange(true);
    let link: string;
    try {
      link = await fetchLink();
    } catch {
      setStep('fetch-failed');
      return;
    } finally {
      onPendingChange(false);
    }
    if ((await copyText(link)) === 'copied') {
      markLinkSaved(workspaceId);
      setStep('copied');
    } else {
      setManualLink(link);
      setStep('manual');
    }
  }

  if (step === 'copied') {
    return (
      <p role="status" className="rounded-md bg-success/15 px-3 py-2 text-sm">
        Link copied — you can forget it safely.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md bg-warning/15 px-3 py-2 text-sm">
      <p>You haven't saved this link. If you forget it here, you may lose access.</p>
      {step === 'manual' ? (
        <label className="flex flex-col gap-1">
          <span>Copy it manually</span>
          <input
            ref={fieldRef}
            readOnly
            value={manualLink}
            className="w-full rounded-md border border-border bg-background px-2 py-1 font-mono text-xs"
          />
        </label>
      ) : step === 'fetch-failed' ? (
        <div role="alert" className="flex items-center gap-2">
          <span>Couldn't get the link</span>
          <Button size="sm" variant="outline" className="touch-target" onClick={onCopy}>
            Retry
          </Button>
        </div>
      ) : (
        <Button size="sm" className="touch-target self-start" disabled={step === 'fetching'} onClick={onCopy}>
          Copy link
        </Button>
      )}
    </div>
  );
}
