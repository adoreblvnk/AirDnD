import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Aperture,
  Box,
  ChevronFirst,
  ChevronLast,
  CircleDotDashed,
  Grid3X3,
  Layers3,
  Pause,
  Play,
  RotateCcw,
  Shield,
  UserRoundSearch
} from "lucide-react";
import { CesiumScene } from "./components/CesiumScene";
import { activeEvent, agentTelemetryAt, closestSafetyTelemetry, frameForTime, latestAgentTelemetry, latestTargetTelemetry, loadReplay, type ReplayEvent, type ReplayModel } from "./replay";

type ViewName = "Scene" | "Cameras" | "Replay" | "Identity" | "Safety" | "Fleet";
type ScenarioId = "full_demo" | "success" | "miss_recovery" | "naive";

const VIEW_ICONS = {
  Scene: Box,
  Cameras: Aperture,
  Replay: CircleDotDashed,
  Identity: UserRoundSearch,
  Safety: Shield,
  Fleet: Grid3X3
} satisfies Record<ViewName, typeof Box>;

const SCENARIOS: Array<{ id: ScenarioId; label: string }> = [
  { id: "full_demo", label: "Full mission" },
  { id: "success", label: "Contact" },
  { id: "miss_recovery", label: "Recovery" },
  { id: "naive", label: "Naive" }
];

const PLAYBACK_RATES = [0.5, 1, 2, 4] as const;
const FOCUSED_VIEWS = new Set<ViewName>(["Identity", "Safety", "Fleet"]);

function storyWindow(view: ViewName, model: ReplayModel) {
  if (view === "Identity") {
    const firstTrack = model.data.events.find((event) => event.kind === "trajectory_step" && event.agent_local?.target_id);
    const start = Math.max(0, (firstTrack?.time_s ?? 32) - 0.4);
    return { start, end: Math.min(model.duration, start + 10), label: "Local identity acquisition" };
  }
  if (view === "Safety") {
    const overrides = model.data.events.filter((event) => event.kind === "trajectory_step" && event.agent_local?.safety_override);
    const closest = overrides.reduce<ReplayEvent | null>((selected, event) => {
      if (!selected) return event;
      return (event.agent_local?.predicted_min_separation_m ?? Infinity)
        < (selected.agent_local?.predicted_min_separation_m ?? Infinity) ? event : selected;
    }, null);
    const start = Math.max(0, (closest?.time_s ?? 49) - 2);
    return { start, end: Math.min(model.duration, start + 7), label: "RVO2-3D conflict resolution" };
  }
  if (view === "Fleet") {
    const ingress = model.data.events.find((event) => event.kind === "threat_ingress")?.time_s ?? 32;
    const firstImpact = model.data.events.find((event) => event.kind === "engagement_attempt")?.time_s ?? ingress + 20;
    return { start: Math.max(0, ingress - 3), end: Math.min(model.duration, firstImpact + 8), label: "Fleet deployment and engagement" };
  }
  return null;
}

