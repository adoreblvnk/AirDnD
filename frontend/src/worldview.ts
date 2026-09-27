import { DEFAULT_SCENARIO, type ScenarioId } from './scenarios';

export type Perspective = 'OVERVIEW' | 'HOSTILE' | 'INTERCEPTOR' | 'OBSERVER';
export type Scenario = ScenarioId;
export type ReplayEventName = 'LAUNCH' | 'GRID SET' | 'MISS' | 'OBSERVER CLAIM' | 'NEUTRALIZED' | 'DUPLICATE PURSUIT' | 'RTH' | 'WAVE DETECTED' | 'ABORT' | 'REFILL' | 'IFF HOLD' | 'LEAKED';

export interface WorldState {
  frame: number;
  maxFrame: number;
  playing: boolean;
  scenario: Scenario;
  view: 'overview' | 'sector';
  perspective: Perspective;
  groundTruth: boolean;
  follow: boolean;
  selected: string;
  pinned: string[];
  detailOpen: boolean;
  compareOpen: boolean;
}

export const MAX_FRAME = 180;
export const initialState: WorldState = {
  frame: 0,
  maxFrame: MAX_FRAME,
  playing: false,
  scenario: DEFAULT_SCENARIO,
  view: 'overview',
  perspective: 'OVERVIEW',
  groundTruth: false,
  follow: true,
  selected: 'I000',
  pinned: [],
  detailOpen: false,
  compareOpen: false,
};

type Action =
  | { type: 'toggle-play' }
  | { type: 'tick' }
  | { type: 'scrub'; frame: number }
  | { type: 'step'; delta: number }
  | { type: 'scenario'; scenario: Scenario }
  | { type: 'replay-loaded'; maxFrame: number }
  | { type: 'view'; view: WorldState['view'] }
  | { type: 'perspective'; perspective: Perspective }
  | { type: 'toggle-truth' }
  | { type: 'toggle-follow' }
  | { type: 'reset' }
  | { type: 'select'; id: string }
  | { type: 'pin'; id: string }
  | { type: 'toggle-detail' }
  | { type: 'toggle-compare' };

const clamp = (frame: number, maxFrame = MAX_FRAME) => Math.max(0, Math.min(maxFrame, Math.round(frame)));

export function reducer(state: WorldState, action: Action): WorldState {
  switch (action.type) {
    case 'toggle-play':
      if (state.playing) return { ...state, playing: false };
      // Pressing play at the end of a replay restarts it instead of stopping instantly.
      return { ...state, playing: true, frame: state.frame >= state.maxFrame ? 0 : state.frame };
    case 'tick': return state.frame === state.maxFrame ? { ...state, playing: false } : { ...state, frame: state.frame + 1 };
    case 'scrub': return { ...state, frame: clamp(action.frame, state.maxFrame), playing: false };
    case 'step': return { ...state, frame: clamp(state.frame + action.delta, state.maxFrame), playing: false };
    case 'scenario': return { ...state, scenario: action.scenario, frame: 0, playing: false, pinned: [] };
    case 'replay-loaded': return { ...state, frame: 0, maxFrame: action.maxFrame, playing: false };
    case 'view': return { ...state, view: action.view };
    case 'perspective': return { ...state, perspective: action.perspective, groundTruth: false };
    case 'toggle-truth': return { ...state, groundTruth: !state.groundTruth };
    case 'toggle-follow': return { ...state, follow: !state.follow };
    case 'reset': return { ...state, frame: 0, playing: false };
    case 'select': return { ...state, selected: action.id };
    case 'pin': return state.pinned.includes(action.id) || state.pinned.length === 3 ? state : { ...state, pinned: [...state.pinned, action.id] };
    case 'toggle-detail': return { ...state, detailOpen: !state.detailOpen };
    case 'toggle-compare': return { ...state, compareOpen: !state.compareOpen };
  }
}

export interface ReplayMoment {
  event: ReplayEventName;
  description: string;
}

export interface Belief {
  target_leak_probability: number;
  action_success_probability: number;
  friendly_coverage_probability: number;
  confidence: number;
  predicted_intercept_point?: number[];
  predicted_intercept_time?: number;
  predicted_coverage_expiry?: number;
}

export interface LocalView {
  agent_id?: string;
  local_track_id?: string;
  belief?: Belief;
  utility?: number;
  identity_state?: string;
  preferred_velocity?: number[];
  safe_velocity?: number[];
  safety_override?: boolean;
  predicted_min_separation_m?: number | null;
  claim_delay_s?: number;
  noisy_position?: number[];
  track_status?: string;
  visible_tracks?: Array<{ track_id: string; identity_state: string }>;
  battery?: number;
  lifecycle_state?: 'departing' | 'on_station' | 'returning' | 'docked';
}

