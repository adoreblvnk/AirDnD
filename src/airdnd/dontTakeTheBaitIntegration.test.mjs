// ==============================================================================
// AirDnD "Don't Take the Bait" End-to-End Wargame Integration Test
// Validates:
// 1. Naive Baseline overcommits on Wave 1 (26 launched) -> Leaks on Wave 2 (12 leaked)
// 2. Survival Optimizer launches minimal Wave 1 (10 launched) -> Preserves reserves -> Neutralizes Wave 2 (0 leaked)
// ==============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { TacticalSimulation } from './simulation.js';
import { SwarmCoordinator } from './swarm.js';

test('Wargame Demo: Naive Baseline overcommits and is overwhelmed by Wave 2', () => {
  const sim = new TacticalSimulation();
  const swarm = new SwarmCoordinator(sim);

  // 1. Initialize Naive Baseline Scenario
  sim.initTwoWaveScenario('naive_baseline');
  assert.strictEqual(sim.threats.length, 8, 'Wave 1 should have exactly 8 apparent threats');
  assert.strictEqual(sim.interceptors.length, 30, 'Total interceptor fleet is 30');

  // 2. Run Baseline Auction for Wave 1
  swarm.runAuction();
  const activeDefenders = sim.interceptors.filter(d => d.status === 'intercepting' || d.status === 'launched');
  const dockedReserves = sim.interceptors.filter(d => d.status === 'docked');
  
  // Baseline should aggressively launch 26 interceptors on 8 threats
  assert.strictEqual(activeDefenders.length, 26, 'Naive baseline launches 26 interceptors on 8 threats');
  assert.strictEqual(dockedReserves.length, 4, 'Only 4 interceptors remain docked in baseline');

  // Step simulation forward until Wave 1 is largely engaged
  for (let step = 0; step < 200; step++) {
    sim.update(0.1);
  }

  // 3. Judge triggers Wave 2: Southeast Corridor (Marina Bay Sands approach)
  sim.triggerWave2('SOUTHEAST');
  assert.strictEqual(sim.currentWave, 2);
  const wave2Threats = sim.threats.filter(t => t.wave === 2);
  assert.strictEqual(wave2Threats.length, 16, 'Wave 2 must have 16 heavy threats');

  // Run Baseline auction for Wave 2
  swarm.runAuction();

  // Step simulation forward until Wave 2 reaches target
  for (let step = 0; step < 800; step++) {
    sim.update(0.1);
    swarm.update();
  }

  // Baseline outcome: fleet was exhausted, so high leakage occurs!
  const wave2Leaked = wave2Threats.filter(t => t.status === 'leaked').length;
  assert.strictEqual(wave2Leaked, 12, 'Baseline must leak exactly 12 threats on Wave 2 (75% leakage)');
  assert.strictEqual(sim.stats.threatsLeaked, 12, 'Total leaked count reflects overwhelmed baseline');
});

test('Wargame Demo: "Don\'t Take the Bait" launches minimum sufficient force and neutralizes Wave 2 with 0% leakage', () => {
  const sim = new TacticalSimulation();
  const swarm = new SwarmCoordinator(sim);

  // 1. Initialize "Don't Take the Bait" Scenario
  sim.initTwoWaveScenario('dont_take_the_bait');
  assert.strictEqual(sim.threats.length, 8, 'Wave 1 should have exactly 8 apparent threats');
  assert.strictEqual(sim.interceptors.length, 30, 'Total interceptor fleet is 30');

  // 2. Run Survival Optimizer Auction for Wave 1
  swarm.runAuction();

  const launchedDefenders = sim.interceptors.filter(d => d.status === 'intercepting' || d.status === 'launched');
  const dockedReserves = sim.interceptors.filter(d => d.status === 'docked');

  // 2 Tier-1 threats (2:1 pairing) + 6 Tier-2 threats (1:1 pairing) = exactly 10 launched!
  assert.strictEqual(launchedDefenders.length, 10, 'Survival optimizer launches exactly 10 interceptors for Wave 1');
  assert.strictEqual(dockedReserves.length, 20, 'Exactly 20 interceptors safely preserved as docked reserves');

  // Verify expiring readiness clocks exist and are positive
  swarm.update();
  assert.ok(swarm.expiringClocks.size >= 4, 'Expiring clocks tracked for all 4 corridors');
  const seClock = swarm.expiringClocks.get('southeast');
  assert.ok(seClock.reachableCount > 0, 'Southeast corridor must have reachable reserves');
  assert.ok(seClock.deadlineSec > 0, 'Launch deadline must be positive');

  // Step simulation forward while Wave 1 is intercepted over water
  for (let step = 0; step < 200; step++) {
    sim.update(0.1);
    swarm.update();
  }

  // Verify Wave 1 had zero leakage
  const wave1Leaked = sim.threats.filter(t => t.wave === 1 && t.status === 'leaked').length;
  assert.strictEqual(wave1Leaked, 0, 'Wave 1 feint should have 0 leaks');

  // 3. Judge triggers Wave 2: Southeast Corridor (MBS / Downtown)
  sim.triggerWave2('SOUTHEAST');
  assert.strictEqual(sim.currentWave, 2);
  const wave2Threats = sim.threats.filter(t => t.wave === 2);
  assert.strictEqual(wave2Threats.length, 16, 'Wave 2 must spawn 16 heavy threats');

  // Scramble and launch the preserved reserves
  swarm.runAuction();

  // Verify that all 16 Wave 2 threats are matched to defenders
  const assignedWave2 = wave2Threats.filter(t => t.assignedDefenderId !== null);
  assert.strictEqual(assignedWave2.length, 16, 'All 16 Wave 2 threats must have assigned defenders from reserve');

  // Step simulation until completion
  for (let step = 0; step < 500; step++) {
    sim.update(0.1);
    swarm.update();
  }

  // Outcome: Zero leakage! All 16 threats intercepted by the preserved reserves
  const wave2LeakedFinal = wave2Threats.filter(t => t.status === 'leaked').length;
  assert.strictEqual(wave2LeakedFinal, 0, 'Wave 2 should have 0 leaks with survival optimizer');
  assert.strictEqual(sim.stats.threatsLeaked, 0, 'Total threats leaked must be exactly 0');
  assert.strictEqual(sim.stats.threatsNeutralized, 24, 'All 24 threats (8 feint + 16 main body) successfully neutralized');
});
