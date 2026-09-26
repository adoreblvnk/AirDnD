import React, { forwardRef, useImperativeHandle } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReplayFrame } from './worldview';

const mocks = vi.hoisted(() => {
  const entities = { add: vi.fn((value: unknown) => value) };
  return {
    loadTiles: vi.fn(),
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
      },
      clock: { currentTime: {}, shouldAnimate: true },
      camera: { setView: vi.fn() },
      screenSpaceEventHandler: { setInputAction: vi.fn(), removeInputAction: vi.fn() },
      dataSources: { add: vi.fn(), remove: vi.fn() },
      entities,
    },
  };
});

vi.mock('./googlePhotorealisticTiles', () => ({
  loadGooglePhotorealisticTiles: mocks.loadTiles,
}));

vi.mock('resium', () => ({
  Viewer: forwardRef(function MockViewer(props: { globe?: boolean; baseLayer?: unknown; geocoder?: unknown }, ref) {
    useImperativeHandle(ref, () => ({ cesiumElement: mocks.viewer }));
    return <div data-testid="cesium-viewer" data-globe={String(props.globe)} data-base-layer={props.baseLayer === undefined ? 'unset' : String(props.baseLayer)} data-geocoder={String(props.geocoder)} />;
  }),
}));

vi.mock('cesium', () => ({
  Cartesian2: class {},
  Cartesian3: { fromDegrees: vi.fn() },
  Color: {
    fromCssColorString: vi.fn(() => ({})),
    fromAlpha: vi.fn(() => ({})),
  },
  ConstantProperty: class {},
  CustomDataSource: class {
    show = true;
    entities = { add: vi.fn((value: unknown) => value) };
  },
  Entity: class {
    constructor(value: object) { Object.assign(this, value); }
  },
  HeightReference: { NONE: 0 },
  HorizontalOrigin: { LEFT: 0 },
  IonGeocodeProviderType: { GOOGLE: 'GOOGLE' },
  LabelStyle: { FILL_AND_OUTLINE: 0 },
  NearFarScalar: class {},
  Rectangle: { fromDegrees: vi.fn(() => ({})) },
  ScreenSpaceEventType: { LEFT_CLICK: 0 },
  VerticalOrigin: { CENTER: 0 },
}));

import CesiumField from './CesiumField';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const frame = {
  frame: 0,
  time_s: 0,
  overview: {},
  event: { event: 'GRID SET', description: '' },
  localViews: {},
} as ReplayFrame;

describe('CesiumField', () => {
  it('marks the real Google tiles as ready only after the loader succeeds', async () => {
    mocks.loadTiles.mockResolvedValueOnce(mocks.tileset);

    render(<CesiumField frame={frame} playing={false} perspective="OVERVIEW" sector={false} groundTruth={false} selected="I-07" onSelect={vi.fn()} />);

    expect(await screen.findByTestId('map-ready')).toBeTruthy();
    expect(mocks.viewer.scene.primitives.add).toHaveBeenCalledWith(mocks.tileset);
  });

  it('blocks the map with the loader error and keeps Resium imagery disabled', async () => {
    mocks.loadTiles.mockRejectedValueOnce(
      new Error('Google Photorealistic 3D Tiles are unavailable: VITE_CESIUM_ION_TOKEN is required.'),
    );

    render(<CesiumField frame={frame} playing={false} perspective="OVERVIEW" sector={false} groundTruth={false} selected="I-07" onSelect={vi.fn()} />);

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Google Photorealistic 3D Tiles are unavailable: VITE_CESIUM_ION_TOKEN is required.',
    );
    expect(screen.getByTestId('cesium-viewer').getAttribute('data-globe')).toBe('undefined');
    expect(screen.getByTestId('cesium-viewer').getAttribute('data-base-layer')).toBe('false');
    expect(screen.getByTestId('cesium-viewer').getAttribute('data-geocoder')).toBe('GOOGLE');
  });
});
