// ==============================================================================
// AirDnD Deterministic Two-Wave Raid Generator ("Don't Take the Bait")
// Generates Wave 1 Feint (8 threats) and Judge-Selected Wave 2 (16 threats)
// ==============================================================================

export const STRATEGIC_TARGETS = {
  MBS: {
    id: 'mbs',
    name: 'Marina Bay Sands / Downtown Core',
    lon: 103.860,
    lat: 1.283,
    alt: 200,
    priority: 'CRITICAL_TIER_1',
    description: 'High-visibility civilian & financial hub'
  },
  JURONG: {
    id: 'jurong',
    name: 'Jurong Island Petrochem Cluster',
    lon: 103.700,
    lat: 1.265,
    alt: 100,
    priority: 'STRATEGIC_TIER_1',
    description: 'Energy and critical refinery infrastructure'
  },
  PORT: {
    id: 'port',
    name: 'Port of Singapore (PSA Pasir Panjang)',
    lon: 103.790,
    lat: 1.270,
    alt: 80,
    priority: 'HIGH_TIER_2',
    description: 'Global maritime trade lifeline'
  },
  CHANGI: {
    id: 'changi',
    name: 'Changi International Air Corridor',
    lon: 103.990,
    lat: 1.355,
    alt: 60,
    priority: 'STRATEGIC_TIER_1',
    description: 'National aviation and airbase corridor'
  }
};

export const CORRIDORS = {
  SOUTHEAST: {
    id: 'southeast',
    name: 'Southeast Corridor (Marina Bay / East Coast)',
    targetKey: 'MBS',
    spawnOrigin: { lon: 103.980, lat: 1.150 },
    headingDeg: 315,
    dangerZone: 'hdb-east-coast'
  },
  SOUTHWEST: {
    id: 'southwest',
    name: 'Southwest Corridor (Jurong Island Approach)',
    targetKey: 'JURONG',
    spawnOrigin: { lon: 103.650, lat: 1.140 },
    headingDeg: 25,
    dangerZone: 'jurong-island'
  },
  CENTRAL: {
    id: 'central',
    name: 'South-Central Corridor (Port / Sentosa Approach)',
    targetKey: 'PORT',
    spawnOrigin: { lon: 103.810, lat: 1.135 },
    headingDeg: 355,
    dangerZone: 'hdb-south-central'
  },
  EAST: {
    id: 'east',
    name: 'East Approach (Changi Air Corridor)',
    targetKey: 'CHANGI',
    spawnOrigin: { lon: 104.060, lat: 1.210 },
    headingDeg: 320,
    dangerZone: 'changi-airport'
  }
};

/**
 * Generates Wave 1: Feint / Bait (8 threats)
 * 2 Fast Jet UAS (Tier 1) + 6 Low-speed Shahed/Decoy (Tier 2)
 */
export function generateWave1Feint() {
  const threats = [];
  
  // 8 deterministic positions along southern Singapore Strait
  // Lon spread: 103.72 to 103.92, Lat: 1.155 to 1.170
  const lons = [103.73, 103.76, 103.79, 103.82, 103.85, 103.88, 103.91, 103.94];
  
  for (let i = 0; i < 8; i++) {
    const isTier1 = (i === 2 || i === 5); // 2 Tier-1 fast threats, 6 decoys
    const type = isTier1 ? 'jet_uas' : 'shahed';
    const speed = isTier1 ? 130 : 50; // m/s (468 km/h vs 180 km/h)
    const alt = isTier1 ? 1200 : 450;
    const lon = lons[i];
    const lat = 1.160 + (i % 3) * 0.005;

    // Aim towards southern coast / port waterline
    const targetLon = 103.75 + (i / 8) * 0.15;
    const targetLat = 1.250 + (i % 2) * 0.015;

    threats.push({
      id: `T-W1-${String(i + 1).padStart(2, '0')}`,
      wave: 1,
      isFeint: true,
      tier: isTier1 ? 1 : 2,
      type,
      lon,
      lat,
      alt,
      speed,
      targetLon,
      targetLat,
      targetKey: isTier1 ? 'PORT' : 'PORT',
      status: 'inbound',
      assignedDefenderId: null,
      assignedDefenderIds: [], // Supports 2:1 pairing
      debrisFootprint: { lon, lat, radius: isTier1 ? 160 : 90 }
    });
  }

  return threats;
}

/**
 * Generates Wave 2: Main Body Strike (16 threats) along Judge-selected Corridor
 * 16 heavy Tier-1 threats in dense tactical wedge formation
 */
export function generateWave2MainBody(corridorKey = 'SOUTHEAST') {
  const corridor = CORRIDORS[corridorKey.toUpperCase()] || CORRIDORS.SOUTHEAST;
  const target = STRATEGIC_TARGETS[corridor.targetKey];
  const threats = [];

  const originLon = corridor.spawnOrigin.lon;
  const originLat = corridor.spawnOrigin.lat;

  // Stagger 16 threats in 4 tactical echelon lines (4 threats per echelon)
  for (let i = 0; i < 16; i++) {
    const row = Math.floor(i / 4);
    const col = i % 4;

    // Echelon offset relative to corridor axis
    const crossOffset = (col - 1.5) * 0.007; // ~770m lateral spacing
    const alongOffset = -row * 0.008;         // ~880m range spacing

    const lon = originLon + crossOffset;
    const lat = originLat + alongOffset;

    // Fast strike velocity: 140 - 165 m/s (~500 - 600 km/h)
    const speed = 145 + (col % 2) * 15;
    const alt = 850 + row * 150 + col * 50;

    threats.push({
      id: `T-W2-${String(i + 1).padStart(2, '0')}`,
      wave: 2,
      isFeint: false,
      tier: 1,
      corridorId: corridor.id,
      corridorName: corridor.name,
      targetKey: corridor.targetKey,
      type: 'jet_uas',
      lon,
      lat,
      alt,
      speed,
      targetLon: target.lon + (col - 1.5) * 0.003,
      targetLat: target.lat + (row - 1.5) * 0.003,
      status: 'inbound',
      assignedDefenderId: null,
      assignedDefenderIds: [], // Supports 2:1 pairing
      debrisFootprint: { lon, lat, radius: 180 }
    });
  }

  return { corridor, threats };
}
