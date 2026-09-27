import threats from '../../configs/threats.json';

export interface ThreatType { id: string; title: string; speed_mps: number; size_m: number; detection_range_m: number; altitude_m: number[]; kill_radius_m: number }
export interface Formation { id: string; title: string }
export interface ForcePlan { screen_sections: number; reserve_sections: number; sections: number; shooters: number; observers: number; drones: number }
export interface ThreatSelection { threat_type: string; count: number; formation: string; seed: number }

export const THREAT_TYPES: readonly ThreatType[] = threats.threat_types;
export const FORMATIONS: readonly Formation[] = threats.formations;
export const SIZING = threats.sizing;
export const DEFAULT_THREAT: ThreatSelection = { threat_type: 'medium', count: 12, formation: 'wedge', seed: 7 };

// Same rule as airdnd.engagement.plan_force (both read configs/threats.json): one shooter
// per hostile in whole sections of 9 (+1 observer each), plus one reserve section per three.
export function planForce(hostiles: number): ForcePlan {
  const count = Math.max(1, Math.min(SIZING.max_hostiles, Math.round(hostiles)));
  const screen = Math.max(1, Math.ceil((count * SIZING.shooters_per_hostile) / SIZING.shooters_per_section));
  const reserve = Math.ceil(screen / SIZING.screen_sections_per_reserve_section);
  const sections = screen + reserve;
  const shooters = sections * SIZING.shooters_per_section;
  const observers = sections * SIZING.observers_per_section;
  return { screen_sections: screen, reserve_sections: reserve, sections, shooters, observers, drones: shooters + observers };
}

export interface SimulationRun {
  id: string;
  name: string;
  force_plan: ForcePlan;
  metrics: { neutralized: number; leaked: number; duplicate_pursuits: number; backups: number; friendly_collisions: number; minimum_separation_m: number };
}

export async function runSimulation(selection: ThreatSelection, fetcher: typeof fetch = fetch): Promise<SimulationRun> {
  const response = await fetcher('/api/simulations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...selection, method: 'airdnd' }),
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data && typeof data === 'object' ? (data as { detail?: unknown }).detail : undefined;
    throw new Error(typeof detail === 'string' ? detail : `Simulation request failed (${response.status})`);
  }
  return data as SimulationRun;
}
