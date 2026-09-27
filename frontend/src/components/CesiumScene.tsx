import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Cartesian2,
  Cartesian3,
  Color,
  DistanceDisplayCondition,
  GoogleMaps,
  HeadingPitchRoll,
  HorizontalOrigin,
  Ion,
  IonGeocodeProviderType,
  JulianDate,
  LabelStyle,
  Matrix4,
  NearFarScalar,
  PolygonHierarchy,
  SampledPositionProperty,
  Transforms,
  VelocityOrientationProperty,
  VerticalOrigin,
  createGooglePhotorealistic3DTileset,
  type Cesium3DTileset
} from "cesium";
import { Entity, ModelGraphics, Viewer, useCesium } from "resium";
import type { ReplayModel, TrackSample, Vec3 } from "../replay";
import { closestSafetyTelemetry, latestAgentTelemetry, latestTargetTelemetry, sampleTrack } from "../replay";

// Marina Bay anchor. Local +Y is north/inland and -Y is south/open sea, so the
// recorded hostile tracks naturally approach Singapore from the sea.
const ORIGIN = Cartesian3.fromDegrees(103.8565, 1.2835, 0);
const LOCAL_TO_WORLD = Transforms.eastNorthUpToFixedFrame(ORIGIN);
const FRIENDLY = Color.fromCssColorString("#55a7e8");
const FRIENDLY_SOFT = Color.fromCssColorString("#8ac8f3");
const CORAL = Color.fromCssColorString("#e98478");
const AMBER = Color.fromCssColorString("#eeb84f");
const WHITE = Color.fromCssColorString("#e6edf2");
const MODEL_URI = "/models/CesiumDrone.glb";
const MISSION_EPOCH = JulianDate.fromIso8601("2026-01-01T00:00:00Z");

export type SceneMode =
  | "overview"
  | "forward"
  | "observer"
  | "contact"
  | "miss"
  | "uncertainty"
  | "identity"
  | "safety"
  | "fleet";

interface CesiumSceneProps {
  model: ReplayModel | null;
  time: number;
  mode?: SceneMode;
  truthOverlay?: boolean;
  className?: string;
  onTileState?: (state: "loading" | "ready" | "error") => void;
}

function world(position: Vec3) {
  return Matrix4.multiplyByPoint(LOCAL_TO_WORLD, new Cartesian3(position[0], position[1], position[2]), new Cartesian3());
}

function worldOrientation(position: Vec3, heading = 0) {
  return Transforms.headingPitchRollQuaternion(world(position), new HeadingPitchRoll(heading, 0, 0));
}

type CameraStyle = "plan" | "horizon";

