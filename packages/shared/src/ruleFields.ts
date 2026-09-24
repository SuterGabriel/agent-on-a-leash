// Conventions between the compiler (backend) and the engine (Ara).
// Viseca stores hard_rules as {field, operator, value}; the field name is ours to define and the engine reads it.
// Every rule the customer confirmed travels with each purchase event as a hard_rule, so the engine never needs our store.
import type { BuiltInProtection } from "./leash.js";

/** Rule keys. A check the engine returns uses the same key, so the backend can attach the customer's words. */
export const RULE_KEYS = {
  order_limit: "order_limit",
  unit_limit: "unit_limit",
  period_budget: "period_budget",
  purpose: "purpose",
  delivery: "delivery",
  requested_item: "requested_item",
  item_size: "item_size",
  one_item: "one_item",
  known_shop: "known_shop",
  merchant_type: "merchant_type",
  return_window: "return_window",
  no_extras: "no_extras",
  session: "session",
  split_orders: "split_orders",
  blocked_shop: "blocked_shop",
  blocked_category: "blocked_category",
  /** "until Friday": kept in our store only, the engine cannot read a date rule (see valid_until on the leash). */
  valid_until: "valid_until",
} as const;

/**
 * hard_rule field names and what they mean. The engine (packages/backend/src/engine/leashEngine.ts, tighten())
 * reads exactly these; a rule it cannot read is never ignored, the purchase is asked instead.
 *
 * Read by the engine today:
 * authorization.billing_amount_chf  <=  N  scope "purchase"               order_limit: total incl. delivery
 * authorization.billing_amount_chf  <=  N  scope "period", period_days D  period_budget: rolling window, approved only
 * items.unit_price_chf              <=  N                                  unit_limit: "CHF 200 per night", each line's unit price
 * items.item_category               in      [..]                           purpose: every basket line must match
 * items.requested_item              =       "road-running shoes"           requested_item
 * items.size                        =       "43"                           item_size: from item_details
 * merchant.merchant_category        in      ["sporting_goods"]             merchant_type
 * order.return_window_days          >=      14                             return_window: unknown = unsure
 * merchant.familiar_on_card         =       "true"                         known_shop
 * order.addons_allowed              =       "false"                        no_extras
 * session.integrity                 =       "required"                     session
 *
 * Written by tighten / learned rules, NOT read by the engine yet (would make every purchase an ask):
 * items.item_category               not_in  [..]                           blocked_category
 * merchant.merchant_id              not_in  [..]                           blocked_shop
 * merchant.text_instructions        =       "decline"                      learned
 * merchant.lookalike                =       "decline"                      learned (the lookalike guard already declines)
 * session.new_device_at_night       =       "decline"                      learned
 * orders.combine_within_minutes     =       10                             learned (the split-order guard is always on)
 *
 * Shown to the customer but not sent as hard_rules (the engine's guards cover them): one_item, delivery, split_orders.
 */
export const RULE_FIELDS = {
  amount: "authorization.billing_amount_chf",
  unitPrice: "items.unit_price_chf",
  itemCategory: "items.item_category",
  fulfillment: "authorization.fulfillment_method",
  requestedItem: "items.requested_item",
  size: "items.size",
  lineCount: "items.line_count",
  familiarOnCard: "merchant.familiar_on_card",
  merchantCategory: "merchant.merchant_category",
  returnWindow: "order.return_window_days",
  addonsAllowed: "order.addons_allowed",
  sessionIntegrity: "session.integrity",
  combineWithin: "orders.combine_within_minutes",
  merchantId: "merchant.merchant_id",
  shopTextInstructions: "merchant.text_instructions",
  lookalike: "merchant.lookalike",
  newDeviceAtNight: "session.new_device_at_night",
} as const;

/** "field operator" pairs the engine can read. Anything else would make every purchase an ask. */
export const ENGINE_READABLE_RULES = new Set([
  "authorization.billing_amount_chf <=",
  "items.unit_price_chf <=",
  "items.item_category in",
  "items.requested_item =",
  "items.size =",
  "merchant.merchant_category in",
  "order.return_window_days >=",
  "merchant.familiar_on_card =",
  "order.addons_allowed =",
  "session.integrity =",
  "merchant.text_instructions =",
]);

/** Always on for every leash. The engine reports them as checks with source "built_in". */
export const BUILT_IN_PROTECTIONS: BuiltInProtection[] = [
  { key: "shop_text", label: "Shop text can't change your rules", explanation: "If a shop's text gives our system orders, we quote it and ignore it." },
  { key: "duplicate", label: "No duplicate orders", explanation: "The same basket from the same shop twice is stopped or asked about." },
  { key: "lookalike", label: "No lookalike shops", explanation: "A shop whose name imitates one you know is not treated as that shop." },
  { key: "session", label: "It has to look like you", explanation: "A new phone, odd hours or a burst of orders makes us ask first." },
];
