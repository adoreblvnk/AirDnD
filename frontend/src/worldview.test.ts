import { describe, expect, it, vi } from 'vitest';
import {
  assembleReplay,
  groupRoster,
  initialState,
  loadReplay,
  reducer,
  replayAt,
  replayDecision,
  replayPosition,
  replaySwarmAt,
  describeReplayError,
  ReplayRequestError,
  type ApiReplay,
} from './worldview';
import { DEFAULT_SCENARIO, SCENARIOS } from './scenarios';

describe('worldview reducer', () => {
  it('plays, pauses, scrubs and frame-steps within bounds', () => {
    let state = reducer(initialState, { type: 'toggle-play' });
    expect(state.playing).toBe(true);
    state = reducer(state, { type: 'scrub', frame: 999 });
    expect(state.frame).toBe(180);
    state = reducer(state, { type: 'step', delta: -1 });
    expect(state.frame).toBe(179);
  });

  it('restarts from frame 0 when play is pressed at the end of a replay', () => {
    const ended = { ...initialState, frame: 14, maxFrame: 14, playing: false };
    const restarted = reducer(ended, { type: 'toggle-play' });
    expect(restarted.playing).toBe(true);
    expect(restarted.frame).toBe(0);
  });

  it('masks truth in local views until evaluator overlay is explicit', () => {
    const local = reducer(initialState, { type: 'perspective', perspective: 'INTERCEPTOR' });
    expect(local.groundTruth).toBe(false);
    expect(reducer(local, { type: 'toggle-truth' }).groundTruth).toBe(true);
  });

  it('pins no more than three unique interceptors', () => {
    let state = initialState;
    for (const id of ['I000', 'I001', 'I002', 'I003']) state = reducer(state, { type: 'pin', id });
    expect(state.pinned).toEqual(['I000', 'I001', 'I002']);
    expect(reducer(state, { type: 'pin', id: 'I001' }).pinned).toEqual(['I000', 'I001', 'I002']);
  });
});

// Mirrors the simulator's section-formation replay: frame-0 order of battle, local policy
// decisions, one hostile's engagement, then completion.
const section = (index: number) => ({
  interceptor_id: `I${String(index).padStart(3, '0')}`,
  callsign: `A1-${Math.floor(index / 9) + 1}-${(index % 9) + 1}`,
  company: 'A',
  platoon: `A${Math.floor(index / 27) + 1}`,
  section: `A${Math.floor(index / 27) + 1}-${Math.floor((index % 27) / 9) + 1}`,
  phase: index < 9 ? 'initial' : 'reserve',
  position: [index * 20, 0, 250],
});
const overview: ApiReplay = {
  scenario_id: 'miss_recovery',
  frames: [
    { frame: 0, time_s: 0, event_kind: 'swarm_initialized', overview: { formation: 'sections', interceptors: Array.from({ length: 18 }, (_, i) => section(i)), hostiles: [{ hostile_id: 'H000', position: [0, 1400, 150], wave: 0 }, { hostile_id: 'H001', position: [900, 1400, 150], wave: 0 }] } },
    { frame: 1, time_s: 0, event_kind: 'policy_decision', overview: { hostile_id: 'H000', interceptor_id: 'I000' } },
    { frame: 2, time_s: 0, event_kind: 'observer_ready', overview: { interceptor_id: 'I009', phase: 'reserve' } },
    { frame: 3, time_s: 0, event_kind: 'track_observed', overview: { hostile_id: 'H000', position: [0, 1400, 150] } },
    { frame: 4, time_s: 0.1, event_kind: 'trajectory_step', overview: { interceptor_id: 'I000', from_position: [0, 0, 250], to_position: [0, 3, 249.8] } },
    { frame: 5, time_s: 0.2, event_kind: 'engagement_attempt', overview: { hostile_id: 'H000', interceptor_id: 'I000', outcome: false } },
    { frame: 6, time_s: 4.4, event_kind: 'coverage_expired', overview: { hostile_id: 'H000' } },
    { frame: 7, time_s: 4.5, event_kind: 'observer_claim', overview: { hostile_id: 'H000' } },
    { frame: 8, time_s: 4.6, event_kind: 'neutralized', overview: { hostile_id: 'H000', interceptor_id: 'I009' } },
    { frame: 9, time_s: 4.7, event_kind: 'simulation_completed', overview: { processed_hostiles: 2, expected_hostiles: 2 } },
  ],
};
const locals: ApiReplay = {
  scenario_id: 'miss_recovery',
  frames: [
    { frame: 0, time_s: 0, local_views: {}, presentation: { label: 'swarms initialized' } },
    { frame: 1, time_s: 0, local_views: { I000: { agent_id: 'I000', local_track_id: 'I000-f736bc91', belief: { target_leak_probability: 0.36, action_success_probability: 0.39, friendly_coverage_probability: 0.01, confidence: 0.99 }, utility: 0.04 } }, presentation: { label: 'local policy decision' } },
    { frame: 3, time_s: 0, local_views: { I000: { agent_id: 'I000', noisy_position: [1, 1401, 151] } }, presentation: { label: 'local observation' } },
    { frame: 6, time_s: 4.4, local_views: {}, presentation: { label: 'coverage expired' } },
    { frame: 7, time_s: 4.5, local_views: { I009: { agent_id: 'I009', claim_delay_s: 0.15 } }, presentation: { label: 'observation-driven recovery' } },
    { frame: 8, time_s: 4.6, local_views: { I009: { agent_id: 'I009', track_status: 'removed' } }, presentation: { label: 'NEUTRALIZED' } },
  ],
};

