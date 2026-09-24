import type { VisecaApi } from "./viseca/api.js";
import type { DecisionStore, LeashBus, StoredDecision } from "./store.js";

export class AskError extends Error {
  constructor(
    readonly code: "not_found" | "not_waiting" | "expired" | "busy",
    message: string,
  ) {
    super(message);
  }
}

/**
 * Asks whose answer is on its way to Viseca. Claimed synchronously before the first await, so a double tap
 * (or app and voice at once) can't send two answers: Node's single thread makes check-and-claim atomic,
 * the same job SELECT … FOR UPDATE does in a database.
 */
const resolving = new Set<string>();

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
  if (resolving.has(id)) throw new AskError("busy", "Your answer to this purchase is already on its way.");

  resolving.add(id);
  try {
    await api.resolve(id, {
      decision: answer,
      customer_message: answer === "approve" ? "The customer confirmed this purchase." : "The customer declined this purchase.",
      evidence: [],
    });
  } finally {
    // On failure the ask stays waiting, so the customer can try again.
    resolving.delete(id);
  }
  d.status = answer === "approve" ? "approved_by_you" : "declined_by_you";
  store.save(d);
  bus.emit("decision", d);
  return d;
}
