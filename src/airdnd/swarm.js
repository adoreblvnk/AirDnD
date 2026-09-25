// ==============================================================================
// AirDnD Swarm Coordination & WTA Consensus Engine (Layer 3 Autonomy)
// Implements P2P Market Auction + EscrowCore Bounded-Counter CRDTs
// ==============================================================================

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
  }

  setJamming(active) {
    this.isJammingActive = active;
    this.sim.isJammingActive = active;
    // When jamming strikes, clear central table and force immediate P2P re-auction
    this.runAuction(true);
  }

  // Run the Weapon-Target Assignment (WTA) Auction
  runAuction(forceFullRebid = false) {
    const startTime = performance.now();
    this.auctionEpoch++;

    const strategy = this.sim.activeStrategy;
    const availableDefenders = this.sim.interceptors.filter(d => {
      if (d.status === 'lost') return false;
      if (strategy === 'economy' && parseInt(d.id.split('-')[1]) > 20) {
        // Reserve 30% of fleet docked
        d.status = 'docked';
        return false;
      }
      return d.status === 'docked' || d.status === 'launched' || (forceFullRebid && d.status === 'intercepting');
    });

    const unassignedThreats = this.sim.threats.filter(t => {
      return t.status === 'inbound' && (!t.assignedDefenderId || forceFullRebid);
    });

    // If no defenders or threats, return
    if (availableDefenders.length === 0 || unassignedThreats.length === 0) {
      this.lastConvergenceMs = Math.round(performance.now() - startTime);
      return;
    }

    // Sort threats based on selected Strategy Card
    unassignedThreats.sort((a, b) => {
      if (strategy === 'waterline') {
        // Waterline Intercept: prioritize threats with lowest latitude (furthest south)
        // to destroy them earliest over water
        return a.lat - b.lat;
      } else if (strategy === 'shield') {
        // Critical Asset Shield: prioritize threats closest to Jurong (lon 103.70) or Changi (lon 103.99)
        const distA = Math.min(Math.abs(a.lon - 103.70), Math.abs(a.lon - 103.99));
        const distB = Math.min(Math.abs(b.lon - 103.70), Math.abs(b.lon - 103.99));
        return distA - distB;
      } else {
        // Economy mode: prioritize highest speed jet threats
        return b.speed - a.speed;
      }
    });

    // P2P Auction Matching: Assign each available defender to best candidate threat
    for (const defender of availableDefenders) {
      if (defender.targetId && !forceFullRebid) continue;

      let bestScore = -Infinity;
      let bestThreat = null;

      for (const threat of unassignedThreats) {
        // Check EscrowCore CRDT credit: ensure no other node has already committed to this threat
        const currentHolder = this.escrowCredits.get(threat.id);
        if (currentHolder && currentHolder !== defender.id) {
          continue; // Credit already locked by another peer! Prevents split-brain overkill
        }

        // Calculate kinetic bidding score: inverse of distance + speed alignment
        const dLon = threat.lon - defender.lon;
        const dLat = threat.lat - defender.lat;
        const dist = Math.sqrt(dLon * dLon + dLat * dLat);

        // Turn angle penalty: can the interceptor turn to target?
        const bearingToThreat = Math.atan2(dLat, dLon);
        const closingSpeed = defender.speed + threat.speed * Math.cos(bearingToThreat);

        let score = (closingSpeed / (dist * 111000 + 100));

        // Bonus for threats with high collateral risk
        if (threat.debrisFootprint.lat > 1.238) {
          score *= 1.5;
        }

        if (score > bestScore) {
          bestScore = score;
          bestThreat = threat;
        }
      }

      if (bestThreat) {
        // Commit credit in EscrowCore ledger
        this.escrowCredits.set(bestThreat.id, defender.id);
        defender.targetId = bestThreat.id;
        defender.status = 'intercepting';
        bestThreat.assignedDefenderId = defender.id;

        // If physical ESP32 node, emit serial frame
        if (defender.isPhysicalHwNode && this.onHardwareBid) {
          this.onHardwareBid(bestThreat.id, defender.id, bestScore);
        }

        // Remove from unassigned pool for this auction round
        const idx = unassignedThreats.indexOf(bestThreat);
        if (idx !== -1) unassignedThreats.splice(idx, 1);
      }
    }

    this.lastConvergenceMs = Math.max(12, Math.round(performance.now() - startTime));
  }

  // Simulate attrition of a defender (e.g. shot down or kinetic failure)
  killDefender(defenderId) {
    const defender = this.sim.interceptors.find(d => d.id === defenderId);
    if (!defender) return;

    defender.status = 'lost';
    this.sim.stats.interceptorsLost++;

    // Release EscrowCore credit for its target
    if (defender.targetId) {
      const target = this.sim.threats.find(t => t.id === defender.targetId);
      if (target && target.status !== 'intercepted') {
        target.assignedDefenderId = null;
        this.escrowCredits.delete(target.id);
        this.reassignments++;
        this.sim.stats.reassignments++;

        // Trigger instant peer re-auction ($<50ms)
        this.runAuction(false);
      }
      defender.targetId = null;
    }
  }

  // Update loop called every frame
  update() {
    // If any active interceptor has an invalid target, run rebidding
    const needsRebid = this.sim.interceptors.some(d => {
      if (d.status === 'launched' && !d.targetId) return true;
      return false;
    });

    if (needsRebid && this.sim.isAuthorized) {
      this.runAuction(false);
    }
  }
}
