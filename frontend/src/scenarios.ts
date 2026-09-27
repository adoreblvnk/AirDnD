import catalogue from '../../configs/scenarios.json';

// One id per scenario, shared with the simulator (FIXED_REPLAYS), the replay file name, the
// API route and the button test id `replay-<id>`. Titles are defined once in
// configs/scenarios.json so the UI, API and tests cannot drift apart.
export type ScenarioId = string;

export interface ScenarioInfo {
  id: ScenarioId;
  title: string;
  force: string;
  summary: string;
  spec: string;
}

export const SCENARIOS: readonly ScenarioInfo[] = Object.freeze(catalogue.scenarios.map((entry) => Object.freeze({ ...entry })));
export const DEFAULT_SCENARIO: ScenarioId = 'miss_recovery';

export function scenarioInfo(id: ScenarioId): ScenarioInfo | undefined {
  return SCENARIOS.find((entry) => entry.id === id);
}
