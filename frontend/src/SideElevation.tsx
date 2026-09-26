import { replayPosition, units, type ReplayFrame } from './worldview';

const MAX_ALT_M = 900;

function altitudeOf(frame: ReplayFrame, source: 'overview' | string): number | undefined {
  const position = replayPosition(frame, source);
  return position ? position[2] : undefined;
}

function clampY(altitude: number): number {
  const ratio = Math.max(0, Math.min(1, altitude / MAX_ALT_M));
  return 100 - ratio * 92 - 4;
}

// replayPosition(frame, agentId) is that agent's own noisy LOCAL ESTIMATE of the hostile's
// position (not the interceptor's own physical position, which isn't part of the replay
// telemetry model) - so this panel compares evaluator TRUTH altitude against each
// interceptor's independent, possibly-stale local estimate of that same altitude.
export default function SideElevation({ frame, selected }: { frame: ReplayFrame; selected: string }) {
  const truthAltitude = altitudeOf(frame, 'overview');
  const estimates = units
    .map((unit) => ({ unit, altitude: altitudeOf(frame, unit.agentId) }))
    .filter((entry): entry is { unit: (typeof units)[number]; altitude: number } => entry.altitude !== undefined);

  return (
    <div className="side-elevation" aria-label="Side elevation: evaluator truth altitude versus each interceptor's local estimate">
      <span className="side-elevation-label">SIDE ELEVATION</span>
      <svg viewBox="0 0 60 100" preserveAspectRatio="none">
        <line x1="4" y1="96" x2="56" y2="96" className="elevation-surface" />
        {[0, 300, 600, 900].map((tick) => (
          <line key={tick} x1="4" y1={clampY(tick)} x2="56" y2={clampY(tick)} className="elevation-tick" />
        ))}
        {truthAltitude !== undefined && (
          <g transform={`translate(30 ${clampY(truthAltitude)})`}>
            <circle r="2.4" className="elevation-hostile">
              <title>Evaluator truth altitude: {Math.round(truthAltitude)}m</title>
            </circle>
          </g>
        )}
        {estimates.map(({ unit, altitude }, index) => (
          <g key={unit.id} transform={`translate(${14 + index * 10} ${clampY(altitude)})`}>
            <circle r="1.8" className={unit.id === selected ? 'elevation-unit selected' : 'elevation-unit'}>
              <title>{unit.id} local estimate: {Math.round(altitude)}m</title>
            </circle>
          </g>
        ))}
      </svg>
      <div className="side-elevation-scale"><span>900M</span><span>0M</span></div>
    </div>
  );
}
