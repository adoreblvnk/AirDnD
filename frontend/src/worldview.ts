import naiveArtifact from './replays/naive.json';

export type Perspective = 'OVERVIEW' | 'HOSTILE' | 'INTERCEPTOR' | 'OBSERVER';
export type Scenario = 'hit' | 'recovery' | 'naive';
export type ReplayEventName = 'LAUNCH' | 'GRID SET' | 'MISS' | 'OBSERVER CLAIM' | 'NEUTRALIZED' | 'DUPLICATE PURSUIT' | 'RTH';

export interface WorldState {
  frame: number;
  maxFrame: number;
  playing: boolean;
  scenario: Scenario;
  view: 'overview' | 'sector';
  perspective: Perspective;
  groundTruth: boolean;
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
  scenario: 'recovery',
  view: 'overview',
  perspective: 'OVERVIEW',
  groundTruth: false,
  selected: 'I-07',
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
  | { type: 'select'; id: string }
  | { type: 'pin'; id: string }
  | { type: 'toggle-detail' }
  | { type: 'toggle-compare' };

const clamp = (frame: number, maxFrame = MAX_FRAME) => Math.max(0, Math.min(maxFrame, Math.round(frame)));

export function reducer(state: WorldState, action: Action): WorldState {
  switch (action.type) {
    case 'toggle-play': return { ...state, playing: !state.playing };
    case 'tick': return state.frame === state.maxFrame ? { ...state, playing: false } : { ...state, frame: state.frame + 1 };
    case 'scrub': return { ...state, frame: clamp(action.frame, state.maxFrame), playing: false };
    case 'step': return { ...state, frame: clamp(state.frame + action.delta, state.maxFrame), playing: false };
    case 'scenario': return { ...state, scenario: action.scenario, frame: 0, playing: false };
    case 'replay-loaded': return { ...state, frame: 0, maxFrame: action.maxFrame, playing: false };
    case 'view': return { ...state, view: action.view };
    case 'perspective': return { ...state, perspective: action.perspective, groundTruth: false };
    case 'toggle-truth': return { ...state, groundTruth: !state.groundTruth };
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
  claim_delay_s?: number;
  noisy_position?: number[];
  track_status?: string;
}

export interface ReplayFrame {
  frame: number;
  time_s: number;
  overview: Record<string, unknown>;
  event: ReplayMoment;
  localViews: Record<string, LocalView>;
}

export interface Replay {
  scenarioId: string;
  evidenceClass: string;
  source: string;
  frames: ReplayFrame[];
}

interface ApiFrame {
  frame: number;
  time_s: number;
  overview?: Record<string, unknown>;
  local_view?: LocalView | null;
  presentation?: { label?: string };
}

interface ApiReplay { scenario_id: string; frames: ApiFrame[]; }
type Fetcher = (input: string) => Promise<Response>;

export const units = [
  { id: 'I-07', agentId: 'I000' },
  { id: 'I-12', agentId: 'I001' },
  { id: 'I-19', agentId: 'I002' },
  { id: 'I-21', agentId: 'I003' },
] as const;

function eventFrom(label: string, overview: Record<string, unknown>): ReplayMoment {
  const normalized = label.toLowerCase();
  if (overview.outcome === false || normalized === 'coverage expired') return { event: 'MISS', description: label || 'engagement unsuccessful' };
  if (overview.outcome === true || normalized === 'neutralized') return { event: 'NEUTRALIZED', description: label || 'hostile track removed' };
  if (normalized.includes('recovery')) return { event: 'OBSERVER CLAIM', description: label };
  if (normalized.includes('duplicate')) return { event: 'DUPLICATE PURSUIT', description: label };
  if (normalized.includes('launch')) return { event: 'LAUNCH', description: label };
  if (normalized.includes('rth') || normalized.includes('return')) return { event: 'RTH', description: label };
  return { event: 'GRID SET', description: label || 'generated replay frame' };
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
  return Object.freeze(replay);
}

const naive = naiveArtifact as unknown as { scenario_id: string; evidence_class: string; frames: ReplayFrame[] };
export const naiveReplay = freezeReplay({
  scenarioId: naive.scenario_id,
  evidenceClass: naive.evidence_class,
  source: 'src/replays/naive.json',
  frames: naive.frames,
});

async function getJson(fetcher: Fetcher, url: string): Promise<ApiReplay> {
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`Replay request failed: ${response.status}`);
  return response.json() as Promise<ApiReplay>;
}

export async function loadReplay(scenario: Scenario, fetcher: Fetcher = fetch): Promise<Replay> {
  if (scenario === 'naive') return naiveReplay;
  const scenarioId = scenario === 'hit' ? 'success' : 'miss_recovery';
  const agentIds = scenario === 'hit' ? ['I000', 'I001'] : ['I000', 'I001', 'I002'];
  const overview = await getJson(fetcher, `/api/scenarios/${scenarioId}/replay?perspective=overview`);
  const locals = await Promise.all(agentIds.map((agentId) => getJson(fetcher, `/api/scenarios/${scenarioId}/replay?perspective=local&observer_id=${agentId}`)));
  const byFrame = new Map<number, ReplayFrame>();
  overview.frames.forEach((frame) => byFrame.set(frame.frame, {
    frame: frame.frame,
    time_s: frame.time_s,
    overview: frame.overview ?? {},
    event: eventFrom('', frame.overview ?? {}),
    localViews: {},
  }));
  locals.forEach((stream) => stream.frames.forEach((frame) => {
    const merged = byFrame.get(frame.frame) ?? { frame: frame.frame, time_s: frame.time_s, overview: {}, event: eventFrom('', {}), localViews: {} };
    if (frame.local_view?.agent_id) merged.localViews[frame.local_view.agent_id] = frame.local_view;
    const label = frame.presentation?.label ?? '';
    if (label) merged.event = eventFrom(label, merged.overview);
    byFrame.set(frame.frame, merged);
  }));
  return freezeReplay({
    scenarioId: overview.scenario_id,
    evidenceClass: 'simulation_evidence',
    source: 'api',
    frames: [...byFrame.values()].sort((a, b) => a.frame - b.frame),
  });
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

export function replayPosition(frame: ReplayFrame, source: 'overview' | string): number[] | undefined {
  const value = source === 'overview' ? frame.overview.position : frame.localViews[source]?.noisy_position;
  return Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number') ? value as number[] : undefined;
}

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
}

export function replayDecision(replay: Replay, frame: number, agentId: string): ReplayDecision | undefined {
  const source = replay.frames.filter((item) => item.frame <= frame && item.localViews[agentId]?.belief).at(-1);
  const local = source?.localViews[agentId];
  if (!local?.belief) return undefined;
  const unit = units.find((item) => item.agentId === agentId);
  return {
    id: unit?.id ?? agentId,
    agentId,
    local: local.local_track_id ?? 'NO LOCAL TRACK',
    decision: source?.event.event === 'OBSERVER CLAIM' ? 'INTERCEPT' : 'EVALUATE',
    leak: Math.round(local.belief.target_leak_probability * 100),
    success: Math.round(local.belief.action_success_probability * 100),
    covered: Math.round(local.belief.friendly_coverage_probability * 100),
    confidence: Math.round(local.belief.confidence * 100),
    utility: local.utility,
    identity: local.identity_state ?? 'UNKNOWN',
    preferredVelocity: local.preferred_velocity,
    safeVelocity: local.safe_velocity,
    safetyOverride: local.safety_override,
  };
}
