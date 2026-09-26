import { useEffect, useMemo, useReducer, useState } from 'react';
import CesiumField from './CesiumField';
import { loadReplay, initialState, reducer, replayAt, replayDecision, units, type Perspective, type Replay, type ReplayFrame } from './worldview';
import './styles.css';

const perspectives: Array<{ key: Perspective; label: string }> = [
  { key: 'OVERVIEW', label: 'BATTLESPACE' },
  { key: 'HOSTILE', label: 'HOSTILE VIEW' },
  { key: 'INTERCEPTOR', label: 'INTERCEPTOR VIEW' },
  { key: 'OBSERVER', label: 'OBSERVER VIEW' },
];

function Icon({ name }: { name: 'play' | 'pause' | 'stepBack' | 'stepForward' }) {
  const paths = {
    play: <path d="M5 3.5 16 10 5 16.5z" />,
    pause: <><path d="M5 4h3v12H5z" /><path d="M12 4h3v12h-3z" /></>,
    stepBack: <><path d="M5 4v12" /><path d="m15 4-8 6 8 6z" /></>,
    stepForward: <><path d="M15 4v12" /><path d="m5 4 8 6-8 6z" /></>,
  };
  return <svg viewBox="0 0 20 20" aria-hidden="true">{paths[name]}</svg>;
}

function TacticalOverlay({ perspective, frame, localId }: { perspective: Perspective; frame: ReplayFrame; localId: string }) {
  const generated = frame.overview.position;
  const position = Array.isArray(generated) ? generated as number[] : [0, 1400, 450];
  const hostileX = Math.max(28, Math.min(78, 52 + position[0] / 40));
  const hostileY = Math.max(24, Math.min(68, 50 - (position[1] - 1400) / 40));
  const committers = Object.values(frame.localViews).filter((view) => view.preferred_velocity).map((_view, index) => [27 + index * 6, 71 - index * 4]);
  return (
    <svg className="tactical-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {perspective === 'OVERVIEW' && <>
        <g className="picket-grid">{[38, 44, 50, 56, 62].map((y) => <line key={`h${y}`} x1="27" y1={y} x2="71" y2={y} />)}{[31, 39, 47, 55, 63, 71].map((x) => <line key={`v${x}`} x1={x} y1="35" x2={x} y2="65" />)}</g>
        {committers.map(([x, y], index) => <path key={`${frame.frame}-${index}`} className={index === 0 ? 'commit-line primary' : 'commit-line'} d={`M ${x} ${y} L ${hostileX} ${hostileY}`} />)}
        {(frame.event.event === 'MISS' || frame.event.event === 'OBSERVER CLAIM') && <circle className="coverage-window" cx={hostileX} cy={hostileY} r="8" />}
      </>}
      {perspective === 'INTERCEPTOR' && <>
        <path className="commit-line primary" d={`M 25 72 L ${hostileX} ${hostileY}`} />
        <circle className="intercept-basket" cx={hostileX} cy={hostileY} r="4" />
        <ellipse className="track-uncertainty" cx={hostileX} cy={hostileY} rx="6" ry="4" />
        <text x="25" y="76">{localId} · SELF</text><text x={hostileX + 2} y={hostileY - 2}>LOCAL TRACK</text>
      </>}
      {perspective === 'OBSERVER' && <>
        <path className="sight-line amber" d={`M 29 69 L ${hostileX} ${hostileY}`} />
        <circle className="coverage-window" cx={hostileX} cy={hostileY} r="9" />
        <text x="30" y="74">OBSERVER SIGHT LINE</text><text x={hostileX + 10} y={hostileY + 11}>PRIVATE WINDOW</text>
      </>}
      {perspective === 'HOSTILE' && <><circle className="hostile-route" cx={hostileX} cy={hostileY} r="1" /><text x={hostileX + 2} y={hostileY - 2}>HOSTILE LOCAL VIEW</text></>}
    </svg>
  );
}

