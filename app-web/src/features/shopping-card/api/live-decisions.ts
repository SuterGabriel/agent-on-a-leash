// Live mode: decisions that arrived from the backend (feed and stream), by id.
// The screens look a decision up with `getDecision(id)` (demo-data.ts); in live mode that lookup checks here first,
// so a row from the engine opens with the engine's checks, not with the mock's proposed answer of the same id.
import type { Decision } from "@/types/decision";

const live = new Map<string, Decision>();

export const registerLiveDecision = (d: Decision) => {
    live.set(d.id, d);
};

export const liveDecision = (id: string): Decision | undefined => live.get(id);

export const clearLiveDecisions = () => live.clear();
