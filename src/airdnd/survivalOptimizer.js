// ==============================================================================
// AirDnD "Don't Take the Bait" — Second-Wave Survival Optimizer
// Mathematical model for reserve endurance, reachability, and shadow-cost WTA
// Pure ES module (Node.js 24 compatible)
// ==============================================================================

import { CORRIDORS, STRATEGIC_TARGETS } from './raidGenerator.js';

export const OPTIMIZER_DEFAULTS = {
  sprintEnduranceSec: 210,     // 3.5 minutes sprint endurance at 160 m/s (~33.6 km range)
  launchDelaySec: 4.0,         // Docked scramble / spool-up delay in seconds
  interceptorSpeedMps: 160,    // Interceptor cruise & sprint velocity (m/s)
  waterlineBoundaryLat: 1.235, // Waterline boundary latitude: intercepts must occur south of this
  metersPerDeg: 111000,        // Equatorial meters per degree approx (Singapore lat ~1.3)
  tier1PairingRatio: 2,        // 2:1 pairing required for Tier 1 high-speed threats
  tier2PairingRatio: 1,        // 1:1 pairing for Tier 2 decoys / loitering threats
  wave2ThreatDemandPerCorridor: 16, // Typical Wave 2 raid size
  wave2ThreatSpeedMps: 145     // Nominal Wave 2 strike speed
};

/**
 * Calculates Euclidean distance in meters between two lat/lon positions.
 * @param {{ lon: number, lat: number }} pos1
 * @param {{ lon: number, lat: number }} pos2
 * @param {number} metersPerDeg
 * @returns {number} Distance in meters
 */
export function distanceMeters(pos1, pos2, metersPerDeg = OPTIMIZER_DEFAULTS.metersPerDeg) {
  const dLon = (pos1.lon - pos2.lon) * metersPerDeg;
  const dLat = (pos1.lat - pos2.lat) * metersPerDeg;
  return Math.hypot(dLon, dLat);
}

/**
 * Calculates the time (in seconds) for a threat moving at constant speed towards its target
 * to cross the specified waterline boundary latitude.
 * @param {{ lon: number, lat: number, targetLon: number, targetLat: number, speed: number }} threat
 * @param {number} waterlineLat
 * @returns {number|null} Seconds to waterline crossing, or null if it never crosses northward
 */
export function calculateWaterlineCrossingTime(
  threat,
  waterlineLat = OPTIMIZER_DEFAULTS.waterlineBoundaryLat
) {
  if (threat.lat >= waterlineLat) {
    return 0; // Already past or at waterline
  }

  const dLon = threat.targetLon - threat.lon;
  const dLat = threat.targetLat - threat.lat;
  const dist = Math.hypot(dLon, dLat);

  if (dist === 0 || dLat <= 0) {
    // Threat not heading north
    return null;
  }

  const vy = (dLat / dist) * threat.speed; // m/s northward
  const vyDeg = vy / OPTIMIZER_DEFAULTS.metersPerDeg; // deg/s northward

  const degToWaterline = waterlineLat - threat.lat;
  const timeSec = degToWaterline / vyDeg;
  return timeSec > 0 ? timeSec : null;
}

/**
 * Calculates exact position of threat at time t (seconds from now).
 * Clamps to target if threat reaches target earlier than t.
 * @param {{ lon: number, lat: number, targetLon: number, targetLat: number, speed: number }} threat
 * @param {number} t Time in seconds
 * @returns {{ lon: number, lat: number, reachedTarget: boolean }}
 */
export function getThreatPositionAtTime(threat, t) {
  const dLon = threat.targetLon - threat.lon;
  const dLat = threat.targetLat - threat.lat;
  const totalDistMeters = Math.hypot(dLon, dLat) * OPTIMIZER_DEFAULTS.metersPerDeg;
  const totalTravelTime = totalDistMeters / threat.speed;

  if (t >= totalTravelTime) {
    return { lon: threat.targetLon, lat: threat.targetLat, reachedTarget: true };
  }

  const frac = t / totalTravelTime;
  return {
    lon: threat.lon + dLon * frac,
    lat: threat.lat + dLat * frac,
    reachedTarget: false
  };
}