export interface ReplayFrame {
  frame: number;
  time_s: number;
  kind?: string;
  overview: Record<string, unknown>;
  event: ReplayMoment;
  localViews: Record<string, LocalView>;
}

// ---- Swarm order of battle -------------------------------------------------------------
// Sections are 3x3 (9 drones), platoons are 3 sections, companies are 3 platoons. The
// simulator records each drone's place in the order of battle in the frame-0
// swarm_initialized event.

export interface RosterDrone {
  id: string;
  callsign: string;
  company: string;
  platoon: string;
  section: string;
  phase: 'initial' | 'reserve';
  // Each section is 9 shooters plus 1 observer hovering above it (intercept engine runs).
  role: 'shooter' | 'observer';
}

export interface RosterSection { id: string; drones: RosterDrone[] }
export interface RosterPlatoon { id: string; sections: RosterSection[] }

export type DroneStatus = 'pad' | 'launching' | 'screen' | 'observing' | 'committed' | 'reserve' | 'pursuit' | 'engaging' | 'returning' | 'stood-down' | 'aborting' | 'rth' | 'refilling' | 'docked' | 'expended';
// 'pending' hostiles belong to a later wave and are not drawn until that wave is detected.
export type HostileStatus = 'pending' | 'inbound' | 'tracked' | 'neutralized' | 'leaked';
export type FriendlyIdentity = 'CONFIRMED FRIENDLY' | 'FRIENDLY LINEAGE' | 'UNKNOWN' | 'HOSTILE EVIDENCE';

export interface DroneState { id: string; position: number[]; status: DroneStatus; target?: string }
export interface HostileState { id: string; position: number[]; status: HostileStatus; wave: number }
export interface FriendlyState { id: string; position: number[]; identities: Partial<Record<FriendlyIdentity, number>> }
export interface EngagementLink { interceptorId: string; hostileId: string; active: boolean }

// What the camera should look at for the frame that just played. Engagements focus on the
// hostile being attacked (the area under attack), seen from the attacking drone's side.
export type Focus =
  | { kind: 'swarm' }
  | { kind: 'drone'; id: string; toward?: string }
  | { kind: 'hostile'; id: string; from?: string }
  | { kind: 'area'; points: number[][] };

export interface SwarmFrame {
  time_s: number;
  drones: Record<string, DroneState>;
  hostiles: Record<string, HostileState>;
  friendlies: Record<string, FriendlyState>;
  links: EngagementLink[];
  focus: Focus;
  // Home cells whose drone has left and that no other drone occupies (concept v2 'Vacant').
  vacant: string[];
}

export interface Replay {
  scenarioId: string;
  evidenceClass: string;
  source: string;
  frames: ReplayFrame[];
  roster: RosterDrone[];
  swarm: SwarmFrame[];
  cells: Record<string, number[]>;
  markers: TimelineMarker[];
}

export interface TimelineMarker { frame: number; event: ReplayEventName; label: string }

export interface ApiFrame {
  frame: number;
  time_s: number;
  event_kind?: string;
  overview?: Record<string, unknown>;
  local_views?: Record<string, LocalView>;
  presentation?: { label?: string };
}

export interface ApiReplay { scenario_id: string; frames: ApiFrame[]; }
type Fetcher = (input: string) => Promise<Response>;

const KIND_EVENTS: Record<string, ReplayEventName> = {
  section_launch: 'LAUNCH', formation_step: 'LAUNCH', section_on_station: 'LAUNCH', grid_set: 'GRID SET',
  wave_detected: 'WAVE DETECTED', abort: 'ABORT', recovery_departure: 'RTH', rth_step: 'RTH', rth_docked: 'RTH',
  cell_refill_claim: 'REFILL', refill_step: 'REFILL', refill_complete: 'REFILL', iff_classification: 'IFF HOLD',
  hostile_leaked: 'LEAKED',
};

