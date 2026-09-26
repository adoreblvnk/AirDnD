import { beforeEach, describe, expect, it, vi } from 'vitest';

const cesium = vi.hoisted(() => ({
  createGooglePhotorealistic3DTileset: vi.fn(),
  Ion: { defaultAccessToken: '' },
}));

vi.mock('cesium', () => cesium);

import { loadGooglePhotorealisticTiles } from './googlePhotorealisticTiles';

describe('loadGooglePhotorealisticTiles', () => {
  beforeEach(() => {
    cesium.Ion.defaultAccessToken = '';
    cesium.createGooglePhotorealistic3DTileset.mockReset();
  });

  it('throws a blocking configuration error when the Cesium ion token is missing', async () => {
    await expect(loadGooglePhotorealisticTiles(undefined)).rejects.toThrow(
      'Google Photorealistic 3D Tiles are unavailable: VITE_CESIUM_ION_TOKEN is required.',
    );
    expect(cesium.createGooglePhotorealistic3DTileset).not.toHaveBeenCalled();
  });

  it('configures Cesium ion before loading Google Photorealistic 3D Tiles', async () => {
    const tileset = { kind: 'google-photorealistic-tiles' };
    cesium.createGooglePhotorealistic3DTileset.mockResolvedValue(tileset);

    await expect(loadGooglePhotorealisticTiles('ion-token')).resolves.toBe(tileset);

    expect(cesium.Ion.defaultAccessToken).toBe('ion-token');
    expect(cesium.createGooglePhotorealistic3DTileset).toHaveBeenCalledOnce();
    expect(cesium.createGooglePhotorealistic3DTileset).toHaveBeenCalledWith({
      onlyUsingWithGoogleGeocoder: true,
    });
  });

  it('turns Cesium load failures into a clear blocking error', async () => {
    cesium.createGooglePhotorealistic3DTileset.mockRejectedValue(new Error('network denied'));

    await expect(loadGooglePhotorealisticTiles('ion-token')).rejects.toThrow(
      'Google Photorealistic 3D Tiles failed to load: network denied',
    );
  });
});
