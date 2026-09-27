import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { THEATRE, localHeadingToWorld, localToGeo, worldHeadingToLocal } from './theatre';
import { planForce } from './threats';
import { assembleReplay, replayAt, replaySwarmAt, type ApiReplay } from './worldview';

vi.mock('./CesiumField', () => ({ default: () => null }));

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('Marina East theatre mapping', () => {
  it('puts the launch pads on the Marina East field and +y out to sea along the threat bearing', () => {
    const pads = localToGeo([...THEATRE.origin_local_m, 0]);
    expect(pads.lat).toBeCloseTo(THEATRE.origin.lat, 9);
    expect(pads.lon).toBeCloseTo(THEATRE.origin.lon, 9);
    const seaward = localToGeo([THEATRE.origin_local_m[0], THEATRE.origin_local_m[1] + 1000, 0]);
    const bearing = (Math.atan2(seaward.lon - pads.lon, (seaward.lat - pads.lat) / Math.cos((pads.lat * Math.PI) / 180)) * 180) / Math.PI;
    expect((bearing + 360) % 360).toBeCloseTo(THEATRE.threat_bearing_deg, 0);
    expect(seaward.lat).toBeLessThan(pads.lat); // the strait is to the south
    expect(worldHeadingToLocal(localHeadingToWorld(0.3))).toBeCloseTo(0.3, 9);
  });
});

describe('intercept engine replays', () => {
  const init = {
    frame: 0, time_s: 0, event_kind: 'swarm_initialized',
    overview: {
      interceptors: [
        { interceptor_id: 'I000', callsign: 'A1-1-1', platoon: 'A1', section: 'A1-1', role: 'shooter', phase: 'initial', position: [0, -700, 2], cell: [0, 0, 150] },
        { interceptor_id: 'I001', callsign: 'A1-1-2', platoon: 'A1', section: 'A1-1', role: 'shooter', phase: 'initial', position: [40, -700, 2], cell: [20, 0, 150] },
        { interceptor_id: 'I009', callsign: 'A1-1-OBS', platoon: 'A1', section: 'A1-1', role: 'observer', phase: 'initial', position: [120, -660, 2], cell: [20, 20, 210] },
      ],
      hostiles: [{ hostile_id: 'H000', position: [450, 3200, 150], wave: 0 }],
    },
  };
  const frames: ApiReplay['frames'] = [
    init,
    { frame: 1, time_s: 30, event_kind: 'swarm_step', overview: { positions: { I000: [0, 0, 150], I001: [20, 0, 150], I009: [20, 20, 210] }, hostiles: { H000: [300, 1500, 150] }, states: { I000: 'station', I001: 'station', I009: 'station' }, targets: {} } },
    { frame: 2, time_s: 30.1, event_kind: 'policy_decision', overview: { hostile_id: 'H000', interceptor_id: 'I000' } },
    { frame: 3, time_s: 31, event_kind: 'swarm_step', overview: { positions: { I000: [40, 60, 150], I001: [20, 0, 150], I009: [20, 20, 210] }, hostiles: { H000: [290, 1450, 150] }, states: { I000: 'committed', I001: 'station', I009: 'station' }, targets: { I000: 'H000' } } },
    { frame: 4, time_s: 50, event_kind: 'neutralized', overview: { hostile_id: 'H000', interceptor_id: 'I000', contact_point: [200, 800, 150], miss_distance_m: 0.6, kill_radius_m: 2 } },
    { frame: 5, time_s: 50.5, event_kind: 'swarm_step', overview: { positions: { I001: [20, 0, 150], I009: [20, 20, 210] }, hostiles: {}, states: { I001: 'station', I009: 'station' }, targets: {} } },
  ];
  const replay = assembleReplay({ scenario_id: 'sim-x', frames }, { scenario_id: 'sim-x', frames: [] });

  it('reads the 9+1 roster and shows the observer above its section', () => {
    expect(replay.roster.find((drone) => drone.id === 'I009')).toMatchObject({ role: 'observer', callsign: 'A1-1-OBS' });
    expect(replaySwarmAt(replay, 1)!.drones.I009.status).toBe('observing');
    expect(replaySwarmAt(replay, 0)!.drones.I000.status).toBe('pad');
  });

  it('draws exactly one engagement line per hostile and frames the area under attack', () => {
    const attack = replaySwarmAt(replay, 3)!;
    expect(attack.links).toEqual([{ interceptorId: 'I000', hostileId: 'H000', active: true }]);
    expect(attack.focus).toEqual({ kind: 'drone', id: 'I000', toward: 'H000' });
    expect(attack.hostiles.H000.position).toEqual([290, 1450, 150]);
  });

  it('ends both drones at the contact point when the interceptor hits', () => {
    const hit = replaySwarmAt(replay, 5)!;
    expect(hit.drones.I000).toMatchObject({ status: 'expended', position: [200, 800, 150] });
    expect(hit.hostiles.H000).toMatchObject({ status: 'neutralized', position: [200, 800, 150] });
    expect(hit.links).toEqual([]);
    expect(replayAt(replay, 5).event.event).toBe('NEUTRALIZED'); // flight samples keep the last real event
  });
});

describe('threat builder', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('sizes the force from the incoming threat and launches a simulation run', async () => {
    window.history.pushState({}, '', '/');
    const calls: string[] = [];
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url === '/api/simulations') return jsonResponse({ id: 'sim-abc', name: '20 x Large fixed-wing · cluster', force_plan: planForce(20), metrics: { neutralized: 18, leaked: 2, duplicate_pursuits: 1, backups: 3, friendly_collisions: 0, minimum_separation_m: 10 } }, 201);
      return jsonResponse({ scenario_id: 'x', frames: [] });
    });
    render(<App />);
    expect(screen.getByTestId('force-plan')).toHaveTextContent('ACTIVATE 3 SECTIONS');
    fireEvent.change(screen.getByTestId('threat-type'), { target: { value: 'large' } });
    expect(screen.getByTestId('threat-spec')).toHaveTextContent('42 m/s · 180–300 m altitude · seen at 3.0 km · kill radius 3 m');
    fireEvent.change(screen.getByTestId('threat-formation'), { target: { value: 'cluster' } });
    fireEvent.change(screen.getByTestId('threat-count'), { target: { value: '20' } });
    fireEvent.change(screen.getByTestId('threat-seed'), { target: { value: '11' } });
    expect(screen.getByTestId('force-plan')).toHaveTextContent('ACTIVATE 4 SECTIONS');
    expect(screen.getByTestId('force-plan')).toHaveTextContent('36 shooters + 4 observers');
    fireEvent.click(screen.getByTestId('threat-launch'));
    expect(await screen.findByTestId('run-brief')).toHaveTextContent('18 intercepted · 2 leaked');
    const post = (window.fetch as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls.find(([url]) => url === '/api/simulations')!;
    expect(JSON.parse(String(post[1].body))).toEqual({ threat_type: 'large', count: 20, formation: 'cluster', seed: 11, method: 'airdnd' });
    await waitFor(() => expect(calls).toContain('GET /api/scenarios/sim-abc/replay?perspective=locals'));
  });
});
