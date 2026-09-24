// Types shared by the engine, the backend and the app.
// Shapes follow data/schemas/authorization_event.schema.json.

export type Decision = "approve" | "step_up" | "decline";
export type UncertaintyPolicy = "ask" | "decline" | "approve";
export type TriState = "true" | "false" | "unknown" | "not_applicable";

export interface Merchant {
  merchant_id: string;
  merchant_name: string;
  merchant_category: string;
  merchant_mcc: string;
  merchant_country: string;
  merchant_city: string;
  availability: string;
  recurring_capable: "true" | "false";
}

export interface CartLine {
  line_no: number;
  item_id: string;
  item_name: string;
  item_category: string;
  quantity: number;
  unit_price: number;
  currency: string;
  item_details: string | null; // UNTRUSTED shop text
}

export interface Authorization {
  authorization_id: string; // live ID
  source_authorization_id: string; // AU... row in the CSV
  scenario_id: string;
  replay_order: number;
  mandate_id: string;
  profile_id: string | null;
  card_id: string;
  initiator_type: string;
  merchant: Merchant;
  timestamp: string; // simulated time
  amount: number;
  currency: string;
  billing_amount_chf: number; // already includes delivery
  items_subtotal: number;
  delivery_fee: number;
  channel: string;
  customer_device_id: string | null;
  authority_status: string;
  card_status_at_attempt: string;
  spend_in_period_before_chf: number | null;
  recent_attempt_count_10m: number;
  fulfillment_method: string;
  delivery_by: string | null;
  order_returnable: TriState;
  order_cancellable: TriState;
  related_authorization_id: string | null;
  related_authorization_status: string | null;
  purchase_description: string;
  items: CartLine[];
}

export interface HardRule {
  field: string;
  operator: "<" | "<=" | "=" | "!=" | ">" | ">=" | "in" | "not_in";
  value: number | string | string[];
  currency?: "CHF" | "EUR" | "GBP" | "USD" | null;
  scope?: "purchase" | "period" | null;
  period_days?: number | null;
}

export interface Mandate {
  mandate_id: string;
  status: string;
  customer_id: string | null;
  card_id: string | null;
  instruction: string;
  hard_rules: HardRule[];
  uncertainty_policy: UncertaintyPolicy;
  profile_id: string | null;
}

export interface AuthorizationEvent {
  type: "authorization.request";
  request_id: string;
  deadline_at: string;
  authorization: Authorization;
  mandate: Mandate;
  context: { approved_spend_in_period_chf: number; recent_authorizations: unknown[] };
  runtime: { received_at: string; history_window_minutes: number; context_basis: string };
}

/** Our richer reading of the customer's instruction (internal policy). */
export interface Policy {
  instruction: string;
  perOrderLimitChf: number | null;
  periodLimit: { amountChf: number; days: number } | null;
  allowedCategories: string[] | null; // every basket line must be one of these
  requestedItem: { phrase: string; tokens: string[] } | null; // "road-running shoes"
  size: string | null; // "43"
  minReturnDays: number | null;
  requiredMerchantCategories: string[] | null; // "specialist sports retailer" -> sporting_goods
  familiarShopsOnly: boolean; // "shops I have used before"
  noExtras: boolean; // "do not add anything I did not ask for"
  sessionIntegrity: boolean; // "pause anything that looks like someone other than me"
  sessionAction: "stop" | "ask"; // three or more signals: "stop" declines, "ask" asks ("... stop and ask me")
  shopTextAction: "ask" | "decline"; // shop text that instructs the agent: "ask" (default) or "decline" (learned rule)
  lookalikeAction: "ask" | "decline"; // a lookalike the guard would only ask about: "ask" (default) or "decline" (learned rule)
  perUnitLimit: { amountChf: number; unit: string } | null; // "CHF 200 per night": compared with each line's unit price
  maxOrdersPerPeriod: { count: number; days: number } | null; // "one a day" -> { count: 1, days: 1 }
  allowedWeekdays: number[] | null; // Swiss local weekday, 0 = Sunday … 6 = Saturday
  blockedCategories: string[] | null; // "no gift cards" -> gift_card
  blockedKeywords: string[] | null; // "no alcohol" -> wine, beer, … (item name, category, clean shop text)
  refundableRequired: boolean; // "refundable rate only", "only if it can be returned"
  destinationCity: string | null; // "a hotel in Lyon" -> "Lyon" (compared with a lodging shop's city)
  stayNights: number | null; // "for 2 nights", or the nights between the stated dates
  stayDates: { from: string; to: string } | null; // "4 March to 7 March" -> { from: "03-04", to: "03-07" }
  oneItem: boolean; // "buy one grocery item": shown to the customer, not a hard rule
  forDelivery: boolean; // "for delivery": shown to the customer, not a hard rule
  /** The customer's words each field was read from (offsets into the instruction), keyed by Policy field name. */
  sources: Partial<Record<keyof Policy | "uncertainty", { text: string; start: number; end: number }>>;
  /** Open questions with a stable id (the app answers them by id). openQuestions holds the same texts. */
  questions: { id: string; text: string }[];
  uncertainty: UncertaintyPolicy;
  overshootTolerance: number; // 0.10 = a limit exceeded by <= 10 % asks instead of declining
  assumptions: string[];
  openQuestions: string[];
}

export interface Evidence {
  fact: string;
  value: number | string | null;
  comparator: string | null;
  threshold: number | string | null;
  source: string;
}