export default function App() {
  const [view, setView] = useState<ViewName>("Scene");
  const [scenarioId, setScenarioId] = useState<ScenarioId>("full_demo");
  const [models, setModels] = useState<Partial<Record<ScenarioId, ReplayModel>>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [truthOverlay, setTruthOverlay] = useState(true);
  const animationFrame = useRef<number | null>(null);
  const previousTick = useRef<number | null>(null);

  useEffect(() => {
    Promise.all(SCENARIOS.map(({ id }) => loadReplay(id).then((model) => [id, model] as const)))
      .then((entries) => setModels(Object.fromEntries(entries)))
      .catch((error: Error) => setLoadError(error.message));
  }, []);

  const model = models[scenarioId] ?? null;
  const duration = model?.duration ?? 1;
  const playbackEnabled = true;
  const focusedWindow = useMemo(() => model ? storyWindow(view, model) : null, [model, view]);

  useEffect(() => {
    setTime(0);
    setPlaying(false);
  }, [scenarioId]);
  useEffect(() => {
    if (!FOCUSED_VIEWS.has(view)) return;
    if (scenarioId !== "full_demo") {
      setScenarioId("full_demo");
      return;
    }
    if (!focusedWindow) return;
    setTime(focusedWindow.start);
    setPlaying(true);
  }, [focusedWindow, scenarioId, view]);

  useEffect(() => {
    if (!playing || !model) return;
    const tick = (now: number) => {
      const last = previousTick.current ?? now;
      previousTick.current = now;
      setTime((current) => {
        const next = current + ((now - last) / 1000) * playbackRate;
        if (focusedWindow && next >= focusedWindow.end) {
          previousTick.current = now;
          return focusedWindow.start;
        }
        if (next >= model.duration) {
          setPlaying(false);
          previousTick.current = null;
          return model.duration;
        }
        return next;
      });
      animationFrame.current = requestAnimationFrame(tick);
    };
    animationFrame.current = requestAnimationFrame(tick);
    return () => {
      if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current);
      animationFrame.current = null;
      previousTick.current = null;
    };
  }, [focusedWindow, playing, model, playbackRate]);

  useEffect(() => {
    if (!playbackEnabled) setPlaying(false);
  }, [playbackEnabled]);

  const step = useCallback((direction: -1 | 1) => {
    if (!model) return;
    setPlaying(false);
    setTime((current) => {
      const frameIndex = frameForTime(model, current);
      const nextIndex = Math.max(0, Math.min(model.frameTimes.length - 1, frameIndex + direction));
      return model.frameTimes[nextIndex];
    });
  }, [model]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (!playbackEnabled || (event.target as HTMLElement).matches("input, button, select, textarea")) return;
      if (event.code === "Space") {
        event.preventDefault();
        setPlaying((current) => !current);
      } else if (event.code === "ArrowLeft") {
        event.preventDefault();
        step(-1);
      } else if (event.code === "ArrowRight") {
        event.preventDefault();
        step(1);
      } else if (event.code === "Home") {
        setPlaying(false);
        setTime(focusedWindow?.start ?? 0);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [focusedWindow, step, playbackEnabled]);

  const currentEvent = model ? activeEvent(model, time) : null;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><Layers3 aria-hidden="true" /><span>AirDnD</span></div>
        {view === "Replay" ? (
          <div className="comparison-label">Fixed comparison · Contact / Miss</div>
        ) : focusedWindow ? (
          <div className="comparison-label">{focusedWindow.label} · auto-focused loop</div>
        ) : (
          <div className="scenario-tabs" aria-label="Replay scenario">
            {SCENARIOS.map(({ id, label }) => (
              <button key={id} className={scenarioId === id ? "active" : ""} aria-pressed={scenarioId === id} onClick={() => setScenarioId(id)}>{label}</button>
            ))}
          </div>
        )}
        <div className="mode-label"><span className="mode-dot" />Fixed-seed replay</div>
      </header>

      <nav className="left-rail" aria-label="Primary views">
        {(Object.keys(VIEW_ICONS) as ViewName[]).map((name) => {
          const Icon = VIEW_ICONS[name];
          return (
            <button key={name} aria-label={name} className={view === name ? "active" : ""} onClick={() => setView(name)} aria-current={view === name ? "page" : undefined}>
              <Icon aria-hidden="true" /><span>{name}</span>
            </button>
          );
        })}
      </nav>

      <section className="workspace" aria-live="polite">
        {loadError ? <LoadError message={loadError} /> : !model ? <Loading /> : (
          <ViewRouter
            view={view}
            model={model}
            models={models}
            time={time}
            truthOverlay={truthOverlay}
            setTruthOverlay={setTruthOverlay}
          />
        )}
      </section>

      <PlaybackBar
        model={model}
        time={time}
        playing={playing}
        enabled={playbackEnabled}
        playbackRate={playbackRate}
        currentLabel={focusedWindow ? `${focusedWindow.label} · ${currentEvent?.presentation?.label ?? "recorded evidence"}` : currentEvent?.presentation?.label ?? "Replay ready"}
        onToggle={() => setPlaying((current) => !current)}
        onStep={step}
        onReset={() => { setPlaying(false); setTime(focusedWindow?.start ?? 0); }}
        onSeek={setTime}
        onRateChange={setPlaybackRate}
      />
    </main>
  );
}

