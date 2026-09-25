import { createStandaloneApplication } from './standalone/application.js';
import { describeError } from './standalone/errors.js';
import { AirDnDLayer } from './airdnd/airdndLayer.js';

const application = createStandaloneApplication({
  googleApiKey: import.meta.env.GOOGLE_MAPS_API_KEY,
  cesiumToken: import.meta.env.CESIUM_ION_TOKEN,
  allowQaRegistration: import.meta.env.DEV,
});

application
  .start()
  .then(() => {
    const components = application.getComponents();
    if (components.scene?.viewer) {
      const airdnd = new AirDnDLayer(components.scene.viewer);
      window.airdnd = airdnd;
      console.info(
        "[AirDnD] Tactical Air Defense Layer mounted successfully.",
      );
    }
  })
  .catch((error) => {
    console.error("AirDnD initialization failed:", error);
    const loaderStatus = document.querySelector(
      '#loading-screen .loader-status',
    );
    if (loaderStatus) {
      loaderStatus.textContent = `Error: ${describeError(error)}`;
      loaderStatus.style.color = '#ff4444';
    }
  });
export { application };
