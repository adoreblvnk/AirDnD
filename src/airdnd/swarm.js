// ==============================================================================
// AirDnD Swarm Coordination & WTA Consensus Engine (Layer 3 Autonomy)
// Implements:
// 1. "Don't Take the Bait" — Second-Wave Survival Optimizer
// 2. Naive Baseline — Greedy Over-commitment Benchmark
// 3. P2P Market Auction + EscrowCore Bounded-Counter CRDTs
// ==============================================================================

import {
  solveWave1Allocation,
  buildCorridorReachabilityMatrix,
  calculateInterceptorShadowValues,
  evaluateWorstCaseWave2Leakage,
  calculateExpiringReserveOption,
  OPTIMIZER_DEFAULTS
} from './survivalOptimizer.js';
import { CORRIDORS, STRATEGIC_TARGETS } from './raidGenerator.js';

export class SwarmCoordinator {
  constructor(simulation) {
    this.sim = simulation;
    this.isJammingActive = false;
    this.auctionEpoch = 0;
    this.lastConvergenceMs = 24;
    this.reassignments = 0;
    this.onHardwareBid = null; // Callback for physical ESP32 node
    // EscrowCore commitment credits ledger: targetId -> holderDefenderId
    this.escrowCredits = new Map();

    // "Don't Take the Bait" telemetry & state
    this.reachabilityMatrix = new Map();
    this.shadowValues = new Map();
    this.wave2RiskSummary = null;
    this.wave1Plan = null;
    this.expiringClocks = new Map(); // corridorId -> { corridorName, reachableCount, deadlineSec }
  }

  setJamming(active) {
    this.isJammingActive = active;
    this.sim.isJammingActive = active;
    // When jamming strikes, clear central table and force immediate P2P re-auction
    this.runAuction(true);
  }

  // Run the Weapon-Target Assignment (WTA) Auction based on scenarioMode
  runAuction(forceFullRebid = false) {
    const startTime = performance.now();
    this.auctionEpoch++;

    if (this.sim.scenarioMode === 'dont_take_the_bait') {
      this.runBaitDefenseAuction(forceFullRebid);
    } else if (this.sim.scenarioMode === 'naive_baseline') {
      this.runNaiveBaselineAuction(forceFullRebid);
    } else {
      this.runStandardAuction(forceFullRebid);
    }

    this.lastConvergenceMs = Math.max(8, Math.round(performance.now() - startTime));
  }

