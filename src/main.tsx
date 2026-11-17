import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';

/**
 * The inline shell in `index.html` paints before React or Babylon exist, so
 * the first frame is never a white screen. Once the engine has built the
 * scene we fade it out; on a fatal boot error we leave it up and let the
 * error screen replace it instead.
 */
export function dismissBootShell(): void {
  const boot = document.getElementById('boot');
  if (!boot) return;
  boot.dataset.done = '1';
  window.setTimeout(() => boot.remove(), 700);
}

function mount(): void {
  const host = document.getElementById('root');
  if (!host) {
    throw new Error('#root is missing from index.html');
  }

  // A stale service worker from an earlier deploy is the most common reason a
  // freshly published build looks unchanged; surfacing it beats silent confusion.
  const params = new URLSearchParams(window.location.search);
  const forced = params.get('reset') === '1';
  if (forced) {
    void navigator.serviceWorker?.getRegistrations?.()
      .then((regs) => Promise.all((regs ?? []).map((r) => r.unregister())))
      .catch(() => undefined);
    params.delete('reset');
    const q = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${q ? `?${q}` : ''}`);
  }

  createRoot(host).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

window.addEventListener('error', (event) => {
  // WebGL context loss is recoverable in Babylon; a truly uncaught script
  // error is not, so make sure something readable reaches the player.
  const host = document.getElementById('root');
  if (!host || host.childElementCount > 0) return;
  host.innerHTML = `<div class="fatal"><h2>The Dimwood could not load</h2>
    <p>Something failed before the game could start.</p>
    <code>${(event.message || 'unknown error').replace(/[<>&]/g, '')}</code></div>`;
  dismissBootShell();
});

mount();
