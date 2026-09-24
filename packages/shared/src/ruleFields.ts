// Conventions between the compiler (backend) and the engine (Ara).
// Viseca stores hard_rules as {field, operator, value}; the field name is ours to define and the engine reads it.
// Every rule the customer confirmed travels with each purchase event as a hard_rule, so the engine never needs our store.
import type { BuiltInProtection } from "./leash.js";

/** Rule keys. A check the engine returns uses the same key, so the backend can attach the customer's words. */
export const RULE_KEYS = {
  order_limit: "order_limit",
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
} as const;

/**
 * hard_rule field names and what they mean (engine contract):
 *
 * authorization.billing_amount_chf  <=  N  scope "purchase"               order_limit: total incl. delivery
 * authorization.billing_amount_chf  <=  N  scope "period", period_days D  period_budget: rolling window, approved only
 * items.item_category               in      [..]                           purpose: every basket line must match
 * items.item_category               not_in  [..]                           blocked_category
 * authorization.fulfillment_method  =       "delivery"                     delivery
 * items.requested                   =       "road-running shoes"           requested_item: every line is this item
 * items.size                        =       "43"                           item_size: from item_details
 * items.line_count                  <=      1                              one_item
 * merchant.familiarity              in      ["used_on_this_card", ...]     known_shop; "used_on_other_card" only if the customer said yes
 * merchant.merchant_category        in      ["sporting_goods"]             merchant_type
 * items.return_window_days          >=      14                             return_window: from item_details; unknown = unsure
 * items.extras                      =       "none"                         no_extras: nothing beyond what was asked
 * session.driver                    =       "cardholder"                   session: pause if someone else seems to drive
 * orders.combine_within_minutes     =       10                             split_orders: orders this close count as one
 * merchant.merchant_id              not_in  [..]                           blocked_shop
 * merchant.text_instructions        =       "decline"                      learned: decline when shop text gives orders
 * merchant.lookalike                =       "decline"                      learned: block lookalikes of known shops
 * session.new_device_at_night       =       "decline"                      learned
 */
export const RULE_FIELDS = {
  amount: "authorization.billing_amount_chf",
  itemCategory: "items.item_category",
  fulfillment: "authorization.fulfillment_method",
  requestedItem: "items.requested",
  size: "items.size",
  lineCount: "items.line_count",
  familiarity: "merchant.familiarity",
  merchantCategory: "merchant.merchant_category",
  returnWindow: "items.return_window_days",
  extras: "items.extras",
  sessionDriver: "session.driver",
  combineWithin: "orders.combine_within_minutes",
  merchantId: "merchant.merchant_id",
  shopTextInstructions: "merchant.text_instructions",
  lookalike: "merchant.lookalike",
  newDeviceAtNight: "session.new_device_at_night",
} as const;

/** Always on for every leash. The engine reports them as checks with source "built_in". */
export const BUILT_IN_PROTECTIONS: BuiltInProtection[] = [
  { key: "shop_text", label: "Shop text can't change your rules", explanation: "If a shop's text gives our system orders, we quote it and ignore it." },
  { key: "duplicate", label: "No duplicate orders", explanation: "The same basket from the same shop twice is stopped or asked about." },
  { key: "lookalike", label: "No lookalike shops", explanation: "A shop whose name imitates one you know is not treated as that shop." },
  { key: "session", label: "It has to look like you", explanation: "A new phone, odd hours or a burst of orders makes us ask first." },
];
