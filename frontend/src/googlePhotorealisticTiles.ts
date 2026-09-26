import { createGooglePhotorealistic3DTileset, Ion } from 'cesium';

export const GOOGLE_TILES_TOKEN_ERROR =
  'Google Photorealistic 3D Tiles are unavailable: VITE_CESIUM_ION_TOKEN is required.';

export async function loadGooglePhotorealisticTiles(token: string | undefined) {
  if (!token?.trim()) throw new Error(GOOGLE_TILES_TOKEN_ERROR);

  Ion.defaultAccessToken = token;
  try {
    return await createGooglePhotorealistic3DTileset({
      onlyUsingWithGoogleGeocoder: true,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Google Photorealistic 3D Tiles failed to load: ${detail}`, { cause: error });
  }
}
