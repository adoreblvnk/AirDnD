import { replaySafety, replaySeparationSeries, type Replay } from './worldview';

function vectorMagnitude(vector?: number[]): number | undefined {
  return vector ? Math.sqrt(vector.reduce((sum, component) => sum + component * component, 0)) : undefined;
}

export default function SafetyPanel({ replay, frame, agentId }: { replay: Replay | null; frame: number; agentId: string }) {
  const reading = replay ? replaySafety(replay, frame, agentId) : undefined;
  const series = replay ? replaySeparationSeries(replay, frame, agentId) : [];
  const preferredSpeed = vectorMagnitude(reading?.preferredVelocity);
  const safeSpeed = vectorMagnitude(reading?.safeVelocity);
  const separations = series.map((sample) => sample.separationM).filter((value): value is number => value !== undefined);
  const maxSeparation = Math.max(1, ...separations);

  return (
    <section className="safety-panel" aria-label="Safety and separation">
      <div className="candidate-head"><span>SAFETY / SEPARATION</span><span>{reading?.safetyOverride ? 'OVERRIDE ACTIVE' : 'CLEAR'}</span></div>
      {!reading && <p className="safety-empty">No RVO2 actuation recorded yet for this unit.</p>}
      {reading && <>
        <div className="safety-velocities">
          <div><span>PREFERRED</span><b>{preferredSpeed?.toFixed(1) ?? '—'} m/s</b></div>
          <div><span>APPLIED</span><b className={reading.safetyOverride ? 'diverged' : ''}>{safeSpeed?.toFixed(1) ?? '—'} m/s</b></div>
        </div>
        <div className="safety-separation">
          <span>ACTUAL SEPARATION</span><b>{reading.actualSeparationM?.toFixed(1) ?? '—'} m</b>
          <span>PREDICTED MIN</span><b>{reading.predictedMinSeparationM?.toFixed(1) ?? '—'} m</b>
        </div>
        {separations.length > 1 && (
          <svg className="separation-chart" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
            <polyline
              points={series.map((sample, index) => `${(index / Math.max(1, series.length - 1)) * 100},${32 - Math.min(1, (sample.separationM ?? maxSeparation) / maxSeparation) * 30}`).join(' ')}
            />
            {series.map((sample, index) => sample.override && (
              <circle key={sample.frame} cx={(index / Math.max(1, series.length - 1)) * 100} cy={32 - Math.min(1, (sample.separationM ?? maxSeparation) / maxSeparation) * 30} r="1.6" className="intervention-marker" />
            ))}
          </svg>
        )}
      </>}
    </section>
  );
}
