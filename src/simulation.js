// ==============================================================================
// AirDnD Tactical Simulation Engine
// Kinematic model for 100-threat MoT salvo and 30 interceptors over Singapore
// ==============================================================================

export const SG_COORDS = {
  center: { lon: 103.8198, lat: 1.2850, alt: 22000 },
  waterlineBoundaryLat: 1.235, // Boundary between open water and land/ports
};

// Singapore Protected Urban & Strategic Zones (Polygons for 3D geofencing)
export const PROTECTED_ZONES = [
  {
    id: 'hdb-east-coast',
    name: 'HDB Sector East (Bedok / Marine Parade)',
    type: 'residential',
    color: '#ff3355',
    coords: [
      [103.885, 1.295],
      [103.955, 1.305],
      [103.970, 1.335],
      [103.890, 1.325]
    ],
    height: 120
  },
  {
    id: 'hdb-south-central',
    name: 'HDB Sector South (Queenstown / Bukit Merah)',
    type: 'residential',
    color: '#ff3355',
    coords: [
      [103.805, 1.275],
      [103.855, 1.275],
      [103.850, 1.300],
      [103.800, 1.295]
    ],
    height: 140
  },
  {
    id: 'jurong-island',
    name: 'Jurong Island Petrochemical Complex',
    type: 'strategic',
    color: '#ffaa00',
    coords: [
      [103.665, 1.240],
      [103.730, 1.245],
      [103.725, 1.285],
      [103.660, 1.280]
    ],
    height: 90
  },
  {
    id: 'changi-airport',
    name: 'Changi International Air Corridor',
    type: 'strategic',
    color: '#00f0ff',
    coords: [
      [103.975, 1.335],
      [104.015, 1.340],
      [104.010, 1.390],
      [103.970, 1.385]
    ],
    height: 60
  }
];

// Littoral Killboxes (Permitted kinetic engagement corridors over sea)
export const LITTORAL_KILLBOXES = [
  {
    id: 'killbox-alpha',
    name: 'Littoral Killbox Alpha (West Approach)',
    color: '#00ff88',
    coords: [
      [103.650, 1.150],
      [103.780, 1.150],
      [103.780, 1.225],
      [103.650, 1.225]
    ],
    height: 2500
  },
  {
    id: 'killbox-bravo',
    name: 'Littoral Killbox Bravo (Main Strait Approach)',
    color: '#00ff88',
    coords: [
      [103.780, 1.140],
      [103.920, 1.140],
      [103.920, 1.225],
      [103.780, 1.225]
    ],
    height: 2500
  },
  {
    id: 'killbox-charlie',
    name: 'Littoral Killbox Charlie (East Approach)',
    color: '#00ff88',
    coords: [
      [103.920, 1.150],
      [104.050, 1.150],
      [104.050, 1.230],
      [103.920, 1.230]
    ],
    height: 2500
  }
];

export class TacticalSimulation {
  constructor() {
    this.threats = [];
    this.interceptors = [];
    this.activeStrategy = 'waterline'; // 'waterline' | 'shield' | 'economy'
    this.isAuthorized = false;
    this.isJammingActive = false;
    this.timeMultiplier = 2.5; // Tactical simulation time scale for demo pacing
    this.history = [];
    this.historyTimer = 0;
    this.isScrubbing = false;
    this.onIntercept = null;
    this.stats = {
      threatsNeutralized: 0,
      threatsLeaked: 0,
      interceptorsActive: 30,
      interceptorsLost: 0,
      collateralRisk: 0.0,
      reassignments: 0,
    };
    this.initSalvo();
  }

