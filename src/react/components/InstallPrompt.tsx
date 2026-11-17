import { useEffect, useState } from 'react';

import { useOfflineReady, usePwaInstall } from '../hooks/usePwa';

const DISMISS_KEY = 'pig-legends:install-dismissed';

/**
 * One dock for two different notices.
 *
 * “Install” appears only when the browser fires `beforeinstallprompt` and the
 * player has not dismissed it before. “Update” appears when a service worker
 * installed during an earlier visit found a new build. On iOS neither event
 * fires, so that platform gets the manual Share → Add to Home Screen note;
 * there is no API to shortcut it.
 */
export function InstallPrompt({ playing = false }: { playing?: boolean }) {
  const { canInstall, installed, promptInstall } = usePwaInstall();
  const { updateReady, offlineReady, applyUpdate, dismissUpdate } = useOfflineReady();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [iosNeedsHint, setIosNeedsHint] = useState(false);

  useEffect(() => {
    const ios =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1);
    const standalone = window.matchMedia('(display-mode: standalone)').matches;
    setIosNeedsHint(ios && !standalone);
  }, []);

  if (updateReady || offlineReady) {
    return (
      // Mid-run the notice has to clear the touch layer. The dock is centred on
      // the bottom edge — exactly where the virtual stick and the action
      // buttons live — and at z-index 6 it swallowed every pointer aimed at
      // them, which elementFromPoint on a 390x844 viewport confirmed.
      <div className={`install-dock${playing ? ' above-hud' : ''}`} role="status">
        <p>A new hunt is ready to load.</p>
        <button type="button" className="btn small" onClick={applyUpdate}>
          Update now
        </button>
        <button type="button" className="x-btn" onClick={dismissUpdate} aria-label="Not now">
          ×
        </button>
      </div>
    );
  }

  if (installed || dismissed || (!canInstall && !iosNeedsHint)) return null;
  // Never nag on top of the controls. The title card carries its own Install
  // button, so the offer stays where it is safe to tap.
  if (playing) return null;

  const close = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* private mode: the dock simply shows again next visit */
    }
  };

  return (
    <div className="install-dock" role="status">
      <p>
        {canInstall
          ? 'Install Pig Legends — it plays offline afterwards.'
          : 'On iPhone: Share, then Add to Home Screen. It opens fullscreen afterwards.'}
      </p>
      {canInstall && (
        <button
          type="button"
          className="btn small"
          onClick={async () => {
            const outcome = await promptInstall();
            if (outcome === 'accepted') close();
          }}
        >
          Install
        </button>
      )}
      <button type="button" className="x-btn" onClick={close} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