/**
 * Solves kinetic intercept solution between an interceptor and a threat.
 * Takes into account launch delay (if docked) and sprint endurance limits.
 *
 * Interceptor position: I0 = (ix, iy)
 * Threat trajectory: T(t) = T0 + V_threat * t
 * Interceptor launches at t_launch_delay, travels at V_int:
 * |T(t) - I0| = V_int * (t - t_launch_delay) for t >= t_launch_delay
 *
 * @param {{ lon: number, lat: number, status?: string, speed?: number }} interceptor
 * @param {{ lon: number, lat: number, targetLon: number, targetLat: number, speed: number }} threat
 * @param {object} [options]
 * @returns {{ feasible: boolean, interceptTime: number, flightTime: number, interceptPoint: { lon: number, lat: number }, reason?: string }}
 */
export function solveKineticIntercept(interceptor, threat, options = {}) {
  const cfg = { ...OPTIMIZER_DEFAULTS, ...options };
  const launchDelay = (interceptor.status === 'docked' || interceptor.status === undefined)
    ? (options.launchDelaySec ?? cfg.launchDelaySec)
    : 0;
  const vInt = interceptor.speed || cfg.interceptorSpeedMps;
  const vThreat = threat.speed;

  // Convert coords relative to interceptor in meters
  const rx0 = (threat.lon - interceptor.lon) * cfg.metersPerDeg;
  const ry0 = (threat.lat - interceptor.lat) * cfg.metersPerDeg;

  const tDx = threat.targetLon - threat.lon;
  const tDy = threat.targetLat - threat.lat;
  const tDistDeg = Math.hypot(tDx, tDy);
  if (tDistDeg === 0) {
    return { feasible: false, interceptTime: 0, flightTime: 0, interceptPoint: null, reason: 'zero_threat_distance' };
  }

  const vxThreat = (tDx / tDistDeg) * vThreat;
  const vyThreat = (tDy / tDistDeg) * vThreat;

  // Quadratic equation:
  // (rx0 + vx*t)^2 + (ry0 + vy*t)^2 = vInt^2 * (t - t0)^2
  // Let t0 = launchDelay
  // (vx^2 + vy^2 - vInt^2) * t^2 + 2 * (rx0*vx + ry0*vy + vInt^2 * t0) * t + (rx0^2 + ry0^2 - vInt^2 * t0^2) = 0
  const a = (vxThreat * vxThreat + vyThreat * vyThreat) - (vInt * vInt);
  const b = 2 * (rx0 * vxThreat + ry0 * vyThreat + vInt * vInt * launchDelay);
  const c = (rx0 * rx0 + ry0 * ry0) - (vInt * vInt * launchDelay * launchDelay);

  let candidateTimes = [];
  const discr = b * b - 4 * a * c;

  if (Math.abs(a) < 1e-6) {
    if (Math.abs(b) > 1e-6) {
      candidateTimes.push(-c / b);
    }
  } else if (discr >= 0) {
    const sqrtDiscr = Math.sqrt(discr);
    candidateTimes.push((-b - sqrtDiscr) / (2 * a));
    candidateTimes.push((-b + sqrtDiscr) / (2 * a));
  }

  // Find smallest valid t >= launchDelay
  const validTimes = candidateTimes
    .filter(t => t >= launchDelay)
    .sort((t1, t2) => t1 - t2);

  if (validTimes.length === 0) {
    return { feasible: false, interceptTime: 0, flightTime: 0, interceptPoint: null, reason: 'no_real_solution' };
  }

  const tIntercept = validTimes[0];
  const flightTime = tIntercept - launchDelay;

  // Check endurance constraint
  if (flightTime > cfg.sprintEnduranceSec) {
    return {
      feasible: false,
      interceptTime: tIntercept,
      flightTime,
      interceptPoint: null,
      reason: 'exceeds_sprint_endurance'
    };
  }

  // Intercept point
  const pos = getThreatPositionAtTime(threat, tIntercept);

  // Check waterline constraint
  const waterlineViolation = pos.lat > cfg.waterlineBoundaryLat;

  return {
    feasible: !waterlineViolation,
    interceptTime: tIntercept,
    flightTime,
    interceptPoint: { lon: pos.lon, lat: pos.lat },
    waterlineViolation,
    reason: waterlineViolation ? 'crosses_waterline' : 'success'
  };
}

