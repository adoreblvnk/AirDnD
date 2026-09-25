// ==============================================================================
// AirDnD Tactical Air Defense Layer for God's Eye View
// Implements 3-Step Guided C2, 12-Threat Focused Dogfight, and ESP32 HIL
// ==============================================================================

import * as Cesium from 'cesium';
import { SG_COORDS, PROTECTED_ZONES, LITTORAL_KILLBOXES, TacticalSimulation } from './simulation.js';
import { SwarmCoordinator } from './swarm.js';
import { SerialBridge } from './serial.js';
import { soundFx } from './audio.js';
import { flyToSingapore } from '../camera.js';

export class AirDnDLayer {
  constructor(viewer) {
    this.viewer = viewer;
    this.sim = new TacticalSimulation();
    this.swarm = new SwarmCoordinator(this.sim);
    this.serial = null;
    this.threatEntities = new Map();
    this.defenderEntities = new Map();
    this.meshLines = null;
    this.isNoseCam = false;
    this.reactionSeconds = 60.0;
    this.lastFrameTime = performance.now();
    this.overlayElement = null;
    this.sim.initTwoWaveScenario('dont_take_the_bait');
    this.init();
  }

  async init() {
    // 1. Cinematic camera fly-in to Singapore
    flyToSingapore(this.viewer);

    // 2. Render Singapore Defense Geofences
    this.renderGeofences();

    // 3. Connect ESP32 Hardware Bus via SSE
    this.initHardwareBus();

    // 4. Inject Clean, Guided Tactical HUD Overlay
    this.injectHud();

    // 5. Run initial auction for Wave 1
    this.swarm.runAuction(true);

    // 6. Start unthrottled 30Hz simulation loop
    this.startLoop();

    soundFx.playRadarPing();
  }

  renderGeofences() {
    for (const zone of PROTECTED_ZONES) {
      const flatCoords = zone.coords.flat();
      this.viewer.entities.add({
        name: zone.name,
        polygon: {
          hierarchy: Cesium.Cartesian3.fromDegreesArray(flatCoords),
          extrudedHeight: zone.height,
          material: Cesium.Color.fromCssColorString(zone.color).withAlpha(0.22),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString(zone.color),
          outlineWidth: 2,
        },
      });
    }

    for (const kb of LITTORAL_KILLBOXES) {
      const flatCoords = kb.coords.flat();
      this.viewer.entities.add({
        name: kb.name,
        polygon: {
          hierarchy: Cesium.Cartesian3.fromDegreesArray(flatCoords),
          extrudedHeight: 250,
          material: Cesium.Color.fromCssColorString(kb.color).withAlpha(0.12),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString(kb.color).withAlpha(0.8),
          outlineWidth: 2,
        },
      });
    }

    this.meshLines = this.viewer.scene.primitives.add(new Cesium.PolylineCollection());
  }