describe('swarm replay', () => {
  const replay = assembleReplay(overview, locals);

  it('builds the section/platoon roster from the order-of-battle frame', () => {
    expect(replay.roster).toHaveLength(18);
    expect(replay.roster[0]).toMatchObject({ id: 'I000', callsign: 'A1-1-1', section: 'A1-1', platoon: 'A1', phase: 'initial' });
    const platoons = groupRoster(replay.roster);
    expect(platoons.map((platoon) => platoon.id)).toEqual(['A1']);
    expect(platoons[0].sections.map((item) => [item.id, item.drones.length])).toEqual([['A1-1', 9], ['A1-2', 9]]);
  });

  it('places every drone and hostile from frame 0', () => {
    const start = replaySwarmAt(replay, 0)!;
    expect(Object.keys(start.drones)).toHaveLength(18);
    expect(Object.keys(start.hostiles)).toEqual(['H000', 'H001']);
    expect(start.drones.I009.status).toBe('reserve');
    expect(start.focus).toEqual({ kind: 'swarm' });
  });

  it('moves drones only to recorded truth positions and links committed drones to targets', () => {
    expect(replaySwarmAt(replay, 1)!.links).toEqual([{ interceptorId: 'I000', hostileId: 'H000', active: false }]);
    const flying = replaySwarmAt(replay, 4)!;
    expect(flying.drones.I000).toMatchObject({ position: [0, 3, 249.8], status: 'engaging', target: 'H000' });
    expect(flying.links).toEqual([{ interceptorId: 'I000', hostileId: 'H000', active: true }]);
    expect(flying.focus).toEqual({ kind: 'drone', id: 'I000', toward: 'H000' });
    expect(replaySwarmAt(replay, 3)!.drones.I000.position).toEqual([0, 0, 250]);
  });

  it('tells the miss and recovery story through focus and hostile status', () => {
    expect(replaySwarmAt(replay, 6)!.focus).toEqual({ kind: 'hostile', id: 'H000' });
    expect(replaySwarmAt(replay, 7)!.drones.I009).toMatchObject({ status: 'committed', target: 'H000' });
    const hit = replaySwarmAt(replay, 8)!;
    expect(hit.hostiles.H000.status).toBe('neutralized');
    expect(hit.focus).toEqual({ kind: 'hostile', id: 'H000', from: 'I009' });
    expect(replaySwarmAt(replay, 9)!.hostiles.H001.status).toBe('leaked');
  });

  it('labels frames from generated event kinds', () => {
    expect(replayAt(replay, 6).event.event).toBe('MISS');
    expect(replayAt(replay, 7).event.event).toBe('OBSERVER CLAIM');
    expect(replayAt(replay, 8).event.event).toBe('NEUTRALIZED');
  });

  it('reads decision probabilities and callsigns from the replay', () => {
    expect(replayDecision(replay, 1, 'I000')).toMatchObject({ id: 'A1-1-1', local: 'I000-f736bc91', leak: 36, success: 39, covered: 1, confidence: 99, decision: 'COMMITTED' });
    expect(replayPosition(replayAt(replay, 3), 'I000')).toEqual([1, 1401, 151]);
  });

  it('freezes the assembled replay', () => {
    expect(Object.isFrozen(replay.frames)).toBe(true);
    expect(Object.isFrozen(replay.swarm)).toBe(true);
  });

  it('loads every scenario with one overview and one all-locals request', async () => {
    const fetcher = vi.fn(async (input: string) => new Response(JSON.stringify(input.includes('perspective=overview') ? overview : locals)));
    for (const { id } of SCENARIOS) {
      fetcher.mockClear();
      const loaded = await loadReplay(id, fetcher);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher).toHaveBeenCalledWith(`/api/scenarios/${id}/replay?perspective=overview`);
      expect(fetcher).toHaveBeenCalledWith(`/api/scenarios/${id}/replay?perspective=locals`);
      expect(loaded.roster).toHaveLength(18);
      expect(loaded.source).toBe('api');
    }
  });
});

