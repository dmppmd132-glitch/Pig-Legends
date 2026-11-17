interface Props {
  message: string;
}

/**
 * Almost always one of three things: hardware acceleration switched off, a
 * browser that predates WebGL 2, or a remote-debugging context with no GPU.
 * Saying which, and how to check, is more useful than a stack trace.
 */
export function FatalScreen({ message }: Props) {
  return (
    <div className="fatal">
      <h2>The Dimwood could not load</h2>
      <p>
        Pig Legends renders in WebGL 2. This browser did not give the game a usable graphics
        context.
      </p>
      <div className="keypad" style={{ maxWidth: 560, textAlign: 'left' }}>
        <div>Enable “Use hardware acceleration” in your browser settings, then restart it.</div>
        <div>Try a current Chrome, Edge, Firefox or Safari.</div>
        <div>On a phone, close other 3D apps and reload.</div>
        <div>
          After an update that looks unchanged, reload once with{' '}
          <a href="?reset=1" style={{ color: 'var(--witch)' }}>
            ?reset=1
          </a>{' '}
          to drop the offline copy.
        </div>
      </div>
      <code>{message}</code>
    </div>
  );
}