  initHardwareBus() {
    this.serial = new SerialBridge(
      () => {},
      (telemetry) => {
        const loopElem = document.getElementById('airdndHwLoop');
        if (loopElem && telemetry.loopMs) loopElem.textContent = `${telemetry.loopMs} ms`;
      },
      () => {
        this.toggleJamming();
      }
    );

    // SSE connection to server-side serial stream
    try {
      const sse = new EventSource('/api/esp32/stream');
      sse.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          const loopElem = document.getElementById('airdndHwLoop');
          const badgeElem = document.getElementById('airdndHwBadge');
          if (loopElem && payload.loopMs) loopElem.textContent = `${payload.loopMs} ms`;
          if (badgeElem) {
            badgeElem.textContent = 'ONLINE (AUTO-BUS)';
            badgeElem.style.color = '#00e599';
          }
        } catch (_) {}
      };
    } catch (_) {}

    this.swarm.onHardwareBid = (tId, dId, score) => {
      this.serial.sendAuctionFrame(tId, dId, score);
    };

    this.sim.onIntercept = (lon, lat, alt) => {
      soundFx.playExplosion();
      this.spawnShockwave(lon, lat, alt);
    };
  }

  injectHud() {
    const hud = document.createElement('div');
    hud.id = 'airdndOverlay';
    hud.style.cssText = `
      position: absolute;
      top: 16px;
      left: 16px;
      z-index: 1000;
      pointer-events: none;
      display: flex;
      flex-direction: column;
      gap: 12px;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 12px;
      color: #f1f5f9;
    `;

    hud.innerHTML = `
      <!-- Top Tactical Header Card: Don't Take the Bait Console -->
      <div style="pointer-events:auto; background:rgba(8,12,20,0.94); border:1px solid rgba(0,216,246,0.35); border-radius:4px; padding:14px 16px; box-shadow:0 4px 24px rgba(0,0,0,0.7); width:400px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; border-bottom:1px solid rgba(255,255,255,0.08); padding-bottom:6px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="background:#00d8f6; color:#000; font-weight:900; font-size:11px; padding:2px 6px; border-radius:2px; font-family:monospace;">AIR-DND</span>
            <span style="font-weight:800; font-size:12px; letter-spacing:0.5px;">DON'T TAKE THE BAIT</span>
          </div>
          <span id="airdndHwBadge" style="font-size:10px; font-weight:700; color:#00e599; font-family:monospace;">WARGAME READY</span>
        </div>

        <!-- One-line pitch banner -->
        <div style="font-size:10.5px; font-style:italic; color:#94a3b8; margin-bottom:10px; background:rgba(0,216,246,0.05); border-left:2px solid #00d8f6; padding:4px 8px; border-radius:0 3px 3px 0;">
          “The judge controls the feint. Our swarm refuses to reveal or exhaust its defence.”
        </div>

        <!-- Mode Toggle: Naive Baseline vs. Don't Take the Bait -->
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:10px;">
          <button id="btnWargameBaseline" style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.15); color:#94a3b8; font-weight:700; padding:8px 4px; border-radius:3px; cursor:pointer; font-size:10px; transition:all 0.15s ease;">
            1. NAIVE BASELINE (OVERCOMMIT)
          </button>
          <button id="btnWargameSurvival" style="background:#00d8f6; border:1px solid #00d8f6; color:#000; font-weight:900; padding:8px 4px; border-radius:3px; cursor:pointer; font-size:10px; transition:all 0.15s ease;">
            2. SURVIVAL OPTIMIZER (ACTIVE)
          </button>
        </div>

        <!-- Wargame Step 1: Run Feint Wave -->
        <button id="btnWargameWave1" style="width:100%; background:rgba(0,229,153,0.18); border:1px solid #00e599; color:#00e599; font-weight:800; padding:8px; border-radius:3px; cursor:pointer; font-size:11px; letter-spacing:0.5px; margin-bottom:10px;">
          ▶ 1. INJECT WAVE 1: FEINT (8 APPARENT THREATS)
        </button>

        <!-- Wargame Step 2: Judge Wave 2 Feint Corridor Launchpad -->
        <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:3px; padding:8px; margin-bottom:10px;">
          <div style="font-size:9.5px; font-weight:800; color:#ffaa00; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px; display:flex; justify-content:space-between;">
            <span>⚡ JUDGE FEINT LAUNCHPAD (REVEAL WAVE 2)</span>
            <span style="color:#94a3b8;">16 THREATS</span>
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
            <button id="btnCorridorSE" style="background:#0d1522; border:1px solid rgba(255,51,85,0.4); color:#f1f5f9; font-weight:700; padding:6px 4px; border-radius:3px; cursor:pointer; font-size:9.5px;">
              SOUTHEAST (MBS / DOWNTOWN)
            </button>
            <button id="btnCorridorSW" style="background:#0d1522; border:1px solid rgba(255,51,85,0.4); color:#f1f5f9; font-weight:700; padding:6px 4px; border-radius:3px; cursor:pointer; font-size:9.5px;">
              SOUTHWEST (JURONG ISLAND)
            </button>
            <button id="btnCorridorSC" style="background:#0d1522; border:1px solid rgba(255,51,85,0.4); color:#f1f5f9; font-weight:700; padding:6px 4px; border-radius:3px; cursor:pointer; font-size:9.5px;">
              CENTRAL (PORT / SENTOSA)
            </button>
            <button id="btnCorridorE" style="background:#0d1522; border:1px solid rgba(255,51,85,0.4); color:#f1f5f9; font-weight:700; padding:6px 4px; border-radius:3px; cursor:pointer; font-size:9.5px;">
              EAST (CHANGI AIR BASE)
            </button>
          </div>
        </div>

        <!-- Expiring Readiness Clocks (Docked Interceptor Reachability) -->
        <div style="margin-bottom:10px;">
          <div style="font-size:9.5px; font-weight:800; color:#00d8f6; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px; display:flex; justify-content:space-between;">
            <span>EXPIRING READINESS CLOCKS</span>
            <span style="color:#94a3b8;">LATEST SAFE LAUNCH</span>
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:4px; font-family:monospace; font-size:9.5px;">
            <div style="background:rgba(255,255,255,0.03); padding:4px 6px; border-radius:2px; display:flex; justify-content:space-between;">
              <span style="color:#94a3b8;">SE (MBS):</span>
              <span id="clockSE" style="color:#00e599; font-weight:800;">CALCULATING</span>
            </div>
            <div style="background:rgba(255,255,255,0.03); padding:4px 6px; border-radius:2px; display:flex; justify-content:space-between;">
              <span style="color:#94a3b8;">SW (JURONG):</span>
              <span id="clockSW" style="color:#00e599; font-weight:800;">CALCULATING</span>
            </div>
            <div style="background:rgba(255,255,255,0.03); padding:4px 6px; border-radius:2px; display:flex; justify-content:space-between;">
              <span style="color:#94a3b8;">CENTRAL:</span>
              <span id="clockSC" style="color:#00e599; font-weight:800;">CALCULATING</span>
            </div>
            <div style="background:rgba(255,255,255,0.03); padding:4px 6px; border-radius:2px; display:flex; justify-content:space-between;">
              <span style="color:#94a3b8;">EAST (CHANGI):</span>
              <span id="clockE" style="color:#00e599; font-weight:800;">CALCULATING</span>
            </div>
          </div>
        </div>

        <!-- Live Scoreboard & Strategic Protection Readout -->
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:10px; font-size:10px;">
          <div style="background:rgba(255,255,255,0.03); padding:6px; border-radius:3px;">
            <div style="color:#94a3b8; font-size:9px;">STRATEGIC CORE STATUS</div>
            <div id="lblMbsStatus" style="font-size:11px; font-weight:800; color:#00e599; font-family:monospace; margin-top:2px;">
              MBS 100% SECURED
            </div>
          </div>
          <div style="background:rgba(255,255,255,0.03); padding:6px; border-radius:3px;">
            <div style="color:#94a3b8; font-size:9px;">DOCKED RESERVES</div>
            <div id="lblWargameFleet" style="font-size:11px; font-weight:800; color:#00d8f6; font-family:monospace; margin-top:2px;">
              20 / 30 HELD
            </div>
          </div>
        </div>

        <!-- Reset Button -->
        <button id="btnWargameReset" style="width:100%; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.12); color:#cbd5e1; font-weight:700; padding:6px; border-radius:3px; cursor:pointer; font-size:10px; margin-bottom:8px;">
          ↺ RESET WARGAME SCENARIO
        </button>

        <!-- Benchmark / Hardware Status Mini Row -->
        <div style="display:flex; justify-content:space-between; font-size:10px; font-family:monospace; color:#94a3b8; border-top:1px solid rgba(255,255,255,0.06); padding-top:6px;">
          <span>LEAKAGE: <strong id="airdndLeakage" style="color:#00e599;">0.0%</strong> <span id="lblLeakCompare">(vs 75% Baseline)</span></span>
          <span>LOOP: <strong id="airdndHwLoop" style="color:#00e599;">2.4 ms</strong></span>
        </div>
      </div>
    `;

    document.body.appendChild(hud);
    this.overlayElement = hud;

    // Bind Wargame HUD Events
    const btnBaseline = document.getElementById('btnWargameBaseline');
    const btnSurvival = document.getElementById('btnWargameSurvival');

    const updateModeButtons = (mode) => {
      if (mode === 'dont_take_the_bait') {
        btnSurvival.style.background = '#00d8f6';
        btnSurvival.style.borderColor = '#00d8f6';
        btnSurvival.style.color = '#000';
        btnSurvival.textContent = '2. SURVIVAL OPTIMIZER (ACTIVE)';
        btnBaseline.style.background = 'rgba(255,255,255,0.06)';
        btnBaseline.style.borderColor = 'rgba(255,255,255,0.15)';
        btnBaseline.style.color = '#94a3b8';
        btnBaseline.textContent = '1. NAIVE BASELINE (OVERCOMMIT)';
      } else {
        btnBaseline.style.background = '#ffaa00';
        btnBaseline.style.borderColor = '#ffaa00';
        btnBaseline.style.color = '#000';
        btnBaseline.textContent = '1. NAIVE BASELINE (ACTIVE)';
        btnSurvival.style.background = 'rgba(255,255,255,0.06)';
        btnSurvival.style.borderColor = 'rgba(255,255,255,0.15)';
        btnSurvival.style.color = '#94a3b8';
        btnSurvival.textContent = '2. SURVIVAL OPTIMIZER';
      }
    };

    btnBaseline?.addEventListener('click', () => {
      this.sim.initTwoWaveScenario('naive_baseline');
      this.swarm.runAuction(true);
      updateModeButtons('naive_baseline');
      soundFx.playRadioClick();
    });

    btnSurvival?.addEventListener('click', () => {
      this.sim.initTwoWaveScenario('dont_take_the_bait');
      this.swarm.runAuction(true);
      updateModeButtons('dont_take_the_bait');
      soundFx.playRadioClick();
    });

    document.getElementById('btnWargameWave1')?.addEventListener('click', () => {
      this.sim.initTwoWaveScenario(this.sim.scenarioMode);
      this.swarm.runAuction(true);
      soundFx.playRadioClick();
    });

    // Corridor Launchpad
    const triggerWave2Corridor = (corridorKey) => {
      this.sim.triggerWave2(corridorKey);
      this.swarm.runAuction(true);
      soundFx.playRadioClick();
    };

    document.getElementById('btnCorridorSE')?.addEventListener('click', () => triggerWave2Corridor('SOUTHEAST'));
    document.getElementById('btnCorridorSW')?.addEventListener('click', () => triggerWave2Corridor('SOUTHWEST'));
    document.getElementById('btnCorridorSC')?.addEventListener('click', () => triggerWave2Corridor('CENTRAL'));
    document.getElementById('btnCorridorE')?.addEventListener('click', () => triggerWave2Corridor('EAST'));

    document.getElementById('btnWargameReset')?.addEventListener('click', () => {
      this.sim.initTwoWaveScenario(this.sim.scenarioMode);
      this.swarm.runAuction(true);
      soundFx.playRadioClick();
    });

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.key === 'c' || e.key === 'C') {
        this.toggleNoseCam();
      } else if (e.key === 'j' || e.key === 'J') {
        this.toggleJamming();
      } else if (e.key === '1') {
        btnBaseline?.click();
      } else if (e.key === '2') {
        btnSurvival?.click();
      }
    });
  }

  toggleJamming() {
    const nextState = !this.sim.isJammingActive;
    this.swarm.setJamming(nextState);
    const btn = document.getElementById('btnAirDndJam');
    const txt = document.getElementById('txtAirDndJam');

    if (nextState) {
      if (btn) {
        btn.style.background = '#ff3355';
        btn.style.color = '#000';
      }
      if (txt) txt.textContent = 'EW JAMMING ACTIVE (0% GROUND TELEMETRY)';
      soundFx.playJammingAlarm();
    } else {
      if (btn) {
        btn.style.background = 'rgba(255,51,85,0.15)';
        btn.style.color = '#ff3355';
      }
      if (txt) txt.textContent = 'INJECT ENEMY EW JAMMING';
      soundFx.playRadioClick();
    }
  }

  toggleNoseCam() {
    this.isNoseCam = !this.isNoseCam;
    if (!this.isNoseCam) {
      flyToSingapore(this.viewer);
    }
  }

  spawnShockwave(lon, lat, alt) {
    const shockId = `shock-${Date.now()}-${Math.random()}`;
    const pos = Cesium.Cartesian3.fromDegrees(lon, lat, Math.max(15, alt));
    const shockEntity = this.viewer.entities.add({
      id: shockId,
      position: pos,
      ellipse: {
        semiMinorAxis: 150,
        semiMajorAxis: 150,
        material: Cesium.Color.ORANGE.withAlpha(0.65),
        outline: true,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
      },
    });

    setTimeout(() => {
      this.viewer.entities.remove(shockEntity);
    }, 700);
  }

  startLoop() {
    this.syncVisuals();

    // 30Hz Simulation physics tick
    setInterval(() => {
      this.sim.update(0.033);
      this.swarm.update();
      this.syncVisuals();
      this.updateHud();
    }, 33);

    // Camera follow render loop
    const renderLoop = (currentTime) => {
      this.lastFrameTime = currentTime;
      if (this.isNoseCam) {
        const d0 = this.sim.interceptors[0];
        if (d0 && d0.status !== 'lost') {
          let targetHeading = 0;
          if (d0.targetId) {
            const target = this.sim.threats.find(t => t.id === d0.targetId);
            if (target) {
              targetHeading = Math.atan2(target.lon - d0.lon, target.lat - d0.lat);
            }
          }
          const camPos = Cesium.Cartesian3.fromDegrees(
            d0.lon - Math.sin(targetHeading) * 0.0004,
            d0.lat - Math.cos(targetHeading) * 0.0004,
            d0.alt + 18
          );
          this.viewer.camera.setView({
            destination: camPos,
            orientation: {
              heading: targetHeading,
              pitch: Cesium.Math.toRadians(-6),
              roll: 0.0,
            },
          });
        }
      }
      requestAnimationFrame(renderLoop);
    };
    requestAnimationFrame(renderLoop);
  }

  syncVisuals() {
    // 1. Sync Threats (3D MQ-9 Models)
    for (const t of this.sim.threats) {
      if (t.status === 'intercepted' || t.status === 'leaked') {
        if (this.threatEntities.has(t.id)) {
          this.viewer.entities.remove(this.threatEntities.get(t.id));
          this.threatEntities.delete(t.id);
        }
        continue;
      }

      const pos = Cesium.Cartesian3.fromDegrees(t.lon, t.lat, t.alt);
      const headingRad = Math.atan2(t.targetLon - t.lon, t.targetLat - t.lat);
      const hpr = new Cesium.HeadingPitchRoll(headingRad, 0.0, 0.0);
      const orientation = Cesium.Transforms.headingPitchRollQuaternion(pos, hpr);
      let entity = this.threatEntities.get(t.id);

      if (!entity) {
        entity = this.viewer.entities.add({
          id: t.id,
          position: pos,
          orientation: orientation,
          model: {
            uri: '/models/mq9.glb',
            minimumPixelSize: 32,
            maximumScale: 150,
            scale: 2.2,
          },
          point: {
            pixelSize: 7,
            color: Cesium.Color.RED,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 1,
          },
        });
        this.threatEntities.set(t.id, entity);
      } else {
        entity.position = pos;
        entity.orientation = orientation;
      }
    }

    // 2. Sync Interceptors (3D Jet Models)
    for (const d of this.sim.interceptors) {
      if (d.status === 'lost') {
        if (this.defenderEntities.has(d.id)) {
          this.viewer.entities.remove(this.defenderEntities.get(d.id));
          this.defenderEntities.delete(d.id);
        }
        continue;
      }

      const pos = Cesium.Cartesian3.fromDegrees(d.lon, d.lat, d.alt);
      let headingRad = 0;
      if (d.targetId) {
        const target = this.sim.threats.find(t => t.id === d.targetId);
        if (target) {
          headingRad = Math.atan2(target.lon - d.lon, target.lat - d.lat);
        }
      }
      const hpr = new Cesium.HeadingPitchRoll(headingRad, 0.0, 0.0);
      const orientation = Cesium.Transforms.headingPitchRollQuaternion(pos, hpr);
      let entity = this.defenderEntities.get(d.id);

      if (!entity) {
        entity = this.viewer.entities.add({
          id: d.id,
          position: pos,
          orientation: orientation,
          model: {
            uri: '/models/jet.glb',
            minimumPixelSize: 28,
            maximumScale: 150,
            scale: 1.8,
          },
          point: {
            pixelSize: d.isPhysicalHwNode ? 12 : 8,
            color: d.isPhysicalHwNode ? Cesium.Color.YELLOW : Cesium.Color.CYAN,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 1,
          },
        });
        this.defenderEntities.set(d.id, entity);
      } else {
        entity.position = pos;
        entity.orientation = orientation;
      }
    }

    // 3. Draw Dynamic P2P Mesh Lines
    if (this.meshLines) {
      this.meshLines.removeAll();
      const activeDefenders = this.sim.interceptors.filter(d => d.status !== 'lost' && d.status !== 'docked');
      for (let i = 0; i < activeDefenders.length; i++) {
        for (let j = i + 1; j < activeDefenders.length; j++) {
          const d1 = activeDefenders[i];
          const d2 = activeDefenders[j];
          const dLon = d1.lon - d2.lon;
          const dLat = d1.lat - d2.lat;
          const distKm = Math.sqrt(dLon * dLon + dLat * dLat) * 111;

          if (distKm < 10) {
            const p1 = Cesium.Cartesian3.fromDegrees(d1.lon, d1.lat, d1.alt);
            const p2 = Cesium.Cartesian3.fromDegrees(d2.lon, d2.lat, d2.alt);
            const lineColor = this.sim.isJammingActive 
              ? Cesium.Color.fromCssColorString('#00ff88').withAlpha(0.4) 
              : Cesium.Color.fromCssColorString('#0077ff').withAlpha(0.2);

            this.meshLines.add({
              positions: [p1, p2],
              width: this.sim.isJammingActive ? 2 : 1,
              material: Cesium.Material.fromType('Color', { color: lineColor }),
            });
          }
        }
      }
    }
  }

  updateHud() {
    const leakElem = document.getElementById('airdndLeakage');
    const leakCompareElem = document.getElementById('lblLeakCompare');
    const mbsStatusElem = document.getElementById('lblMbsStatus');
    const fleetElem = document.getElementById('lblWargameFleet');

    const dockedCount = this.sim.interceptors.filter(d => d.status === 'docked').length;
    const activeCount = this.sim.interceptors.filter(d => d.status === 'launched' || d.status === 'intercepting').length;

    if (fleetElem) {
      fleetElem.textContent = `${dockedCount} / 30 HELD`;
      fleetElem.style.color = dockedCount >= 15 ? '#00d8f6' : '#ffaa00';
    }

    const total = this.sim.stats.threatsNeutralized + this.sim.stats.threatsLeaked;
    const pct = total > 0 ? (this.sim.stats.threatsLeaked / total) * 100 : 0.0;

    if (leakElem) {
      leakElem.textContent = `${pct.toFixed(1)}%`;
      leakElem.style.color = pct === 0 ? '#00e599' : '#ff3355';
    }

    if (leakCompareElem) {
      if (this.sim.scenarioMode === 'naive_baseline') {
        leakCompareElem.textContent = '(BASELINE DEPLETED)';
        leakCompareElem.style.color = '#ffaa00';
      } else {
        leakCompareElem.textContent = '(vs 75% Baseline)';
        leakCompareElem.style.color = '#94a3b8';
      }
    }

    if (mbsStatusElem) {
      if (this.sim.scenarioMode === 'naive_baseline') {
        if (this.sim.stats.threatsLeaked > 0) {
          mbsStatusElem.textContent = `MBS BREACHED (${this.sim.stats.threatsLeaked} LEAKED)`;
          mbsStatusElem.style.color = '#ff3355';
        } else if (this.sim.currentWave >= 2) {
          mbsStatusElem.textContent = 'MBS EXPOSED (0 RESERVES)';
          mbsStatusElem.style.color = '#ffaa00';
        } else {
          mbsStatusElem.textContent = 'OVERCOMMITTED (FLEET AT RISK)';
          mbsStatusElem.style.color = '#ffaa00';
        }
      } else {
        if (this.sim.stats.threatsLeaked > 0) {
          mbsStatusElem.textContent = `MBS BREACHED (${this.sim.stats.threatsLeaked} LEAKED)`;
          mbsStatusElem.style.color = '#ff3355';
        } else {
          mbsStatusElem.textContent = 'MBS 100% SECURED';
          mbsStatusElem.style.color = '#00e599';
        }
      }
    }

    // Update 4 Expiring Readiness Clocks
    const updateClock = (elemId, corridorKey) => {
      const el = document.getElementById(elemId);
      if (!el) return;
      const clockData = this.swarm.expiringClocks.get(corridorKey);
      if (!clockData || clockData.deadlineSec <= 0) {
        if (dockedCount === 0) {
          el.textContent = 'EXPIRED (0 RSV)';
          el.style.color = '#ff3355';
        } else {
          el.textContent = 'STANDBY';
          el.style.color = '#94a3b8';
        }
      } else {
        const sec = clockData.deadlineSec.toFixed(1);
        el.textContent = `${sec}s [${clockData.reachableCount} Rsv]`;
        if (clockData.deadlineSec > 25) {
          el.style.color = '#00e599';
        } else if (clockData.deadlineSec > 12) {
          el.style.color = '#ffaa00';
        } else {
          el.style.color = '#ff3355';
        }
      }
    };

    updateClock('clockSE', 'SOUTHEAST');
    updateClock('clockSW', 'SOUTHWEST');
    updateClock('clockSC', 'CENTRAL');
    updateClock('clockE', 'EAST');
  }
}