  initSalvo() {
    this.threats = [];
    this.interceptors = [];
    this.stats.threatsNeutralized = 0;
    this.stats.threatsLeaked = 0;
    this.stats.interceptorsLost = 0;
    this.stats.reassignments = 0;

    // Spawn 100 inbound threats across southern Singapore Strait
    // Types: 60 Shahed (slow loitering), 25 Jet UAS (fast), 15 Agile FPV
    for (let i = 0; i < 100; i++) {
      let type, speed, alt;
      if (i < 60) {
        type = 'shahed';
        speed = 50 + Math.random() * 10; // ~180-210 km/h
        alt = 400 + Math.random() * 300;
      } else if (i < 85) {
        type = 'jet_uas';
        speed = 130 + Math.random() * 30; // ~470-580 km/h
        alt = 1200 + Math.random() * 1200;
      } else {
        type = 'fpv';
        speed = 35 + Math.random() * 10; // ~130 km/h
        alt = 80 + Math.random() * 120;
      }

      // Spread along southern approach (Lat 1.160 to 1.190, Lon 103.65 to 104.05)
      const startLon = 103.66 + (i / 100) * (104.04 - 103.66) + (Math.random() - 0.5) * 0.02;
      const startLat = 1.162 + (i / 100) * 0.022 + Math.random() * 0.008;
      // Target selection: aim at southern Singapore coastline / landmarks
      const targetLon = 103.70 + Math.random() * 0.28;
      const targetLat = 1.25 + Math.random() * 0.05;

      this.threats.push({
        id: `T-${String(i + 1).padStart(3, '0')}`,
        type,
        lon: startLon,
        lat: startLat,
        alt,
        speed, // m/s
        targetLon,
        targetLat,
        status: 'inbound', // 'inbound' | 'targeted' | 'intercepted' | 'leaked'
        assignedDefenderId: null,
        debrisFootprint: { lon: startLon, lat: startLat, radius: 100 },
      });
    }

    // Spawn 30 defensive interceptors:
    // 12 Forward Combat Air Patrol (already airborne over Singapore Strait killboxes: Lat 1.18-1.20)
    // 10 Coastal Quick-Reaction Scramble (Sentosa / Jurong Island coast: Lat 1.23-1.24)
    // 8 Changi & Jurong Defense Reserves (Lat 1.26-1.28)
    for (let j = 0; j < 30; j++) {
      let baseLon, baseLat, baseAlt, speed;
      if (j < 12) {
        baseLon = 103.70 + (j / 12) * 0.30 + (Math.random() - 0.5) * 0.02;
        baseLat = 1.18 + Math.random() * 0.025;
        baseAlt = 600 + Math.random() * 400;
        speed = 180; // High-speed jet interceptor (~650 km/h)
      } else if (j < 22) {
        baseLon = 103.74 + ((j - 12) / 10) * 0.22;
        baseLat = 1.235 + Math.random() * 0.015;
        baseAlt = 300 + Math.random() * 200;
        speed = 150; // Fast FPV kinetic rammer (~540 km/h)
      } else {
        baseLon = 103.88 + ((j - 22) / 8) * 0.12;
        baseLat = 1.265 + Math.random() * 0.02;
        baseAlt = 150 + Math.random() * 100;
        speed = 140; // Attritable interceptor (~500 km/h)
      }

      this.interceptors.push({
        id: `D-${String(j + 1).padStart(2, '0')}`,
        lon: baseLon,
        lat: baseLat,
        alt: baseAlt,
        speed,
        status: 'docked', // 'docked' | 'launched' | 'intercepting' | 'lost' | 'returning'
        targetId: null,
        battery: 100,
        isPhysicalHwNode: (j === 0), // Node D-01 is physical ESP32
      });
    }
  }