interface ViewRouterProps {
  view: ViewName;
  model: ReplayModel;
  models: Partial<Record<ScenarioId, ReplayModel>>;
  time: number;
  truthOverlay: boolean;
  setTruthOverlay: (value: boolean) => void;
}

function ViewRouter(props: ViewRouterProps) {
  switch (props.view) {
    case "Scene": return <SceneView {...props} />;
    case "Cameras": return <CamerasView model={props.model} time={props.time} />;
    case "Replay": return <ReplayView models={props.models} time={props.time} />;
    case "Identity": return <IdentityView model={props.model} time={props.time} />;
    case "Safety": return <SafetyView model={props.model} time={props.time} />;
    case "Fleet": return <FleetView model={props.model} time={props.time} />;
  }
}

function SceneView({ model, time, truthOverlay, setTruthOverlay }: ViewRouterProps) {
  const [selectedAgent, setSelectedAgent] = useState("I000");
  const telemetry = latestAgentTelemetry(model, time, selectedAgent);
  return (
    <div className="view-grid scene-view">
      <div className="primary-canvas">
        <CesiumScene model={model} time={time} mode="overview" truthOverlay={truthOverlay} />
        <PinnedComparison model={model} time={time} />
      </div>
      <aside className="inspector scene-inspector">
        <PanelHeading title="Decision inspector" meta="One agent · local state" />
        <label className="agent-select">Interceptor<select value={selectedAgent} onChange={(event) => setSelectedAgent(event.target.value)}>{Array.from({ length: model.data.config.interceptors }, (_, index) => <option key={index} value={`I${String(index).padStart(3, "0")}`}>{`I${String(index).padStart(3, "0")}`}</option>)}</select></label>
        <DecisionPanel event={telemetry} />
        <label className="toggle-row">
          <span>Truth overlay <small>Evaluator view</small></span>
          <input type="checkbox" checked={truthOverlay} onChange={(event) => setTruthOverlay(event.target.checked)} />
          <i aria-hidden="true" />
        </label>
      </aside>
    </div>
  );
}

function CamerasView({ model, time }: { model: ReplayModel; time: number }) {
  const lead = latestTargetTelemetry(model, time);
  const observer = latestTargetTelemetry(model, time, true) ?? lead;
  const leadId = lead?.agent_local?.agent_id ?? "No active lead";
  const observerId = observer?.agent_local?.agent_id ?? "No active observer";
  return (
    <div className="camera-layout">
      <section className="camera-pane">
        <PanelHeading title={`${leadId} · Interceptor`} meta="Forward local track" tag="Ground truth masked" />
        <div className="camera-canvas"><CesiumScene model={model} time={time} mode="forward" truthOverlay={false} /></div>
      </section>
      <section className="camera-pane">
        <PanelHeading title={`${observerId} · Observer`} meta="Temporary high-ground role" tag="Ground truth masked" />
        <div className="camera-canvas"><CesiumScene model={model} time={time} mode="observer" truthOverlay={false} /></div>
      </section>
      <TrackLedger events={[lead, observer]} />
      <section className="geometry-inset">
        <span className="inset-title">View geometry · side elevation</span>
        <div className="geometry-diagram"><span className="upper-drone">Observer</span><span className="lower-drone">Interceptor</span><i className="down-cone" /><i className="forward-cone" /><b>Upper</b><b>Lower</b></div>
      </section>
    </div>
  );
}

