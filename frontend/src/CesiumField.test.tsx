import React, { forwardRef, useImperativeHandle } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReplayFrame, SwarmFrame } from './worldview';

const mocks = vi.hoisted(() => {
  const preRender: Array<() => void> = [];
  return {
    loadTiles: vi.fn(),
    preRender,
    tileset: { destroy: vi.fn(), isDestroyed: vi.fn(() => false) },
    viewer: {
      scene: {
        primitives: { add: vi.fn((value: unknown) => value), remove: vi.fn() },
        requestRender: vi.fn(),
        backgroundColor: undefined,
        globe: { show: true },
        skyAtmosphere: { show: true },
        fog: { enabled: true },
        pick: vi.fn(),
        requestRenderMode: true,
        preRender: { addEventListener: vi.fn((callback: () => void) => { preRender.push(callback); return () => undefined; }) },
        postRender: { addEventListener: vi.fn(() => () => undefined) },
      },
      clock: { currentTime: {}, shouldAnimate: true },
      camera: { heading: 0, setView: vi.fn(), flyTo: vi.fn(), lookAt: vi.fn(), lookAtTransform: vi.fn() },
      screenSpaceEventHandler: { setInputAction: vi.fn(), removeInputAction: vi.fn() },
      dataSources: { add: vi.fn(), remove: vi.fn() },
    },
  };
});

vi.mock('./googlePhotorealisticTiles', () => ({
  loadGooglePhotorealisticTiles: mocks.loadTiles,
}));

vi.mock('resium', () => ({
  Viewer: forwardRef(function MockViewer(props: { globe?: boolean; baseLayer?: unknown; geocoder?: unknown; requestRenderMode?: boolean }, ref) {
    useImperativeHandle(ref, () => ({ cesiumElement: mocks.viewer }));
    return <div data-testid="cesium-viewer" data-request-render-mode={String(props.requestRenderMode)} data-globe={String(props.globe)} data-base-layer={props.baseLayer === undefined ? 'unset' : String(props.baseLayer)} data-geocoder={String(props.geocoder)} />;
  }),
}));

vi.mock('cesium', () => ({
  ArcType: { NONE: 0 },
  Cartesian2: class {},
  Cartesian3: { fromDegrees: vi.fn((lon: number, lat: number, height: number) => ({ lon, lat, height })) },
  Color: {
    fromCssColorString: vi.fn(() => ({})),
    fromAlpha: vi.fn(() => ({})),
  },
  ConstantProperty: class { constructor(public value: unknown) {} },
  CustomDataSource: class {
    show = true;
    added: unknown[] = [];
    entities = { add: vi.fn((value: unknown) => { this.added.push(value); return value; }), removeAll: vi.fn(() => { this.added = []; }) };
  },
  Entity: class {
    constructor(value: object) { Object.assign(this, value); }
  },
  HeadingPitchRange: class { constructor(public heading: number, public pitch: number, public range: number) {} },
  HeightReference: { NONE: 0 },
  HorizontalOrigin: { LEFT: 0 },
  IonGeocodeProviderType: { GOOGLE: 'GOOGLE' },
  LabelStyle: { FILL_AND_OUTLINE: 0 },
  Math: { toRadians: (deg: number) => (deg * Math.PI) / 180 },
  Matrix4: { IDENTITY: 'IDENTITY' },
  NearFarScalar: class {},
  ScreenSpaceEventType: { LEFT_CLICK: 0 },
  VerticalOrigin: { CENTER: 0 },
}));

import CesiumField, { followPose } from './CesiumField';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.preRender.length = 0;
});

const frame = {
  frame: 0,
  time_s: 0,
  overview: {},
  event: { event: 'GRID SET', description: '' },
  localViews: {},
} as ReplayFrame;