function WorldLoader({ model, mode, time, cameraStyle, onTileState }: Pick<CesiumSceneProps, "model" | "mode" | "time" | "onTileState"> & { cameraStyle: CameraStyle }) {
  const { viewer } = useCesium();

  useEffect(() => {
    if (!viewer) return;
    const token = import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined;
    const googleKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
    if (!token || !googleKey) {
      onTileState?.("error");
      return;
    }

    Ion.defaultAccessToken = token;
    GoogleMaps.defaultApiKey = googleKey;
    viewer.scene.globe.show = false;
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
    viewer.scene.fog.enabled = true;
    viewer.scene.highDynamicRange = true;
    viewer.scene.postProcessStages.fxaa.enabled = true;
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 35;
    viewer.scene.screenSpaceCameraController.maximumZoomDistance = 9000;
    viewer.scene.backgroundColor = Color.fromCssColorString("#9bb2bd");
    const removeRenderErrorListener = viewer.scene.renderError.addEventListener(() => {
      onTileState?.("error");
    });

    let cancelled = false;
    let tileset: Cesium3DTileset | undefined;
    onTileState?.("loading");
    createGooglePhotorealistic3DTileset({ key: googleKey, onlyUsingWithGoogleGeocoder: true })
      .then((loaded) => {
        if (cancelled) {
          loaded.destroy();
          return;
        }
        tileset = viewer.scene.primitives.add(loaded);
        onTileState?.("ready");
      })
      .catch(() => onTileState?.("error"));

    return () => {
      cancelled = true;
      removeRenderErrorListener();
      if (tileset && !tileset.isDestroyed()) viewer.scene.primitives.remove(tileset);
    };
  }, [viewer, onTileState]);

  const overviewPhase = time < 32 ? "launch" : "mission";
  const identityEvent = model && mode === "identity" ? latestAgentTelemetry(model, time, "I000") : null;
  const identityObserver = identityEvent?.agent_local?.estimated_position;
  const identityTarget = identityEvent?.agent_local?.local_target_position;
  const identityKey = identityEvent?.agent_local?.target_id ?? "pending";
  useEffect(() => {
    if (!viewer) return;
    const destinations: Record<SceneMode, { position: Vec3; heading: number; pitch: number }> = {
      overview: overviewPhase === "launch"
        ? { position: [0, 800, 2_400], heading: 180, pitch: -55 }
        : { position: [0, -1_000, 4_200], heading: 180, pitch: -68 },
      forward: { position: [-120, 900, 420], heading: 180, pitch: -8 },
      observer: { position: [120, 1_300, 1_600], heading: 180, pitch: -48 },
      contact: { position: [-300, 1_000, 520], heading: 180, pitch: -20 },
      miss: { position: [300, 1_000, 520], heading: 180, pitch: -20 },
      uncertainty: { position: [0, 1_500, 1_850], heading: 180, pitch: -28 },
      identity: { position: [0, 1_600, 1_150], heading: 180, pitch: -18 },
      safety: { position: [0, 1_400, 1_600], heading: 180, pitch: -65 },
      fleet: { position: [-700, 1_300, 1_500], heading: 180, pitch: -31 }
    };
    let target = destinations[mode ?? "overview"];
    if (mode === "identity" && identityObserver && identityTarget) {
      const midpoint: Vec3 = [
        (identityObserver[0] + identityTarget[0]) / 2,
        (identityObserver[1] + identityTarget[1]) / 2,
        (identityObserver[2] + identityTarget[2]) / 2
      ];
      const separation = Math.hypot(
        identityObserver[0] - identityTarget[0],
        identityObserver[1] - identityTarget[1],
        identityObserver[2] - identityTarget[2]
      );
      if (cameraStyle === "plan") {
        target = { position: [midpoint[0], midpoint[1] - separation * 0.21, midpoint[2] + Math.max(2_200, separation * 1.5)], heading: 0, pitch: -82 };
      } else {
        const range = Math.max(1_400, separation * 1.7);
        const cameraPosition: Vec3 = [midpoint[0] + range, midpoint[1] + range * 0.12, midpoint[2] + Math.max(420, range * 0.18)];
        const dx = midpoint[0] - cameraPosition[0];
        const dy = midpoint[1] - cameraPosition[1];
        target = {
          position: cameraPosition,
          heading: Math.atan2(dx, dy) * 180 / Math.PI,
          pitch: -Math.atan2(cameraPosition[2] - midpoint[2], Math.hypot(dx, dy)) * 180 / Math.PI
        };
      }
    } else if (cameraStyle === "horizon") {
      if (mode === "overview") {
        target = overviewPhase === "launch"
          ? { position: [0, 1_800, 760], heading: 180, pitch: -16 }
          : { position: [0, 2_400, 950], heading: 180, pitch: -14 };
      } else {
        target = { ...target, position: [target.position[0], target.position[1], Math.min(target.position[2], 900)], pitch: -16 };
      }
    }
    viewer.camera.setView({
      destination: world(target.position),
      orientation: {
        heading: CesiumMathRadians(target.heading),
        pitch: CesiumMathRadians(target.pitch),
        roll: 0
      }
    });
  }, [viewer, mode, overviewPhase, cameraStyle, identityKey]);

  return null;
}

function RenderOnTime({ time }: { time: number }) {
  const { viewer } = useCesium();
  useEffect(() => {
    if (!viewer) return;
    viewer.clock.currentTime = JulianDate.addSeconds(MISSION_EPOCH, time, new JulianDate());
    viewer.scene.requestRender();
  }, [viewer, time]);
  return null;
}

function CesiumMathRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

const label = (text: string, color = WHITE) => ({
  text,
  font: "600 13px Inter, sans-serif",
  fillColor: color,
  outlineColor: Color.fromCssColorString("#071014"),
  outlineWidth: 3,
  style: LabelStyle.FILL_AND_OUTLINE,
  showBackground: true,
  backgroundColor: Color.fromCssColorString("#071014").withAlpha(0.82),
  backgroundPadding: new Cartesian2(6, 4),
  pixelOffset: new Cartesian2(0, -30),
  horizontalOrigin: HorizontalOrigin.CENTER,
  verticalOrigin: VerticalOrigin.BOTTOM,
  distanceDisplayCondition: new DistanceDisplayCondition(0, 10000),
  scaleByDistance: new NearFarScalar(500, 1, 10000, 0.72),
  disableDepthTestDistance: Number.POSITIVE_INFINITY
});