function ReplayView({ models, time }: { models: Partial<Record<ScenarioId, ReplayModel>>; time: number }) {
  const [mode, setMode] = useState<"outcome" | "uncertainty">("outcome");
  if (mode === "uncertainty") {
    const model = models.full_demo ?? models.miss_recovery ?? null;
    return (
      <div className="replay-detail-layout">
        <ViewHeading title="Replay" subtitle="Observation uncertainty" actions={<SubViewSwitch value={mode} onChange={setMode} />} />
        <div className="uncertainty-canvas"><CesiumScene model={model} time={time} mode="uncertainty" truthOverlay={false} /></div>
        <aside className="inspector compact-inspector">
          <PanelHeading title="Track inspector" />
          <DefinitionRows rows={[["Source", "Local"], ["Visibility", "Partial"], ["Identity", "Unknown"], ["Track age", "Stale"]]} amberRows={[2, 3]} />
          <SideElevation compact />
        </aside>
        <SpeedTrace model={model} time={time} />
        <section className="track-legend"><PanelHeading title="Track legend" /><span><i className="envelope" />Track spread</span><span><i className="prediction" />Prediction envelope</span><span><i className="recorded-line" />Recorded trail</span><span>Confidence level —</span></section>
      </div>
    );
  }

  const success = models.success ?? null;
  const miss = models.miss_recovery ?? null;
  const successTime = success ? (time / Math.max(miss?.duration ?? 1, 1)) * success.duration : 0;
  return (
    <div className="outcome-layout">
      <ViewHeading title="Replay" subtitle="Synchronized outcomes" actions={<SubViewSwitch value={mode} onChange={setMode} />} />
      <section className="outcome-pane"><h2>Contact</h2><CesiumScene model={success} time={successTime} mode="contact" truthOverlay /></section>
      <section className="outcome-pane"><h2>Miss</h2><CesiumScene model={miss} time={time} mode="miss" truthOverlay /></section>
      <div className="outcome-inspector"><MetricCell label="Outcome" value="Recorded event" /><MetricCell label="Source" value="Simulator replay" /><MetricCell label="Physics" value="Debris not modelled" /></div>
    </div>
  );
}

function IdentityView({ model, time }: { model: ReplayModel; time: number }) {
  const event = latestTargetTelemetry(model, time);
  const agent = event?.agent_local?.agent_id ?? "Awaiting observer";
  const target = event?.agent_local?.target_id ?? "Unclassified track";
  const classified = Boolean(event);
  const selectedState = classified ? "Hostile evidence" : "Unknown";
  return (
    <div className="identity-layout">
      <div className="identity-canvas"><CesiumScene model={model} time={time} mode="identity" truthOverlay={false} /></div>
      <aside className="identity-inspector">
        <PanelHeading title="Local identity evidence" meta={`Recorded ${formatTime(time)} · no evaluator truth`} />
        <div className="compare-head"><strong>{agent}</strong><strong>{target}</strong></div>
        <CompareRow label="Observation" left="Launch lineage" right={classified ? "Ingress track" : "Sensor track pending"} />
        <CompareRow label="Identity signal" left="Authenticated NIR" right={classified ? "No friendly code" : "No determination"} />
        <CompareRow label="Status" left="Confirmed friendly" right={selectedState} emphasis={classified} />
        <p>Beacon loss alone never implies hostile. Classification is local and evidence-led.</p>
      </aside>
      <div className="identity-states" aria-label="Identity state machine">
        {["Confirmed", "Lineage", "Unknown", "Hostile evidence"].map((item) => <span key={item} className={`${item.toLowerCase().replace(" ", "-")} ${item === selectedState ? "selected" : ""}`}>{item}</span>)}
      </div>
      <div className="identity-events"><span className="done">Lineage retained</span><span className={classified ? "done" : ""}>NIR evaluated</span><span className={classified ? "current" : ""}>{classified ? "Hostile classified" : "Awaiting evidence"}</span><em>Local state · no RF exchange</em></div>
    </div>
  );
}

