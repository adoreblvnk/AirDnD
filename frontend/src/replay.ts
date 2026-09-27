export type Vec3 = [number, number, number];

export interface ReplayConfig {
  hostiles: number;
  interceptors: number;
  seed: number;
  method: string;
  reserve_ratio: number;
  minimum_separation_m: number;
  continuous_flight?: boolean;
}

export interface ReplayMetrics {
  hostiles_total: number;
  neutralized: number;
  leaked: number;
  duplicate_pursuits: number;
  recovery_count: number;
  retained_coverage: number;
  minimum_separation_m: number;
  friendly_collisions: number;
  entity_drops: number;
  rf_ground_messages: number;
  rf_interdrone_messages: number;
  target_assignment_messages: number;
  safety_filter: string;
  decision_ticks?: number;
  belief_inferences?: number;
}

export interface Belief {
  target_leak_probability: number;
  action_success_probability: number;
  friendly_coverage_probability: number;
  predicted_intercept_time: number;
  predicted_intercept_point: Vec3;
  predicted_coverage_expiry: number;
  confidence: number;
}

export interface ReplayEvent {
  time_s: number;
  kind: string;
  truth: {
    interceptor_id?: string;
    interceptor_ids?: string[];
    hostile_id?: string;
    phase?: string;
    from_position?: Vec3;
    to_position?: Vec3;
    position?: Vec3;
    target_position?: Vec3;
    hostile_position?: Vec3;
    nearest_friendly_separation_m?: number;
    separation_m?: number;
    outcome?: boolean;
    state?: string;
    summary?: Record<string, unknown>;
    battery?: number;
    reason?: string;
  };
  agent_local?: {
    agent_id?: string;
    local_track_id?: string;
    identity_state?: string;
    guidance_mode?: string;
    preferred_velocity?: Vec3;
    safe_velocity?: Vec3;
    safety_override?: boolean;
    belief?: Belief | null;
    utility?: number | null;
    trigger?: string;
    target_id?: string | null;
    local_target_position?: Vec3 | null;
    intercept_basket?: Vec3 | null;
    estimated_position?: Vec3;
    estimated_velocity?: Vec3;
    covariance_diag?: Vec3;
    heading_error_rad?: number;
    battery?: number;
    predicted_min_separation_m?: number | null;
    neighbor_source?: string;
    navigation_mode?: string;
    decision?: string;
    rf_messages?: number;
    cost_terms?: { expenditure: number; battery: number; coverage_loss: number; collision: number } | null;
    selection_reason?: string | null;
    hysteresis_margin?: number | null;
    competing_action?: string | null;
    hysteresis_ticks?: number | null;
    recovery_waypoint?: Vec3 | null;
  };
  presentation?: { frame: number; label: string };
}

export interface ReplayData {
  config: ReplayConfig;
  metrics: ReplayMetrics;
  events: ReplayEvent[];
}

export interface TrackSample {
  time: number;
  position: Vec3;
}

export interface ImpactEvent {
  time: number;
  position: Vec3;
  label: string;
}

export interface ReplayModel {
  data: ReplayData;
  duration: number;
  frameTimes: number[];
  tracks: Map<string, TrackSample[]>;
  hostileTracks: Map<string, TrackSample[]>;
  removedAt: Map<string, number>;
  impacts: ImpactEvent[];
  eventMarkers: ReplayEvent[];
}

const replayCache = new Map<string, Promise<ReplayModel>>();

export function loadReplay(id: string): Promise<ReplayModel> {
  const cached = replayCache.get(id);
  if (cached) return cached;
  const pending = fetch(`/replays/${id}.json`)
    .then((response) => {
      if (!response.ok) throw new Error(`Replay ${id} could not be loaded`);
      return response.json() as Promise<ReplayData>;
    })
    .then(buildReplayModel);
  replayCache.set(id, pending);
  return pending;
}

