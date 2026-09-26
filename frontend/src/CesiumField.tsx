import { useEffect, useRef, useState } from 'react';
import { Viewer } from 'resium';
import { Cartesian2, Cartesian3, Color, ConstantProperty, CustomDataSource, Entity, HeightReference, HorizontalOrigin, IonGeocodeProviderType, LabelStyle, NearFarScalar, Rectangle, ScreenSpaceEventType, VerticalOrigin, Viewer as CesiumViewer } from 'cesium';
import { replayPosition, units, type Perspective, type ReplayFrame } from './worldview';
import { loadGooglePhotorealisticTiles } from './googlePhotorealisticTiles';

interface Props { frame: ReplayFrame; playing: boolean; perspective: Perspective; sector: boolean; groundTruth: boolean; selected: string; onSelect: (id: string) => void; }
interface Registry { truth: CustomDataSource; interceptor: CustomDataSource; observer: CustomDataSource; hostile: CustomDataSource; geometry: CustomDataSource; entities: Map<string, Entity>; }

const center = { lon: 103.8565, lat: 1.2835 };
const localIds = units.map((unit) => unit.id);
const blue = Color.fromCssColorString('#58a8d8');
const cyan = Color.fromCssColorString('#77d4e8');
const red = Color.fromCssColorString('#ed665b');
const amber = Color.fromCssColorString('#e2b75d');
const chalk = Color.fromCssColorString('#dce7e5');
const pos = (lon: number, lat: number, height: number) => Cartesian3.fromDegrees(lon, lat, height);

function addPoint(source: CustomDataSource, id: string, color: Color, position: Cartesian3, label = '') {
  return source.entities.add(new Entity({ id, position, point: { color, pixelSize: 8, outlineColor: Color.fromAlpha(chalk, 0.85), outlineWidth: 1, heightReference: HeightReference.NONE, disableDepthTestDistance: Number.POSITIVE_INFINITY }, label: { text: label, font: '11px ui-monospace, monospace', fillColor: chalk, outlineColor: Color.fromCssColorString('#081014'), outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE, horizontalOrigin: HorizontalOrigin.LEFT, verticalOrigin: VerticalOrigin.CENTER, pixelOffset: new Cartesian2(12, 0), scaleByDistance: new NearFarScalar(300, 1, 18000, 0.55), disableDepthTestDistance: Number.POSITIVE_INFINITY } }));
}
function addLine(source: CustomDataSource, id: string, color: Color, positions: Cartesian3[], width = 1) { const seeded = positions.length >= 2 ? positions : [pos(center.lon - 0.004, center.lat - 0.004, 440), pos(center.lon + 0.004, center.lat + 0.004, 440)]; return source.entities.add({ id, polyline: { positions: seeded, width, material: color, depthFailMaterial: color } }); }
function setPosition(entity: Entity | undefined, value: Cartesian3) { if (entity) entity.position = value as never; }
function setLine(entity: Entity | undefined, values: Cartesian3[]) { if (entity?.polyline) entity.polyline.positions = new ConstantProperty(values) as never; }
function replayCartesian(value: number[]) {
  // Simulator replay positions are local ENU metres around the demo origin.
  if (Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90) return pos(value[0], value[1], value[2]);
  return pos(center.lon + value[0] / 111_300, center.lat + value[1] / 111_300, value[2]);
}

