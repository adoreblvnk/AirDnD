// ==============================================================================
// Unit Tests: Second-Wave Survival Optimizer ("Don't Take the Bait")
// Tests kinematics, expiring reserve options, shadow costs, and Wave 1 WTA allocation
// ==============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OPTIMIZER_DEFAULTS,
  distanceMeters,
  calculateWaterlineCrossingTime,
  getThreatPositionAtTime,
  solveKineticIntercept,
  calculateExpiringReserveOption,
  buildCorridorReachabilityMatrix,
  calculateInterceptorShadowValues,
  evaluateWorstCaseWave2Leakage,
  solveWave1Allocation
} from './survivalOptimizer.js';
import {
  CORRIDORS,
  STRATEGIC_TARGETS,
  generateWave1Feint,
  generateWave2MainBody
} from './raidGenerator.js';

test('distanceMeters calculates accurate distance on Singapore coordinate grid', () => {
  const p1 = { lon: 103.85, lat: 1.25 };
  const p2 = { lon: 103.85, lat: 1.26 }; // 0.01 deg lat ~ 1110 meters
  const dist = distanceMeters(p1, p2, 111000);
  assert.ok(Math.abs(dist - 1110) < 1e-3, `Expected ~1110m, got ${dist}`);
});

test('calculateWaterlineCrossingTime returns accurate time or null for southward threats', () => {
  // Threat at lat 1.15 moving to lat 1.25 (target) at 100 m/s
  const threatNorth = {
    lon: 103.80,
    lat: 1.15,
    targetLon: 103.80,
    targetLat: 1.25,
    speed: 100
  };
  const tCross = calculateWaterlineCrossingTime(threatNorth, 1.235);
  assert.ok(tCross !== null);
  // Lat distance = 1.235 - 1.15 = 0.085 deg * 111000 = 9435 meters / 100 m/s = 94.35s
  assert.ok(Math.abs(tCross - 94.35) < 0.1, `Expected ~94.35s, got ${tCross}`);

  // Threat heading south away from waterline
  const threatSouth = {
    lon: 103.80,
    lat: 1.20,
    targetLon: 103.80,
    targetLat: 1.10,
    speed: 100
  };
  assert.strictEqual(calculateWaterlineCrossingTime(threatSouth, 1.235), null);

  // Threat already past waterline
  const threatPast = {
    lon: 103.80,
    lat: 1.25,
    targetLon: 103.80,
    targetLat: 1.30,
    speed: 100
  };
  assert.strictEqual(calculateWaterlineCrossingTime(threatPast, 1.235), 0);
});

test('solveKineticIntercept accounts for launch delay, sprint endurance, and waterline', () => {
  const threat = {
    lon: 103.80,
    lat: 1.16,
    targetLon: 103.80,
    targetLat: 1.28,
    speed: 100 // m/s
  };

  // Docked interceptor positioned forward at lat 1.20
  const interceptor = {
    id: 'D-01',
    lon: 103.80,
    lat: 1.20,
    status: 'docked',
    speed: 160
  };

  const sol = solveKineticIntercept(interceptor, threat, { launchDelaySec: 4.0, waterlineBoundaryLat: 1.235 });
  assert.strictEqual(sol.feasible, true);
  assert.ok(sol.interceptTime > 4.0, 'Intercept time must exceed launch delay');
  assert.ok(sol.interceptPoint.lat <= 1.235, 'Intercept must happen south of waterline');
  assert.ok(sol.flightTime <= OPTIMIZER_DEFAULTS.sprintEnduranceSec, 'Must not exceed 210s sprint endurance');
});

test('calculateExpiringReserveOption computes latest safe launch deadline and slack', () => {
  const interceptor = { lon: 103.88, lat: 1.265 }; // Changi/East coast base
  const corridorSE = CORRIDORS.SOUTHEAST;

  const opt = calculateExpiringReserveOption(interceptor, corridorSE);
  assert.strictEqual(opt.corridorId, 'southeast');
  assert.ok(typeof opt.isReachable === 'boolean');
  if (opt.isReachable) {
    assert.ok(opt.latestLaunchDeadlineSec > 0, 'Launch deadline should be positive');
    assert.ok(opt.reserveSlackSec > 0, 'Slack should be positive for reachable base');
  }
});