function buildReplayModel(data: ReplayData): ReplayModel {
  const tracks = new Map<string, TrackSample[]>();
  const hostileTracks = new Map<string, TrackSample[]>();
  const removedAt = new Map<string, number>();
  const impacts: ImpactEvent[] = [];
  const frameTimes = Array.from(new Set(data.events.map((event) => event.time_s))).sort((a, b) => a - b);

  const append = (collection: Map<string, TrackSample[]>, id: string, time: number, position: Vec3) => {
    const samples = collection.get(id) ?? [];
    const last = samples[samples.length - 1];
    if (!last || last.time !== time || !samePosition(last.position, position)) {
      samples.push({ time, position });
      collection.set(id, samples);
    }
  };

  for (const event of data.events) {
    if (event.kind === "trajectory_step" && event.truth.interceptor_id && event.truth.to_position) {
      append(tracks, event.truth.interceptor_id, event.time_s, event.truth.to_position);
    }
    if (event.kind === "hostile_trajectory_step" && event.truth.hostile_id && event.truth.to_position) {
      append(hostileTracks, event.truth.hostile_id, event.time_s, event.truth.to_position);
    }
    if (event.kind === "trajectory_step" && event.truth.hostile_id && event.truth.hostile_position) {
      append(hostileTracks, event.truth.hostile_id, event.time_s, event.truth.hostile_position);
    }
    if (event.kind === "neutralized") {
      if (event.truth.interceptor_id) removedAt.set(event.truth.interceptor_id, event.time_s);
      if (event.truth.hostile_id) removedAt.set(event.truth.hostile_id, event.time_s);
      if (event.truth.position) impacts.push({ time: event.time_s, position: event.truth.position, label: "NEUTRALIZED" });
    }
    if (event.kind === "expended" && event.truth.interceptor_id) {
      removedAt.set(event.truth.interceptor_id, event.time_s);
    }
  }

  return {
    data,
    duration: frameTimes[frameTimes.length - 1] ?? 0,
    frameTimes,
    tracks,
    hostileTracks,
    removedAt,
    impacts,
    eventMarkers: data.events.filter((event) => event.kind !== "trajectory_step" && event.kind !== "hostile_trajectory_step")
  };
}

function samePosition(a: Vec3, b: Vec3) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

export function sampleTrack(samples: TrackSample[], time: number): Vec3 | null {
  if (!samples.length || time < samples[0].time) return null;
  if (time === samples[0].time) return samples[0].position;
  if (time >= samples[samples.length - 1].time) return samples[samples.length - 1].position;

  let low = 0;
  let high = samples.length - 1;
  while (low + 1 < high) {
    const middle = (low + high) >> 1;
    if (samples[middle].time <= time) low = middle;
    else high = middle;
  }
  const before = samples[low];
  const after = samples[high];
  const amount = (time - before.time) / (after.time - before.time);
  return [
    before.position[0] + (after.position[0] - before.position[0]) * amount,
    before.position[1] + (after.position[1] - before.position[1]) * amount,
    before.position[2] + (after.position[2] - before.position[2]) * amount
  ];
}

function eventIndexAtTime(events: ReplayEvent[], time: number) {
  let low = 0;
  let high = events.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (events[middle].time_s <= time) low = middle;
    else high = middle - 1;
  }
  return low;
}

export function activeEvent(model: ReplayModel, time: number) {
  return model.data.events[eventIndexAtTime(model.data.events, time)];
}

export function latestAgentTelemetry(model: ReplayModel, time: number, agentId?: string) {
  for (let index = eventIndexAtTime(model.data.events, time); index >= 0; index -= 1) {
    const event = model.data.events[index];
    if (event.kind === "trajectory_step" && (!agentId || event.agent_local?.agent_id === agentId)) return event;
  }
  return null;
}

export function latestEvent(model: ReplayModel, time: number, kinds: string[]) {
  const accepted = new Set(kinds);
  for (let index = eventIndexAtTime(model.data.events, time); index >= 0; index -= 1) {
    const event = model.data.events[index];
    if (accepted.has(event.kind)) return event;
  }
  return null;
}

export function agentTelemetryAt(model: ReplayModel, time: number) {
  const latestByAgent = new Map<string, ReplayEvent>();
  for (let index = eventIndexAtTime(model.data.events, time); index >= 0 && latestByAgent.size < model.data.config.interceptors; index -= 1) {
    const event = model.data.events[index];
    const agentId = event.agent_local?.agent_id;
    if (event.kind === "trajectory_step" && agentId && !latestByAgent.has(agentId)) latestByAgent.set(agentId, event);
  }
  return latestByAgent;
}

export function latestTargetTelemetry(model: ReplayModel, time: number, recoveryOnly = false) {
  for (let index = eventIndexAtTime(model.data.events, time); index >= 0; index -= 1) {
    const event = model.data.events[index];
    if (
      event.kind === "trajectory_step"
      && event.agent_local?.target_id
      && (!recoveryOnly || event.truth.state === "RECOVERY_INTERCEPT")
    ) return event;
  }
  return null;
}

export function closestSafetyTelemetry(model: ReplayModel, time: number) {
  const candidates = Array.from(agentTelemetryAt(model, time).values())
    .filter((event) => event.agent_local?.predicted_min_separation_m != null);
  return candidates.reduce<ReplayEvent | null>((closest, event) => {
    if (!closest) return event;
    return (event.agent_local?.predicted_min_separation_m ?? Infinity)
      < (closest.agent_local?.predicted_min_separation_m ?? Infinity) ? event : closest;
  }, null);
}
export function frameForTime(model: ReplayModel, time: number) {
  let index = 0;
  for (let i = 0; i < model.frameTimes.length; i += 1) {
    if (model.frameTimes[i] > time) break;
    index = i;
  }
  return index;
}
