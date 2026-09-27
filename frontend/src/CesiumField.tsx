import { useEffect, useRef, useState } from 'react';
import { Viewer } from 'resium';
import { ArcType, Cartesian2, Cartesian3, Color, ConstantProperty, CustomDataSource, Entity, HeadingPitchRange, HeightReference, HorizontalOrigin, IonGeocodeProviderType, LabelStyle, Math as CesiumMath, Matrix4, NearFarScalar, ScreenSpaceEventType, VerticalOrigin, Viewer as CesiumViewer } from 'cesium';
import { replayPosition, type DroneStatus, type Focus, type FriendlyState, type HostileStatus, type Perspective, type ReplayFrame, type RosterDrone, type SwarmFrame } from './worldview';
import { loadGooglePhotorealisticTiles } from './googlePhotorealisticTiles';
import { localHeadingToWorld, localToGeo, worldHeadingToLocal } from './theatre';

interface Props {
  frame?: ReplayFrame;
  cells?: Record<string, number[]>;
  swarm?: SwarmFrame;
  roster?: readonly RosterDrone[];
  replayKey?: string;
  playing: boolean;
  follow?: boolean;
  perspective: Perspective;
  sector: boolean;
  groundTruth: boolean;
  selected: string;
  onSelect: (id: string) => void;
  onHeadingChange?: (headingRad: number) => void;
}
interface Registry {
  swarm: CustomDataSource; interceptor: CustomDataSource; observer: CustomDataSource; hostile: CustomDataSource; geometry: CustomDataSource;
  entities: Map<string, Entity>;
  drones: Map<string, { entity: Entity; key?: string }>;
  hostiles: Map<string, { entity: Entity; key?: string }>;
  friendlies: Map<string, { entity: Entity; key?: string }>;
  links: Entity[];
  drops: Map<string, Entity>;
  vacant: Map<string, Entity>;
}
export interface Pose { target: number[]; heading: number; pitch: number; range: number }

// Simulator positions are local ENU metres (x east, y north, z up). The engagement box
// (front 0-900 m, screen near y=0, hostiles near y=1400, pads near y=-700) is centred on the
// map origin so the whole battle sits over Marina Bay.
const FRONT_CENTRE = [450, 0, 200];
const blue = Color.fromCssColorString('#58a8d8');
const cyan = Color.fromCssColorString('#77d4e8');
const red = Color.fromCssColorString('#ff5a4a');
const amber = Color.fromCssColorString('#f2c14e');
const chalk = Color.fromCssColorString('#f4faf9');
const slate = Color.fromCssColorString('#8aa4a6');
const green = Color.fromCssColorString('#6fce8f');
const violet = Color.fromCssColorString('#c7a6ff');
const outline = Color.fromCssColorString('#061014');
const PAD_CLEARANCE_M = 20;
const pos = (lon: number, lat: number, height: number) => Cartesian3.fromDegrees(lon, lat, height);
// Local simulator metres -> globe, via configs/theatre.json (Marina East pads, +y out to sea).
export const enu = (value: readonly number[]) => { const geo = localToGeo(value); return pos(geo.lon, geo.lat, geo.height); };

const droneColors: Record<DroneStatus, Color> = { pad: slate, launching: cyan, screen: blue, observing: violet, committed: cyan, reserve: slate, pursuit: amber, engaging: chalk, returning: blue, 'stood-down': slate, aborting: amber, rth: amber, refilling: cyan, docked: slate, expended: slate };
const hostileColors: Record<HostileStatus, Color> = { pending: red, inbound: red, tracked: red, neutralized: green, leaked: amber };

