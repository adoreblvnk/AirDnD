import type { SwarmFrame } from './worldview';

const MAX_ALT_M = 600;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

const toY = (altitudeM: number) => 96 - (Math.max(0, Math.min(MAX_ALT_M, altitudeM)) / MAX_ALT_M) * 90;

export function compassPoint(headingRad: number): string {
  const degrees = ((headingRad * 180) / Math.PI + 360) % 360;
  return COMPASS[Math.round(degrees / 45) % 8];
}

// Side elevation drawn from the map camera's point of view: the horizontal axis is distance
// along the direction the camera is looking (ENU x east, y north; heading clockwise from
// north), so "further away" on the map is further right here, whatever the map orientation.
export default function SideElevation({ swarm, selected, headingRad = 0 }: { swarm?: SwarmFrame; selected: string; headingRad?: number }) {
  const drones = swarm ? Object.values(swarm.drones) : [];
  const hostiles = swarm ? Object.values(swarm.hostiles).filter((hostile) => hostile.status !== 'pending') : [];
  const friendlies = swarm ? Object.values(swarm.friendlies) : [];
  const target = swarm?.drones[selected]?.target;
  const along = (position: number[]) => position[0] * Math.sin(headingRad) + position[1] * Math.cos(headingRad);
  const depths = [...drones, ...hostiles, ...friendlies].map((item) => along(item.position));
  const nearest = depths.length ? Math.min(...depths) : 0;
  const span = Math.max(1, (depths.length ? Math.max(...depths) : 1) - nearest);
  const toX = (position: number[]) => 6 + ((along(position) - nearest) / span) * 50;
  const facing = compassPoint(headingRad);
  return (
    <div className="side-elevation" aria-label={`Side elevation looking ${facing}: depth along the camera view against altitude`}>
      <span className="side-elevation-label">SIDE ELEVATION · LOOKING {facing}</span>
      <svg viewBox="0 0 60 100" preserveAspectRatio="none">
        <line x1="4" y1="96" x2="56" y2="96" className="elevation-surface" />
        {[0, 200, 400, 600].map((tick) => <line key={tick} x1="4" y1={toY(tick)} x2="56" y2={toY(tick)} className="elevation-tick" />)}
        {hostiles.map((hostile) => (
          <circle key={hostile.id} cx={toX(hostile.position)} cy={toY(hostile.position[2])} r={hostile.id === target ? 2.2 : 1.3} className={hostile.status === 'neutralized' ? 'elevation-hostile neutralized' : 'elevation-hostile'}>
            <title>{hostile.id}: {Math.round(hostile.position[2])}m</title>
          </circle>
        ))}
        {friendlies.map((friendly) => (
          <circle key={friendly.id} cx={toX(friendly.position)} cy={toY(friendly.position[2])} r={1.5} className="elevation-friendly">
            <title>{friendly.id}: {Math.round(friendly.position[2])}m</title>
          </circle>
        ))}
        {drones.map((drone) => (
          <circle key={drone.id} cx={toX(drone.position)} cy={toY(drone.position[2])} r={drone.id === selected ? 2 : 1} className={drone.id === selected ? 'elevation-unit selected' : 'elevation-unit'}>
            <title>{drone.id}: {Math.round(drone.position[2])}m</title>
          </circle>
        ))}
      </svg>
      <div className="side-elevation-scale"><span>{MAX_ALT_M}M</span><span>NEAR → FAR</span></div>
    </div>
  );
}
