import { useCallback, useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * PWA plumbing, kept out of the components.
 *
 * Two separate things are easy to conflate:
 *
 * * **Installation** is driven by `beforeinstallprompt`, an event that fires
 *   once and is never replayed, so it has to be caught early and held. There
 *   is no API for installing on iOS — there the only honest answer is to tell
 *   the player what to tap.
 * * **Updates** come from the generated service worker, and the plugin's React
 *   binding already models them as `needRefresh` / `offlineReady` state.
 *
 * A static import of the virtual module is required: resolving it through a
 * variable defeats Vite's analysis, and the browser then tries to fetch a file
 * literally named `virtual:pwa-register` and fails with a CORS error.
 */

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt: () => Promise<void>;
}

function isStandalone(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  // iOS Safari has no display-mode support; this is its only signal.
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function usePwaInstall() {
  const deferred = useRef<BeforeInstallPromptEvent | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [installed, setInstalled] = useState(isStandalone);

  useEffect(() => {
    if (installed) return;

    const onPrompt = (event: Event) => {
      // Preventing the default is what keeps Chrome's own mini-bar from
      // appearing and hands us the choice.
      event.preventDefault();
      deferred.current = event as BeforeInstallPromptEvent;
      setCanInstall(true);
    };
    const onInstalled = () => {
      setInstalled(true);
      setCanInstall(false);
      deferred.current = null;
    };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [installed]);

  const promptInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    const event = deferred.current;
    if (!event) return 'unavailable';
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === 'accepted') setInstalled(true);
    deferred.current = null;
    setCanInstall(false);
    return outcome;
  }, []);

  return { canInstall, installed, promptInstall };
}

export function useOfflineReady() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      // A blocked or unsupported worker (private mode, enterprise policy) must
      // never look like a broken game: it only means no offline caching.
      console.warn('[pig-legends] service worker unavailable', error);
    },
  });

  const applyUpdate = useCallback(() => {
    void updateServiceWorker(true);
  }, [updateServiceWorker]);

  const dismissUpdate = useCallback(() => {
    setNeedRefresh(false);
    setOfflineReady(false);
  }, [setNeedRefresh, setOfflineReady]);

  return {
    updateReady: needRefresh,
    offlineReady,
    applyUpdate,
    dismissUpdate,
  };
}