const droneModel = (color: Color, scale = 1.2) => ({
  uri: MODEL_URI,
  color,
  colorBlendAmount: 0.42,
  minimumPixelSize: 44,
  maximumScale: 20000,
  scale,
  distanceDisplayCondition: new DistanceDisplayCondition(0, 12000),
  silhouetteColor: color.withAlpha(0.92),
  silhouetteSize: 1.4
});

function SectorGeometry() {
  const sectors = [
    { name: "A", x0: -360, x1: -120 },
    { name: "B", x0: -120, x1: 120 },
    { name: "C", x0: 120, x1: 360 }
  ];
  return (
    <>
      {sectors.map((sector) => {
        const footprint = [
          world([sector.x0, -200, 2]), world([sector.x1, -200, 2]), world([sector.x1, -4_800, 2]),
          world([sector.x0, -4_800, 2]), world([sector.x0, -200, 2])
        ];
        return (
          <Entity key={sector.name}>
            <Entity polyline={{ positions: footprint, width: 1, material: FRIENDLY_SOFT.withAlpha(0.4) }} />
            <Entity position={world([(sector.x0 + sector.x1) / 2, -260, 4])} label={label(sector.name, WHITE.withAlpha(0.8))} />
          </Entity>
        );
      })}
      {[-360, -120, 120, 360].map((x) => (
        <Entity key={`partition-${x}`} polyline={{
          positions: [world([x, -200, 0]), world([x, -4_800, 0]), world([x, -4_800, 400]), world([x, -200, 400]), world([x, -200, 0])],
          width: 1,
          material: WHITE.withAlpha(0.18)
        }} />
      ))}
      {[170, 350].map((height) => (
        <Entity key={`layer-${height}`} polygon={{
          hierarchy: new PolygonHierarchy([
            world([-360, -200, height]), world([360, -200, height]), world([360, -4_800, height]), world([-360, -4_800, height])
          ]),
          perPositionHeight: true,
          material: FRIENDLY.withAlpha(height === 170 ? 0.075 : 0.05),
          outline: true,
          outlineColor: FRIENDLY_SOFT.withAlpha(0.32)
        }} />
      ))}
      <Entity position={world([-325, -320, 180])} label={label("Active layer", FRIENDLY_SOFT)} />
      <Entity position={world([-300, -320, 360])} label={label("Reserve · observing", FRIENDLY_SOFT)} />
      <Entity position={world([0, 1_200, 20])} label={label("SINGAPORE COAST · LAUNCH", FRIENDLY_SOFT)} />
      <Entity position={world([0, -5_200, 20])} label={label("OPEN SEA · HOSTILE INGRESS", CORAL)} />
    </>
  );
}


function sampledPosition(samples: TrackSample[]) {
  const property = new SampledPositionProperty();
  property.addSamples(
    samples.map((sample) => JulianDate.addSeconds(MISSION_EPOCH, sample.time, new JulianDate())),
    samples.map((sample) => world(sample.position))
  );
  return property;
}

