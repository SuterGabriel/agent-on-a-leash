import type { VisecaApi } from "./viseca/api.js";
import type { DecisionStore, LeashBus, StoredDecision } from "./store.js";

export class AskError extends Error {
  constructor(
    readonly code: "not_found" | "not_waiting" | "expired",
    message: string,
  ) {
    super(message);
  }
}

/** The customer's answer to a step_up (S6). Goes to Viseca via /resolve, never as a second decision. */
export async function resolveAsk(
  api: VisecaApi,
  store: DecisionStore,
  bus: LeashBus,
  id: string,
  answer: "approve" | "decline",
): Promise<StoredDecision> {
  const d = store.get(id);
  if (!d) throw new AskError("not_found", `no decision ${id}`);
  if (d.status === "expired" || (d.human_deadline_at && Date.now() > Date.parse(d.human_deadline_at))) {
    throw new AskError("expired", "The time to answer is over. Nothing was bought.");
  }
  if (d.status !== "waiting_for_you") throw new AskError("not_waiting", `decision ${id} is ${d.status}`);

  await api.resolve(id, {
    decision: answer,
    customer_message: answer === "approve" ? "The customer confirmed this purchase." : "The customer declined this purchase.",
    evidence: [],
  });
  d.status = answer === "approve" ? "approved_by_you" : "declined_by_you";
  store.save(d);
  bus.emit("decision", d);
  return d;
}