  // Update kinematics each simulation tick (dt seconds)
  update(rawDt) {
    if (this.isScrubbing) return;
    this.historyTimer = (this.historyTimer || 0) + rawDt;
    if (this.historyTimer >= 0.15) {
      this.historyTimer = 0;
      this.recordSnapshot();
    }
    const dt = Math.min(0.5, rawDt) * this.timeMultiplier;
    let activeThreats = 0;
    let highRiskCount = 0;
    // 1. Move inbound threats northward
    for (const t of this.threats) {
      if (t.status === 'intercepted' || t.status === 'leaked') continue;

      activeThreats++;

      // Heading towards target
      const dLon = t.targetLon - t.lon;
      const dLat = t.targetLat - t.lat;
      const dist = Math.sqrt(dLon * dLon + dLat * dLat);

      if (dist < 0.003) {
        // Threat reached target on land! Leaked!
        t.status = 'leaked';
        this.stats.threatsLeaked++;
        continue;
      }

      // 1 deg lat ~ 111,000 meters. 1 deg lon ~ 111,000 * cos(1.28) ~ 111,000 m
      const stepMeters = t.speed * dt;
      const stepDeg = stepMeters / 111000;
      t.lon += (dLon / dist) * stepDeg;
      t.lat += (dLat / dist) * stepDeg;

      // Project falling debris footprint: if shot down now, where does burning debris land?
      // Footprint projects forward by forward momentum + altitude drift
      const forwardDriftDeg = (t.speed * Math.sqrt(t.alt / 9.81)) / 111000;
      const debrisLon = t.lon + (dLon / dist) * forwardDriftDeg;
      const debrisLat = t.lat + (dLat / dist) * forwardDriftDeg;
      t.debrisFootprint = { lon: debrisLon, lat: debrisLat, radius: 150 };

      // Check if debris hits land (Lat > 1.238)
      if (debrisLat > SG_COORDS.waterlineBoundaryLat) {
        highRiskCount++;
      }
    }

    // 2. Move active interceptors towards assigned targets
    for (const d of this.interceptors) {
      if (d.status !== 'launched' && d.status !== 'intercepting') continue;
      if (!d.targetId) continue;

      const target = this.threats.find(t => t.id === d.targetId);
      if (!target || target.status === 'intercepted' || target.status === 'leaked') {
        // Target already gone! Trigger immediate re-assignment
        d.targetId = null;
        d.status = 'launched';
        continue;
      }

      // Vector to target
      const dLon = target.lon - d.lon;
      const dLat = target.lat - d.lat;
      const dist = Math.sqrt(dLon * dLon + dLat * dLat);

      // Closing distance in meters
      const distMeters = dist * 111000;

      if (distMeters < 65 || distMeters < d.speed * dt * 1.5) {
        // KINETIC INTERCEPT SUCCESS!
        target.status = 'intercepted';
        this.stats.threatsNeutralized++;
        if (this.onIntercept) {
          this.onIntercept(target.lon, target.lat, target.alt);
        }
        d.targetId = null;
        d.status = 'launched';
      } else {
        // Fly towards target at interceptor speed
        const stepMeters = d.speed * dt;
        const stepDeg = stepMeters / 111000;
        d.lon += (dLon / dist) * stepDeg;
        d.lat += (dLat / dist) * stepDeg;
        d.alt += (target.alt - d.alt) * Math.min(1.0, dt * 2.0);

        // Self-collision avoidance against neighboring active interceptors (200m safety buffer)
        let avoidLon = 0;
        let avoidLat = 0;
        for (const other of this.interceptors) {
          if (other.id === d.id || other.status === 'docked' || other.status === 'lost') continue;
          const oDistLon = d.lon - other.lon;
          const oDistLat = d.lat - other.lat;
          const oDistMeters = Math.sqrt(oDistLon * oDistLon + oDistLat * oDistLat) * 111000;
          if (oDistMeters < 200 && oDistMeters > 0.1) {
            const repelMagnitude = ((200 - oDistMeters) / 200) * 0.0002;
            avoidLon += (oDistLon / (oDistMeters / 111000)) * repelMagnitude;
            avoidLat += (oDistLat / (oDistMeters / 111000)) * repelMagnitude;
          }
        }
        d.lon += avoidLon;
        d.lat += avoidLat;
      }
    }

    // 3. Update stats
    this.stats.threatsActive = activeThreats;
    this.stats.collateralRisk = activeThreats > 0 ? (highRiskCount / activeThreats) * 100 : 0;
    this.stats.interceptorsActive = this.interceptors.filter(d => d.status !== 'lost').length;
  }

  recordSnapshot() {
    if (this.isScrubbing) return;
    const snap = {
      timestamp: Date.now(),
      threats: this.threats.map(t => ({ ...t })),
      interceptors: this.interceptors.map(d => ({ ...d })),
      stats: { ...this.stats },
      isAuthorized: this.isAuthorized,
      isJammingActive: this.isJammingActive,
      activeStrategy: this.activeStrategy
    };
    this.history.push(snap);
    if (this.history.length > 300) {
      this.history.shift();
    }
  }

  restoreSnapshot(index) {
    if (index < 0 || index >= this.history.length) return;
    const snap = this.history[index];
    this.threats = snap.threats.map(t => ({ ...t }));
    this.interceptors = snap.interceptors.map(d => ({ ...d }));
    this.stats = { ...snap.stats };
    this.isAuthorized = snap.isAuthorized;
    this.isJammingActive = snap.isJammingActive;
    this.activeStrategy = snap.activeStrategy;
  }

  branchFromSnapshot(index) {
    if (index < 0 || index >= this.history.length) return;
    this.restoreSnapshot(index);
    this.history = this.history.slice(0, index + 1);
    this.isScrubbing = false;
  }

  spawnCustomRaid(startLon, startLat, targetLon, targetLat, count = 5) {
    const spawned = [];
    for (let k = 0; k < count; k++) {
      const id = `T-CUST-${String(this.threats.length + 1).padStart(3, '0')}`;
      const offsetLon = (Math.random() - 0.5) * 0.015;
      const offsetLat = (Math.random() - 0.5) * 0.008;
      const threat = {
        id,
        type: 'jet_uas',
        lon: startLon + offsetLon,
        lat: startLat + offsetLat,
        alt: 800 + Math.random() * 400,
        speed: 160 + Math.random() * 20, // High-speed raid
        targetLon,
        targetLat,
        status: 'inbound',
        assignedDefenderId: null,
        debrisFootprint: { lon: startLon, lat: startLat, radius: 120 }
      };
      this.threats.push(threat);
      spawned.push(threat);
    }
    this.stats.threatsActive += count;
    return spawned;
  }
}