function ReplayEntities({ model, time, mode, truthOverlay }: Required<Pick<CesiumSceneProps, "time" | "mode" | "truthOverlay">> & Pick<CesiumSceneProps, "model">) {
  const friendlies = useMemo(() => model ? Array.from(model.tracks.entries()).map(([id, samples]) => ({
    id,
    samples,
    position: sampledPosition(samples),
    removedAt: model.removedAt.get(id)
  })) : [], [model]);
  const hostiles = useMemo(() => model ? Array.from(model.hostileTracks.entries()).map(([id, samples]) => ({
    id,
    samples,
    position: sampledPosition(samples),
    removedAt: model.removedAt.get(id)
  })) : [], [model]);
  const localSelection = useMemo(() => {
    if (!model || (mode !== "forward" && mode !== "observer" && mode !== "identity")) return null;
    const event = mode === "identity"
      ? latestAgentTelemetry(model, time, "I000")
      : latestTargetTelemetry(model, time, mode === "observer");
    const agentId = event?.agent_local?.agent_id;
    const hostileId = event?.agent_local?.target_id;
    return agentId && hostileId ? { agentId, hostileId } : null;
  }, [model, mode, time]);
  const localTracks = useMemo(() => {
    if (!model || !localSelection) return null;
    const own: TrackSample[] = [];
    const target: TrackSample[] = [];
    for (const event of model.data.events) {
      if (event.kind !== "trajectory_step" || event.agent_local?.agent_id !== localSelection.agentId) continue;
      if (event.agent_local.estimated_position) own.push({ time: event.time_s, position: event.agent_local.estimated_position });
      if (event.agent_local.target_id === localSelection.hostileId && event.agent_local.local_target_position) {
        target.push({ time: event.time_s, position: event.agent_local.local_target_position });
      }
    }
    return {
      ownSamples: own,
      targetSamples: target
    };
  }, [model, localSelection]);
  const localOwnPosition = localTracks ? sampleTrack(localTracks.ownSamples, time) : null;
  const localTargetPosition = localTracks ? sampleTrack(localTracks.targetSamples, time) : null;
  const impacts = useMemo(() => model?.impacts
    .filter((impact) => time >= impact.time && time < impact.time + 1.5)
    .map((impact) => ({ ...impact, progress: (time - impact.time) / 1.5 })) ?? [], [model, time]);
  const reservePositions: Vec3[] = [[-250, 300, 350], [0, 410, 360], [260, 520, 345]];
  const safetyEvent = useMemo(() => model ? closestSafetyTelemetry(model, time) : null, [model, time]);
  const safetyPosition = safetyEvent?.agent_local?.estimated_position;
  const preferredVelocity = safetyEvent?.agent_local?.preferred_velocity;
  const safeVelocity = safetyEvent?.agent_local?.safe_velocity;
  const localMode = mode === "forward" || mode === "observer" || mode === "identity";

  if (mode === "uncertainty") return <UncertaintyEntities model={model} time={time} />;

  if (localMode) {
    return (
      <>
        <SectorGeometry />
        {localOwnPosition && localSelection && (
          <Entity
            position={world(localOwnPosition)}
            orientation={worldOrientation(localOwnPosition)}
            label={label(`${localSelection.agentId} · local INS`, FRIENDLY_SOFT)}
          >
            <ModelGraphics {...droneModel(FRIENDLY, 2.4)} />
          </Entity>
        )}
        {localTargetPosition && localSelection && (
          <Entity position={world(localTargetPosition)} label={label(`${localSelection.hostileId} · ${localSelection.agentId} local track`, AMBER)}>
            <Entity ellipsoid={{ radii: new Cartesian3(22, 22, 22), material: AMBER.withAlpha(0.28), outline: true, outlineColor: AMBER }} />
            <Entity polyline={{ positions: localTracks?.targetSamples.filter((sample) => sample.time <= time).slice(-60).map((sample) => world(sample.position)), width: 2, material: AMBER.withAlpha(0.72) }} />
          </Entity>
        )}
      </>
    );
  }

  return (
    <>
      {mode === "overview" && <SectorGeometry />}
      {friendlies.map(({ id, position, samples, removedAt }, index) => {
        const visible = time >= samples[0].time && (removedAt === undefined || time < removedAt);
        const current = samples.reduce((selected, sample) => sample.time <= time ? sample : selected, samples[0]);
        return visible && (
          <Entity key={id} position={position} orientation={new VelocityOrientationProperty(position)} label={index % 4 === 0 ? label(id, FRIENDLY_SOFT) : undefined}>
            <ModelGraphics {...droneModel(FRIENDLY)} />
            <Entity polyline={{ positions: samples.filter((sample) => sample.time <= time).slice(-80).filter((_, sampleIndex) => sampleIndex % 2 === 0).map((sample) => world(sample.position)), width: 2, material: FRIENDLY.withAlpha(0.58) }} />
            <Entity polyline={{ positions: [world([current.position[0], current.position[1], 0]), world(current.position)], width: 1, material: FRIENDLY_SOFT.withAlpha(0.38) }} />
            <Entity position={world([current.position[0], current.position[1], 1])} ellipse={{ semiMajorAxis: 7, semiMinorAxis: 7, material: FRIENDLY.withAlpha(0.12), outline: true, outlineColor: FRIENDLY.withAlpha(0.35) }} />
            {index === 1 && mode === "overview" && <Entity position={world([current.position[0], current.position[1], Math.max(current.position[2] - 80, 60)])} cylinder={{ length: 160, topRadius: 5, bottomRadius: 95, material: FRIENDLY.withAlpha(0.09), outline: true, outlineColor: FRIENDLY.withAlpha(0.2) }} />}
          </Entity>
        );
      })}
      {mode === "overview" && (model?.data.config.hostiles ?? 0) <= 1 && reservePositions.map((position, index) => (
        <Entity key={`reserve-${index}`} position={world(position)} orientation={worldOrientation(position)} label={index === 1 ? label("Observer", AMBER) : undefined}>
          <ModelGraphics {...droneModel(index === 1 ? AMBER : FRIENDLY)} />
          <Entity polyline={{ positions: [world([position[0], position[1], 0]), world(position)], width: 1, material: WHITE.withAlpha(0.2) }} />
          {index === 1 && <Entity position={world([position[0], position[1], 260])} cylinder={{ length: 180, topRadius: 4, bottomRadius: 105, material: FRIENDLY.withAlpha(0.09), outline: true, outlineColor: FRIENDLY.withAlpha(0.22) }} />}
        </Entity>
      ))}
      {truthOverlay && hostiles.map(({ id, position, samples, removedAt }, index) => {
        const visible = time >= samples[0].time && (removedAt === undefined || time < removedAt);
        const current = samples.reduce((selected, sample) => sample.time <= time ? sample : selected, samples[0]);
        return visible && (
          <Entity key={id} position={position} point={{ pixelSize: 9, color: CORAL, outlineColor: Color.fromCssColorString("#321512"), outlineWidth: 2 }} label={index % 4 === 0 ? label(id, CORAL) : undefined}>
            <Entity polyline={{ positions: samples.filter((sample) => sample.time <= time).slice(-80).filter((_, sampleIndex) => sampleIndex % 2 === 0).map((sample) => world(sample.position)), width: 2, material: CORAL.withAlpha(0.58) }} />
            <Entity polyline={{ positions: [world([current.position[0], current.position[1], 0]), world(current.position)], width: 1, material: CORAL.withAlpha(0.3) }} />
          </Entity>
        );
      })}
      {impacts.map(({ time: impactTime, position, progress, label: impactLabel }) => (
        <Entity key={`impact-${impactTime}-${position.join("-")}`} position={world(position)} label={progress < 0.55 ? label(impactLabel, CORAL) : undefined}>
          <Entity ellipsoid={{ radii: new Cartesian3(10 + progress * 34, 10 + progress * 34, 10 + progress * 34), material: CORAL.withAlpha(0.3 * (1 - progress)), outline: true, outlineColor: WHITE.withAlpha(0.65 * (1 - progress)) }} />
        </Entity>
      ))}
      {mode === "safety" && safetyPosition && preferredVelocity && safeVelocity && (
        <>
          <Entity position={world(safetyPosition)} label={label(`${safetyEvent?.agent_local?.agent_id ?? "Interceptor"} · RVO2-3D`, AMBER)}>
            <ModelGraphics {...droneModel(AMBER)} />
          </Entity>
          <Entity polyline={{ positions: [world(safetyPosition), world([
            safetyPosition[0] + preferredVelocity[0] * 3,
            safetyPosition[1] + preferredVelocity[1] * 3,
            safetyPosition[2] + preferredVelocity[2] * 3
          ])], width: 2, material: AMBER.withAlpha(0.72) }} />
          <Entity polyline={{ positions: [world(safetyPosition), world([
            safetyPosition[0] + safeVelocity[0] * 3,
            safetyPosition[1] + safeVelocity[1] * 3,
            safetyPosition[2] + safeVelocity[2] * 3
          ])], width: 3, material: FRIENDLY.withAlpha(0.9) }} />
        </>
      )}
    </>
  );
}