describe('scenario catalogue', () => {
  it('explains why a replay failed to load', async () => {
    const stale = vi.fn(async (input: string) => new Response('{}', { status: input.includes('locals') ? 422 : 200 }));
    await expect(loadReplay('miss_recovery', stale)).rejects.toBeInstanceOf(ReplayRequestError);
    const error = await loadReplay('miss_recovery', stale).catch((caught: unknown) => caught);
    expect(describeReplayError(error)).toBe('REPLAY API OUT OF DATE (422) · RESTART THE API SERVER');
    expect(describeReplayError(new TypeError('Failed to fetch'))).toBe('REPLAY API UNREACHABLE · START THE API SERVER ON PORT 8000');
  });
  it('uses one snake_case id per scenario and defaults to an existing one', () => {
    const ids = SCENARIOS.map((scenario) => scenario.id);
    expect(ids).toEqual(['launch_formation', 'intercept_success', 'miss_recovery', 'multi_wave', 'return_to_base', 'friend_or_foe', 'naive_baseline']);
    expect(ids.every((id) => /^[a-z]+(_[a-z]+)*$/.test(id))).toBe(true);
    expect(new Set(SCENARIOS.map((scenario) => scenario.title)).size).toBe(ids.length);
    expect(ids).toContain(DEFAULT_SCENARIO);
    expect(initialState.scenario).toBe(DEFAULT_SCENARIO);
  });
});

