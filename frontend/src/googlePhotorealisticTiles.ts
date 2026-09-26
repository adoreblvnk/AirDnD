import { createGooglePhotorealistic3DTileset, Ion } from 'cesium';

export const GOOGLE_TILES_ION_TOKEN_ERROR =
  'Google Photorealistic 3D Tiles are unavailable: VITE_CESIUM_ION_TOKEN is required.';
export const GOOGLE_TILES_API_KEY_ERROR =
  'Google Photorealistic 3D Tiles are unavailable: VITE_GOOGLE_MAPS_API_KEY is required.';

interface GooglePhotorealisticTilesConfig {
  ionToken?: string;
  googleMapsApiKey?: string;
}

export async function loadGooglePhotorealisticTiles({
  ionToken,
  googleMapsApiKey,
}: GooglePhotorealisticTilesConfig) {
  if (!ionToken?.trim()) throw new Error(GOOGLE_TILES_ION_TOKEN_ERROR);
  if (!googleMapsApiKey?.trim()) throw new Error(GOOGLE_TILES_API_KEY_ERROR);

  Ion.defaultAccessToken = ionToken;
  try {
    return await createGooglePhotorealistic3DTileset({
      key: googleMapsApiKey,
      onlyUsingWithGoogleGeocoder: true,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Google Photorealistic 3D Tiles failed to load: ${detail}`, { cause: error });
  }
}