  // "Don't Take the Bait": Second-Wave Survival Optimizer
  runBaitDefenseAuction(forceFullRebid = false) {
    // Wave 1: The Feint
    if (this.sim.currentWave === 1 || this.sim.currentWave === 0) {
      const wave1Threats = this.sim.threats.filter(t => t.status === 'inbound');
      if (wave1Threats.length === 0) return;

      // Solve minimax second-wave survival allocation
      const plan = solveWave1Allocation(wave1Threats, this.sim.interceptors);
      this.wave1Plan = plan;

      // Apply assignments: launch ONLY minimal sufficient interceptors
      const launchedSet = new Set(plan.launchedInterceptorIds);

      for (const assignment of plan.assignments) {
        const threat = this.sim.threats.find(t => t.id === assignment.threatId);
        if (!threat || threat.status !== 'inbound') continue;

        for (const intId of assignment.interceptorIds) {
          const defender = this.sim.interceptors.find(d => d.id === intId);
          if (defender && defender.status !== 'lost') {
            defender.status = 'intercepting';
            defender.targetId = threat.id;
            threat.assignedDefenderId = defender.id;
            threat.assignedDefenderIds = assignment.interceptorIds;
            this.escrowCredits.set(threat.id, defender.id);

            if (defender.isPhysicalHwNode && this.onHardwareBid) {
              this.onHardwareBid(threat.id, defender.id, 99.5);
            }
          }
        }
      }

      // Preserve all other interceptors as docked reserves
      for (const d of this.sim.interceptors) {
        if (!launchedSet.has(d.id) && d.status !== 'lost') {
          d.status = 'docked';
          d.targetId = null;
        }
      }

      this.reachabilityMatrix = buildCorridorReachabilityMatrix(this.sim.interceptors);
      this.shadowValues = calculateInterceptorShadowValues(this.sim.interceptors, this.reachabilityMatrix);
      this.wave2RiskSummary = plan.wave2RiskSummary;
      return;
    }

    // Wave 2: The Main Body Strike along Judge-selected corridor
    if (this.sim.currentWave === 2) {
      const unassignedWave2 = this.sim.threats.filter(t => {
        return t.status === 'inbound' && !t.assignedDefenderId;
      });

      // Available reserves: docked interceptors or free launched ones
      const availableReserves = this.sim.interceptors.filter(d => {
        if (d.status === 'lost') return false;
        return d.status === 'docked' || (d.status === 'launched' && !d.targetId);
      });

      // Match reserves to Wave 2 threats based on proximity & sprint capability
      for (const threat of unassignedWave2) {
        let bestScore = -Infinity;
        let bestDefender = null;

        for (const defender of availableReserves) {
          if (defender.targetId) continue;

          const dLon = (threat.lon - defender.lon) * 111000;
          const dLat = (threat.lat - defender.lat) * 111000;
          const dist = Math.hypot(dLon, dLat);

          // Can defender reach threat before it penetrates too far north?
          const timeToWaterline = (1.235 - threat.lat) / ((threat.speed * (threat.targetLat - threat.lat) / dist) / 111000);
          const flightTime = dist / defender.speed;

          let score = 10000 / (dist + 100);
          if (flightTime <= timeToWaterline) {
            score *= 2.0; // Priority bonus for feasible intercept
          }

          if (score > bestScore) {
            bestScore = score;
            bestDefender = defender;
          }
        }

        if (bestDefender) {
          bestDefender.status = 'intercepting';
          bestDefender.targetId = threat.id;
          threat.assignedDefenderId = bestDefender.id;
          this.escrowCredits.set(threat.id, bestDefender.id);

          const idx = availableReserves.indexOf(bestDefender);
          if (idx !== -1) availableReserves.splice(idx, 1);
        }
      }
    }
  }

  // Naive Baseline: Greedy Nearest-Neighbor WTA with NO reserve protection
  runNaiveBaselineAuction(forceFullRebid = false) {
    const unassignedThreats = this.sim.threats.filter(t => t.status === 'inbound');
    if (unassignedThreats.length === 0) return;

    // Wave 1: Baseline over-commits almost the entire fleet (26 of 30)
    if (this.sim.currentWave === 1 || this.sim.currentWave === 0) {
      const activeThreats = unassignedThreats.filter(t => t.wave === 1 || !t.wave);
      if (activeThreats.length === 0) return;

      // Scramble 26 interceptors aggressively
      const toScramble = this.sim.interceptors.slice(0, 26);
      for (let i = 0; i < toScramble.length; i++) {
        const defender = toScramble[i];
        if (defender.status === 'lost') continue;

        // Multi-allocate greedily: 3-4 defenders per threat
        const threatIndex = i % activeThreats.length;
        const target = activeThreats[threatIndex];

        defender.status = 'intercepting';
        defender.targetId = target.id;
        target.assignedDefenderId = defender.id;
        this.escrowCredits.set(target.id, defender.id);
      }

      // Only 4 remain docked
      for (let i = 26; i < this.sim.interceptors.length; i++) {
        this.sim.interceptors[i].status = 'docked';
        this.sim.interceptors[i].targetId = null;
      }
      return;
    }

    // Wave 2 arrives in Naive Baseline:
    // Fleet is already airborne or far south, only 4 docked interceptors remain
    if (this.sim.currentWave === 2) {
      const wave2Threats = this.sim.threats.filter(t => t.wave === 2 && t.status === 'inbound');
      const availableDocked = this.sim.interceptors.filter(d => d.status === 'docked');

      // Only the 4 docked can scramble; the other 26 are out of position/depleted
      for (let i = 0; i < Math.min(availableDocked.length, wave2Threats.length); i++) {
        const defender = availableDocked[i];
        const threat = wave2Threats[i];
        defender.status = 'intercepting';
        defender.targetId = threat.id;
        threat.assignedDefenderId = defender.id;
      }
      // The remaining 12 Wave 2 threats have NO available interceptors and will leak!
    }
  }