/**
 * Calculates the Expiring Reserve Option for a docked interceptor and a candidate Wave 2 corridor.
 * Evaluates the latest safe launch deadline before the corridor threat crosses the waterline.
 *
 * @param {{ lon: number, lat: number }} interceptor
 * @param {object} corridor Corridor definition with spawnOrigin, targetKey, etc.
 * @param {object} [options]
 * @returns {{
 *   corridorId: string,
 *   isReachable: boolean,
 *   waterlineCrossingSec: number,
 *   latestLaunchDeadlineSec: number|null,
 *   flightTimeToWaterlineSec: number,
 *   reserveSlackSec: number,
 *   waterlineInterceptPos: { lon: number, lat: number }|null
 * }}
 */
export function calculateExpiringReserveOption(interceptor, corridor, options = {}) {
  const cfg = { ...OPTIMIZER_DEFAULTS, ...options };
  const target = STRATEGIC_TARGETS[corridor.targetKey] || { lon: 103.85, lat: 1.28 };
  const threatSpeed = cfg.wave2ThreatSpeedMps;

  // Synthesize corridor lead threat trajectory
  const threat = {
    lon: corridor.spawnOrigin.lon,
    lat: corridor.spawnOrigin.lat,
    targetLon: target.lon,
    targetLat: target.lat,
    speed: threatSpeed
  };

  const tWaterline = calculateWaterlineCrossingTime(threat, cfg.waterlineBoundaryLat);
  if (tWaterline === null) {
    return {
      corridorId: corridor.id,
      isReachable: false,
      waterlineCrossingSec: Infinity,
      latestLaunchDeadlineSec: null,
      flightTimeToWaterlineSec: Infinity,
      reserveSlackSec: -Infinity,
      waterlineInterceptPos: null,
      reason: 'threat_never_crosses_waterline'
    };
  }

  // Position of threat when it reaches the waterline boundary
  const waterlinePos = getThreatPositionAtTime(threat, tWaterline);

  // Distance from docked interceptor to this waterline intercept point
  const distToWaterline = distanceMeters(interceptor, waterlinePos, cfg.metersPerDeg);
  const flightTimeToWaterline = distToWaterline / cfg.interceptorSpeedMps;

  // Interceptor cannot exceed sprint endurance
  if (flightTimeToWaterline > cfg.sprintEnduranceSec) {
    return {
      corridorId: corridor.id,
      isReachable: false,
      waterlineCrossingSec: tWaterline,
      latestLaunchDeadlineSec: null,
      flightTimeToWaterlineSec: flightTimeToWaterline,
      reserveSlackSec: -Infinity,
      waterlineInterceptPos: waterlinePos,
      reason: 'out_of_sprint_endurance_range'
    };
  }

  // Interceptor must arrive at or before tWaterline:
  // t_launch + launchDelay + flightTime <= tWaterline
  // => t_launch <= tWaterline - launchDelay - flightTime
  const latestLaunchDeadline = tWaterline - cfg.launchDelaySec - flightTimeToWaterline;
  const isReachable = latestLaunchDeadline >= 0;

  return {
    corridorId: corridor.id,
    isReachable,
    waterlineCrossingSec: tWaterline,
    latestLaunchDeadlineSec: isReachable ? latestLaunchDeadline : null,
    flightTimeToWaterlineSec: flightTimeToWaterline,
    reserveSlackSec: latestLaunchDeadline, // Positive slack means comfortable launch window
    waterlineInterceptPos: waterlinePos,
    reason: isReachable ? 'reachable_before_waterline' : 'launch_deadline_expired'
  };
}