function SafetyView({ model, time }: { model: ReplayModel; time: number }) {
  const event = closestSafetyTelemetry(model, time);
  const separation = event?.agent_local?.predicted_min_separation_m;
  const override = event?.agent_local?.safety_override ?? false;
  return (
    <div className="safety-layout">
      <div className="safety-canvas"><CesiumScene model={model} time={time} mode="safety" truthOverlay={false} /></div>
      <aside className="inspector safety-inspector">
        <PanelHeading title="Collision-avoidance evidence" meta={`Recorded ${formatTime(time)}`} tag={override ? "OVERRIDE ACTIVE" : "MONITORING"} />
        <DefinitionRows rows={[
          ["Unit", event?.agent_local?.agent_id ?? "—"],
          ["Filter", model.data.metrics.safety_filter],
          ["State", override ? "Velocity override" : "Preferred velocity safe"],
          ["Predicted separation", separation == null ? "No neighbor" : `${separation.toFixed(1)} m`]
        ]} amberRows={override ? [2] : []} />
        <SideElevation compact safety />
        <div className="legend-list slim"><span><i className="line-dashed" />Preferred</span><span><i className="line-solid" />Applied</span><span><i className="legend-ring friendly-ring" />8 m limit</span></div>
      </aside>
      <SeparationTrace model={model} time={time} />
    </div>
  );
}

function FleetView({ model, time }: { model: ReplayModel; time: number }) {
  const snapshot = agentTelemetryAt(model, time);
  const rows = Array.from({ length: model.data.config.interceptors }, (_, index) => {
    const unit = `I${String(index).padStart(3, "0")}`;
    const event = snapshot.get(unit);
    const removedAt = model.removedAt.get(unit);
    const lifecycle = [...model.eventMarkers].reverse().find((marker) =>
      marker.time_s <= time && marker.truth.interceptor_id === unit
      && ["launched", "formation_occupied", "mobilized", "return_to_base", "landed"].includes(marker.kind)
    );
    return {
      unit,
      state: removedAt !== undefined && time >= removedAt ? "Expended" : lifecycle?.kind === "landed" ? "Landed" : event?.truth.state?.replaceAll("_", " ") ?? "Docked",
      battery: event?.agent_local?.battery ?? event?.truth.battery ?? 1
    };
  });
  const count = (...states: string[]) => rows.filter((row) => states.includes(row.state.toLowerCase())).length;
  const stages = [
    { label: "Docked", count: count("docked") },
    { label: "Deploying", count: count("deploying") },
    { label: "On station", count: count("on station", "reserve") },
    { label: "Engaging", count: count("intercepting", "recovery intercept") },
    { label: "Returning", count: count("returning") },
    { label: "Landed", count: count("landed") }
  ];
  const engaged = count("intercepting", "recovery intercept");
  const retained = rows.length - count("expended");
  return (
    <div className="fleet-layout">
      <div className="fleet-canvas"><CesiumScene model={model} time={time} mode="fleet" truthOverlay={false} /></div>
      <aside className="inspector fleet-inspector">
        <PanelHeading title="Fleet lifecycle" meta={`${retained} retained · ${engaged} engaging · ${formatTime(time)}`} />
        <table><thead><tr><th>Unit</th><th>State</th><th>Battery</th></tr></thead><tbody>
          {rows.map((row) => <FleetRow key={row.unit} {...row} />)}
        </tbody></table>
      </aside>
      <div className="lifecycle" aria-label="Current fleet lifecycle counts">{stages.map((stage) => <span key={stage.label} className={stage.count > 0 ? stage.label === "Returning" ? "warning" : "active" : ""}>{stage.label}<b>{stage.count}</b></span>)}</div>
    </div>
  );
}