// Markers are drawn on top of the 3D tiles (depth test disabled), with a dark outline so they
// stay readable over bright buildings, and scale with distance so they never vanish.
function addPoint(source: CustomDataSource, id: string, color: Color, position: Cartesian3, label = '', pixelSize = 10) {
  return source.entities.add(new Entity({ id, position, point: { color, pixelSize, outlineColor: outline, outlineWidth: 2, heightReference: HeightReference.NONE, disableDepthTestDistance: Number.POSITIVE_INFINITY, scaleByDistance: new NearFarScalar(150, 1.3, 6000, 0.8) }, label: { text: label, font: '600 12px ui-monospace, monospace', fillColor: chalk, outlineColor: outline, outlineWidth: 4, style: LabelStyle.FILL_AND_OUTLINE, horizontalOrigin: HorizontalOrigin.LEFT, verticalOrigin: VerticalOrigin.CENTER, pixelOffset: new Cartesian2(12, 0), scaleByDistance: new NearFarScalar(150, 1, 6000, 0.6), disableDepthTestDistance: Number.POSITIVE_INFINITY } }));
}
// Straight 3D segments between world positions (ArcType.NONE), so every line is drawn from the
// real 3D endpoints and stays correct for any camera heading, pitch and perspective.
function addLine(source: CustomDataSource, id: string, color: Color, width = 1) { return source.entities.add({ id, polyline: { positions: [enu([0, 0, 250]), enu([0, 1, 250])], width, arcType: ArcType.NONE, material: color, depthFailMaterial: color } }); }
function setPosition(entity: Entity | undefined, value: Cartesian3) { if (entity) entity.position = value as never; }
function setLine(entity: Entity | undefined, values: Cartesian3[]) { if (entity?.polyline) entity.polyline.positions = new ConstantProperty(values) as never; }
function setLabel(entity: Entity | undefined, text: string) { if (entity?.label) entity.label.text = new ConstantProperty(text) as never; }
function setPoint(entity: Entity | undefined, color: Color, size: number) { if (entity?.point) { entity.point.color = new ConstantProperty(color) as never; entity.point.pixelSize = new ConstantProperty(size) as never; } }