/**
 * Computes corridor reachability matrix for a set of interceptors.
 * Maps each interceptor to its reachable corridors and slack times.
 *
 * @param {Array<object>} interceptors
 * @param {object} [options]
 * @returns {Map<string, Map<string, object>>} interceptorId -> (corridorId -> reachabilityOption)
 */
export function buildCorridorReachabilityMatrix(interceptors, options = {}) {
  const corridorList = Object.values(CORRIDORS);
  const matrix = new Map();

  for (const interceptor of interceptors) {
    const corridorMap = new Map();
    for (const corridor of corridorList) {
      const option = calculateExpiringReserveOption(interceptor, corridor, options);
      corridorMap.set(corridor.id, option);
    }
    matrix.set(interceptor.id, corridorMap);
  }

  return matrix;
}

/**
 * Computes the opportunity cost / shadow value for each interceptor.
 * Interceptors that are among the very few capable of defending a bottleneck corridor
 * have high shadow value. Committing them to Wave 1 incurs high risk of Wave 2 leakage.
 *
 * @param {Array<object>} interceptors
 * @param {Map<string, Map<string, object>>} reachabilityMatrix
 * @param {object} [options]
 * @returns {Map<string, { shadowValue: number, criticalCorridors: string[], reachableCorridorCount: number }>}
 */
export function calculateInterceptorShadowValues(interceptors, reachabilityMatrix, options = {}) {
  const cfg = { ...OPTIMIZER_DEFAULTS, ...options };
  const corridorList = Object.values(CORRIDORS);

  // Count total interceptors that can reach each corridor
  const corridorSupply = new Map();
  for (const c of corridorList) {
    corridorSupply.set(c.id, 0);
  }

  for (const interceptor of interceptors) {
    const cMap = reachabilityMatrix.get(interceptor.id);
    if (!cMap) continue;
    for (const [cId, opt] of cMap.entries()) {
      if (opt.isReachable) {
        corridorSupply.set(cId, (corridorSupply.get(cId) || 0) + 1);
      }
    }
  }

  const results = new Map();

  for (const interceptor of interceptors) {
    const cMap = reachabilityMatrix.get(interceptor.id);
    let shadowValue = 0;
    const criticalCorridors = [];
    let reachableCount = 0;

    if (cMap) {
      for (const [cId, opt] of cMap.entries()) {
        if (opt.isReachable) {
          reachableCount++;
          const supply = corridorSupply.get(cId) || 1;
          // Scarcity weight: if supply is low relative to wave 2 threat demand, shadow cost is high
          // Inverse of supply squared provides high penalty for scarce corridor defenders
          const scarcityWeight = 1.0 / Math.max(1, supply);
          const urgencyBonus = opt.reserveSlackSec < 30 ? 1.5 : 1.0;
          shadowValue += scarcityWeight * urgencyBonus * 100;

          // If this corridor has <= required defenders, it's critical
          if (supply <= cfg.wave2ThreatDemandPerCorridor) {
            criticalCorridors.push(cId);
          }
        }
      }
    }

    results.set(interceptor.id, {
      shadowValue,
      criticalCorridors,
      reachableCorridorCount: reachableCount
    });
  }

  return results;
}

/**
 * Evaluates projected worst-case leakage across all Wave 2 corridors given the reserved interceptors.
 *
 * @param {Array<object>} reservedInterceptors
 * @param {Map<string, Map<string, object>>} reachabilityMatrix
 * @param {object} [options]
 * @returns {{
 *   worstCaseCorridor: string,
 *   worstCaseLeakagePercent: number,
 *   corridorBreakdown: Record<string, { reachableCount: number, demand: number, leakedCount: number, leakagePercent: number }>
 * }}
 */
