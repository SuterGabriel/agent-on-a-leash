// Turns a CSV purchase attempt into a live-shaped event (for offline replay and tests).
// Live IDs differ from source IDs, exactly like the real platform.
import type { DataPack, Row } from "./loaders";
import type { AuthorizationEvent, CartLine, HardRule, TriState, UncertaintyPolicy } from "./types";

const nullable = (v: string | undefined): string | null => (v === undefined || v === "" ? null : v);
const num = (v: string): number => Number(v);
const numOrNull = (v: string | undefined): number | null => (v === undefined || v === "" ? null : Number(v));

export const liveId = (sourceId: string, runId: string) => `live_${runId}_${sourceId}`;

export interface OfflineMandate {
  mandate_id: string;
  instruction: string;
  hard_rules: HardRule[];
  uncertainty_policy: UncertaintyPolicy;
}

export function buildEvent(
  pack: DataPack,
  attempt: Row,
  mandate: OfflineMandate,
  runId: string,
  now = new Date(),
): AuthorizationEvent {
  const m = pack.merchants.get(attempt.merchant_id);
  if (!m) throw new Error(`Unknown merchant ${attempt.merchant_id}`);
  const authority = pack.authorities.get(attempt.authority_id);

  const items: CartLine[] = (pack.attemptItems.get(attempt.authorization_id) ?? [])
    .sort((a, b) => num(a.line_no) - num(b.line_no))
    .map((r) => ({
      line_no: num(r.line_no),
      item_id: r.item_id,
      item_name: r.item_name,
      item_category: r.item_category,
      quantity: num(r.quantity),
      unit_price: num(r.unit_price),
      currency: r.currency,
      item_details: nullable(r.item_details),
    }));

  const related = nullable(attempt.related_authorization_id);

  return {
    type: "authorization.request",
    request_id: `req_${runId}_${attempt.authorization_id}`,
    deadline_at: new Date(now.getTime() + 8000).toISOString(), // fresh real-clock deadline
    authorization: {
      authorization_id: liveId(attempt.authorization_id, runId),
      source_authorization_id: attempt.authorization_id,
      scenario_id: attempt.scenario_id,
      replay_order: num(attempt.replay_order),
      mandate_id: mandate.mandate_id,
      profile_id: null,
      card_id: attempt.card_id,
      initiator_type: "agent",
      merchant: {
        merchant_id: m.merchant_id,
        merchant_name: m.merchant_name,
        merchant_category: m.merchant_category,
        merchant_mcc: m.merchant_mcc,
        merchant_country: m.merchant_country,
        merchant_city: m.merchant_city,
        availability: m.availability,
        recurring_capable: m.recurring_capable as "true" | "false",
      },
      timestamp: attempt.timestamp, // simulated time is preserved
      amount: num(attempt.amount),
      currency: attempt.currency,
      billing_amount_chf: num(attempt.billing_amount_chf),
      items_subtotal: num(attempt.items_subtotal),
      delivery_fee: num(attempt.delivery_fee),
      channel: attempt.channel,
      customer_device_id: nullable(attempt.customer_device_id),
      authority_status: attempt.authority_status,
      card_status_at_attempt: attempt.card_status_at_attempt,
      spend_in_period_before_chf: numOrNull(attempt.spend_in_period_before_chf),
      recent_attempt_count_10m: num(attempt.recent_attempt_count_10m),
      fulfillment_method: attempt.fulfillment_method,
      delivery_by: nullable(attempt.delivery_by),
      order_returnable: attempt.order_returnable as TriState,
      order_cancellable: attempt.order_cancellable as TriState,
      related_authorization_id: related ? liveId(related, runId) : null,
      related_authorization_status: nullable(attempt.related_authorization_status),
      purchase_description: attempt.purchase_description,
      items,
    },
    mandate: {
      mandate_id: mandate.mandate_id,
      status: "active",
      customer_id: authority?.customer_id ?? null,
      card_id: attempt.card_id,
      instruction: mandate.instruction,
      hard_rules: mandate.hard_rules,
      uncertainty_policy: mandate.uncertainty_policy,
      profile_id: null,
    },
    context: { approved_spend_in_period_chf: 0, recent_authorizations: [] },
    runtime: {
      received_at: now.toISOString(),
      history_window_minutes: 10,
      context_basis: "run_decisions_and_scenario_timestamps",
    },
  };
}