function PlaybackBar({ model, time, playing, currentLabel, enabled, playbackRate, onToggle, onStep, onReset, onSeek, onRateChange }: {
  model: ReplayModel | null; time: number; playing: boolean; currentLabel: string; enabled: boolean; playbackRate: number;
  onToggle: () => void; onStep: (direction: -1 | 1) => void; onReset: () => void; onSeek: (time: number) => void; onRateChange: (rate: number) => void;
}) {
  const duration = model?.duration ?? 1;
  const markers = useMemo(() => model?.eventMarkers.filter((event) => ["launched", "formation_occupied", "threat_ingress", "engagement_attempt", "coverage_expired", "observer_claim", "neutralized", "return_to_base", "landed"].includes(event.kind)) ?? [], [model]);
  const cycleRate = () => {
    const index = PLAYBACK_RATES.indexOf(playbackRate as (typeof PLAYBACK_RATES)[number]);
    onRateChange(PLAYBACK_RATES[(index + 1) % PLAYBACK_RATES.length]);
  };
  return (
    <footer className={`playback-bar ${enabled ? "" : "static-view"}`}>
      {enabled ? (
        <>
          <div className="transport">
            <button onClick={onReset} aria-label="Reset replay"><RotateCcw /></button>
            <button onClick={() => onStep(-1)} aria-label="Previous frame"><ChevronFirst /></button>
            <button className="play-button" onClick={onToggle} aria-label={playing ? "Pause replay" : "Play replay"}>{playing ? <Pause /> : <Play />}</button>
            <button onClick={() => onStep(1)} aria-label="Next frame"><ChevronLast /></button>
            <button className="speed-toggle" onClick={cycleRate} aria-label={`Playback speed ${playbackRate} times. Activate to change.`}>{playbackRate}×</button>
          </div>
          <div className="timeline-wrap">
            <input aria-label="Replay timeline" type="range" min="0" max={duration} step="0.1" value={Math.min(time, duration)} onChange={(event) => onSeek(Number(event.target.value))} style={{ "--progress": `${(time / duration) * 100}%` } as React.CSSProperties} />
            <div className="event-markers" aria-hidden="true">{markers.map((event, index) => <i key={`${event.kind}-${index}`} style={{ left: `${(event.time_s / duration) * 100}%` }} className={event.kind === "neutralized" ? "blue" : "amber"} />)}</div>
            <span className="event-label"><span>{currentLabel}</span><b>{formatTime(time)} / {formatTime(duration)}</b></span>
          </div>
        </>
      ) : <div className="static-view-note">Replay controls remain available in operational views</div>}
      <div className="blackout-status"><span>RF denied · 0 ground / 0 inter-drone messages</span><span className="nir">NIR · one-way identity only</span></div>
    </footer>
  );
}