export function evaluateWorstCaseWave2Leakage(reservedInterceptors, reachabilityMatrix, options = {}) {
  const cfg = { ...OPTIMIZER_DEFAULTS, ...options };
  const corridorList = Object.values(CORRIDORS);
  const demand = cfg.wave2ThreatDemandPerCorridor;

  const breakdown = {};
  let maxLeakagePercent = 0;
  let worstCorridor = corridorList[0].id;

  for (const corridor of corridorList) {
    let reachableCount = 0;
    for (const interceptor of reservedInterceptors) {
      const cMap = reachabilityMatrix.get(interceptor.id);
      if (cMap && cMap.get(corridor.id)?.isReachable) {
        reachableCount++;
      }
    }

    // Tier 1 threats in Wave 2 demand 1:1 or 2:1 depending on doctrine.
    // Here demand is threat count; assuming 1 interceptor stops 1 threat if launched on time,
    // or pairing ratio.
    const defendedCount = Math.min(demand, reachableCount);
    const leakedCount = Math.max(0, demand - defendedCount);
    const leakagePercent = (leakedCount / demand) * 100;

    breakdown[corridor.id] = {
      corridorName: corridor.name,
      reachableCount,
      demand,
      leakedCount,
      leakagePercent
    };

    if (leakagePercent > maxLeakagePercent) {
      maxLeakagePercent = leakagePercent;
      worstCorridor = corridor.id;
    }
  }

  return {
    worstCaseCorridor: worstCorridor,
    worstCaseLeakagePercent: maxLeakagePercent,
    corridorBreakdown: breakdown
  };
}

/**
 * Solves the Second-Wave Survival Optimizer WTA problem:
 * Given Wave 1 threats (e.g. 8 threats: 2 Tier-1 and 6 Tier-2) and fleet of interceptors (e.g. 30),
 * selects minimal sufficient subset to neutralize Wave 1 before the waterline,
 * minimizing shadow value / opportunity cost to maximize Wave 2 survival.
 *
 * Constraints:
 * 1. Threat pairing ratio:
 *    - Tier 1: 2 interceptors per threat
 *    - Tier 2 / decoys: 1 interceptor per threat
 * 2. Feasibility:
 *    - Chosen interceptors must achieve kinetic intercept strictly south of the waterline boundary (lat <= 1.235)
 *    - Interceptor flight time must not exceed sprint endurance (210s)
 * 3. Minimal sufficient subset:
 *    - Exactly the required count (e.g. 2*2 + 6*1 = 10 interceptors for 8 threats), no wasteful over-commitment
 * 4. Shadow Cost Minimization:
 *    - Minimize sum of shadow costs of launched interceptors, protecting reserve reachability across all 4 corridors
 *
 * @param {Array<object>} wave1Threats
 * @param {Array<object>} interceptors
 * @param {object} [options]
 * @returns {{
 *   success: boolean,
 *   assignments: Array<{
 *     threatId: string,
 *     threatTier: number,
 *     interceptorIds: string[],
 *     interceptPoints: Array<{ lon: number, lat: number }>,
 *     flightTimes: number[]
 *   }>,
 *   launchedInterceptorIds: string[],
 *   reservedInterceptorIds: string[],
 *   stats: {
 *     wave1ThreatCount: number,
 *     requiredDefenders: number,
 *     totalLaunched: number,
 *     totalReserved: number,
 *     worstCaseLeakagePercent: number,
 *     worstCaseCorridor: string
 *   },
 *   wave2RiskSummary: object
 * }}
 */