function UncertaintyEntities({ model, time }: { model: ReplayModel | null; time: number }) {
  const telemetry = model ? latestTargetTelemetry(model, time) : null;
  const agentId = telemetry?.agent_local?.agent_id;
  const trail = useMemo(() => {
    if (!model || !agentId) return [];
    return model.data.events
      .filter((event) => (
        event.time_s <= time
        && event.kind === "trajectory_step"
        && event.agent_local?.agent_id === agentId
        && event.agent_local.local_target_position
      ))
      .filter((_, index) => index % 8 === 0)
      .slice(-40)
      .map((event) => event.agent_local?.local_target_position as Vec3);
  }, [agentId, model, time]);
  const target = telemetry?.agent_local?.local_target_position ?? null;
  const observer = telemetry?.agent_local?.estimated_position ?? null;
  const covariance = telemetry?.agent_local?.covariance_diag ?? [4, 4, 4];
  const confidence = telemetry?.agent_local?.belief?.confidence ?? 0.5;
  const radii = new Cartesian3(
    Math.max(8, Math.sqrt(covariance[0]) * 6 / Math.max(confidence, 0.2)),
    Math.max(8, Math.sqrt(covariance[1]) * 6 / Math.max(confidence, 0.2)),
    Math.max(6, Math.sqrt(covariance[2]) * 4 / Math.max(confidence, 0.2))
  );
  return (
    <>
      <SectorGeometry />
      {trail.length > 1 && <Entity polyline={{ positions: trail.map(world), width: 2, material: WHITE.withAlpha(0.55) }} />}
      {target && (
        <Entity position={world(target)} ellipsoid={{ radii, material: AMBER.withAlpha(0.12), outline: true, outlineColor: AMBER.withAlpha(0.7), subdivisions: 32 }} label={label(`Local covariance · ${Math.round(confidence * 100)}%`, AMBER)}>
          <ModelGraphics {...droneModel(AMBER)} />
        </Entity>
      )}
      {observer && <Entity position={world(observer)} orientation={worldOrientation(observer)} label={label(agentId ?? "Observer", FRIENDLY_SOFT)}><ModelGraphics {...droneModel(FRIENDLY)} /></Entity>}
    </>
  );
}


