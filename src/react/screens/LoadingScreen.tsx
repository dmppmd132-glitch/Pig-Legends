interface Props {
  pct: number;
  label: string;
}

/** Shown while `GameEngine.boot()` builds the scene in yielded steps. */
export function LoadingScreen({ pct, label }: Props) {
  const done = pct >= 0.999;
  return (
    <div className="screen">
      <div className="plate" style={{ textAlign: 'center' }}>
        <p className="eyebrow">Pig Legends</p>
        <h1 className="title">
          ARNO
          <em>of the Darkwood</em>
        </h1>
        <div className="rule" />
        <div className="bar-line" style={{ height: 4, marginBottom: 10 }}>
          <div
            className="fill"
            style={{
              width: `${Math.round(pct * 100)}%`,
              background: 'linear-gradient(90deg,#2f7a4d,#79e6a0)',
              transition: 'width .25s ease',
            }}
          />
        </div>
        <p className="lede" style={{ margin: 0, minHeight: 42 }}>
          {done ? 'The wood is watching.' : label}
        </p>
      </div>
    </div>
  );
}