// Non-colour-only symbols (concept v2 legend): friendly circle, opposing diamond, unknown ring.
const svg = (body: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${body}</svg>`)}`;
export const SYMBOLS = {
  opposing: svg('<path d="M12 2 22 12 12 22 2 12z" fill="#ff5a4a" stroke="#061014" stroke-width="2.5"/>'),
  neutralized: svg('<path d="M12 5 19 12 12 19 5 12z" fill="#6fce8f" stroke="#061014" stroke-width="2"/><path d="M8 8l8 8M16 8l-8 8" stroke="#061014" stroke-width="2"/>'),
  leaked: svg('<path d="M12 2 22 12 12 22 2 12z" fill="#f2c14e" stroke="#061014" stroke-width="2.5"/>'),
  transit: svg('<circle cx="12" cy="12" r="8" fill="none" stroke="#061014" stroke-width="6"/><circle cx="12" cy="12" r="8" fill="none" stroke="#f2c14e" stroke-width="3"/>'),
};

function addSymbol(source: CustomDataSource, id: string, image: string, position: Cartesian3, label: string) {
  return source.entities.add(new Entity({ id, position, billboard: { image, width: 22, height: 22, disableDepthTestDistance: Number.POSITIVE_INFINITY, scaleByDistance: new NearFarScalar(150, 1.3, 6000, 0.8) }, label: { text: label, font: '600 12px ui-monospace, monospace', fillColor: chalk, outlineColor: outline, outlineWidth: 4, style: LabelStyle.FILL_AND_OUTLINE, horizontalOrigin: HorizontalOrigin.LEFT, verticalOrigin: VerticalOrigin.CENTER, pixelOffset: new Cartesian2(14, 0), scaleByDistance: new NearFarScalar(150, 1, 6000, 0.6), disableDepthTestDistance: Number.POSITIVE_INFINITY } }));
}
function setSymbol(entity: Entity | undefined, image: string) { if (entity?.billboard) entity.billboard.image = new ConstantProperty(image) as never; }
const reducedMotion = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const HOSTILE_SYMBOL: Record<HostileStatus, string> = { pending: SYMBOLS.opposing, inbound: SYMBOLS.opposing, tracked: SYMBOLS.opposing, neutralized: SYMBOLS.neutralized, leaked: SYMBOLS.leaked };

const headingBetween = (from: readonly number[], to: readonly number[]) => Math.atan2(to[0] - from[0], to[1] - from[1]);

function frameArea(points: number[][], sector: boolean): Pose {
  const mid = [0, 1, 2].map((axis) => points.reduce((sum, point) => sum + point[axis], 0) / points.length);
  const extent = Math.max(0, ...points.map((point) => Math.hypot(point[0] - mid[0], point[1] - mid[1], point[2] - mid[2])));
  const range = Math.max(sector ? 220 : 320, extent * 2.4);
  return { target: mid, heading: 0, pitch: CesiumMath.toRadians(-35), range };
}

// Camera pose for the frame that just played. Engagements frame the area under attack: the
// hostile being attacked, seen from the attacking drone's side. Launch, waves, refills and
// returns frame the group that is moving; otherwise the whole battlespace.
export function followPose(focus: Focus, swarm: SwarmFrame, sector: boolean): Pose {
  if (focus.kind === 'drone' && swarm.drones[focus.id]) {
    const drone = swarm.drones[focus.id].position;
    const target = focus.toward ? swarm.hostiles[focus.toward]?.position : undefined;
    if (target) return { target, heading: headingBetween(drone, target), pitch: CesiumMath.toRadians(-22), range: sector ? 220 : 340 };
    return { target: drone, heading: 0, pitch: CesiumMath.toRadians(-28), range: sector ? 160 : 240 };
  }
  if (focus.kind === 'hostile' && swarm.hostiles[focus.id]) {
    const hostile = swarm.hostiles[focus.id].position;
    const from = focus.from ? swarm.drones[focus.from]?.position : undefined;
    return { target: hostile, heading: from ? headingBetween(from, hostile) : 0, pitch: CesiumMath.toRadians(-25), range: sector ? 220 : 340 };
  }
  if (focus.kind === 'area' && focus.points.length) return frameArea(focus.points, sector);
  const points = [...Object.values(swarm.drones), ...Object.values(swarm.hostiles).filter((hostile) => hostile.status !== 'pending')].map((item) => item.position);
  if (!points.length) return { target: FRONT_CENTRE, heading: 0, pitch: CesiumMath.toRadians(-40), range: 1600 };
  const pose = frameArea(points, sector);
  return { ...pose, pitch: CesiumMath.toRadians(-40), range: Math.max(500, pose.range * (sector ? 0.55 : 0.9)) };
}

function blendAngle(from: number, to: number, t: number) {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * t;
}

function friendlyLabel(friendly: FriendlyState) {
  const counts = friendly.identities;
  const parts = [['CONFIRMED FRIENDLY', 'CONF'], ['FRIENDLY LINEAGE', 'LIN'], ['UNKNOWN', 'UNK']].filter(([state]) => counts[state as keyof typeof counts]).map(([state, short]) => `${counts[state as keyof typeof counts]} ${short}`);
  return `${friendly.id} · FRIENDLY${parts.length ? ` · ${parts.join(' / ')}` : ''}`;
}

export default function CesiumField(props: Props) {
  const viewerRef = useRef<{ cesiumElement?: CesiumViewer } | null>(null);
  const registryRef = useRef<Registry | undefined>(undefined);
  const desiredPose = useRef<Pose | undefined>(undefined);
  const currentPose = useRef<Pose | undefined>(undefined);
  const playingRef = useRef(props.playing);
  const followRef = useRef(props.follow ?? true);
  const headingRef = useRef<number | undefined>(undefined);
  const onHeadingRef = useRef(props.onHeadingChange);
  const droneIdsRef = useRef<Set<string>>(new Set());
  const [ready, setReady] = useState(false);
  const [tilesReady, setTilesReady] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  onHeadingRef.current = props.onHeadingChange;

  useEffect(() => { const timer = window.setInterval(() => { if (viewerRef.current?.cesiumElement) { setReady(true); window.clearInterval(timer); } }, 16); return () => window.clearInterval(timer); }, []);

  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement;
    if (!viewer) return;
    let cancelled = false;
    let tileset: Awaited<ReturnType<typeof loadGooglePhotorealisticTiles>> | undefined;
    const removers: Array<() => void> = [];
    const sources: CustomDataSource[] = [];

    viewer.scene.globe.show = false;
    setLoadError(undefined);
    setTilesReady(false);
    void (async () => {
      try {
        const loadedTileset = await loadGooglePhotorealisticTiles({
          ionToken: import.meta.env.VITE_CESIUM_ION_TOKEN,
          googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
        });
        if (cancelled) {
          loadedTileset.destroy();
          return;
        }
        tileset = viewer.scene.primitives.add(loadedTileset);
        viewer.scene.backgroundColor = Color.fromCssColorString('#081014'); if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = false; viewer.scene.fog.enabled = false; viewer.scene.requestRenderMode = true; viewer.scene.maximumRenderTimeChange = Number.POSITIVE_INFINITY; viewer.clock.shouldAnimate = false;
        const geometry = new CustomDataSource('tactical-geometry'); const swarm = new CustomDataSource('evaluator-swarm-truth'); const interceptor = new CustomDataSource('interceptor-private-view'); const observer = new CustomDataSource('observer-private-view'); const hostile = new CustomDataSource('hostile-private-view'); const entities = new Map<string, Entity>();
        interceptor.show = false; observer.show = false; hostile.show = false;
        sources.push(geometry, swarm, hostile, interceptor, observer);
        sources.forEach((source) => viewer.dataSources.add(source));
        // Defended zone and coastal pads behind the screen, and the screen line itself.
        // Launch field at Marina East (pads), the defended area behind it, and the screen line out over the water.
        geometry.entities.add({ position: enu([450, -760, 12]), ellipse: { semiMajorAxis: 520, semiMinorAxis: 140, rotation: 0, height: 12, material: Color.fromAlpha(blue, 0.05), outline: true, outlineColor: Color.fromAlpha(blue, 0.45) }, label: { text: 'LAUNCH · MARINA EAST OPEN FIELD', font: '600 12px ui-monospace, monospace', fillColor: chalk, outlineColor: outline, outlineWidth: 4, style: LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cartesian2(0, -18), disableDepthTestDistance: Number.POSITIVE_INFINITY } });
        geometry.entities.add({ position: enu([450, -900, 12]), ellipse: { semiMajorAxis: 160, semiMinorAxis: 160, height: 12, material: Color.fromAlpha(red, 0.05), outline: true, outlineColor: Color.fromAlpha(red, 0.45) } });
        geometry.entities.add({ polyline: { positions: [enu([0, 50, 150]), enu([900, 50, 150])], width: 1, arcType: ArcType.NONE, material: Color.fromAlpha(blue, 0.35) } });
        geometry.entities.add({ position: enu([450, 2600, 20]), label: { text: 'SEA APPROACH · SINGAPORE STRAIT', font: '600 12px ui-monospace, monospace', fillColor: Color.fromAlpha(red, 0.9), outlineColor: outline, outlineWidth: 4, style: LabelStyle.FILL_AND_OUTLINE, disableDepthTestDistance: Number.POSITIVE_INFINITY } });
        entities.set('INT-SELF', addPoint(interceptor, 'INT-SELF', blue, enu([0, 0, 250]), 'SELF', 12)); entities.set('INT-THREAT', addPoint(interceptor, 'INT-THREAT', amber, enu([0, 1400, 150]), 'LOCAL', 12)); entities.set('INT-LINE', addLine(interceptor, 'INT-LINE', cyan, 3)); entities.set('INT-BASKET', interceptor.entities.add({ id: 'INT-BASKET', position: enu([0, 1400, 150]), ellipse: { semiMajorAxis: 60, semiMinorAxis: 60, height: 150, material: Color.fromAlpha(cyan, 0.05), outline: true, outlineColor: cyan } })); entities.set('INT-UNCERTAINTY', interceptor.entities.add({ id: 'INT-UNCERTAINTY', position: enu([0, 1400, 150]), ellipse: { semiMajorAxis: 90, semiMinorAxis: 45, height: 150, material: Color.fromAlpha(amber, 0.08), outline: true, outlineColor: amber } }));
        entities.set('OBS-SELF', addPoint(observer, 'OBS-SELF', blue, enu([0, 0, 250]), 'OBSERVER', 12)); entities.set('OBS-THREAT', addPoint(observer, 'OBS-THREAT', amber, enu([0, 1400, 150]), 'LOCAL', 12)); entities.set('OBS-SIGHT', addLine(observer, 'OBS-SIGHT', amber, 3)); entities.set('OBS-WINDOW', observer.entities.add({ id: 'OBS-WINDOW', position: enu([0, 1400, 150]), ellipse: { semiMajorAxis: 120, semiMinorAxis: 120, height: 150, material: Color.fromAlpha(cyan, 0.08), outline: true, outlineColor: cyan } }));
        entities.set('HOSTILE-SELF', addPoint(hostile, 'HOSTILE-SELF', red, enu([0, 1400, 150]), 'HOSTILE · SELF', 12)); entities.set('HOSTILE-CONTACT', addPoint(hostile, 'HOSTILE-CONTACT', amber, enu([0, 0, 250]), 'OPTICAL CONTACT', 12)); entities.set('HOSTILE-ROUTE', addLine(hostile, 'HOSTILE-ROUTE', Color.fromAlpha(red, 0.65), 2));
        viewer.screenSpaceEventHandler.setInputAction((movement: { position: Cartesian2 }) => { const picked = viewer.scene.pick(movement.position) as { id?: Entity } | undefined; const id = picked?.id?.id; if (id && droneIdsRef.current.has(id)) props.onSelect(id); }, ScreenSpaceEventType.LEFT_CLICK);
        // While playing with follow on, ease the camera toward the latest focus every frame.
        removers.push(viewer.scene.preRender.addEventListener(() => {
          const desired = desiredPose.current;
          if (!playingRef.current || !followRef.current || !desired) return;
          const current = currentPose.current ?? desired;
          const t = reducedMotion() ? 1 : 0.12;
          const next: Pose = {
            target: current.target.map((value, axis) => value + (desired.target[axis] - value) * t),
            heading: blendAngle(current.heading, desired.heading, t),
            pitch: current.pitch + (desired.pitch - current.pitch) * t,
            range: current.range + (desired.range - current.range) * t,
          };
          currentPose.current = next;
          viewer.camera.lookAt(enu(next.target), new HeadingPitchRange(localHeadingToWorld(next.heading), next.pitch, next.range));
        }));
        // Report the camera heading so 2D panels can be drawn from the same point of view.
        removers.push(viewer.scene.postRender.addEventListener(() => {
          const heading = viewer.camera.heading;
          if (headingRef.current === undefined || Math.abs(Math.atan2(Math.sin(heading - headingRef.current), Math.cos(heading - headingRef.current))) > CesiumMath.toRadians(3)) {
            headingRef.current = heading;
            onHeadingRef.current?.(worldHeadingToLocal(heading));
          }
        }));
        registryRef.current = { swarm, interceptor, observer, hostile, geometry, entities, drones: new Map(), hostiles: new Map(), friendlies: new Map(), links: [], drops: new Map(), vacant: new Map() };
        // Start behind the launch field looking out to sea along the threat axis.
        viewer.camera.setView({ destination: enu([450, -1700, 900]), orientation: { heading: localHeadingToWorld(0), pitch: CesiumMath.toRadians(-30), roll: 0 } });
        viewer.scene.requestRender();
        setTilesReady(true);
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Google Photorealistic 3D Tiles failed to load.');
      }
    })();

    return () => {
      cancelled = true;
      removers.forEach((remove) => remove());
      viewer.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_CLICK);
      sources.forEach((source) => viewer.dataSources.remove(source, true));
      if (tileset && !tileset.isDestroyed()) viewer.scene.primitives.remove(tileset);
      registryRef.current = undefined;
    };
  }, [ready]);

  // Rebuild the swarm entities whenever a different replay (roster) is loaded.
  useEffect(() => {
    const registry = registryRef.current; if (!registry) return;
    registry.swarm.entities.removeAll();
    registry.drones.clear(); registry.hostiles.clear(); registry.friendlies.clear(); registry.links = []; registry.drops.clear(); registry.vacant.clear();
    droneIdsRef.current = new Set((props.roster ?? []).map((drone) => drone.id));
    currentPose.current = undefined;
  }, [tilesReady, props.replayKey, props.roster]);

  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement; const registry = registryRef.current; if (!viewer || !registry || !props.frame) return;
    const swarm = props.swarm;
    const callsigns = new Map((props.roster ?? []).map((drone) => [drone.id, drone]));
    if (swarm) {
      Object.values(swarm.drones).forEach((drone) => {
        let record = registry.drones.get(drone.id);
        if (!record) { record = { entity: addPoint(registry.swarm, drone.id, blue, enu(drone.position), '', 9) }; registry.drones.set(drone.id, record); }
        setPosition(record.entity, enu(drone.position));
        record.entity.show = drone.status !== 'expended';
        const isSelected = drone.id === props.selected;
        const key = `${drone.status}|${isSelected}`;
        if (record.key !== key) {
          setPoint(record.entity, isSelected ? chalk : droneColors[drone.status], isSelected ? 14 : ['engaging', 'rth', 'refilling', 'launching', 'aborting', 'observing'].includes(drone.status) ? 11 : 9);
          const roster = callsigns.get(drone.id);
          // Label the selected drone and each section lead so the 3x3 blocks stay readable.
          setLabel(record.entity, isSelected ? roster?.callsign ?? drone.id : roster?.callsign.endsWith('-1') ? roster.section : '');
          record.key = key;
        }
      });
      Object.values(swarm.hostiles).forEach((hostile) => {
        let record = registry.hostiles.get(hostile.id);
        if (!record) { record = { entity: addSymbol(registry.swarm, hostile.id, SYMBOLS.opposing, enu(hostile.position), hostile.id) }; registry.hostiles.set(hostile.id, record); }
        setPosition(record.entity, enu(hostile.position));
        record.entity.show = hostile.status !== 'pending';
        if (record.key !== hostile.status) { setSymbol(record.entity, HOSTILE_SYMBOL[hostile.status]); setLabel(record.entity, hostile.status === 'neutralized' ? `${hostile.id} ✕` : hostile.status === 'leaked' ? `${hostile.id} · LEAKED` : hostile.id); record.key = hostile.status; }
      });
      Object.values(swarm.friendlies).forEach((friendly) => {
        let record = registry.friendlies.get(friendly.id);
        if (!record) { record = { entity: addSymbol(registry.swarm, friendly.id, SYMBOLS.transit, enu(friendly.position), friendly.id) }; registry.friendlies.set(friendly.id, record); }
        setPosition(record.entity, enu(friendly.position));
        record.entity.show = friendly.position[0] > -200 && friendly.position[0] < 1100;
        const label = friendlyLabel(friendly);
        if (record.key !== label) { setLabel(record.entity, label); record.key = label; }
      });
      swarm.links.forEach((link, index) => {
        let line = registry.links[index];
        if (!line) { line = addLine(registry.swarm, `LINK-${index}`, Color.fromAlpha(cyan, 0.5), 1); registry.links[index] = line; }
        const from = swarm.drones[link.interceptorId]?.position; const to = swarm.hostiles[link.hostileId]?.position;
        line.show = Boolean(from && to);
        if (from && to) { setLine(line, [enu(from), enu(to)]); if (line.polyline) { line.polyline.width = new ConstantProperty(link.active ? 4 : 2) as never; line.polyline.material = (link.active ? chalk : Color.fromAlpha(cyan, 0.55)) as never; } }
      });
      registry.links.slice(swarm.links.length).forEach((line) => { line.show = false; });
      // Vertical drop lines to the surface make every altitude unambiguous (concept v2).
      const airborne: Array<[string, number[], Color, boolean]> = [
        ...Object.values(swarm.drones).map((drone): [string, number[], Color, boolean] => [drone.id, drone.position, Color.fromAlpha(drone.status === 'observing' ? violet : blue, 0.3), drone.status !== 'expended' && drone.position[2] > PAD_CLEARANCE_M]),
        ...Object.values(swarm.hostiles).map((hostile): [string, number[], Color, boolean] => [hostile.id, hostile.position, Color.fromAlpha(red, 0.35), hostile.status !== 'pending' && hostile.status !== 'neutralized']),
        ...Object.values(swarm.friendlies).map((friendly): [string, number[], Color, boolean] => [friendly.id, friendly.position, Color.fromAlpha(amber, 0.35), friendly.position[0] > -200 && friendly.position[0] < 1100]),
      ];
      airborne.forEach(([id, position, color, visible]) => {
        let drop = registry.drops.get(id);
        if (!drop) { drop = addLine(registry.swarm, `DROP-${id}`, color, 1); registry.drops.set(id, drop); }
        drop.show = visible;
        if (visible) setLine(drop, [enu(position), enu([position[0], position[1], 0])]);
      });
      const vacant = new Set(swarm.vacant);
      Object.entries(props.cells ?? {}).forEach(([owner, cell]) => {
        let marker = registry.vacant.get(owner);
        if (!marker && vacant.has(owner)) {
          const r = 7;
          marker = registry.swarm.entities.add({ id: `VACANT-${owner}`, polyline: { positions: [[-r, -r], [r, -r], [r, r], [-r, r], [-r, -r]].map(([dx, dy]) => enu([cell[0] + dx, cell[1] + dy, cell[2]])), width: 2, arcType: ArcType.NONE, material: amber, depthFailMaterial: amber } });
          registry.vacant.set(owner, marker);
        }
        if (marker) marker.show = vacant.has(owner);
      });
    }

    // Private perspectives follow the selected drone and its current target.
    const self = swarm?.drones[props.selected];
    const targetHostile = self?.target ? swarm?.hostiles[self.target] : undefined;
    const localEstimate = replayPosition(props.frame, props.selected);
    const threatValue = localEstimate ?? targetHostile?.position;
    const selfPosition = self ? enu(self.position) : undefined;
    const threatPosition = threatValue ? enu(threatValue) : undefined;
    if (selfPosition) { setPosition(registry.entities.get('INT-SELF'), selfPosition); setPosition(registry.entities.get('OBS-SELF'), selfPosition); setPosition(registry.entities.get('HOSTILE-CONTACT'), selfPosition); }
    if (threatPosition) ['INT-THREAT', 'INT-BASKET', 'INT-UNCERTAINTY', 'OBS-THREAT', 'OBS-WINDOW', 'HOSTILE-SELF'].forEach((id) => setPosition(registry.entities.get(id), threatPosition));
    if (selfPosition && threatPosition) { setLine(registry.entities.get('INT-LINE'), [selfPosition, threatPosition]); setLine(registry.entities.get('OBS-SIGHT'), [selfPosition, threatPosition]); setLine(registry.entities.get('HOSTILE-ROUTE'), [threatPosition, selfPosition]); }
    const callsign = callsigns.get(props.selected)?.callsign ?? props.selected;
    setLabel(registry.entities.get('INT-SELF'), `${callsign} · SELF`);
    setLabel(registry.entities.get('OBS-SELF'), `${callsign} · OBSERVER`);
    setLabel(registry.entities.get('INT-THREAT'), `${props.frame.localViews[props.selected]?.local_track_id ?? 'NO LOCAL TRACK'} · LOCAL`);
    const coverageWindow = registry.entities.get('OBS-WINDOW'); if (coverageWindow) coverageWindow.show = props.frame.event.event === 'MISS' || props.frame.event.event === 'OBSERVER CLAIM';

    registry.swarm.show = props.perspective === 'OVERVIEW' || props.groundTruth; registry.interceptor.show = props.perspective === 'INTERCEPTOR'; registry.observer.show = props.perspective === 'OBSERVER'; registry.hostile.show = props.perspective === 'HOSTILE'; registry.geometry.show = props.perspective === 'OVERVIEW' || props.groundTruth;
    if (swarm) desiredPose.current = followPose(swarm.focus, swarm, props.sector);
    viewer.scene.requestRenderMode = !props.playing; viewer.scene.requestRender();
  }, [tilesReady, props.frame, props.swarm, props.roster, props.playing, props.groundTruth, props.perspective, props.selected, props.sector]);

  // Playing (with follow on) hands the camera to the follow controller; pausing or turning
  // follow off releases it back to the user.
  useEffect(() => {
    playingRef.current = props.playing;
    followRef.current = props.follow ?? true;
    const viewer = viewerRef.current?.cesiumElement;
    if (!viewer || (props.playing && followRef.current)) return;
    currentPose.current = undefined;
    viewer.camera.lookAtTransform(Matrix4.IDENTITY);
  }, [props.playing, props.follow]);

  // Stepping or scrubbing while paused moves the camera once to the area of that frame.
  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement;
    if (!viewer || !tilesReady || props.playing || !(props.follow ?? true) || !props.swarm) return;
    const pose = followPose(props.swarm.focus, props.swarm, props.sector);
    const horizontal = pose.range * Math.cos(-pose.pitch);
    const eye = [pose.target[0] - horizontal * Math.sin(pose.heading), pose.target[1] - horizontal * Math.cos(pose.heading), pose.target[2] + pose.range * Math.sin(-pose.pitch)];
    viewer.camera.flyTo({ destination: enu(eye), orientation: { heading: localHeadingToWorld(pose.heading), pitch: pose.pitch, roll: 0 }, duration: reducedMotion() ? 0 : 0.8 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tilesReady, props.replayKey, props.sector, props.swarm, props.follow]);

  return (
    <div className="cesium-field">
      <Viewer ref={viewerRef as never} full animation={false} timeline={false} baseLayerPicker={false} geocoder={IonGeocodeProviderType.GOOGLE} homeButton={false} sceneModePicker={false} navigationHelpButton={false} fullscreenButton={false} infoBox={false} selectionIndicator={false} baseLayer={false} scene3DOnly requestRenderMode />
      {tilesReady && <span data-testid="map-ready" hidden>Google Photorealistic 3D Tiles ready</span>}
      {loadError && <div className="cesium-blocking-error" role="alert"><strong>MAP BLOCKED</strong><span>{loadError}</span></div>}
    </div>
  );
}