function eventFrom(label: string, overview: Record<string, unknown>, kind?: string): ReplayMoment {
  const normalized = label.toLowerCase();
  if (kind && KIND_EVENTS[kind]) return { event: KIND_EVENTS[kind], description: label || kind.replaceAll('_', ' ') };
  if (kind === 'coverage_expired' || overview.outcome === false || normalized === 'coverage expired') return { event: 'MISS', description: label || 'engagement unsuccessful' };
  if (kind === 'neutralized' || overview.outcome === true || normalized === 'neutralized') return { event: 'NEUTRALIZED', description: label || 'hostile track removed' };
  if (kind === 'observer_claim' || normalized.includes('recovery')) return { event: 'OBSERVER CLAIM', description: label || 'observation-driven recovery' };
  if (kind === 'duplicate_pursuit' || normalized.includes('duplicate')) return { event: 'DUPLICATE PURSUIT', description: label || 'duplicate pursuit' };
  if (kind === 'mobilized' || normalized.includes('mobiliz') || normalized.includes('launch')) return { event: 'LAUNCH', description: label || 'mobilization' };
  if (normalized.includes('rth') || normalized.includes('return')) return { event: 'RTH', description: label };
  return { event: 'GRID SET', description: label || 'generated replay frame' };
}

function isVector3(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number' && Number.isFinite(item));
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function buildRoster(frames: ReplayFrame[]): RosterDrone[] {
  const init = frames.find((frame) => Array.isArray(frame.overview.interceptors));
  if (init) {
    return (init.overview.interceptors as Array<Record<string, unknown>>).map((drone) => ({
      id: String(drone.interceptor_id),
      callsign: str(drone.callsign) ?? String(drone.interceptor_id),
      company: str(drone.company) ?? 'A',
      platoon: str(drone.platoon) ?? 'A1',
      section: str(drone.section) ?? 'A1-1',
      phase: drone.phase === 'reserve' ? 'reserve' : 'initial',
      role: drone.role === 'observer' ? 'observer' : 'shooter',
    }));
  }
  // Replays without an order-of-battle snapshot: list every agent that appears, unsectioned.
  const ids = new Set<string>();
  frames.forEach((frame) => {
    Object.keys(frame.localViews).forEach((id) => ids.add(id));
    const truthId = str(frame.overview.interceptor_id);
    if (truthId) ids.add(truthId);
  });
  return [...ids].sort().map((id) => ({ id, callsign: id, company: '—', platoon: '—', section: '—', phase: 'initial', role: 'shooter' }));
}

export function groupRoster(roster: RosterDrone[]): RosterPlatoon[] {
  const platoons: RosterPlatoon[] = [];
  roster.forEach((drone) => {
    let platoon = platoons.find((item) => item.id === drone.platoon);
    if (!platoon) platoons.push(platoon = { id: drone.platoon, sections: [] });
    let section = platoon.sections.find((item) => item.id === drone.section);
    if (!section) platoon.sections.push(section = { id: drone.section, drones: [] });
    section.drones.push(drone);
  });
  return platoons;
}

const clone = <T extends object>(items: Record<string, T>) => Object.fromEntries(Object.entries(items).map(([id, item]) => [id, { ...item }])) as Record<string, T>;

interface FriendlyTrack { id: string; start: number[]; velocity: number[]; startTime: number }

const friendlyAt = (track: FriendlyTrack, time: number) => track.start.map((value, axis) => value + track.velocity[axis] * Math.max(0, time - track.startTime));

const pointsOf = (items: Array<{ position: number[] }>) => items.map((item) => item.position);

// Replays the recorded simulator events in order and snapshots every entity after each frame.
// Positions come only from recorded truth (swarm_initialized, formation/refill/rth steps,
// track_observed, trajectory_step.to_position) or, for friendly crossers, from the
// constant-velocity track the simulator itself recorded in swarm_initialized.
export function buildSwarmTimeline(frames: ReplayFrame[]): SwarmFrame[] {
  let drones: Record<string, DroneState> = {};
  let hostiles: Record<string, HostileState> = {};
  let friendlies: Record<string, FriendlyState> = {};
  let friendlyTracks: FriendlyTrack[] = [];
  const reserve = new Set<string>();
  const observers = new Set<string>();
  const sectionMembers = new Map<string, string[]>();
  const timeline: SwarmFrame[] = [];
  const setDrone = (id: string | undefined, patch: Partial<DroneState>) => {
    if (!id) return;
    drones[id] = { ...(drones[id] ?? { id, position: [0, 0, 0], status: 'screen' as DroneStatus }), ...patch };
  };
  const setHostile = (id: string | undefined, patch: Partial<HostileState>) => {
    if (!id) return;
    hostiles[id] = { ...(hostiles[id] ?? { id, position: [0, 0, 0], status: 'inbound' as HostileStatus, wave: 0 }), ...patch };
  };
  const applyPositions = (positions: unknown, status?: DroneStatus) => {
    const moved: number[][] = [];
    Object.entries((positions ?? {}) as Record<string, unknown>).forEach(([id, value]) => {
      if (!isVector3(value)) return;
      setDrone(id, { position: [...value], ...(status ? { status } : {}) });
      moved.push(value);
    });
    return moved;
  };
  let focus: Focus = { kind: 'swarm' };
  const cells: Record<string, number[]> = {};

  frames.forEach((frame) => {
    drones = clone(drones);
    hostiles = clone(hostiles);
    friendlies = clone(friendlies);
    const truth = frame.overview;
    const interceptorId = str(truth.interceptor_id) ?? Object.keys(frame.localViews)[0];
    const hostileId = str(truth.hostile_id);
    switch (frame.kind) {
      case 'swarm_initialized': {
        const launching = (truth.interceptors as Array<Record<string, unknown>> | undefined)?.some((drone) => isVector3(drone.cell) && isVector3(drone.position) && drone.position[1] < (drone.cell as number[])[1] - 100);
        (truth.interceptors as Array<Record<string, unknown>> | undefined)?.forEach((drone) => {
          const id = String(drone.interceptor_id);
          if (drone.phase === 'reserve') reserve.add(id);
          if (drone.role === 'observer') observers.add(id);
          if (isVector3(drone.cell)) cells[id] = [...drone.cell];
          const section = str(drone.section);
          if (section) sectionMembers.set(section, [...(sectionMembers.get(section) ?? []), id]);
          if (isVector3(drone.position)) setDrone(id, { position: [...drone.position], status: launching ? 'pad' : reserve.has(id) ? 'reserve' : 'screen' });
        });
        (truth.hostiles as Array<Record<string, unknown>> | undefined)?.forEach((hostile) => {
          const wave = typeof hostile.wave === 'number' ? hostile.wave : 0;
          if (isVector3(hostile.position)) setHostile(String(hostile.hostile_id), { position: [...hostile.position], status: wave > 0 ? 'pending' : 'inbound', wave });
        });
        friendlyTracks = ((truth.friendlies as Array<Record<string, unknown>> | undefined) ?? [])
          .filter((track) => isVector3(track.start) && isVector3(track.velocity))
          .map((track) => ({ id: String(track.friendly_id), start: track.start as number[], velocity: track.velocity as number[], startTime: Number(track.start_time_s ?? 0) }));
        focus = { kind: 'swarm' };
        break;
      }
      case 'section_launch': {
        const ids = (truth.interceptor_ids as string[] | undefined) ?? [];
        ids.forEach((id) => setDrone(id, { status: 'launching' }));
        focus = { kind: 'area', points: pointsOf(ids.map((id) => drones[id]).filter(Boolean)) };
        break;
      }
      case 'formation_step': {
        const moved = applyPositions(truth.positions);
        if (moved.length) focus = { kind: 'area', points: moved };
        break;
      }
      case 'section_on_station':
        (sectionMembers.get(str(truth.section) ?? '') ?? []).forEach((id) => setDrone(id, { status: reserve.has(id) ? 'reserve' : 'screen' }));
        break;
      case 'swarm_step': {
        // Intercept engine flight sample: every airborne drone and hostile, with each drone's
        // own state and (if committed) the one hostile it is flying at.
        const states = (truth.states ?? {}) as Record<string, string>;
        const targets = (truth.targets ?? {}) as Record<string, string>;
        Object.entries((truth.positions ?? {}) as Record<string, unknown>).forEach(([id, value]) => {
          if (!isVector3(value)) return;
          const engineState = states[id];
          const status: DroneStatus = engineState === 'committed' ? 'engaging'
            : engineState === 'launching' ? 'launching'
            : engineState === 'returning' ? 'returning'
            : engineState === 'rtb' ? 'rth'
            : engineState === 'docked' ? 'docked'
            : observers.has(id) ? 'observing' : reserve.has(id) ? 'reserve' : 'screen';
          setDrone(id, { position: [...value], status, target: targets[id] });
        });
        Object.entries((truth.hostiles ?? {}) as Record<string, unknown>).forEach(([id, value]) => {
          if (isVector3(value) && hostiles[id] && !['neutralized', 'leaked'].includes(hostiles[id].status)) setHostile(id, { position: [...value], status: hostiles[id].status === 'pending' ? 'inbound' : hostiles[id].status });
        });
        // Focus on the area under attack: the engagement closest to impact, from the attacker's side.
        const engagements = Object.entries(targets)
          .filter(([id, hostile]) => drones[id] && hostiles[hostile])
          .map(([id, hostile]) => ({ id, hostile, range: Math.hypot(...drones[id].position.map((value, axis) => value - hostiles[hostile].position[axis])) }))
          .sort((a, b) => a.range - b.range);
        if (engagements.length) focus = { kind: 'drone', id: engagements[0].id, toward: engagements[0].hostile };
        else {
          const launching = Object.values(drones).filter((drone) => drone.status === 'launching');
          if (launching.length) focus = { kind: 'area', points: pointsOf(launching) };
        }
        break;
      }
      case 'hostile_leaked':
        setHostile(hostileId, { status: 'leaked', ...(isVector3(truth.position) ? { position: [...truth.position] } : {}) });
        if (hostileId) focus = { kind: 'hostile', id: hostileId };
        break;
      case 'grid_set':
        focus = { kind: 'swarm' };
        break;
      case 'wave_detected': {
        const ids = (truth.hostile_ids as string[] | undefined) ?? [];
        ids.forEach((id) => { if (hostiles[id]?.status === 'pending') setHostile(id, { status: 'inbound' }); });
        focus = { kind: 'area', points: pointsOf(ids.map((id) => hostiles[id]).filter(Boolean)) };
        break;
      }
      case 'observer_ready':
        setDrone(interceptorId, { status: 'reserve' });
        break;
      case 'mobilized':
        if (truth.phase === 'reserve') { setDrone(interceptorId, { status: 'committed' }); focus = { kind: 'drone', id: interceptorId! }; }
        break;
      case 'policy_decision':
        if (drones[interceptorId!]?.status !== 'reserve') setDrone(interceptorId, { status: 'committed', target: hostileId });
        else setDrone(interceptorId, { target: hostileId });
        break;
      case 'track_observed':
        setHostile(hostileId, { ...(isVector3(truth.position) ? { position: [...truth.position] } : {}), status: 'tracked' });
        if (hostileId) focus = { kind: 'hostile', id: hostileId };
        break;
      case 'duplicate_pursuit':
        setDrone(interceptorId, { status: 'pursuit', target: hostileId });
        break;
      case 'trajectory_step':
        setDrone(interceptorId, { ...(isVector3(truth.to_position) ? { position: [...truth.to_position] } : {}), status: 'engaging' });
        if (interceptorId) focus = { kind: 'drone', id: interceptorId, toward: drones[interceptorId]?.target };
        break;
      case 'engagement_attempt':
        setDrone(interceptorId, { status: 'returning', target: hostileId });
        if (interceptorId) focus = { kind: 'drone', id: interceptorId, toward: hostileId };
        break;
      case 'neutralized': {
        // Kinetic intercept: when a contact point is recorded, both drones end there.
        const contact = isVector3(truth.contact_point) ? [...truth.contact_point] : undefined;
        setHostile(hostileId, { status: 'neutralized', ...(contact ? { position: contact } : {}) });
        if (contact) setDrone(interceptorId, { status: 'expended', position: contact, target: undefined });
        if (hostileId) focus = { kind: 'hostile', id: hostileId, from: interceptorId };
        break;
      }
      case 'claim_cancelled':
        setDrone(interceptorId, { status: 'stood-down' });
        break;
      case 'coverage_expired':
        if (hostileId) focus = { kind: 'hostile', id: hostileId };
        break;
      case 'observer_claim':
        setDrone(interceptorId, { status: 'committed', target: hostileId });
        if (interceptorId) focus = { kind: 'drone', id: interceptorId, toward: hostileId };
        break;
      case 'abort':
        setDrone(interceptorId, { status: 'aborting', target: undefined });
        if (interceptorId) focus = { kind: 'drone', id: interceptorId };
        break;
      case 'recovery_departure':
        ((truth.interceptor_ids as string[] | undefined) ?? []).forEach((id) => setDrone(id, { status: 'rth', target: undefined }));
        break;
      case 'rth_step': {
        const moved = applyPositions(truth.positions, 'rth');
        if (moved.length) focus = { kind: 'area', points: moved };
        break;
      }
      case 'rth_docked':
        setDrone(interceptorId, { status: 'docked' });
        break;
      case 'cell_refill_claim':
        setDrone(interceptorId, { status: 'refilling' });
        if (interceptorId) focus = { kind: 'drone', id: interceptorId };
        break;
      case 'refill_step': {
        const moved = applyPositions(truth.positions, 'refilling');
        if (moved.length) focus = { kind: 'area', points: moved };
        break;
      }
      case 'refill_complete':
        Object.keys((truth.refilled ?? {}) as Record<string, string>).forEach((id) => { setDrone(id, { status: 'screen' }); reserve.delete(id); });
        focus = { kind: 'swarm' };
        break;
      case 'iff_classification': {
        const id = str(truth.friendly_id);
        if (id) {
          const counts: Partial<Record<FriendlyIdentity, number>> = { ...(friendlies[id]?.identities ?? {}) };
          Object.values((truth.identity_states ?? {}) as Record<string, FriendlyIdentity>).forEach((state) => { counts[state] = (counts[state] ?? 0) + 1; });
          friendlies[id] = { ...(friendlies[id] ?? { id, position: [0, 0, 0] }), identities: counts };
          focus = { kind: 'area', points: [friendlyAt(friendlyTracks.find((track) => track.id === id)!, frame.time_s)] };
        }
        break;
      }
      case 'coverage_status':
        if (drones[interceptorId!]?.status !== 'docked') setDrone(interceptorId, { status: drones[interceptorId!]?.status === 'reserve' ? 'reserve' : 'docked' });
        break;
      case 'simulation_completed':
      case 'simulation_incomplete':
        Object.values(hostiles).forEach((hostile) => { if (hostile.status !== 'neutralized' && hostile.status !== 'pending') hostile.status = 'leaked'; });
        focus = { kind: 'swarm' };
        break;
    }
    friendlyTracks.forEach((track) => {
      friendlies[track.id] = { ...(friendlies[track.id] ?? { id: track.id, identities: {} }), position: friendlyAt(track, frame.time_s) };
    });
    const links: EngagementLink[] = Object.values(drones)
      .filter((drone) => drone.target && hostiles[drone.target] && !['neutralized', 'pending'].includes(hostiles[drone.target].status) && ['committed', 'pursuit', 'engaging'].includes(drone.status))
      .map((drone) => ({ interceptorId: drone.id, hostileId: drone.target!, active: drone.status === 'engaging' }));
    const occupants = Object.values(drones).map((drone) => drone.position);
    const vacant = Object.entries(cells)
      .filter(([owner]) => !['pad', 'launching'].includes(drones[owner]?.status ?? 'pad'))
      .filter(([, cell]) => !occupants.some((position) => Math.hypot(position[0] - cell[0], position[1] - cell[1], position[2] - cell[2]) < 6))
      .map(([owner]) => owner);
    timeline.push({ time_s: frame.time_s, drones, hostiles, friendlies, links, focus, vacant });
  });
  return timeline;
}

export function buildCells(frames: ReplayFrame[]): Record<string, number[]> {
  const init = frames.find((frame) => Array.isArray(frame.overview.interceptors));
  return Object.fromEntries(((init?.overview.interceptors as Array<Record<string, unknown>> | undefined) ?? [])
    .filter((drone) => isVector3(drone.cell))
    .map((drone) => [String(drone.interceptor_id), drone.cell as number[]]));
}

const MARKER_EVENTS: ReplayEventName[] = ['GRID SET', 'WAVE DETECTED', 'MISS', 'OBSERVER CLAIM', 'NEUTRALIZED', 'ABORT', 'IFF HOLD', 'LEAKED'];

// Key moments for the timeline strip; repeated consecutive events of one type collapse to one.
export function buildMarkers(frames: ReplayFrame[]): TimelineMarker[] {
  const markers: TimelineMarker[] = [];
  frames.forEach((frame) => {
    if (frame.kind === 'swarm_step' || !MARKER_EVENTS.includes(frame.event.event)) return;
    // GRID SET is also the generic fallback label, so only a recorded grid_set counts.
    if (frame.event.event === 'GRID SET' && frame.kind !== 'grid_set') return;
    const previous = markers.at(-1);
    if (previous && previous.event === frame.event.event && frame.frame - previous.frame <= 3) return;
    markers.push({ frame: frame.frame, event: frame.event.event, label: frame.event.description });
  });
  return markers;
}

function freezeReplay(replay: Replay): Replay {
  replay.frames.forEach((frame) => {
    Object.values(frame.localViews).forEach(Object.freeze);
    Object.freeze(frame.localViews);
    Object.freeze(frame.overview);
    Object.freeze(frame.event);
    Object.freeze(frame);
  });
  Object.freeze(replay.frames);
  Object.freeze(replay.roster);
  Object.freeze(replay.swarm);
  Object.freeze(replay.markers);
  return Object.freeze(replay);
}

export class ReplayRequestError extends Error {
  constructor(public status: number, public url: string) {
    super(`Replay request failed: ${status}`);
  }
}

// Turns a replay load failure into an actionable one-line status for the map overlay.
export function describeReplayError(error: unknown): string {
  if (error instanceof ReplayRequestError) {
    // 404 for a known scenario id, or 422 for perspective=locals, means the API process predates
    // this frontend (uvicorn without --reload keeps serving the code it started with).
    if (error.status === 404 || error.status === 422) return `REPLAY API OUT OF DATE (${error.status}) · RESTART THE API SERVER`;
    return `REPLAY API ERROR (${error.status})`;
  }
  return 'REPLAY API UNREACHABLE · START THE API SERVER ON PORT 8000';
}

async function getJson(fetcher: Fetcher, url: string): Promise<ApiReplay> {
  const response = await fetcher(url);
  if (!response.ok) throw new ReplayRequestError(response.status, url);
  return response.json() as Promise<ApiReplay>;
}

export function assembleReplay(overview: ApiReplay, locals: ApiReplay, source = 'api'): Replay {
  const byFrame = new Map<number, ReplayFrame>();
  overview.frames.forEach((frame) => byFrame.set(frame.frame, {
    frame: frame.frame,
    time_s: frame.time_s,
    kind: frame.event_kind,
    overview: frame.overview ?? {},
    event: eventFrom('', frame.overview ?? {}, frame.event_kind),
    localViews: {},
  }));
  locals.frames.forEach((frame) => {
    const merged = byFrame.get(frame.frame) ?? { frame: frame.frame, time_s: frame.time_s, overview: {}, event: eventFrom('', {}), localViews: {} };
    Object.entries(frame.local_views ?? {}).forEach(([agentId, view]) => { if (view) merged.localViews[agentId] = view; });
    const label = frame.presentation?.label ?? '';
    if (label) merged.event = eventFrom(label, merged.overview, merged.kind);
    byFrame.set(frame.frame, merged);
  });
  const frames = [...byFrame.values()].sort((a, b) => a.frame - b.frame);
  // Flight samples carry no event of their own; keep showing the last real event.
  frames.forEach((frame, index) => {
    if (frame.kind === 'swarm_step' && index > 0) frame.event = frames[index - 1].event;
  });
  return freezeReplay({
    scenarioId: overview.scenario_id,
    evidenceClass: 'simulation_evidence',
    source,
    frames,
    roster: buildRoster(frames),
    swarm: buildSwarmTimeline(frames),
    cells: buildCells(frames),
    markers: buildMarkers(frames),
  });
}

export async function loadReplay(scenario: Scenario, fetcher: Fetcher = fetch): Promise<Replay> {
  const scenarioId = encodeURIComponent(scenario);
  const [overview, locals] = await Promise.all([
    getJson(fetcher, `/api/scenarios/${scenarioId}/replay?perspective=overview`),
    getJson(fetcher, `/api/scenarios/${scenarioId}/replay?perspective=locals`),
  ]);
  return assembleReplay(overview, locals);
}

function frameIndexAt(replay: Replay, frame: number): number {
  let index = 0;
  for (let i = 0; i < replay.frames.length; i += 1) {
    if (replay.frames[i].frame <= frame) index = i;
    else break;
  }
  return index;
}

export function replayAt(replay: Replay, frame: number): ReplayFrame {
  const elapsed = replay.frames.filter((item) => item.frame <= frame);
  const current = elapsed.at(-1) ?? replay.frames[0];
  return {
    ...current,
    overview: Object.assign({}, ...elapsed.map((item) => item.overview)),
    localViews: Object.assign({}, ...elapsed.map((item) => item.localViews)),
  };
}

export function replaySwarmAt(replay: Replay, frame: number): SwarmFrame | undefined {
  return replay.swarm[frameIndexAt(replay, frame)];
}

export function replayPosition(frame: ReplayFrame, source: 'overview' | string): number[] | undefined {
  const value = source === 'overview' ? frame.overview.position : frame.localViews[source]?.noisy_position;
  return isVector3(value) ? value : undefined;
}

export function rosterCallsign(replay: Replay | null | undefined, agentId: string): string {
  return replay?.roster.find((drone) => drone.id === agentId)?.callsign ?? agentId;
}

export const DRONE_STATUS_LABELS: Record<DroneStatus, string> = {
  pad: 'ON PAD',
  launching: 'LAUNCHING',
  observing: 'OBSERVING',
  expended: 'EXPENDED · INTERCEPT',
  aborting: 'ABORT',
  rth: 'RTH',
  refilling: 'REFILLING',
  screen: 'SCREEN',
  committed: 'COMMITTED',
  reserve: 'RESERVE',
  pursuit: 'DUPLICATE',
  engaging: 'ENGAGING',
  returning: 'RTB',
  'stood-down': 'STOOD DOWN',
  docked: 'DOCKED',
};

export interface ReplayDecision {
  id: string;
  agentId: string;
  local: string;
  decision: string;
  leak?: number;
  success?: number;
  covered?: number;
  confidence?: number;
  utility?: number;
  identity: string;
  preferredVelocity?: number[];
  safeVelocity?: number[];
  safetyOverride?: boolean;
  visibleTracks?: Array<{ track_id: string; identity_state: string }>;
}

export function replayDecision(replay: Replay, frame: number, agentId: string): ReplayDecision | undefined {
  const source = replay.frames.filter((item) => item.frame <= frame && item.localViews[agentId]?.belief).at(-1);
  const local = source?.localViews[agentId];
  if (!local?.belief) return undefined;
  const status = replaySwarmAt(replay, frame)?.drones[agentId]?.status;
  return {
    id: rosterCallsign(replay, agentId),
    agentId,
    local: local.local_track_id ?? 'NO LOCAL TRACK',
    decision: status ? DRONE_STATUS_LABELS[status] : 'EVALUATE',
    leak: Math.round(local.belief.target_leak_probability * 100),
    success: Math.round(local.belief.action_success_probability * 100),
    covered: Math.round(local.belief.friendly_coverage_probability * 100),
    confidence: Math.round(local.belief.confidence * 100),
    utility: local.utility,
    identity: local.identity_state ?? 'UNKNOWN',
    preferredVelocity: local.preferred_velocity,
    safeVelocity: local.safe_velocity,
    safetyOverride: local.safety_override,
    visibleTracks: local.visible_tracks,
  };
}

export interface SafetyReading {
  preferredVelocity?: number[];
  safeVelocity?: number[];
  safetyOverride?: boolean;
  predictedMinSeparationM?: number | null;
  actualSeparationM?: number;
}

// trajectory_step frames (guidance/RVO2 output) never carry a `belief`, so replayDecision's
// belief-gated lookup can't surface them - this reads the same accumulated frames for
// whichever local view most recently reported a preferred/safe velocity pair instead.
export function replaySafety(replay: Replay, frame: number, agentId: string): SafetyReading | undefined {
  const elapsed = replay.frames.filter((item) => item.frame <= frame);
  const source = elapsed.filter((item) => item.localViews[agentId]?.preferred_velocity).at(-1);
  const local = source?.localViews[agentId];
  if (!local) return undefined;
  const actual = source?.overview.nearest_friendly_separation_m;
  return {
    preferredVelocity: local.preferred_velocity,
    safeVelocity: local.safe_velocity,
    safetyOverride: local.safety_override,
    predictedMinSeparationM: local.predicted_min_separation_m,
    actualSeparationM: typeof actual === 'number' ? actual : undefined,
  };
}

export interface FleetStatus {
  battery?: number;
  lifecycleState?: LocalView['lifecycle_state'];
}

export function replayFleetStatus(replay: Replay, frame: number, agentId: string): FleetStatus | undefined {
  const source = replay.frames.filter((item) => item.frame <= frame && item.localViews[agentId]?.lifecycle_state).at(-1);
  const local = source?.localViews[agentId];
  if (!local) return undefined;
  return { battery: local.battery, lifecycleState: local.lifecycle_state };
}

export interface SeparationSample {
  frame: number;
  separationM?: number;
  override: boolean;
}

export function replaySeparationSeries(replay: Replay, uptoFrame: number, agentId: string, windowSize = 24): SeparationSample[] {
  const start = Math.max(0, uptoFrame - windowSize + 1);
  const samples: SeparationSample[] = [];
  for (let f = start; f <= uptoFrame; f += 1) {
    const frameAt = replayAt(replay, f);
    const rawSeparation = frameAt.overview.nearest_friendly_separation_m;
    samples.push({
      frame: f,
      separationM: typeof rawSeparation === 'number' ? rawSeparation : undefined,
      override: frameAt.localViews[agentId]?.safety_override === true,
    });
  }
  return samples;
}