export default function CesiumField(props: Props) {
  const viewerRef = useRef<{ cesiumElement?: CesiumViewer } | null>(null);
  const registryRef = useRef<Registry | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [tilesReady, setTilesReady] = useState(false);
  const [loadError, setLoadError] = useState<string>();

  useEffect(() => { const timer = window.setInterval(() => { if (viewerRef.current?.cesiumElement) { setReady(true); window.clearInterval(timer); } }, 16); return () => window.clearInterval(timer); }, []);

  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement;
    if (!viewer) return;
    let cancelled = false;
    let tileset: Awaited<ReturnType<typeof loadGooglePhotorealisticTiles>> | undefined;
    const sources: CustomDataSource[] = [];

    viewer.scene.globe.show = false;
    setLoadError(undefined);
    setTilesReady(false);
    void (async () => {
      try {
        const loadedTileset = await loadGooglePhotorealisticTiles(import.meta.env.VITE_CESIUM_ION_TOKEN);
        if (cancelled) {
          loadedTileset.destroy();
          return;
        }
        tileset = viewer.scene.primitives.add(loadedTileset);
        viewer.scene.backgroundColor = Color.fromCssColorString('#081014'); if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = false; viewer.scene.fog.enabled = false; viewer.scene.requestRenderMode = true; viewer.scene.maximumRenderTimeChange = Number.POSITIVE_INFINITY; viewer.clock.shouldAnimate = false;
        const geometry = new CustomDataSource('tactical-geometry'); const truth = new CustomDataSource('evaluator-ground-truth'); const interceptor = new CustomDataSource('interceptor-private-view'); const observer = new CustomDataSource('observer-private-view'); const hostile = new CustomDataSource('hostile-private-view'); const entities = new Map<string, Entity>();
        interceptor.show = false; observer.show = false; hostile.show = false;
        sources.push(geometry, truth, hostile, interceptor, observer);
        sources.forEach((source) => viewer.dataSources.add(source));
        const grid: Cartesian3[] = []; for (let row = -2; row <= 2; row += 1) grid.push(pos(center.lon - 0.018, center.lat + row * 0.004, 450), pos(center.lon + 0.018, center.lat + row * 0.004, 450)); for (let col = -3; col <= 3; col += 1) grid.push(pos(center.lon + col * 0.006, center.lat - 0.008, 450), pos(center.lon + col * 0.006, center.lat + 0.008, 450));
        geometry.entities.add({ polyline: { positions: grid, width: 1, material: Color.fromAlpha(blue, 0.22) } }); geometry.entities.add({ position: pos(center.lon, center.lat, 25), ellipse: { semiMajorAxis: 700, semiMinorAxis: 700, height: 25, material: Color.fromAlpha(red, 0.06), outline: true, outlineColor: Color.fromAlpha(red, 0.5) } });
        localIds.forEach((id, index) => entities.set(id, addPoint(truth, id, blue, pos(center.lon - 0.024 + index * 0.006, center.lat - 0.015 + index * 0.004, 220 + index * 75), id)));
        entities.set('H-TRUTH', addPoint(truth, 'H-TRUTH', red, pos(center.lon + 0.027, center.lat + 0.013, 520), 'H-01 · EVALUATOR')); entities.set('TRUTH-PATH', addLine(truth, 'TRUTH-PATH', Color.fromAlpha(red, 0.48), [], 2)); entities.set('TRUTH-COMMIT-1', addLine(truth, 'TRUTH-COMMIT-1', Color.fromAlpha(blue, 0.72), [], 2)); entities.set('TRUTH-COMMIT-2', addLine(truth, 'TRUTH-COMMIT-2', Color.fromAlpha(cyan, 0.56), [])); entities.set('TRUTH-COMMIT-3', addLine(truth, 'TRUTH-COMMIT-3', Color.fromAlpha(amber, 0.55), []));
        entities.set('INT-SELF', addPoint(interceptor, 'INT-SELF', blue, pos(center.lon - 0.02, center.lat - 0.01, 320), 'I-07 · SELF')); entities.set('INT-THREAT', addPoint(interceptor, 'INT-THREAT', amber, pos(center.lon + 0.02, center.lat + 0.01, 500), 'A-12 · LOCAL')); entities.set('INT-LINE', addLine(interceptor, 'INT-LINE', cyan, [], 3)); entities.set('INT-PATH', addLine(interceptor, 'INT-PATH', Color.fromAlpha(blue, 0.82), [], 2)); entities.set('INT-BASKET', interceptor.entities.add({ id: 'INT-BASKET', position: pos(center.lon + 0.01, center.lat, 420), ellipse: { semiMajorAxis: 500, semiMinorAxis: 500, height: 440, material: Color.fromAlpha(cyan, 0.05), outline: true, outlineColor: cyan } })); entities.set('INT-UNCERTAINTY', interceptor.entities.add({ id: 'INT-UNCERTAINTY', position: pos(center.lon + 0.02, center.lat, 450), ellipse: { semiMajorAxis: 700, semiMinorAxis: 360, height: 450, material: Color.fromAlpha(amber, 0.08), outline: true, outlineColor: amber } }));
        entities.set('OBS-SELF', addPoint(observer, 'OBS-SELF', blue, pos(center.lon - 0.01, center.lat + 0.008, 470), 'I-19 · OBSERVER')); entities.set('OBS-LEAD', addPoint(observer, 'OBS-LEAD', cyan, pos(center.lon, center.lat, 400), 'LEAD · INFERRED')); entities.set('OBS-THREAT', addPoint(observer, 'OBS-THREAT', amber, pos(center.lon + 0.018, center.lat + 0.008, 500), 'C-09 · LOCAL')); entities.set('OBS-SIGHT-A', addLine(observer, 'OBS-SIGHT-A', cyan, [], 3)); entities.set('OBS-SIGHT-B', addLine(observer, 'OBS-SIGHT-B', amber, [], 3)); entities.set('OBS-WINDOW', observer.entities.add({ id: 'OBS-WINDOW', position: pos(center.lon + 0.01, center.lat, 420), ellipse: { semiMajorAxis: 800, semiMinorAxis: 800, height: 440, material: Color.fromAlpha(cyan, 0.08), outline: true, outlineColor: cyan } }));
        entities.set('HOSTILE-SELF', addPoint(hostile, 'HOSTILE-SELF', red, pos(center.lon + 0.02, center.lat + 0.01, 500), 'HOSTILE · SELF')); entities.set('HOSTILE-CONTACT', addPoint(hostile, 'HOSTILE-CONTACT', amber, pos(center.lon - 0.01, center.lat, 430), 'OPTICAL CONTACT')); entities.set('HOSTILE-ROUTE', addLine(hostile, 'HOSTILE-ROUTE', Color.fromAlpha(red, 0.65), [], 2));
        viewer.screenSpaceEventHandler.setInputAction((movement: { position: Cartesian2 }) => { const picked = viewer.scene.pick(movement.position) as { id?: Entity } | undefined; const id = picked?.id?.id; if (id && localIds.some((localId) => localId === id)) props.onSelect(id); }, ScreenSpaceEventType.LEFT_CLICK);
        registryRef.current = { truth, interceptor, observer, hostile, geometry, entities }; viewer.camera.setView({ destination: Rectangle.fromDegrees(103.815, 1.248, 103.898, 1.323) }); viewer.scene.requestRender();
        setTilesReady(true);
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Google Photorealistic 3D Tiles failed to load.');
      }
    })();

    return () => {
      cancelled = true;
      viewer.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_CLICK);
      sources.forEach((source) => viewer.dataSources.remove(source, true));
      if (tileset && !tileset.isDestroyed()) viewer.scene.primitives.remove(tileset);
      registryRef.current = undefined;
    };
  }, [ready]);

  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement; const registry = registryRef.current; if (!viewer || !registry) return;
    const selectedUnit = units.find((unit) => unit.id === props.selected) ?? units[0];
    const hostileValue = replayPosition(props.frame, 'overview');
    const localValue = replayPosition(props.frame, selectedUnit.agentId);
    const hostilePosition = hostileValue ? replayCartesian(hostileValue) : undefined;
    const localThreat = localValue ? replayCartesian(localValue) : hostilePosition;
    const selfPosition = registry.entities.get(props.selected)?.position?.getValue(viewer.clock.currentTime);

    if (hostilePosition) {
      setPosition(registry.entities.get('H-TRUTH'), hostilePosition);
      setPosition(registry.entities.get('HOSTILE-SELF'), hostilePosition);
    }
    if (localThreat) {
      setPosition(registry.entities.get('INT-THREAT'), localThreat);
      setPosition(registry.entities.get('INT-BASKET'), localThreat);
      setPosition(registry.entities.get('INT-UNCERTAINTY'), localThreat);
      setPosition(registry.entities.get('OBS-THREAT'), localThreat);
      setPosition(registry.entities.get('OBS-WINDOW'), localThreat);
    }
    if (selfPosition) {
      setPosition(registry.entities.get('INT-SELF'), selfPosition);
      if (localThreat) { setLine(registry.entities.get('INT-LINE'), [selfPosition, localThreat]); setLine(registry.entities.get('INT-PATH'), [selfPosition, localThreat]); }
    }
    if (registry.entities.get('INT-SELF')?.label) registry.entities.get('INT-SELF')!.label!.text = new ConstantProperty(`${props.selected} · SELF`);
    const localId = props.frame.localViews[selectedUnit.agentId]?.local_track_id ?? 'NO LOCAL TRACK';
    if (registry.entities.get('INT-THREAT')?.label) registry.entities.get('INT-THREAT')!.label!.text = new ConstantProperty(`${localId} · LOCAL`);
    registry.entities.get('OBS-WINDOW')!.show = props.frame.event.event === 'MISS' || props.frame.event.event === 'OBSERVER CLAIM';
    registry.truth.show = props.perspective === 'OVERVIEW' || props.groundTruth; registry.interceptor.show = props.perspective === 'INTERCEPTOR'; registry.observer.show = props.perspective === 'OBSERVER'; registry.hostile.show = props.perspective === 'HOSTILE'; registry.geometry.show = props.perspective === 'OVERVIEW' || props.groundTruth; viewer.scene.requestRenderMode = !props.playing; viewer.scene.requestRender();
  }, [ready, props.frame, props.playing, props.groundTruth, props.perspective, props.selected]);

  useEffect(() => { const viewer = viewerRef.current?.cesiumElement; if (!viewer) return; viewer.camera.setView({ destination: props.sector ? Rectangle.fromDegrees(103.837, 1.268, 103.878, 1.304) : Rectangle.fromDegrees(103.815, 1.248, 103.898, 1.323) }); viewer.scene.requestRender(); }, [props.sector]);
  return (
    <div className="cesium-field">
      <Viewer ref={viewerRef as never} full animation={false} timeline={false} baseLayerPicker={false} geocoder={IonGeocodeProviderType.GOOGLE} homeButton={false} sceneModePicker={false} navigationHelpButton={false} fullscreenButton={false} infoBox={false} selectionIndicator={false} baseLayer={false} scene3DOnly requestRenderMode={!props.playing} />
      {tilesReady && <span data-testid="map-ready" hidden>Google Photorealistic 3D Tiles ready</span>}
      {loadError && <div className="cesium-blocking-error" role="alert"><strong>MAP BLOCKED</strong><span>{loadError}</span></div>}
    </div>
  );
}
