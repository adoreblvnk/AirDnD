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
    await expect(loadGooglePhotorealisticTiles({ googleMapsApiKey: 'google-key' })).rejects.toThrow(
      'Google Photorealistic 3D Tiles are unavailable: VITE_CESIUM_ION_TOKEN is required.',
    );
    expect(cesium.createGooglePhotorealistic3DTileset).not.toHaveBeenCalled();
  });

  it('throws a blocking configuration error when the paid Google Maps key is missing', async () => {
    await expect(loadGooglePhotorealisticTiles({ ionToken: 'ion-token' })).rejects.toThrow(
      'Google Photorealistic 3D Tiles are unavailable: VITE_GOOGLE_MAPS_API_KEY is required.',
    );
    expect(cesium.createGooglePhotorealistic3DTileset).not.toHaveBeenCalled();
  });

  it('configures Cesium ion and uses the paid Google Map Tiles API key', async () => {
    const tileset = { kind: 'google-photorealistic-tiles' };
    cesium.createGooglePhotorealistic3DTileset.mockResolvedValue(tileset);

    await expect(loadGooglePhotorealisticTiles({
      ionToken: 'ion-token',
      googleMapsApiKey: 'google-key',
    })).resolves.toBe(tileset);

    expect(cesium.Ion.defaultAccessToken).toBe('ion-token');
    expect(cesium.createGooglePhotorealistic3DTileset).toHaveBeenCalledOnce();
    expect(cesium.createGooglePhotorealistic3DTileset).toHaveBeenCalledWith({
      key: 'google-key',
      onlyUsingWithGoogleGeocoder: true,
    });
  });

  it('turns Cesium load failures into a clear blocking error', async () => {
    cesium.createGooglePhotorealistic3DTileset.mockRejectedValue(new Error('network denied'));

    await expect(loadGooglePhotorealisticTiles({
      ionToken: 'ion-token',
      googleMapsApiKey: 'google-key',
    })).rejects.toThrow(
      'Google Photorealistic 3D Tiles failed to load: network denied',
    );
  });
});
