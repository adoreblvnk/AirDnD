/** Build the voice control independently of its connection backend. */
export function createVoiceControl({ reset = false } = {}) {
  let root = document.getElementById('airdnd-voice-control');
  if (root && reset) {
    root.remove();
    root = null;
  }
  if (!root) {
    root = document.createElement('div');
    root.id = 'airdnd-voice-control';
    root.dataset.status = 'idle';
    root.dataset.speaker = 'idle';
    root.innerHTML = `
      <div class="airdnd-voice-heading">
        <div class="airdnd-voice-kicker">AI AGENT</div>
        <div id="airdnd-voice-status">OFF</div>
        <div class="airdnd-voice-cost">
          <button id="airdnd-voice-tier" class="airdnd-voice-tier-btn" type="button" aria-pressed="false" title="Voice model tier — applies next session">STD</button>
          <span id="airdnd-voice-cost-value" class="airdnd-voice-cost-value" data-level="ok" title="Estimated session cost">~$0.00</span>
        </div>
      </div>
      <button id="airdnd-voice-button" type="button" aria-label="Voice control — activate to toggle voice; hold Space to speak" aria-describedby="airdnd-voice-help">
        <span class="airdnd-mic-orbit"><img src="/mic.svg" alt="" /></span>
        <span class="airdnd-mic-label">ON/OFF</span>
      </button>
      <div class="airdnd-voice-visualizer" aria-hidden="true">
        ${Array.from({ length: 15 }, (_, index) => `<span style="--bar:${index}"></span>`).join('')}
      </div>
      <div class="airdnd-voice-readout">
        <div id="airdnd-voice-detail">VOICE STANDBY</div>
      </div>
      <div id="airdnd-voice-help" class="airdnd-voice-help-tray" role="tooltip">
        <span class="airdnd-voice-help-kicker">VOICE CONTROL</span>
        <span class="airdnd-voice-help-detail">Hold Space to speak · tap Space to activate focused controls</span>
      </div>
      <div class="airdnd-voice-error-tray" role="alert" aria-live="assertive">
        <div class="airdnd-voice-error-header">
          <span>VOICE SYSTEM ERROR</span>
          <button class="airdnd-voice-error-dismiss" type="button">DISMISS</button>
        </div>
        <div id="airdnd-voice-error-detail"></div>
        <div class="airdnd-voice-error-hint">Check microphone permission and network access, then try again.</div>
      </div>
    `;
    const commandDock = document.getElementById('command-dock');
    if (commandDock) {
      const locationBar = document.getElementById('location-bar');
      const controlPanel = document.getElementById('control-panel');
      commandDock.appendChild(root);
      if (locationBar) commandDock.insertBefore(locationBar, root);
      if (controlPanel) commandDock.appendChild(controlPanel);
    } else {
      document.body.appendChild(root);
    }
    root
      .querySelector('.airdnd-voice-error-dismiss')
      ?.addEventListener('click', () => {
        root.classList.add('error-dismissed');
      });
  }
  return {
    root,
    button: root.querySelector('#airdnd-voice-button'),
    buttonLabel: root.querySelector('.airdnd-mic-label'),
    status: root.querySelector('#airdnd-voice-status'),
    detail: root.querySelector('#airdnd-voice-detail'),
    helpDetail: root.querySelector('.airdnd-voice-help-detail'),
    errorDetail: root.querySelector('#airdnd-voice-error-detail'),
    tierButton: root.querySelector('#airdnd-voice-tier'),
    costValue: root.querySelector('#airdnd-voice-cost-value'),
  };
}