const PROVENANCE: Record<SceneMode, string> = {
  overview: "Recorded replay tracks · hosted Google 3D context",
  forward: "Noisy local track · evaluator ground truth masked",
  observer: "Observer local track · private coverage recovery",
  contact: "Recorded simulator outcome · impact event",
  miss: "Recorded simulator miss · coverage expiry",
  uncertainty: "Replay-timed local covariance envelope",
  identity: "Recorded local identity state · ground truth masked",
  safety: "Recorded RVO2-3D preferred and applied velocities",
  fleet: "Recorded twenty-four-interceptor lifecycle"
};

export function CesiumScene({ model, time, mode = "overview", truthOverlay = true, className, onTileState }: CesiumSceneProps) {
  const [cameraStyle, setCameraStyle] = useState<CameraStyle>(mode === "overview" || mode === "identity" ? "horizon" : "plan");
  const [tileState, setTileState] = useState<"loading" | "ready" | "error">("loading");
  const handleTileState = useCallback((state: "loading" | "ready" | "error") => {
    setTileState(state);
    onTileState?.(state);
  }, [onTileState]);
  return (
    <div className={`cesium-shell ${className ?? ""}`}>
      <Viewer
        full
        animation={false}
        timeline={false}
        homeButton={false}
        sceneModePicker={false}
        baseLayerPicker={false}
        baseLayer={false}
        navigationHelpButton={false}
        fullscreenButton={false}
        infoBox={false}
        selectionIndicator={false}
        geocoder={IonGeocodeProviderType.GOOGLE}
        requestRenderMode
        maximumRenderTimeChange={Infinity}
        shouldAnimate={false}
        showRenderLoopErrors={false}
      >
        <WorldLoader model={model} mode={mode} time={time} cameraStyle={cameraStyle} onTileState={handleTileState} />
        <RenderOnTime time={time} />
        <ReplayEntities model={model} time={time} mode={mode} truthOverlay={truthOverlay} />
      </Viewer>
      {tileState === "loading" && <div className="map-state"><span className="map-state-pulse" />Loading hosted 3D context</div>}
      {tileState === "error" && (
        <div className="map-blocker" role="alert">
          <strong>Hosted 3D context unavailable</strong>
          <span>Google Photorealistic 3D Tiles requires valid Cesium ion and Map Tiles credentials.</span>
        </div>
      )}
      <div className="camera-style-toggle" role="group" aria-label="Camera orientation">
        <button type="button" className={cameraStyle === "plan" ? "active" : ""} aria-pressed={cameraStyle === "plan"} onClick={() => setCameraStyle("plan")}>Top-down</button>
        <button type="button" className={cameraStyle === "horizon" ? "active" : ""} aria-pressed={cameraStyle === "horizon"} onClick={() => setCameraStyle("horizon")}>Horizon</button>
      </div>
      <div className="scene-provenance">{PROVENANCE[mode]}</div>
    </div>
  );
}