describe('scenario events on the swarm timeline', () => {
  const init = (extra: Record<string, unknown> = {}) => ({
    frame: 0, time_s: 0, event_kind: 'swarm_initialized',
    overview: {
      interceptors: [
        { interceptor_id: 'I000', callsign: 'A1-1-1', platoon: 'A1', section: 'A1-1', phase: 'initial', position: [0, -650, 15], cell: [0, 0, 250] },
        { interceptor_id: 'I001', callsign: 'A3-1-1', platoon: 'A3', section: 'A3-1', phase: 'reserve', position: [0, -850, 15], cell: [0, -200, 250] },
      ],
      hostiles: [{ hostile_id: 'H000', position: [0, 1400, 150], wave: 0 }, { hostile_id: 'H001', position: [900, 1400, 150], wave: 1 }],
      friendlies: [{ friendly_id: 'F000', start: [250, 700, 200], velocity: [20, 0, 0], start_time_s: 10 }],
      ...extra,
    },
  });
  const build = (frames: ApiReplay['frames']) => assembleReplay({ scenario_id: 't', frames: [init(), ...frames] }, { scenario_id: 't', frames: [] });

  it('starts launch scenarios on the pads and flies drones by recorded positions', () => {
    const replay = build([
      { frame: 1, time_s: 0, event_kind: 'section_launch', overview: { section: 'A1-1', interceptor_ids: ['I000'] } },
      { frame: 2, time_s: 2, event_kind: 'formation_step', overview: { positions: { I000: [0, -600, 30] }, nearest_friendly_separation_m: 40 } },
      { frame: 3, time_s: 40, event_kind: 'section_on_station', overview: { section: 'A1-1' } },
      { frame: 4, time_s: 40, event_kind: 'grid_set', overview: { sections: 1 } },
    ]);
    expect(replaySwarmAt(replay, 0)!.drones.I000).toMatchObject({ status: 'pad', position: [0, -650, 15] });
    expect(replaySwarmAt(replay, 1)!.drones.I000.status).toBe('launching');
    expect(replaySwarmAt(replay, 2)!.drones.I000.position).toEqual([0, -600, 30]);
    expect(replaySwarmAt(replay, 2)!.focus).toEqual({ kind: 'area', points: [[0, -600, 30]] });
    expect(replaySwarmAt(replay, 3)!.drones.I000.status).toBe('screen');
    expect(replayAt(replay, 4).event.event).toBe('GRID SET');
  });

  it('keeps later-wave hostiles hidden until their wave is detected', () => {
    const replay = build([{ frame: 1, time_s: 360, event_kind: 'wave_detected', overview: { wave: 2, hostile_ids: ['H001'] } }]);
    expect(replaySwarmAt(replay, 0)!.hostiles.H001.status).toBe('pending');
    expect(replaySwarmAt(replay, 1)!.hostiles.H001.status).toBe('inbound');
    expect(replaySwarmAt(replay, 1)!.focus).toEqual({ kind: 'area', points: [[900, 1400, 150]] });
    expect(replayAt(replay, 1).event.event).toBe('WAVE DETECTED');
  });

  it('tracks abort, dead-reckoning return and docking', () => {
    const replay = build([
      { frame: 1, time_s: 5, event_kind: 'abort', overview: { interceptor_id: 'I000', battery: 0.23 } },
      { frame: 2, time_s: 7, event_kind: 'rth_step', overview: { positions: { I000: [0, -100, 300] }, phase: 'transit' } },
      { frame: 3, time_s: 90, event_kind: 'rth_docked', overview: { interceptor_id: 'I000', docking_error_m: 3.1 } },
    ]);
    expect(replaySwarmAt(replay, 1)!.drones.I000.status).toBe('aborting');
    expect(replayAt(replay, 1).event.event).toBe('ABORT');
    expect(replaySwarmAt(replay, 2)!.drones.I000).toMatchObject({ status: 'rth', position: [0, -100, 300] });
    expect(replaySwarmAt(replay, 3)!.drones.I000.status).toBe('docked');
  });

  it('moves a reserve into a vacated cell and returns it to the screen', () => {
    const replay = build([
      { frame: 1, time_s: 100, event_kind: 'cell_refill_claim', overview: { interceptor_id: 'I001', vacated_by: 'I000' } },
      { frame: 2, time_s: 102, event_kind: 'refill_step', overview: { positions: { I001: [0, -100, 300] } } },
      { frame: 3, time_s: 140, event_kind: 'refill_complete', overview: { refilled: { I001: 'I000' } } },
    ]);
    expect(replaySwarmAt(replay, 1)!.drones.I001.status).toBe('refilling');
    expect(replaySwarmAt(replay, 2)!.drones.I001.position).toEqual([0, -100, 300]);
    expect(replaySwarmAt(replay, 3)!.drones.I001.status).toBe('screen');
  });

  it('marks a cell vacant once its drone leaves and clears it when a reserve arrives', () => {
    const replay = build([
      { frame: 1, time_s: 5, event_kind: 'rth_step', overview: { positions: { I000: [0, 0, 400] } } },
      { frame: 2, time_s: 100, event_kind: 'refill_step', overview: { positions: { I001: [0, 0, 250] } } },
    ]);
    expect(replaySwarmAt(replay, 0)!.vacant).toEqual([]); // on pads before launch: not vacant yet
    expect(replaySwarmAt(replay, 1)!.vacant).toContain('I000');
    expect(replaySwarmAt(replay, 2)!.vacant).not.toContain('I000');
    expect(replay.cells.I000).toEqual([0, 0, 250]);
  });

  it('builds clickable timeline markers for key events', () => {
    const replay = build([
      { frame: 1, time_s: 360, event_kind: 'wave_detected', overview: { wave: 2, hostile_ids: ['H001'] } },
      { frame: 2, time_s: 361, event_kind: 'neutralized', overview: { hostile_id: 'H001', interceptor_id: 'I000' } },
    ]);
    expect(replay.markers.map((marker) => [marker.frame, marker.event])).toEqual([[1, 'WAVE DETECTED'], [2, 'NEUTRALIZED']]);
    expect(reducer({ ...initialState, frame: 9, playing: true }, { type: 'reset' })).toMatchObject({ frame: 0, playing: false });
  });

  it('moves friendly crossers on their recorded track and tallies identity states', () => {
    const replay = build([
      { frame: 1, time_s: 10, event_kind: 'iff_classification', overview: { friendly_id: 'F000', identity_states: { I000: 'CONFIRMED FRIENDLY', I001: 'UNKNOWN' }, engaged: false } },
      { frame: 2, time_s: 15, event_kind: 'trajectory_step', overview: { interceptor_id: 'I000', to_position: [0, 1, 250] } },
    ]);
    expect(replaySwarmAt(replay, 0)!.friendlies.F000.position).toEqual([250, 700, 200]);
    expect(replaySwarmAt(replay, 1)!.friendlies.F000.identities).toEqual({ 'CONFIRMED FRIENDLY': 1, UNKNOWN: 1 });
    expect(replaySwarmAt(replay, 2)!.friendlies.F000.position).toEqual([350, 700, 200]);
    expect(replayAt(replay, 1).event.event).toBe('IFF HOLD');
  });
});