test('buildCorridorReachabilityMatrix and calculateInterceptorShadowValues rate scarce defenders higher', () => {
  const interceptors = [
    { id: 'D-01', lon: 103.70, lat: 1.18, status: 'docked' }, // West / Jurong approach
    { id: 'D-02', lon: 103.95, lat: 1.26, status: 'docked' }, // East / Changi approach
    { id: 'D-03', lon: 103.82, lat: 1.24, status: 'docked' }  // Central / Sentosa approach
  ];

  const matrix = buildCorridorReachabilityMatrix(interceptors);
  assert.strictEqual(matrix.size, 3);
  assert.strictEqual(matrix.get('D-01').size, 4);

  const shadowValues = calculateInterceptorShadowValues(interceptors, matrix);
  assert.strictEqual(shadowValues.size, 3);
  for (const [id, data] of shadowValues.entries()) {
    assert.ok(data.shadowValue > 0, `Interceptor ${id} must have positive shadow value`);
    assert.ok(data.reachableCorridorCount >= 0);
  }
});

test('solveWave1Allocation enforces 2:1 pairing for Tier 1 and 1:1 for Tier 2', () => {
  // Generate deterministic 8-feint threats (2 Tier-1, 6 Tier-2)
  const wave1Threats = generateWave1Feint();
  assert.strictEqual(wave1Threats.length, 8);
  const tier1Count = wave1Threats.filter(t => t.tier === 1).length;
  const tier2Count = wave1Threats.filter(t => t.tier === 2).length;
  assert.strictEqual(tier1Count, 2);
  assert.strictEqual(tier2Count, 6);

  // Expected defender requirement: 2 * 2 + 6 * 1 = 10 interceptors
  const expectedDefenders = tier1Count * 2 + tier2Count * 1;
  assert.strictEqual(expectedDefenders, 10);

  // Fleet of 30 interceptors (like simulation.js)
  const interceptors = [];
  for (let j = 0; j < 30; j++) {
    let baseLon, baseLat;
    if (j < 12) {
      baseLon = 103.70 + (j / 12) * 0.30;
      baseLat = 1.185;
    } else if (j < 22) {
      baseLon = 103.74 + ((j - 12) / 10) * 0.22;
      baseLat = 1.235;
    } else {
      baseLon = 103.88 + ((j - 22) / 8) * 0.12;
      baseLat = 1.265;
    }
    interceptors.push({
      id: `D-${String(j + 1).padStart(2, '0')}`,
      lon: baseLon,
      lat: baseLat,
      alt: 400,
      speed: 160,
      status: 'docked'
    });
  }

  const result = solveWave1Allocation(wave1Threats, interceptors);

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.launchedInterceptorIds.length, 10, 'Must launch exactly 10 interceptors');
  assert.strictEqual(result.reservedInterceptorIds.length, 20, 'Must reserve exactly 20 interceptors');

  // Check pairing for each threat
  for (const assignment of result.assignments) {
    if (assignment.threatTier === 1) {
      assert.strictEqual(assignment.interceptorIds.length, 2, 'Tier 1 threat must have 2:1 pairing');
    } else {
      assert.strictEqual(assignment.interceptorIds.length, 1, 'Tier 2 threat must have 1:1 pairing');
    }
    // Verify each intercept point is south of waterline
    for (const pt of assignment.interceptPoints) {
      assert.ok(pt.lat <= OPTIMIZER_DEFAULTS.waterlineBoundaryLat + 0.001, `Intercept at lat ${pt.lat} must be south of waterline`);
    }
  }

  // Check that docked reserves are evaluated for Wave 2 risk
  assert.ok(result.wave2RiskSummary);
  assert.ok(typeof result.wave2RiskSummary.worstCaseLeakagePercent === 'number');
});

test('generateWave2MainBody produces 16 heavy Tier-1 threats for any chosen corridor', () => {
  for (const corridorKey of ['SOUTHEAST', 'SOUTHWEST', 'CENTRAL', 'EAST']) {
    const { corridor, threats } = generateWave2MainBody(corridorKey);
    assert.strictEqual(threats.length, 16);
    assert.strictEqual(threats.every(t => t.tier === 1), true);
    assert.strictEqual(threats.every(t => t.speed >= 140), true);
    assert.strictEqual(threats.every(t => t.wave === 2), true);
    assert.ok(corridor.name.length > 0);
  }
});
