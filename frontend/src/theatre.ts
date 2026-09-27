import theatre from '../../configs/theatre.json';

// The simulator's local frame: x across the defended front, y out to sea along the threat
// axis, z up (metres). configs/theatre.json pins that frame to the launch site at Marina East
// and turns +y to face the sea, so the enemy swarm comes in from the Singapore Strait.
export const THEATRE = theatre;
export const THREAT_BEARING_RAD = (theatre.threat_bearing_deg * Math.PI) / 180;
const [ORIGIN_X, ORIGIN_Y] = theatre.origin_local_m;
const METRES_PER_DEG_LAT = 110_574;
const METRES_PER_DEG_LON = 111_320 * Math.cos((theatre.origin.lat * Math.PI) / 180);

export interface GeoPoint { lon: number; lat: number; height: number }

export function localToGeo(value: readonly number[]): GeoPoint {
  const dx = value[0] - ORIGIN_X;
  const dy = value[1] - ORIGIN_Y;
  const sin = Math.sin(THREAT_BEARING_RAD);
  const cos = Math.cos(THREAT_BEARING_RAD);
  // +y points along the threat bearing; +x is 90 degrees clockwise from it.
  const east = dx * cos + dy * sin;
  const north = -dx * sin + dy * cos;
  return {
    lon: theatre.origin.lon + east / METRES_PER_DEG_LON,
    lat: theatre.origin.lat + north / METRES_PER_DEG_LAT,
    height: value[2] + theatre.height_offset_m,
  };
}

// Headings are clockwise from north in the world and clockwise from +y locally.
export const localHeadingToWorld = (heading: number) => heading + THREAT_BEARING_RAD;
export const worldHeadingToLocal = (heading: number) => heading - THREAT_BEARING_RAD;

export function formatSite(): string {
  const { lat, lon } = theatre.origin;
  const dm = (value: number, positive: string, negative: string) => {
    const abs = Math.abs(value);
    const degrees = Math.floor(abs);
    const minutes = Math.round((abs - degrees) * 60);
    return `${String(degrees).padStart(2, '0')}°${String(minutes).padStart(2, '0')}′${value >= 0 ? positive : negative}`;
  };
  return `${dm(lat, 'N', 'S')} ${dm(lon, 'E', 'W')}`;
}