export function solveWave1Allocation(wave1Threats, interceptors, options = {}) {
  const cfg = { ...OPTIMIZER_DEFAULTS, ...options };

  // 1. Calculate corridor reachability matrix & shadow values for all interceptors
  const reachabilityMatrix = buildCorridorReachabilityMatrix(interceptors, cfg);
  const shadowValues = calculateInterceptorShadowValues(interceptors, reachabilityMatrix, cfg);

  // 2. Pre-filter candidate solutions for each Wave 1 threat
  // For each threat, find all interceptors that can feasibly intercept it south of waterline
  const candidatesPerThreat = new Map();
  let totalRequiredDefenders = 0;

  for (const threat of wave1Threats) {
    const ratio = threat.tier === 1 ? cfg.tier1PairingRatio : cfg.tier2PairingRatio;
    totalRequiredDefenders += ratio;

    const validCandidates = [];
    for (const interceptor of interceptors) {
      if (interceptor.status === 'lost') continue;
      const sol = solveKineticIntercept(interceptor, threat, cfg);
      if (sol.feasible) {
        const shadow = shadowValues.get(interceptor.id)?.shadowValue ?? 0;
        // Cost combines shadow value (preservation of wave 2 corridors) + slight flight time penalty
        const cost = shadow + sol.flightTime * 0.1;
        validCandidates.push({
          interceptorId: interceptor.id,
          interceptor,
          cost,
          shadow,
          sol
        });
      }
    }

    // Sort candidates by lowest cost (least critical to Wave 2 corridors)
    validCandidates.sort((a, b) => a.cost - b.cost);
    candidatesPerThreat.set(threat.id, validCandidates);
  }

  // 3. Greedy with conflict resolution / minimal shadow cost assignment
  // Order threats: Tier 1 threats first, then threats with fewest feasible candidates (constrained first)
  const sortedThreats = [...wave1Threats].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier; // Tier 1 before Tier 2
    const lenA = candidatesPerThreat.get(a.id)?.length || 0;
    const lenB = candidatesPerThreat.get(b.id)?.length || 0;
    return lenA - lenB;
  });

  const committedInterceptors = new Set();
  const assignments = [];
  let allFeasible = true;

  for (const threat of sortedThreats) {
    const ratio = threat.tier === 1 ? cfg.tier1PairingRatio : cfg.tier2PairingRatio;
    const candidates = candidatesPerThreat.get(threat.id) || [];

    const availableCandidates = candidates.filter(c => !committedInterceptors.has(c.interceptorId));

    if (availableCandidates.length < ratio) {
      allFeasible = false;
      // Infeasible under strict constraints: record partial or fallback
    }

    const chosen = availableCandidates.slice(0, ratio);
    for (const c of chosen) {
      committedInterceptors.add(c.interceptorId);
    }

    assignments.push({
      threatId: threat.id,
      threatTier: threat.tier,
      interceptorIds: chosen.map(c => c.interceptorId),
      interceptPoints: chosen.map(c => c.sol.interceptPoint),
      flightTimes: chosen.map(c => c.sol.flightTime),
      feasibility: chosen.length === ratio
    });
  }

  const launchedIds = Array.from(committedInterceptors);
  const reservedInterceptors = interceptors.filter(d => !committedInterceptors.has(d.id));
  const reservedIds = reservedInterceptors.map(d => d.id);

  // 4. Evaluate projected worst-case leakage for Wave 2
  const wave2Risk = evaluateWorstCaseWave2Leakage(reservedInterceptors, reachabilityMatrix, cfg);

  return {
    success: allFeasible && launchedIds.length === totalRequiredDefenders,
    assignments,
    launchedInterceptorIds: launchedIds,
    reservedInterceptorIds: reservedIds,
    stats: {
      wave1ThreatCount: wave1Threats.length,
      requiredDefenders: totalRequiredDefenders,
      totalLaunched: launchedIds.length,
      totalReserved: reservedIds.length,
      worstCaseLeakagePercent: wave2Risk.worstCaseLeakagePercent,
      worstCaseCorridor: wave2Risk.worstCaseCorridor
    },
    wave2RiskSummary: wave2Risk
  };
}
