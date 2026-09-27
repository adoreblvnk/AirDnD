import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import cesium from 'vite-plugin-cesium';

// Dev proxy target for the FastAPI service; override with AIRDND_API_URL to point at another port.
const apiTarget = process.env.AIRDND_API_URL ?? 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [react(), cesium()],
  server: {
    proxy: { '/api': apiTarget, '/ws': { target: apiTarget.replace(/^http/, 'ws'), ws: true } },
    // configs/scenarios.json (the shared scenario catalogue) lives one level above frontend/.
    fs: { allow: ['..'] },
  },
  test: { environment: 'jsdom' },
});
