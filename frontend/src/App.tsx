import { useEffect, useMemo, useReducer, useState } from 'react';
import CesiumField from './CesiumField';
import SideElevation from './SideElevation';
import SafetyPanel from './SafetyPanel';
import { DRONE_STATUS_LABELS, describeReplayError, groupRoster, loadReplay, initialState, reducer, replayAt, replayDecision, replayFleetStatus, replaySwarmAt, rosterCallsign, type Perspective, type Replay } from './worldview';
import { SCENARIOS, scenarioInfo } from './scenarios';
import './styles.css';

const perspectives: Array<{ key: Perspective; label: string }> = [
  { key: 'OVERVIEW', label: 'BATTLESPACE' },
  { key: 'HOSTILE', label: 'HOSTILE VIEW' },
  { key: 'INTERCEPTOR', label: 'INTERCEPTOR VIEW' },
  { key: 'OBSERVER', label: 'OBSERVER VIEW' },
];

const fleetStateLabels: Record<'departing' | 'on_station' | 'returning' | 'docked', string> = {
  departing: 'DEPARTING',
  on_station: 'ON STATION',
  returning: 'RETURNING',
  docked: 'DOCKED',
};

function identityModifier(state: string): string {
  if (state === 'CONFIRMED FRIENDLY') return 'confirmed';
  if (state === 'FRIENDLY LINEAGE') return 'lineage';
  if (state === 'HOSTILE EVIDENCE') return 'hostile';
  return 'unknown';
}

function IdentityBadge({ state }: { state: string }) {
  return <small className={`identity-badge ${identityModifier(state)}`}>{state}</small>;
}

function BatteryBar({ level }: { level: number }) {
  const fillWidth = Math.max(0, Math.min(1, level)) * 12;
  const tier = level > 0.5 ? 'high' : level > 0.2 ? 'mid' : 'low';
  return (
    <svg className={`battery-bar ${tier}`} viewBox="0 0 18 9" aria-hidden="true">
      <rect x="0.5" y="0.5" width="15" height="8" rx="1.5" className="battery-shell" />
      <rect x="16" y="3" width="1.5" height="3" className="battery-nub" />
      <rect x="2" y="2" width={fillWidth} height="5" className="battery-fill" />
    </svg>
  );
}

function Icon({ name }: { name: 'play' | 'pause' | 'stepBack' | 'stepForward' | 'reset' }) {
  const paths = {
    reset: <><path d="M4 4v12" /><path d="m16 4-9 6 9 6z" /><path d="M10 4v12" /></>,
    play: <path d="M5 3.5 16 10 5 16.5z" />,
    pause: <><path d="M5 4h3v12H5z" /><path d="M12 4h3v12h-3z" /></>,
    stepBack: <><path d="M5 4v12" /><path d="m15 4-8 6 8 6z" /></>,
    stepForward: <><path d="M15 4v12" /><path d="m5 4 8 6-8 6z" /></>,
  };
  return <svg viewBox="0 0 20 20" aria-hidden="true">{paths[name]}</svg>;
}