const swarm: SwarmFrame = {
  drones: {
    I000: { id: 'I000', position: [0, 0, 250], status: 'engaging', target: 'H000' },
    I001: { id: 'I001', position: [20, 0, 250], status: 'screen' },
  },
  hostiles: {
    H000: { id: 'H000', position: [0, 1400, 150], status: 'tracked', wave: 0 },
    H001: { id: 'H001', position: [900, 1400, 150], status: 'pending', wave: 1 },
  },
  friendlies: { F000: { id: 'F000', position: [300, 700, 200], identities: { 'CONFIRMED FRIENDLY': 5, UNKNOWN: 4 } } },
  links: [{ interceptorId: 'I000', hostileId: 'H000', active: true }],
  focus: { kind: 'drone', id: 'I000', toward: 'H000' },
  time_s: 0,
  vacant: [],
};
const roster = [
  { id: 'I000', callsign: 'A1-1-1', company: 'A', platoon: 'A1', section: 'A1-1', phase: 'initial' as const, role: 'shooter' as const },
  { id: 'I001', callsign: 'A1-1-2', company: 'A', platoon: 'A1', section: 'A1-1', phase: 'initial' as const, role: 'shooter' as const },
];

describe('CesiumField', () => {
  it('marks the real Google tiles as ready only after the loader succeeds', async () => {
    mocks.loadTiles.mockResolvedValueOnce(mocks.tileset);

    render(<CesiumField frame={frame} playing={false} perspective="OVERVIEW" sector={false} groundTruth={false} selected="I000" onSelect={vi.fn()} />);

    expect(await screen.findByTestId('map-ready')).toBeTruthy();
    expect(mocks.viewer.scene.primitives.add).toHaveBeenCalledWith(mocks.tileset);
  });

  it('keeps read-only Viewer props constant across play/pause so Resium never recreates the viewer', async () => {
    mocks.loadTiles.mockResolvedValue(mocks.tileset);
    const { rerender } = render(<CesiumField frame={frame} playing={false} perspective="OVERVIEW" sector={false} groundTruth={false} selected="I000" onSelect={vi.fn()} />);
    const before = screen.getByTestId('cesium-viewer').getAttribute('data-request-render-mode');
    rerender(<CesiumField frame={frame} playing perspective="OVERVIEW" sector={false} groundTruth={false} selected="I000" onSelect={vi.fn()} />);
    expect(screen.getByTestId('cesium-viewer').getAttribute('data-request-render-mode')).toBe(before);
  });

  it('draws every drone, hostile, friendly and engagement link, hiding later-wave hostiles', async () => {
    mocks.loadTiles.mockResolvedValueOnce(mocks.tileset);
    render(<CesiumField frame={frame} swarm={swarm} roster={roster} replayKey="miss_recovery" playing={false} perspective="OVERVIEW" sector={false} groundTruth={false} selected="I000" onSelect={vi.fn()} />);
    await screen.findByTestId('map-ready');
    const sources = () => mocks.viewer.dataSources.add.mock.calls.map(([source]) => source as { added: Array<{ id?: string; show?: boolean; point?: { pixelSize?: number; disableDepthTestDistance?: number }; polyline?: { arcType?: number } }> });
    await waitFor(() => expect(sources().some((source) => source.added.some((entity) => entity.id === 'I000'))).toBe(true));
    const added = sources().find((source) => source.added.some((entity) => entity.id === 'I000'))!.added;
    expect(added.map((entity) => entity.id)).toEqual(expect.arrayContaining(['I000', 'I001', 'H000', 'H001', 'F000', 'LINK-0']));
    expect(added.find((entity) => entity.id === 'H001')!.show).toBe(false);
    expect(added.find((entity) => entity.id === 'H000')!.show).toBe(true);
    // Visible over the 3D tiles: depth test disabled, and lines are straight 3D segments.
    expect(added.find((entity) => entity.id === 'I001')!.point!.disableDepthTestDistance).toBe(Number.POSITIVE_INFINITY);
    expect(added.find((entity) => entity.id === 'LINK-0')!.polyline!.arcType).toBe(0);
  });

  it('follows the action close-up while playing instead of pulling back to the globe', async () => {
    mocks.loadTiles.mockResolvedValueOnce(mocks.tileset);
    render(<CesiumField frame={frame} swarm={swarm} roster={roster} replayKey="miss_recovery" playing perspective="OVERVIEW" sector={false} groundTruth={false} selected="I000" onSelect={vi.fn()} />);
    await screen.findByTestId('map-ready');
    await waitFor(() => expect(mocks.preRender.length).toBe(1));
    mocks.preRender[0]();
    const [, offset] = mocks.viewer.camera.lookAt.mock.calls.at(-1)!;
    expect(offset.range).toBeLessThanOrEqual(340);
    expect(offset.pitch).toBeLessThan(0);
  });

  it('releases the camera back to the user when paused', async () => {
    mocks.loadTiles.mockResolvedValue(mocks.tileset);
    const { rerender } = render(<CesiumField frame={frame} swarm={swarm} roster={roster} playing perspective="OVERVIEW" sector={false} groundTruth={false} selected="I000" onSelect={vi.fn()} />);
    await screen.findByTestId('map-ready');
    rerender(<CesiumField frame={frame} swarm={swarm} roster={roster} playing={false} perspective="OVERVIEW" sector={false} groundTruth={false} selected="I000" onSelect={vi.fn()} />);
    expect(mocks.viewer.camera.lookAtTransform).toHaveBeenCalledWith('IDENTITY');
  });

  it('centres engagements on the area under attack, seen from the attacker side', () => {
    const attack = followPose({ kind: 'drone', id: 'I000', toward: 'H000' }, swarm, false);
    expect(attack.target).toEqual([0, 1400, 150]); // the hostile being attacked, not the drone
    expect(attack.heading).toBeCloseTo(0, 6); // attacker is due south, so the camera looks north
    expect(attack.range).toBeLessThanOrEqual(340);
    const hostile = followPose({ kind: 'hostile', id: 'H000', from: 'I000' }, swarm, false);
    expect(hostile.target).toEqual([0, 1400, 150]);
    const area = followPose({ kind: 'area', points: [[0, 0, 250], [100, 0, 250]] }, swarm, false);
    expect(area.target).toEqual([50, 0, 250]);
    const overview = followPose({ kind: 'swarm' }, swarm, false);
    expect(overview.range).toBeGreaterThan(500);
    expect(overview.range).toBeLessThan(5000);
  });

  it('moves the camera to the frame area when stepping while paused, but not in free look', async () => {
    mocks.loadTiles.mockResolvedValue(mocks.tileset);
    const { rerender } = render(<CesiumField frame={frame} swarm={swarm} roster={roster} playing={false} perspective="OVERVIEW" sector={false} groundTruth={false} selected="I000" onSelect={vi.fn()} />);
    await screen.findByTestId('map-ready');
    await waitFor(() => expect(mocks.viewer.camera.flyTo).toHaveBeenCalled());
    mocks.viewer.camera.flyTo.mockClear();
    rerender(<CesiumField frame={frame} swarm={{ ...swarm, focus: { kind: 'hostile', id: 'H000' } }} roster={roster} playing={false} perspective="OVERVIEW" sector={false} groundTruth={false} selected="I000" onSelect={vi.fn()} />);
    expect(mocks.viewer.camera.flyTo).toHaveBeenCalledTimes(1);
    mocks.viewer.camera.flyTo.mockClear();
    rerender(<CesiumField frame={frame} swarm={{ ...swarm, focus: { kind: 'swarm' } }} roster={roster} follow={false} playing={false} perspective="OVERVIEW" sector={false} groundTruth={false} selected="I000" onSelect={vi.fn()} />);
    expect(mocks.viewer.camera.flyTo).not.toHaveBeenCalled();
  });

  it('blocks the map with the loader error and keeps Resium imagery disabled', async () => {
    mocks.loadTiles.mockRejectedValueOnce(
      new Error('Google Photorealistic 3D Tiles are unavailable: VITE_CESIUM_ION_TOKEN is required.'),
    );

    render(<CesiumField frame={frame} playing={false} perspective="OVERVIEW" sector={false} groundTruth={false} selected="I000" onSelect={vi.fn()} />);

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Google Photorealistic 3D Tiles are unavailable: VITE_CESIUM_ION_TOKEN is required.',
    );
    expect(screen.getByTestId('cesium-viewer').getAttribute('data-globe')).toBe('undefined');
    expect(screen.getByTestId('cesium-viewer').getAttribute('data-base-layer')).toBe('false');
    expect(screen.getByTestId('cesium-viewer').getAttribute('data-geocoder')).toBe('GOOGLE');
  });
});
