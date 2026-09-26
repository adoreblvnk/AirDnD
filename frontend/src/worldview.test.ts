import { describe, expect, it, vi } from 'vitest';
import {
  initialState,
  loadReplay,
  naiveReplay,
  reducer,
  replayAt,
  replayDecision,
  replayPosition,
  type Replay,
} from './worldview';

describe('worldview reducer', () => {
  it('plays, pauses, scrubs and frame-steps within bounds', () => {
    let state = reducer(initialState, { type: 'toggle-play' });
    expect(state.playing).toBe(true);
    state = reducer(state, { type: 'scrub', frame: 999 });
    expect(state.frame).toBe(180);
    state = reducer(state, { type: 'step', delta: -1 });
    expect(state.frame).toBe(179);
  });

  it('masks truth in local views until evaluator overlay is explicit', () => {
    const local = reducer(initialState, { type: 'perspective', perspective: 'INTERCEPTOR' });
    expect(local.groundTruth).toBe(false);
    expect(reducer(local, { type: 'toggle-truth' }).groundTruth).toBe(true);
  });

  it('pins no more than three unique interceptors', () => {
    let state = initialState;
    for (const id of ['I-07', 'I-12', 'I-19', 'I-21']) state = reducer(state, { type: 'pin', id });
    expect(state.pinned).toEqual(['I-07', 'I-12', 'I-19']);
    expect(reducer(state, { type: 'pin', id: 'I-12' }).pinned).toEqual(['I-07', 'I-12', 'I-19']);
  });
});

describe('generated replay data', () => {
  const replay: Replay = {
    scenarioId: 'miss_recovery',
    evidenceClass: 'simulation_evidence',
    source: 'api',
    frames: [
      {
        frame: 4,
        time_s: 0,
        overview: { hostile_id: 'H000', interceptor_id: 'I000', outcome: false },
        event: { event: 'MISS', description: 'simulated engagement' },
        localViews: {
          I000: {
            agent_id: 'I000',
            local_track_id: 'I000-f736bc91',
            belief: {
              target_leak_probability: 0.3646664321422577,
              action_success_probability: 0.3909035921096802,
              friendly_coverage_probability: 0.013921905308961868,
              confidence: 0.9976771473884583,
            },
            utility: 0.04056485874355786,
          },
        },
      },
      {
        frame: 6,
        time_s: 4.45,
        overview: { hostile_id: 'H000' },
        event: { event: 'OBSERVER CLAIM', description: 'observation-driven recovery' },
        localViews: { I001: { agent_id: 'I001', claim_delay_s: 0.15 } },
      },
    ],
  };

  it('uses generated frame events instead of authored frame thresholds', () => {
    expect(replayAt(replay, 4).event).toEqual({ event: 'MISS', description: 'simulated engagement' });
    expect(replayAt(replay, 5).event.event).toBe('MISS');
    expect(replayAt(replay, 6).event.event).toBe('OBSERVER CLAIM');
  });

  it('carries the latest generated geometry through sparse event frames', () => {
    const sparse: Replay = {
      ...replay,
      frames: [
        { ...replay.frames[0], overview: { position: [10, 20, 30] } },
        { ...replay.frames[1], overview: { outcome: false } },
      ],
    };
    expect(replayAt(sparse, 6).overview.position).toEqual([10, 20, 30]);
    expect(replayAt(sparse, 6).event.event).toBe('OBSERVER CLAIM');
  });

  it('uses generated positions without interpolating authored scenario paths', () => {
    expect(replayPosition(replay.frames[0], 'overview')).toEqual(undefined);
    const positioned = { ...replay.frames[0], overview: { position: [103.85, 1.28, 440] } };
    expect(replayPosition(positioned, 'overview')).toEqual([103.85, 1.28, 440]);
    expect(replayPosition(positioned, 'I000')).toBeUndefined();
  });

  it('reads decision probabilities from the replay local view', () => {
    expect(replayDecision(replay, 4, 'I000')).toMatchObject({
      local: 'I000-f736bc91',
      leak: 36,
      success: 39,
      covered: 1,
      confidence: 100,
      utility: 0.04056485874355786,
    });
  });

  it('loads hit and miss-recovery frames from the replay API', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('perspective=overview')) return new Response(JSON.stringify({ scenario_id: 'success', frames: [{ frame: 3, time_s: 0, overview: { outcome: true } }] }));
      return new Response(JSON.stringify({ scenario_id: 'success', frames: [{ frame: 3, time_s: 0, local_view: { agent_id: 'I000' }, presentation: { label: 'simulated engagement' } }] }));
    });
    const loaded = await loadReplay('hit', fetcher);
    expect(fetcher).toHaveBeenCalledWith('/api/scenarios/success/replay?perspective=overview');
    expect(fetcher).toHaveBeenCalledWith('/api/scenarios/success/replay?perspective=local&observer_id=I000');
    expect(loaded.frames[0].event.event).toBe('NEUTRALIZED');
    expect(loaded.source).toBe('api');
  });

  it('ships an immutable naive replay derived from checked-in simulation evidence', () => {
    expect(naiveReplay.source).toBe('src/replays/naive.json');
    expect(naiveReplay.frames.some((frame) => frame.event.event === 'DUPLICATE PURSUIT')).toBe(true);
    expect(Object.isFrozen(naiveReplay.frames)).toBe(true);
    expect(() => naiveReplay.frames.push(naiveReplay.frames[0])).toThrow();
  });
});