function Worldview() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [replay, setReplay] = useState<Replay | null>(null);
  const [replayError, setReplayError] = useState('');
  const [headingRad, setHeadingRad] = useState(0);
  const roster = replay?.roster ?? [];
  const platoons = useMemo(() => groupRoster(replay?.roster ?? []), [replay]);
  const selectedId = roster.some((drone) => drone.id === state.selected) ? state.selected : roster[0]?.id ?? state.selected;
  const frame = replay ? replayAt(replay, state.frame) : undefined;
  const swarm = replay ? replaySwarmAt(replay, state.frame) : undefined;
  const generatedDecision = replay ? replayDecision(replay, state.frame, selectedId) : undefined;
  const selectedDrone = swarm?.drones[selectedId];
  const selected = generatedDecision ?? { id: rosterCallsign(replay, selectedId), agentId: selectedId, local: 'NO LOCAL TRACK', decision: selectedDrone ? DRONE_STATUS_LABELS[selectedDrone.status] : 'AWAIT REPLAY', identity: 'UNKNOWN' };
  const moment = frame?.event ?? { event: 'GRID SET' as const, description: replayError || 'Loading generated replay' };
  const hostileCount = swarm ? Object.values(swarm.hostiles).filter((hostile) => hostile.status !== 'pending').length : 0;
  const neutralizedCount = swarm ? Object.values(swarm.hostiles).filter((hostile) => hostile.status === 'neutralized').length : 0;
  const sectionCount = platoons.reduce((sum, platoon) => sum + platoon.sections.length, 0);
  const friendlyCount = swarm ? Object.keys(swarm.friendlies).length : 0;
  const pendingCount = swarm ? Object.values(swarm.hostiles).filter((hostile) => hostile.status === 'pending').length : 0;
  const activeScenario = scenarioInfo(state.scenario);

  useEffect(() => {
    document.body.classList.add('worldview-active');
  }, []);

  useEffect(() => {
    let active = true;
    setReplay(null);
    setReplayError('');
    loadReplay(state.scenario)
      .then((loaded) => {
        if (!active) return;
        setReplay(loaded);
        dispatch({ type: 'replay-loaded', maxFrame: loaded.frames.at(-1)?.frame ?? 0 });
      })
      .catch((error: unknown) => { if (active) setReplayError(describeReplayError(error)); });
    return () => { active = false; };
  }, [state.scenario]);

  useEffect(() => {
    if (!state.playing) return;
    const timer = window.setInterval(() => dispatch({ type: 'tick' }), 85);
    return () => window.clearInterval(timer);
  }, [state.playing]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.code === 'Space') { event.preventDefault(); dispatch({ type: 'toggle-play' }); }
      if (event.key === 'ArrowLeft') dispatch({ type: 'step', delta: -1 });
      if (event.key === 'ArrowRight') dispatch({ type: 'step', delta: 1 });
      if (event.key.toLowerCase() === 't') dispatch({ type: 'toggle-truth' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const time = useMemo(() => {
    const seconds = frame?.time_s ?? 0;
    return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  }, [frame]);

  const compareIds = state.pinned.length ? state.pinned : roster.slice(0, 3).map((drone) => drone.id);

  return (
    <main className="worldview">
      <div className="map-field" aria-label="Live 3D AirDnD battlespace">
        <CesiumField
          frame={frame}
          swarm={swarm}
          roster={replay?.roster}
          cells={replay?.cells}
          replayKey={replay?.scenarioId}
          playing={state.playing}
          follow={state.follow}
          onHeadingChange={setHeadingRad}
          perspective={state.perspective}
          sector={state.view === 'sector'}
          groundTruth={state.groundTruth}
          selected={selectedId}
          onSelect={(id) => dispatch({ type: 'select', id })}
        />
        <div className="provenance" data-testid="provenance">RECORDED SIMULATOR EVENTS · NOT FLIGHT DATA</div>
        <ul className="map-legend" aria-label="Map legend">
          <li><i className="legend-friendly" aria-hidden="true" />Friendly</li>
          <li><i className="legend-opposing" aria-hidden="true" />Opposing</li>
          <li><i className="legend-unknown" aria-hidden="true" />Friendly transit · identity varies</li>
          <li><i className="legend-vacant" aria-hidden="true" />Vacant cell</li>
        </ul>
        <div className="plot-title" aria-hidden="true"><span>MARINA BAY / 01°17′N</span><span>103°51′E / ALT 0—600M</span></div>
        {swarm && <SideElevation swarm={swarm} selected={selectedId} headingRad={headingRad} />}
        <div className={`event-marker ${moment.event === 'MISS' ? 'alert' : ''}`}>
          <strong>{moment.event}</strong><span>{moment.description}</span>
        </div>
      </div>

      <aside className="command-rail" aria-label="Worldview controls">
        <a className="wordmark" href="/" aria-label="AirDnD worldview"><b>AIR</b><span>DND</span></a>
        <nav aria-label="Primary">
          <a className="active" href="/">WORLDVIEW</a>
          <a data-testid="nav-evidence" href="/evidence">EVIDENCE</a>
          <a data-testid="nav-training" href="/training">TRAINING</a>
        </nav>
        <div className="rail-group">
          <span className="rail-label">SCOPE</span>
          <div className="switch-line">
            <button data-testid="view-overview" className={state.view === 'overview' ? 'selected' : ''} onClick={() => dispatch({ type: 'view', view: 'overview' })}>OVERVIEW</button>
            <button data-testid="view-sector" className={state.view === 'sector' ? 'selected' : ''} onClick={() => dispatch({ type: 'view', view: 'sector' })}>SECTOR</button>
          </div>
          <button data-testid="camera-follow" className={`follow-toggle${state.follow ? ' selected' : ''}`} aria-pressed={state.follow} onClick={() => dispatch({ type: 'toggle-follow' })}>{state.follow ? 'CAMERA · FOLLOW ACTION' : 'CAMERA · FREE LOOK'}</button>
        </div>
        <div className="rail-group perspective-list">
          <span className="rail-label">PERSPECTIVE</span>
          {perspectives.map((item) => (
            <button data-testid={`perspective-${item.key.toLowerCase()}`} key={item.key} className={state.perspective === item.key ? 'selected' : ''} onClick={() => dispatch({ type: 'perspective', perspective: item.key })}>{item.label}</button>
          ))}
        </div>
        <div className="rail-group scenarios">
          <span className="rail-label">SCENARIO</span>
          {SCENARIOS.map((scenario, index) => (
            <button key={scenario.id} data-testid={`replay-${scenario.id}`} className={state.scenario === scenario.id ? 'selected' : ''} aria-pressed={state.scenario === scenario.id} title={scenario.summary} onClick={() => dispatch({ type: 'scenario', scenario: scenario.id })}>
              <span className="scenario-index">{index + 1}</span>{scenario.title.toUpperCase()}
            </button>
          ))}
          {activeScenario && <p className="scenario-brief" data-testid="scenario-brief"><b>{activeScenario.force}</b>{activeScenario.summary}</p>}
        </div>
        <div className="rail-group order-of-battle" data-testid="order-of-battle">
          <span className="rail-label">ORDER OF BATTLE</span>
          <p>{roster.length} FRIENDLY · {platoons.length} PLT · {sectionCount} SEC</p>
          <p>{hostileCount} HOSTILE · {neutralizedCount} DOWN{pendingCount ? ` · ${pendingCount} INBOUND LATER` : ''}</p>
          {friendlyCount > 0 && <p>{friendlyCount} FRIENDLY TRANSIT · NOT ENGAGED</p>}
        </div>
        <label className="truth-toggle">
          <input type="checkbox" checked={state.groundTruth} onChange={() => dispatch({ type: 'toggle-truth' })} />
          <span>EVALUATOR TRUTH</span><small>explicit overlay</small>
        </label>
        <p className="local-note">LOCAL VIEW MASK ACTIVE<br />No shared target IDs</p>
      </aside>

      <aside data-testid="decision-inspector" className="decision-panel" aria-label="Selected decision detail">
        <header>
          <div><span>SELECTED UNIT</span><strong>{selected.id}</strong></div>
          <button onClick={() => dispatch({ type: 'pin', id: selectedId })} disabled={state.pinned.length === 3 || state.pinned.includes(selectedId)}>PIN {state.pinned.length}/3</button>
        </header>
        <div className="decision-primary">
          <span>ACTION</span><strong>{selectedDrone ? DRONE_STATUS_LABELS[selectedDrone.status] : selected.decision}{selectedDrone?.target ? ` · ${selectedDrone.target}` : ''}</strong>
          <p>Generated local decision from immutable replay frame F{String(frame?.frame ?? 0).padStart(3, '0')}.</p>
          <p data-testid="rvo-trace">v<sub>pref</sub> {selected.preferredVelocity?.join('/') ?? 'not recorded'} → v<sub>safe</sub> {selected.safeVelocity?.join('/') ?? 'not recorded'}</p>
        </div>
        <div className="candidate-head"><span>LOCAL CANDIDATES</span><span>UTILITY</span></div>
        {selected.visibleTracks && selected.visibleTracks.length > 0 ? selected.visibleTracks.slice(0, 6).map((track) => (
          <button key={track.track_id} className={track.track_id === selected.local ? 'candidate selected' : 'candidate'} disabled={track.track_id !== selected.local}>
            <span>{track.track_id}<IdentityBadge state={track.identity_state} /></span>
            <b>{track.track_id === selected.local ? selected.utility?.toFixed(2) ?? '—' : '—'}</b>
          </button>
        )) : <>
          <button className="candidate selected"><span>{selected.local}<IdentityBadge state={selected.identity} /></span><b>{selected.utility?.toFixed(2) ?? '—'}</b></button>
          <button className="candidate" disabled><span>REPLAY-RECORDED CANDIDATES ONLY<small>NO AUTHORED ESTIMATE</small></span><b>—</b></button>
        </>}
        <button className="disclosure" aria-expanded={state.detailOpen} onClick={() => dispatch({ type: 'toggle-detail' })}>DECISION TRACE <span>{state.detailOpen ? 'CLOSE' : 'OPEN'}</span></button>
        {state.detailOpen && <div className="trace">
          <dl><dt>P(leak)</dt><dd>{selected.leak ?? '—'}{selected.leak === undefined ? '' : '%'}</dd><dt>P(success)</dt><dd>{selected.success ?? '—'}{selected.success === undefined ? '' : '%'}</dd><dt>P(covered)</dt><dd>{selected.covered ?? '—'}{selected.covered === undefined ? '' : '%'}</dd><dt>confidence</dt><dd>{selected.confidence ?? '—'}{selected.confidence === undefined ? '' : '%'}</dd></dl>
          <hr />
          <p>Source {replay?.source ?? 'unavailable'} · frame {frame?.frame ?? '—'} · {replay?.evidenceClass ?? 'pending'}</p>
          <p>v<sub>pref</sub> [{selected.preferredVelocity?.join(', ') ?? 'not recorded'}] · v<sub>safe</sub> [{selected.safeVelocity?.join(', ') ?? 'not recorded'}]</p>
          <p>Safety override: {selected.safetyOverride === undefined ? 'NOT RECORDED' : selected.safetyOverride ? 'ACTIVE' : 'CLEAR'}</p>
        </div>}
        <SafetyPanel replay={replay} frame={state.frame} agentId={selectedId} />
        {selectedDrone && replay && (() => {
          const status = replayFleetStatus(replay, state.frame, selectedId);
          return status?.lifecycleState ? <p className="fleet-status selected-status"><BatteryBar level={status.battery ?? 0} />{Math.round((status.battery ?? 0) * 100)}%<small>{fleetStateLabels[status.lifecycleState]}</small></p> : null;
        })()}
        <div className="fleet-select" data-testid="fleet-select">
          <span>SELECT UNIT · {roster.length} DRONES</span>
          {platoons.map((platoon) => (
            <div className="platoon" key={platoon.id}>
              <b className="platoon-id">{platoon.id === '—' ? 'UNITS' : `${platoon.id} PLATOON`}</b>
              <div className="sections">
                {platoon.sections.map((section) => (
                  <div className="section" key={section.id}>
                    <small>{section.id === '—' ? '' : section.id}</small>
                    <div className="section-grid">
                      {section.drones.map((drone) => {
                        const status = swarm?.drones[drone.id]?.status;
                        return (
                          <button
                            key={drone.id}
                            data-testid={`unit-${drone.id}`}
                            className={`drone-chip ${status ?? 'unknown'}${selectedId === drone.id ? ' selected' : ''}`}
                            title={`${drone.callsign} · ${status ? DRONE_STATUS_LABELS[status] : 'NO DATA'}`}
                            aria-label={`${drone.callsign} ${status ? DRONE_STATUS_LABELS[status] : 'NO DATA'}`}
                            aria-pressed={selectedId === drone.id}
                            onClick={() => dispatch({ type: 'select', id: drone.id })}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </aside>

      <section className="timeline" aria-label="Replay timeline">
        <button className="icon-button" aria-label="Reset replay" data-testid="replay-reset" onClick={() => dispatch({ type: 'reset' })}><Icon name="reset" /></button>
        <button className="icon-button primary" aria-label={state.playing ? 'Pause replay' : 'Play replay'} onClick={() => dispatch({ type: 'toggle-play' })}><Icon name={state.playing ? 'pause' : 'play'} /></button>
        <button className="icon-button" aria-label="Previous frame" onClick={() => dispatch({ type: 'step', delta: -1 })}><Icon name="stepBack" /></button>
        <button className="icon-button" aria-label="Next frame" onClick={() => dispatch({ type: 'step', delta: 1 })}><Icon name="stepForward" /></button>
        <strong>{time}</strong>
        <div className="timeline-track">
          <input aria-label="Replay frame" type="range" min="0" max={state.maxFrame} value={state.frame} onChange={(event) => dispatch({ type: 'scrub', frame: Number(event.target.value) })} />
          <div className="timeline-markers" aria-label="Key events">
            {(replay?.markers ?? []).map((marker) => (
              <button
                key={`${marker.event}-${marker.frame}`}
                className={`timeline-marker ${marker.event.toLowerCase().replaceAll(' ', '-')}`}
                style={{ left: `${(marker.frame / Math.max(1, state.maxFrame)) * 100}%` }}
                aria-label={`Jump to ${marker.event} at frame ${marker.frame}`}
                title={`${marker.event} · ${marker.label}`}
                onClick={() => dispatch({ type: 'scrub', frame: marker.frame })}
              />
            ))}
          </div>
        </div>
        <span>F{String(state.frame).padStart(3, '0')} / F{String(state.maxFrame).padStart(3, '0')}</span>
        <button className="compare-trigger" onClick={() => dispatch({ type: 'toggle-compare' })}>PINNED COMPARISON {state.pinned.length}/3</button>
      </section>

      <section data-testid="blackout-status" className="blackout" aria-label="Radio blackout status">
        <span><b>RF GROUND LINKS</b><strong>0</strong></span>
        <span><b>RF INTER-DRONE</b><strong>0</strong></span>
        <span><b>TARGET ASSIGNMENTS</b><strong>0</strong></span>
        <span className="nir"><b>NIR IDENTITY BEACONS</b><strong>ACTIVE</strong></span>
        <em>identity only · no tracks / intent / assignment</em>
      </section>

      {state.compareOpen && <section className="comparison" aria-label="Three-drone pinned comparison">
        <header><strong>INDEPENDENT LOCAL VIEWS · SAME PHYSICAL HOSTILE</strong><button onClick={() => dispatch({ type: 'toggle-compare' })}>CLOSE</button></header>
        <div className="comparison-grid">
          {compareIds.map((id) => {
            const decision = replay ? replayDecision(replay, state.frame, id) : undefined;
            return <article key={id}><h2>{rosterCallsign(replay, id)}</h2><p>LOCAL TRACK <b>{decision?.local ?? 'NO DATA'}</b></p><dl><dt>P(leak)</dt><dd>{decision?.leak ?? '—'}{decision?.leak === undefined ? '' : '%'}</dd><dt>P(my action)</dt><dd>{decision?.success ?? '—'}{decision?.success === undefined ? '' : '%'}</dd><dt>P(friendly cover)</dt><dd>{decision?.covered ?? '—'}{decision?.covered === undefined ? '' : '%'}</dd></dl><strong>{decision?.decision ?? 'NO REPLAY DECISION'}</strong></article>;
          })}
        </div>
        <p className="comparison-note">Divergent local IDs. No RF messages exchanged.</p>
      </section>}
    </main>
  );
}

type TrainingStatus = 'queued' | 'running' | 'completed' | 'failed';

interface TrainingArtifact {
  name?: string;
  filename?: string;
  format?: string;
  path?: string;
  download_url?: string;
  url?: string;
  size_bytes?: number;
  sha256?: string;
  runtime_verified?: boolean;
  max_abs_error?: number;
}

interface TrainingMetric {
  epoch: number;
  train_loss: number;
  heldout_loss: number;
}

interface TrainingRun {
  id?: string;
  run_id?: string;
  status: TrainingStatus;
  epoch?: number;
  current_epoch?: number;
  epochs?: number;
  train_loss?: number;
  held_out_loss?: number;
  config?: { seed: number; samples: number; epochs: number };
  metrics?: TrainingMetric[];
  report?: Record<string, unknown> | string;
  artifacts?: TrainingArtifact[];
  error?: string;
  detail?: string;
}

function apiError(data: unknown, fallback: string) {
  if (!data || typeof data !== 'object') return fallback;
  const detail = (data as { detail?: unknown }).detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map((item) => typeof item === 'object' && item && 'msg' in item ? String(item.msg) : String(item)).join('; ');
  return fallback;
}

async function trainingRequest(url: string, options?: RequestInit): Promise<TrainingRun> {
  const response = options ? await fetch(url, options) : await fetch(url);
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(apiError(data, `Training API request failed (${response.status})`));
  return data as TrainingRun;
}

function Training() {
  const [seed, setSeed] = useState(17);
  const [samples, setSamples] = useState(256);
  const [epochs, setEpochs] = useState(30);
  const [run, setRun] = useState<TrainingRun | null>(null);
  const [runId, setRunId] = useState('');
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!runId) return;
    let active = true;
    let timer = 0;
    const poll = async () => {
      try {
        const next = await trainingRequest(`/api/training/runs/${encodeURIComponent(runId)}`);
        if (!active) return;
        setRun(next);
        if (next.status === 'queued' || next.status === 'running') timer = window.setTimeout(poll, 1000);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : 'Unable to read training status');
      }
    };
    void poll();
    return () => { active = false; window.clearTimeout(timer); };
  }, [runId]);

  const start = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStarting(true);
    setError('');
    setRun(null);
    setRunId('');
    try {
      const created = await trainingRequest('/api/training/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed, samples, epochs }),
      });
      const id = created.id ?? created.run_id;
      if (!id) throw new Error('Training API returned no run identifier');
      setRun(created);
      setRunId(id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to start training');
    } finally {
      setStarting(false);
    }
  };

  const latestMetric = run?.metrics?.at(-1);
  const epoch = latestMetric?.epoch ?? run?.epoch ?? run?.current_epoch;
  const totalEpochs = run?.config?.epochs ?? run?.epochs ?? epochs;
  const trainLoss = latestMetric?.train_loss ?? run?.train_loss;
  const heldOutLoss = latestMetric?.heldout_loss ?? run?.held_out_loss;
  const reportEntries = run?.report && typeof run.report === 'object' ? Object.entries(run.report) : [];
  const statusError = run?.status === 'failed' ? run.error ?? run.detail ?? 'Training run failed' : '';

  return <main className="training-page">
    <header className="training-header">
      <a className="wordmark" href="/"><b>AIR</b><span>DND</span></a>
      <div><h1>Model training</h1><p>Live backend execution · no local fallback</p></div>
      <nav aria-label="Primary"><a href="/">WORLDVIEW</a><a href="/evidence">EVIDENCE</a><a className="active" href="/training">TRAINING</a></nav>
    </header>
    <section className="training-workspace">
      <form className="training-config" onSubmit={start}>
        <div><span>RUN CONFIGURATION</span><p>Start a new belief-model training job on the API service.</p></div>
        <label>Seed<input aria-label="Seed" type="number" min="0" max="2147483647" step="1" required value={seed} onChange={(event) => setSeed(Number(event.target.value))} /></label>
        <label>Samples<input aria-label="Samples" type="number" min="4" max="4096" step="1" required value={samples} onChange={(event) => setSamples(Number(event.target.value))} /></label>
        <label>Epochs<input aria-label="Epochs" type="number" min="1" max="500" step="1" required value={epochs} onChange={(event) => setEpochs(Number(event.target.value))} /></label>
        <button type="submit" disabled={starting || run?.status === 'queued' || run?.status === 'running'}>{starting ? 'STARTING…' : 'START TRAINING'}</button>
      </form>
      <article className="training-status" aria-live="polite">
        <div className="training-status-line"><span>RUN STATUS</span><strong>{run?.status.toUpperCase() ?? 'NOT STARTED'}</strong></div>
        {run && <>
          <dl className="training-run-meta"><dt>Run ID</dt><dd>{run.id ?? run.run_id}</dd>{epoch !== undefined && <><dt>Progress</dt><dd>EPOCH {epoch} / {totalEpochs}</dd></>}</dl>
          {(trainLoss !== undefined || heldOutLoss !== undefined) && <div className="loss-grid">
            {trainLoss !== undefined && <div><span>TRAIN LOSS</span><strong>{trainLoss}</strong></div>}
            {heldOutLoss !== undefined && <div><span>HELD-OUT LOSS</span><strong>{heldOutLoss}</strong></div>}
          </div>}
          {run.status === 'completed' && run.report && <section className="completion-report"><h2>Completion report</h2>{typeof run.report === 'string' ? <p>{run.report}</p> : <dl>{reportEntries.map(([key, value]) => <div key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd></div>)}</dl>}</section>}
          {run.status === 'completed' && run.artifacts && run.artifacts.length > 0 && <section className="training-artifacts"><h2>Artifacts</h2>{run.artifacts.map((artifact, index) => {
            const name = artifact.path ?? artifact.name ?? artifact.filename ?? artifact.format;
            const href = artifact.download_url ?? artifact.url;
            return <div className="artifact-row" key={`${name}-${index}`}><div>{name && (href ? <a href={href}>{name}</a> : <strong>{name}</strong>)}<dl>{artifact.format && <><dt>Format</dt><dd>{artifact.format}</dd></>}{artifact.size_bytes !== undefined && <><dt>Size</dt><dd>{artifact.size_bytes.toLocaleString()} bytes</dd></>}{artifact.runtime_verified !== undefined && <><dt>Runtime verified</dt><dd>{String(artifact.runtime_verified)}</dd></>}{artifact.max_abs_error !== undefined && <><dt>Max abs error</dt><dd>{artifact.max_abs_error}</dd></>}</dl></div>{artifact.sha256 && <code>{artifact.sha256}</code>}</div>;
          })}</section>}
        </>}
        {(error || statusError) && <p className="training-error" role="alert">{error || statusError}</p>}
        {!run && !error && <p className="training-empty">Configure the bounded inputs and start a backend run. Progress appears only after the API returns it.</p>}
      </article>
    </section>
  </main>;
}

interface BenchmarkReport {
  evidence_class: string;
  git_revision: string;
  paired_seed_count: number;
  hostiles: number;
  methods: string[];
  claims: Record<string, string>;
  statistics: Record<string, {
    leakage: { numerator: number; denominator: number; mean: number };
    duplicate_pursuit: { numerator: number; denominator: number };
    minimum_separation_m: { mean: number };
    latency: { p95_ms: number };
  }>;
}

function Evidence() {
  const [report, setReport] = useState<BenchmarkReport | null>(null);
  const [error, setError] = useState('LOADING VERIFIED EVIDENCE');
  const [selected, choose] = useReducer((_s: number, n: number) => n, 0);

  useEffect(() => {
    fetch('/api/evidence/files/reports/benchmark.json')
      .then((response) => {
        if (!response.ok) throw new Error('Evidence API unavailable');
        return response.json();
      })
      .then((data: BenchmarkReport) => { setReport(data); setError(''); })
      .catch(() => setError('GENERATE EVIDENCE FIRST · START THE FASTAPI SERVICE'));
  }, []);

  const method = report?.methods[selected] ?? 'airdnd';
  const metrics = report?.statistics[method];
  const label = method.replaceAll('_', ' ').toUpperCase();

  return <main className="evidence-page">
    <header className="evidence-header"><a className="wordmark" href="/"><b>AIR</b><span>DND</span></a><div><h1>Evidence archive</h1><p>Replay-to-log inspection · exact metadata · raw artifacts</p></div><nav aria-label="Primary"><a href="/">WORLDVIEW</a><a data-testid="nav-training" href="/training">TRAINING</a></nav></header>
    <section className="evidence-ledger">
      <div className="run-index"><h2>Recorded methods</h2>{(report?.methods ?? ['airdnd']).map((item, index) => <button className={selected === index ? 'selected' : ''} key={item} onClick={() => choose(index)}><span>{String(index + 1).padStart(2, '0')}</span><b>{item.replaceAll('_', ' ')}</b><small>100-hostile paired benchmark</small></button>)}</div>
      <article className="run-sheet">
        <div className="run-rule"><span data-testid="evidence-status">{error || report?.evidence_class}</span><strong>{report ? `${report.paired_seed_count} PAIRED SEEDS` : 'NO VERIFIED RUN'}</strong></div>
        <h2>{label}</h2><p>100-hostile fixed-configuration simulation benchmark</p>
        <dl className="metadata"><dt>Git revision</dt><dd>{report?.git_revision ?? 'unavailable'}</dd><dt>Config</dt><dd>configs/benchmark.json</dd><dt>Replay authority</dt><dd>frame-index event log</dd><dt>Paired seeds</dt><dd>{report?.paired_seed_count ?? 'pending'}</dd><dt>Hostiles</dt><dd>{report?.hostiles ?? 'pending'}</dd><dt>Evidence class</dt><dd>{report?.evidence_class ?? 'pending'}</dd></dl>
        <div className="metric-table"><div><span>LEAKAGE</span><b>{metrics ? `${metrics.leakage.numerator}/${metrics.leakage.denominator}` : 'Pending'}</b></div><div><span>DUPLICATE PURSUIT</span><b>{metrics ? `${metrics.duplicate_pursuit.numerator}/${metrics.duplicate_pursuit.denominator}` : 'Pending'}</b></div><div><span>MIN SEPARATION</span><b>{metrics ? `${metrics.minimum_separation_m.mean.toFixed(1)} m` : 'Pending'}</b></div><div><span>P95 LATENCY</span><b>{metrics ? `${metrics.latency.p95_ms.toFixed(3)} ms` : 'Pending'}</b></div></div>
        <p className="evidence-warning">Simulation evidence only. Collision filtering uses the official vendored snape/RVO2-3D implementation. Learned-model superiority failed its paired confidence test and is not claimed.</p>
        <div className="downloads"><a href="/api/evidence/files/raw/benchmark.jsonl">DOWNLOAD JSONL</a><a href="/api/evidence/files/raw/benchmark.csv">DOWNLOAD CSV</a><a href="/api/evidence/manifest">SHA-256 MANIFEST</a></div>
      </article>
    </section>
    <footer><span>BASELINES · NAIVE STATIC / INDEPENDENT GREEDY / DETERMINISTIC ABLATION / AIRDND / OMNISCIENT TEACHER</span><span>AC-035</span></footer>
  </main>;
}

export default function App() {
  if (window.location.pathname.startsWith('/training')) return <Training />;
  return window.location.pathname.startsWith('/evidence') ? <Evidence /> : <Worldview />;
}
