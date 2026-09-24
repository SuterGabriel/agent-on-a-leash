import type { DataPack, Row } from "./dataPack.js";
import type { Authorization, AuthorizationEvent, CartItem, Currency, EventMandate, Merchant, RecentAuthorization } from "./event.js";

const orNull = (v: string | undefined): string | null => (v === undefined || v === "" ? null : v);
const num = (v: string | undefined): number => {
  if (v === undefined || v === "") throw new Error("buildEvent: required number is empty");
  return Number(v);
};

export function merchantFromRow(r: Row): Merchant {
  return {
    merchant_id: r.merchant_id as string,
    merchant_name: r.merchant_name as string,
    merchant_category: r.merchant_category as string,
    merchant_mcc: r.merchant_mcc as string,
    merchant_country: r.merchant_country as string,
    merchant_city: r.merchant_city as string,
    availability: r.availability as Merchant["availability"],
    recurring_capable: r.recurring_capable as Merchant["recurring_capable"],
  };
}

function itemFromRow(r: Row): CartItem {
  return {
    line_no: num(r.line_no),
    item_id: r.item_id as string,
    item_name: r.item_name as string,
    item_category: r.item_category as string,
    quantity: num(r.quantity),
    unit_price: num(r.unit_price),
    currency: r.currency as Currency,
    item_details: r.item_details ?? "",
  };
}

export interface BuildEventOptions {
  liveAuthorizationId: string;
  requestId: string;
  mandate: EventMandate;
  /** Live ID of the related purchase in this run (the platform rewrites AU ids). */
  relatedLiveId: string | null;
  context: { approved_spend_in_period_chf: number | null; recent_authorizations: RecentAuthorization[] };
  receivedAt: string;
  deadlineAt: string;
  historyWindowMinutes?: number;
}

/** Turns one purchase_attempts.csv row plus its cart lines and merchant into a live-shaped event. */
export function buildEvent(pack: DataPack, attempt: Row, opts: BuildEventOptions): AuthorizationEvent {
  const auId = attempt.authorization_id as string;
  const merchantRow = pack.merchants.get(attempt.merchant_id as string);
  if (!merchantRow) throw new Error(`buildEvent: merchant ${attempt.merchant_id} not found`);
  const lines = pack.attemptItems.get(auId) ?? [];
  if (lines.length === 0) throw new Error(`buildEvent: no cart lines for ${auId}`);

  const authorization: Authorization = {
    authorization_id: opts.liveAuthorizationId,
    source_authorization_id: auId,
    scenario_id: attempt.scenario_id as string,
    replay_order: num(attempt.replay_order),
    mandate_id: opts.mandate.mandate_id,
    profile_id: opts.mandate.profile_id,
    card_id: attempt.card_id as string,
    initiator_type: "agent",
    merchant: merchantFromRow(merchantRow),
    timestamp: attempt.timestamp as string,
    amount: num(attempt.amount),
    currency: attempt.currency as Currency,
    billing_amount_chf: num(attempt.billing_amount_chf),
    items_subtotal: num(attempt.items_subtotal),
    delivery_fee: num(attempt.delivery_fee),
    channel: attempt.channel as Authorization["channel"],
    customer_device_id: attempt.customer_device_id ?? "",
    authority_status: attempt.authority_status as Authorization["authority_status"],
    card_status_at_attempt: attempt.card_status_at_attempt as Authorization["card_status_at_attempt"],
    spend_in_period_before_chf: orNull(attempt.spend_in_period_before_chf) === null ? null : Number(attempt.spend_in_period_before_chf),
    recent_attempt_count_10m: num(attempt.recent_attempt_count_10m),
    fulfillment_method: attempt.fulfillment_method as string,
    delivery_by: orNull(attempt.delivery_by),
    order_returnable: attempt.order_returnable as Authorization["order_returnable"],
    order_cancellable: attempt.order_cancellable as Authorization["order_cancellable"],
    related_authorization_id: opts.relatedLiveId,
    related_authorization_status: orNull(attempt.related_authorization_status) as Authorization["related_authorization_status"],
    purchase_description: attempt.purchase_description as string,
    items: lines.map(itemFromRow),
  };

  return {
    type: "authorization.request",
    request_id: opts.requestId,
    deadline_at: opts.deadlineAt,
    authorization,
    mandate: opts.mandate,
    context: opts.context,
    runtime: {
      received_at: opts.receivedAt,
      history_window_minutes: opts.historyWindowMinutes ?? 10,
      context_basis: "run_decisions_and_scenario_timestamps",
    },
  };
}
