// ==============================================================================
// AirDnD Tactical Air Defense Layer for AirDnD
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

    // 5. Start unthrottled 30Hz simulation loop
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
      <!-- Top Tactical Header Card -->
      <div style="pointer-events:auto; background:rgba(8,12,20,0.92); border:1px solid rgba(0,216,246,0.3); border-radius:4px; padding:12px 16px; box-shadow:0 4px 20px rgba(0,0,0,0.6); width:380px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; border-bottom:1px solid rgba(255,255,255,0.08); padding-bottom:6px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="background:#00d8f6; color:#000; font-weight:900; font-size:11px; padding:2px 6px; border-radius:2px; font-family:monospace;">AIR-DND</span>
            <span style="font-weight:700; font-size:12px; letter-spacing:0.5px;">LITTORAL AIR DEFENSE C2</span>
          </div>
          <span id="airdndHwBadge" style="font-size:10px; font-weight:700; color:#ffaa00; font-family:monospace;">CONNECTING BUS...</span>
        </div>

        <!-- 3-Step Guided Progression Bar -->
        <div style="display:flex; justify-content:space-between; font-size:10px; font-weight:700; color:#94a3b8; margin-bottom:12px; background:rgba(255,255,255,0.04); padding:4px 8px; border-radius:3px;">
          <span style="color:#00d8f6;">1. DETECT</span>
          <span>➔</span>
          <span id="stepAuthText" style="color:#94a3b8;">2. AUTHORIZE</span>
          <span>➔</span>
          <span id="stepEngageText" style="color:#94a3b8;">3. ENGAGE</span>
        </div>

        <!-- Status Metrics -->
        <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; margin-bottom:12px; text-align:center;">
          <div style="background:rgba(255,255,255,0.03); padding:6px; border-radius:3px;">
            <div style="font-size:9px; color:#94a3b8; text-transform:uppercase;">Hostiles</div>
            <div id="airdndThreats" style="font-size:15px; font-weight:800; color:#ff3355; font-family:monospace;">100</div>
          </div>
          <div style="background:rgba(255,255,255,0.03); padding:6px; border-radius:3px;">
            <div style="font-size:9px; color:#94a3b8; text-transform:uppercase;">Defenders</div>
            <div id="airdndDefenders" style="font-size:15px; font-weight:800; color:#00e599; font-family:monospace;">30</div>
          </div>
          <div style="background:rgba(255,255,255,0.03); padding:6px; border-radius:3px;">
            <div style="font-size:9px; color:#94a3b8; text-transform:uppercase;">Reaction Window</div>
            <div id="airdndReaction" style="font-size:15px; font-weight:800; color:#ff3355; font-family:monospace;">60.0s</div>
          </div>
        </div>

        <!-- Strategy Selection & 1-Click Authorize -->
        <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:10px;">
          <div style="font-size:10.5px; color:#94a3b8;">Strategic Intent (Select Course of Action):</div>
          <select id="selStrategy" style="background:#0d1522; border:1px solid rgba(0,216,246,0.3); color:#f1f5f9; padding:6px 8px; border-radius:3px; font-size:11px; font-family:inherit;">
            <option value="waterline" selected>1. Waterline Intercept (Recommended — Sea Engagement)</option>
            <option value="shield">2. Critical Asset Shield (Jurong & Changi Focus)</option>
            <option value="economy">3. Economy Reserve (30% Held for Follow-on Waves)</option>
          </select>
          <button id="btnAirDndAuth" style="background:#00e599; border:none; color:#000; font-weight:800; padding:10px; border-radius:3px; cursor:pointer; font-size:11px; letter-spacing:0.5px; transition:all 0.15s ease;">
            AUTHORIZE STRATEGY (1-CLICK)
          </button>
        </div>

        <!-- Jamming Simulation Trigger -->
        <button id="btnAirDndJam" style="width:100%; background:rgba(255,51,85,0.15); border:1px solid #ff3355; color:#ff3355; font-weight:800; padding:8px; border-radius:3px; cursor:pointer; font-size:11px; letter-spacing:0.5px; margin-bottom:8px;">
          <span id="txtAirDndJam">INJECT ENEMY EW JAMMING</span>
        </button>

        <!-- Benchmark / Hardware Status Mini Row -->
        <div style="display:flex; justify-content:space-between; font-size:10px; font-family:monospace; color:#94a3b8; border-top:1px solid rgba(255,255,255,0.06); padding-top:6px;">
          <span>LEAKAGE: <strong id="airdndLeakage" style="color:#00e599;">0.0%</strong> (vs 28% Baseline)</span>
          <span>LOOP: <strong id="airdndHwLoop" style="color:#00e599;">2.4 ms</strong></span>
        </div>
      </div>
    `;

    document.body.appendChild(hud);
    this.overlayElement = hud;

    // Bind HUD events
    document.getElementById('btnAirDndAuth')?.addEventListener('click', () => {
      this.sim.isAuthorized = true;
      const btn = document.getElementById('btnAirDndAuth');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'ROE AUTHORIZED — SWARM ENGAGING';
        btn.style.background = '#334155';
        btn.style.color = '#94a3b8';
      }
      const stepAuth = document.getElementById('stepAuthText');
      const stepEng = document.getElementById('stepEngageText');
      if (stepAuth) stepAuth.style.color = '#00e599';
      if (stepEng) stepEng.style.color = '#00d8f6';

      for (const d of this.sim.interceptors) {
        if (d.status !== 'lost') d.status = 'launched';
      }
      this.swarm.runAuction(true);
      soundFx.playRadioClick();
    });

    document.getElementById('btnAirDndJam')?.addEventListener('click', () => {
      this.toggleJamming();
    });

    document.getElementById('selStrategy')?.addEventListener('change', (e) => {
      this.sim.activeStrategy = e.target.value;
      if (this.sim.isAuthorized) this.swarm.runAuction(true);
      soundFx.playRadioClick();
    });

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.key === 'c' || e.key === 'C') {
        this.toggleNoseCam();
      } else if (e.key === 'j' || e.key === 'J') {
        this.toggleJamming();
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
    const threatsElem = document.getElementById('airdndThreats');
    const defendersElem = document.getElementById('airdndDefenders');
    const reactElem = document.getElementById('airdndReaction');
    const leakElem = document.getElementById('airdndLeakage');

    if (threatsElem) threatsElem.textContent = this.sim.stats.threatsActive;
    if (defendersElem) defendersElem.textContent = this.sim.stats.interceptorsActive;

    if (reactElem) {
      if (this.sim.stats.threatsActive === 0 && this.sim.stats.threatsNeutralized > 0) {
        reactElem.textContent = `${this.reactionSeconds.toFixed(1)}s [SECURED]`;
        reactElem.style.color = '#00e599';
      } else if (this.sim.isAuthorized) {
        this.reactionSeconds = Math.max(0, this.reactionSeconds - 0.033 * this.sim.timeMultiplier);
        reactElem.textContent = `${this.reactionSeconds.toFixed(1)}s`;
        reactElem.style.color = this.reactionSeconds > 20 ? '#00e599' : '#ff3355';
      } else {
        reactElem.textContent = '60.0s';
      }
    }

    if (leakElem) {
      const total = this.sim.stats.threatsNeutralized + this.sim.stats.threatsLeaked;
      const pct = total > 0 ? (this.sim.stats.threatsLeaked / total) * 100 : 0.0;
      leakElem.textContent = `${pct.toFixed(1)}%`;
    }
  }
}