  // Legacy / Default multi-strategy auction
  runStandardAuction(forceFullRebid = false) {
    const strategy = this.sim.activeStrategy;
    const availableDefenders = this.sim.interceptors.filter(d => {
      if (d.status === 'lost') return false;
      if (strategy === 'economy' && parseInt(d.id.split('-')[1]) > 20) {
        d.status = 'docked';
        return false;
      }
      return d.status === 'docked' || d.status === 'launched' || (forceFullRebid && d.status === 'intercepting');
    });

    const unassignedThreats = this.sim.threats.filter(t => {
      return t.status === 'inbound' && (!t.assignedDefenderId || forceFullRebid);
    });

    if (availableDefenders.length === 0 || unassignedThreats.length === 0) return;

    unassignedThreats.sort((a, b) => {
      if (strategy === 'waterline') return a.lat - b.lat;
      if (strategy === 'shield') {
        const distA = Math.min(Math.abs(a.lon - 103.70), Math.abs(a.lon - 103.99));
        const distB = Math.min(Math.abs(b.lon - 103.70), Math.abs(b.lon - 103.99));
        return distA - distB;
      }
      return b.speed - a.speed;
    });

    for (const defender of availableDefenders) {
      if (defender.targetId && !forceFullRebid) continue;

      let bestScore = -Infinity;
      let bestThreat = null;

      for (const threat of unassignedThreats) {
        const currentHolder = this.escrowCredits.get(threat.id);
        if (currentHolder && currentHolder !== defender.id) continue;

        const dLon = threat.lon - defender.lon;
        const dLat = threat.lat - defender.lat;
        const dist = Math.hypot(dLon, dLat);

        const bearingToThreat = Math.atan2(dLat, dLon);
        const closingSpeed = defender.speed + threat.speed * Math.cos(bearingToThreat);
        let score = (closingSpeed / (dist * 111000 + 100));

        if (threat.debrisFootprint?.lat > 1.238) score *= 1.5;

        if (score > bestScore) {
          bestScore = score;
          bestThreat = threat;
        }
      }

      if (bestThreat) {
        this.escrowCredits.set(bestThreat.id, defender.id);
        defender.targetId = bestThreat.id;
        defender.status = 'intercepting';
        bestThreat.assignedDefenderId = defender.id;

        if (defender.isPhysicalHwNode && this.onHardwareBid) {
          this.onHardwareBid(bestThreat.id, defender.id, bestScore);
        }

        const idx = unassignedThreats.indexOf(bestThreat);
        if (idx !== -1) unassignedThreats.splice(idx, 1);
      }
    }
  }

  // Simulate attrition of a defender (e.g. shot down or kinetic failure)
  killDefender(defenderId) {
    const defender = this.sim.interceptors.find(d => d.id === defenderId);
    if (!defender) return;

    defender.status = 'lost';
    this.sim.stats.interceptorsLost++;

    if (defender.targetId) {
      const target = this.sim.threats.find(t => t.id === defender.targetId);
      if (target && target.status !== 'intercepted') {
        target.assignedDefenderId = null;
        this.escrowCredits.delete(target.id);
        this.reassignments++;
        this.sim.stats.reassignments++;
        this.runAuction(false);
      }
      defender.targetId = null;
    }
  }

  // Update loop called every frame
  update() {
    // 1. Maintain live expiring readiness clocks for docked reserves across all 4 corridors
    if (this.sim.scenarioMode === 'dont_take_the_bait') {
      const docked = this.sim.interceptors.filter(d => d.status === 'docked');
      for (const corridor of Object.values(CORRIDORS)) {
        let minSlack = Infinity;
        let reachableCount = 0;

        for (const d of docked) {
          const opt = calculateExpiringReserveOption(d, corridor);
          if (opt.isReachable) {
            reachableCount++;
            if (opt.reserveSlackSec < minSlack) {
              minSlack = opt.reserveSlackSec;
            }
          }
        }

        this.expiringClocks.set(corridor.id, {
          corridorName: corridor.name,
          reachableCount,
          deadlineSec: minSlack === Infinity ? 0 : Math.max(0, minSlack)
        });
      }
    }

    // 2. Check if re-auction is needed
    const needsRebid = this.sim.interceptors.some(d => {
      return d.status === 'launched' && !d.targetId;
    });

    if (needsRebid && this.sim.isAuthorized) {
      this.runAuction(false);
    }
  }
}