function formatTime(value: number) {
  const seconds = Math.max(0, Math.floor(value));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function PanelHeading({ title, meta, tag }: { title: string; meta?: string; tag?: string }) {
  return <header className="panel-heading"><div><h2>{title}</h2>{meta && <span>{meta}</span>}</div>{tag && <small>{tag}</small>}</header>;
}

function ViewHeading({ title, subtitle, actions }: { title: string; subtitle: string; actions: React.ReactNode }) {
  return <header className="view-heading"><h1>{title}</h1><span>{subtitle}</span>{actions}</header>;
}

function SubViewSwitch({ value, onChange }: { value: "outcome" | "uncertainty"; onChange: (value: "outcome" | "uncertainty") => void }) {
  return <div className="subview-switch" role="group" aria-label="Replay detail"><button aria-pressed={value === "outcome"} className={value === "outcome" ? "active" : ""} onClick={() => onChange("outcome")}>Outcomes</button><button aria-pressed={value === "uncertainty"} className={value === "uncertainty" ? "active" : ""} onClick={() => onChange("uncertainty")}>Observation</button></div>;
}

function TrackLedger({ events }: { events: Array<ReplayEvent | null> }) {
  const unique = events.filter((event, index) => event && events.findIndex((candidate) => candidate?.agent_local?.local_track_id === event.agent_local?.local_track_id) === index);
  return <section className="track-ledger"><PanelHeading title="Local track ledger" /><table><thead><tr><th>Local track</th><th>Observer</th><th>Identity</th><th>Confidence</th></tr></thead><tbody>{unique.length ? unique.map((event) => event && <tr key={`${event.agent_local?.agent_id}-${event.agent_local?.local_track_id}`}><td>{event.agent_local?.local_track_id ?? "—"}</td><td>{event.agent_local?.agent_id ?? "—"}</td><td className="amber-text">Hostile evidence</td><td>{Math.round((event.agent_local?.belief?.confidence ?? 0) * 100)}%</td></tr>) : <tr><td colSpan={4}>Awaiting local tracks</td></tr>}</tbody></table></section>;
}

function DecisionPanel({ event }: { event: ReplayEvent | null }) {
  if (!event) return <p className="empty-panel">Awaiting launch telemetry</p>;
  const local = event.agent_local;
  const belief = local?.belief;
  const costs = local?.cost_terms;
  return (
    <div className="decision-panel">
      <div className="decision-primary"><span>{event.truth.state?.replaceAll("_", " ") ?? "DOCKED"}</span><strong>{local?.target_id ? `INTERCEPT ${local.target_id}` : local?.guidance_mode?.replaceAll("_", " ") ?? "HOLD"}</strong><p>{local?.selection_reason ?? "Preserving assigned grid state."}</p></div>
      <DefinitionRows rows={[
        ["Local track", local?.local_track_id ?? "—"],
        ["Identity", local?.target_id ? "HOSTILE EVIDENCE" : local?.identity_state ?? "—"],
        ["Battery", `${Math.round((local?.battery ?? event.truth.battery ?? 0) * 100)}%`],
        ["Guidance", local?.guidance_mode?.replaceAll("_", " ") ?? "—"],
        ["Safety", local?.safety_override ? "RVO2 override" : "Preferred safe"]
      ]} amberRows={local?.safety_override ? [4] : []} />
      {belief && (
        <details>
          <summary>Belief & mission utility</summary>
          <DefinitionRows rows={[
            ["P(leak)", `${Math.round(belief.target_leak_probability * 100)}%`],
            ["P(success)", `${Math.round(belief.action_success_probability * 100)}%`],
            ["P(covered)", `${Math.round(belief.friendly_coverage_probability * 100)}%`],
            ["Intercept", `${belief.predicted_intercept_time.toFixed(1)} s`],
            ["Confidence", `${Math.round(belief.confidence * 100)}%`],
            ["Utility", local?.utility?.toFixed(3) ?? "—"],
            ["Costs E / B / G / C", costs ? `${costs.expenditure.toFixed(3)} / ${costs.battery.toFixed(3)} / ${costs.coverage_loss.toFixed(3)} / ${costs.collision.toFixed(3)}` : "—"],
            ["Hysteresis", local?.hysteresis_margin == null ? "—" : `${local.hysteresis_margin.toFixed(3)} · ${local.competing_action} · ${local.hysteresis_ticks} ticks`]
          ]} />
        </details>
      )}
    </div>
  );
}

function PinnedComparison({ model, time }: { model: ReplayModel; time: number }) {
  const [pins, setPins] = useState(["I000", "I001", "I002"]);
  return (
    <section className="pinned-comparison" aria-label="Pinned interceptor comparison">
      {pins.map((agentId, slot) => {
        const event = latestAgentTelemetry(model, time, agentId);
        const belief = event?.agent_local?.belief;
        return (
          <article key={slot}>
            <select aria-label={`Pinned interceptor ${slot + 1}`} value={agentId} onChange={(change) => setPins((current) => current.map((value, index) => index === slot ? change.target.value : value))}>
              {Array.from({ length: model.data.config.interceptors }, (_, index) => {
                const value = `I${String(index).padStart(3, "0")}`;
                return <option key={value} value={value}>{value}</option>;
              })}
            </select>
            <strong>{event?.agent_local?.target_id ?? "No target"}</strong>
            <span>P(leak) {belief ? `${Math.round(belief.target_leak_probability * 100)}%` : "—"}</span>
            <span>P(action) {belief ? `${Math.round(belief.action_success_probability * 100)}%` : "—"}</span>
            <span>P(cover) {belief ? `${Math.round(belief.friendly_coverage_probability * 100)}%` : "—"}</span>
            <b>{event?.agent_local?.target_id ? "INTERCEPT" : event?.truth.state?.replaceAll("_", " ") ?? "DOCKED"}</b>
          </article>
        );
      })}
    </section>
  );
}

function SideElevation({ compact = false, safety = false }: { compact?: boolean; safety?: boolean }) {
  return <div className={`side-elevation ${compact ? "compact" : ""} ${safety ? "safety" : ""}`}><span className="upper-label">Upper</span><span className="lower-label">Lower</span><span className="surface-label">Surface</span><i className="elevation-line upper" /><i className="elevation-line lower" /><i className="elevation-line surface" /><b className="drone-mark one" /><b className="drone-mark two" /><b className="drone-mark three" />{!safety && <i className="view-cone" />}</div>;
}

function DefinitionRows({ rows, amberRows = [] }: { rows: string[][]; amberRows?: number[] }) {
  return <dl className="definition-rows">{rows.map(([term, value], index) => <div key={term}><dt>{term}</dt><dd className={amberRows.includes(index) ? "amber-text" : ""}>{value}</dd></div>)}</dl>;
}

function SpeedTrace({ model, time }: { model: ReplayModel | null; time: number }) {
  const latest = model ? latestTargetTelemetry(model, time) : null;
  const agentId = latest?.agent_local?.agent_id;
  const samples = useMemo(() => {
    if (!model || !agentId) return [];
    return model.data.events
      .filter((event) => (
        event.time_s <= time
        && event.kind === "trajectory_step"
        && event.agent_local?.agent_id === agentId
        && event.agent_local.safe_velocity
      ))
      .filter((_, index) => index % 5 === 0)
      .map((event) => {
        const velocity = event.agent_local?.safe_velocity ?? [0, 0, 0];
        return { time: event.time_s, speed: Math.hypot(...velocity) };
      });
  }, [agentId, model, time]);
  const points = samples.map((sample) => `${(sample.time / Math.max(model?.duration ?? 1, 1)) * 600},${82 - Math.min(72, sample.speed / 66 * 72)}`).join(" ");
  return <section className="trace-panel"><PanelHeading title="Recorded speed" meta={agentId ?? "No active local track"} /><svg role="img" aria-label="Recorded interceptor speed from replay telemetry" viewBox="0 0 600 90" preserveAspectRatio="none"><polyline points={points} fill="none" /></svg></section>;
}

function SeparationTrace({ model, time }: { model: ReplayModel; time: number }) {
  const samples = useMemo(() => model.data.events.filter((event) => event.time_s <= time && event.kind === "trajectory_step" && event.agent_local?.predicted_min_separation_m != null).map((event) => ({ time: event.time_s, value: event.agent_local?.predicted_min_separation_m ?? 0 })).filter((sample, index) => index % 20 === 0), [model, time]);
  const width = 900;
  const height = 90;
  const points = samples.map((sample) => `${(sample.time / Math.max(model.duration, 1)) * width},${height - Math.min(72, sample.value * 2)}`).join(" ");
  return <section className="separation-trace"><PanelHeading title="Recorded separation" meta={`Minimum ${model.data.metrics.minimum_separation_m.toFixed(1)} m`} /><svg role="img" aria-label="Recorded predicted separation remains above the eight metre limit" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"><path className="limit" d={`M0 ${height - 16} H${width}`} /><polyline className="curve" points={points} fill="none" /></svg></section>;
}

function MetricCell({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function CompareRow({ label, left, right, emphasis = false }: { label: string; left: string; right: string; emphasis?: boolean }) { return <div className="compare-row"><span>{label}</span><b className={emphasis ? "blue-text" : ""}>{left}</b><b className={emphasis ? "amber-text" : ""}>{right}</b></div>; }
function FleetRow({ unit, state, battery }: { unit: string; state: string; battery: number }) {
  const level = battery <= 0.25 ? "low" : battery < 0.6 ? "medium" : "full";
  return <tr><td>{unit}</td><td>{state.toLowerCase()}</td><td><i className={`battery ${level}`} aria-label={`${Math.round(battery * 100)} percent battery`} /> {Math.round(battery * 100)}%</td></tr>;
}
function Loading() { return <div className="loading-screen"><span /><strong>Loading fixed-seed replay</strong></div>; }
function LoadError({ message }: { message: string }) { return <div className="load-error" role="alert"><strong>Replay unavailable</strong><span>{message}</span><button onClick={() => window.location.reload()}>Reload application</button></div>; }