function Worldview() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [replay, setReplay] = useState<Replay | null>(null);
  const [replayError, setReplayError] = useState('');
  const selectedUnit = units.find((unit) => unit.id === state.selected) ?? units[0];
  const frame = replay ? replayAt(replay, state.frame) : undefined;
  const generatedDecision = replay ? replayDecision(replay, state.frame, selectedUnit.agentId) : undefined;
  const selected = generatedDecision ?? { id: selectedUnit.id, agentId: selectedUnit.agentId, local: 'NO REPLAY DATA', decision: 'AWAIT REPLAY', identity: 'UNKNOWN' };
  const moment = frame?.event ?? { event: 'GRID SET' as const, description: replayError || 'Loading generated replay' };

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
      .catch(() => { if (active) setReplayError('REPLAY API UNAVAILABLE'); });
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

  return (
    <main className="worldview">
      <div className="map-field" aria-label="Live 3D AirDnD battlespace">
        {frame && <CesiumField
          frame={frame}
          playing={state.playing}
          perspective={state.perspective}
          sector={state.view === 'sector'}
          groundTruth={state.groundTruth}
          selected={state.selected}
          onSelect={(id) => dispatch({ type: 'select', id })}
        />}
        {frame && <TacticalOverlay perspective={state.perspective} frame={frame} localId={selected.local} />}
        <div className="plot-title" aria-hidden="true"><span>MARINA BAY / 01°17′N</span><span>103°51′E / ALT 0—900M</span></div>
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
            <button className={state.view === 'sector' ? 'selected' : ''} onClick={() => dispatch({ type: 'view', view: 'sector' })}>SECTOR</button>
          </div>
        </div>
        <div className="rail-group perspective-list">
          <span className="rail-label">PERSPECTIVE</span>
          {perspectives.map((item) => (
            <button data-testid={`perspective-${item.key.toLowerCase()}`} key={item.key} className={state.perspective === item.key ? 'selected' : ''} onClick={() => dispatch({ type: 'perspective', perspective: item.key })}>{item.label}</button>
          ))}
        </div>
        <div className="rail-group scenarios">
          <span className="rail-label">FIXED REPLAY</span>
          <button data-testid="replay-airdnd" className={state.scenario === 'hit' ? 'selected' : ''} onClick={() => dispatch({ type: 'scenario', scenario: 'hit' })}>HIT / 7F8BD02F</button>
          <button data-testid="replay-miss" className={state.scenario === 'recovery' ? 'selected' : ''} onClick={() => dispatch({ type: 'scenario', scenario: 'recovery' })}>MISS + RECOVERY / 19A4</button>
          <button data-testid="replay-naive" className={state.scenario === 'naive' ? 'selected' : ''} onClick={() => dispatch({ type: 'scenario', scenario: 'naive' })}>NAIVE / DUPLICATE PURSUIT</button>
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
          <button onClick={() => dispatch({ type: 'pin', id: selected.id })} disabled={state.pinned.length === 3 || state.pinned.includes(selected.id)}>PIN {state.pinned.length}/3</button>
        </header>
        <div className="decision-primary">
          <span>ACTION</span><strong>{selected.decision}</strong>
          <p>Generated local decision from immutable replay frame F{String(frame?.frame ?? 0).padStart(3, '0')}.</p>
          <p data-testid="rvo-trace">v<sub>pref</sub> {selected.preferredVelocity?.join('/') ?? 'not recorded'} → v<sub>safe</sub> {selected.safeVelocity?.join('/') ?? 'not recorded'}</p>
        </div>
        <div className="candidate-head"><span>LOCAL CANDIDATES</span><span>UTILITY</span></div>
        <button className="candidate selected"><span>{selected.local}<small>{selected.identity}</small></span><b>{selected.utility?.toFixed(2) ?? '—'}</b></button>
        <button className="candidate" disabled><span>REPLAY-RECORDED CANDIDATES ONLY<small>NO AUTHORED ESTIMATE</small></span><b>—</b></button>
        <button className="disclosure" aria-expanded={state.detailOpen} onClick={() => dispatch({ type: 'toggle-detail' })}>DECISION TRACE <span>{state.detailOpen ? 'CLOSE' : 'OPEN'}</span></button>
        {state.detailOpen && <div className="trace">
          <dl><dt>P(leak)</dt><dd>{selected.leak ?? '—'}{selected.leak === undefined ? '' : '%'}</dd><dt>P(success)</dt><dd>{selected.success ?? '—'}{selected.success === undefined ? '' : '%'}</dd><dt>P(covered)</dt><dd>{selected.covered ?? '—'}{selected.covered === undefined ? '' : '%'}</dd><dt>confidence</dt><dd>{selected.confidence ?? '—'}{selected.confidence === undefined ? '' : '%'}</dd></dl>
          <hr />
          <p>Source {replay?.source ?? 'unavailable'} · frame {frame?.frame ?? '—'} · {replay?.evidenceClass ?? 'pending'}</p>
          <p>v<sub>pref</sub> [{selected.preferredVelocity?.join(', ') ?? 'not recorded'}] · v<sub>safe</sub> [{selected.safeVelocity?.join(', ') ?? 'not recorded'}]</p>
          <p>Safety override: {selected.safetyOverride === undefined ? 'NOT RECORDED' : selected.safetyOverride ? 'ACTIVE' : 'CLEAR'}</p>
        </div>}
        <div className="fleet-select">
          <span>SELECT UNIT</span>
          {units.map((unit) => {
            const decision = replay ? replayDecision(replay, state.frame, unit.agentId) : undefined;
            return <button key={unit.id} className={state.selected === unit.id ? 'selected' : ''} onClick={() => dispatch({ type: 'select', id: unit.id })}>{unit.id}<small>{decision?.decision ?? 'NO DATA'}</small></button>;
          })}
        </div>
      </aside>

      <section className="timeline" aria-label="Replay timeline">
        <button className="icon-button" aria-label={state.playing ? 'Pause replay' : 'Play replay'} onClick={() => dispatch({ type: 'toggle-play' })}><Icon name={state.playing ? 'pause' : 'play'} /></button>
        <button className="icon-button" aria-label="Previous frame" onClick={() => dispatch({ type: 'step', delta: -1 })}><Icon name="stepBack" /></button>
        <button className="icon-button" aria-label="Next frame" onClick={() => dispatch({ type: 'step', delta: 1 })}><Icon name="stepForward" /></button>
        <strong>{time}</strong>
        <input aria-label="Replay frame" type="range" min="0" max={state.maxFrame} value={state.frame} onChange={(event) => dispatch({ type: 'scrub', frame: Number(event.target.value) })} />
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
          {(state.pinned.length ? state.pinned : ['I-07', 'I-12', 'I-19']).map((id) => {
            const unit = units.find((item) => item.id === id)!;
            const decision = replay ? replayDecision(replay, state.frame, unit.agentId) : undefined;
            return <article key={id}><h2>{id}</h2><p>LOCAL TRACK <b>{decision?.local ?? 'NO DATA'}</b></p><dl><dt>P(leak)</dt><dd>{decision?.leak ?? '—'}{decision?.leak === undefined ? '' : '%'}</dd><dt>P(my action)</dt><dd>{decision?.success ?? '—'}{decision?.success === undefined ? '' : '%'}</dd><dt>P(friendly cover)</dt><dd>{decision?.covered ?? '—'}{decision?.covered === undefined ? '' : '%'}</dd></dl><strong>{decision?.decision ?? 'NO REPLAY DECISION'}</strong></article>;
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
