// Dev 1's engine (packages/engine) behind the worker's Engine port. The engine is used as written; this file only
//   - builds its inputs: the policy (instruction + the stricter of the two mandates), one ledger per run, card baselines;
//   - keeps each run's ledger in step with the customer's answers (from the bus);
//   - turns its DecisionResult into the EngineVerdict the backend and the app use.
import type {
  AuthorizationEvent,
  Check,
  CheckResult,
  CheckSource,
  EngineDecisionValue,
  EngineVerdict,
  EventMandate,
  MandateRule,
  UncertaintyPolicy,
} from "@leash/shared";
import { decide, ENGINE_VERSION } from "../../../engine/src/decide.js";
import { Ledger } from "../../../engine/src/ledger.js";
import type { DecisionResult, GuardResult } from "../../../engine/src/types.js";
import { buildBaselines, type Baselines } from "../../../shared/src/baselines.js";
import { compilePolicy, itemTokens, WEEKDAYS } from "../../../shared/src/compiler.js";
import { loadDataPack } from "../../../shared/src/loaders.js";
import type { AuthorizationEvent as EngineEvent, Evidence, Policy } from "../../../shared/src/types.js";
import type { LeashBus } from "../store.js";
import type { Engine, EngineContext } from "./port.js";

// ---------- Policy: the stricter of the frozen and the current mandate ----------

const UNCERTAINTY_RANK: Record<UncertaintyPolicy, number> = { approve: 0, ask: 1, decline: 2 };

export interface MandatePolicy {
  policy: Policy;
  /** Hard rules the engine's policy cannot express. They are never ignored silently: the purchase is asked. */
  notApplied: string[];
  /** Status of whichever mandate is revoked or expired, else null. */
  inactive: EventMandate["status"] | null;
}

/**
 * The instruction read by the one compiler, then tightened by every hard rule of the frozen snapshot and of the
 * current mandate. Rules only ever tighten, so the result is at least as strict as each mandate on its own.
 */
export function policyFor(snapshot: EventMandate, current: EventMandate | null): MandatePolicy {
  const policy = compilePolicy(snapshot.instruction);
  const notApplied = new Set<string>();
  let inactive: MandatePolicy["inactive"] = null;
  for (const m of current ? [snapshot, current] : [snapshot]) {
    for (const rule of m.hard_rules) if (!tighten(policy, rule)) notApplied.add(describeRule(rule));
    if ((UNCERTAINTY_RANK[m.uncertainty_policy] ?? 0) > UNCERTAINTY_RANK[policy.uncertainty]) policy.uncertainty = m.uncertainty_policy;
    if (m.status === "revoked" || m.status === "expired") inactive = m.status;
  }
  return { policy, notApplied: [...notApplied], inactive };
}

const intersect = (a: string[] | null, b: string[]) => (a ? a.filter((x) => b.includes(x)) : [...b]);

/** Applies one hard rule (field names as toHardRules() writes them). Returns false when the rule cannot be expressed. */
function tighten(p: Policy, r: MandateRule): boolean {
  const num = typeof r.value === "number" ? r.value : null;
  const str = typeof r.value === "string" ? r.value : null;
  const list = Array.isArray(r.value) ? r.value : null;
  switch (`${r.field} ${r.operator}`) {
    case "authorization.billing_amount_chf <=":
      if (num === null || (r.currency && r.currency !== "CHF")) return false;
      if (r.scope === "period") {
        if (!r.period_days) return false;
        // The policy holds one period limit. Two different ones merge into one stricter than both:
        // the smaller amount over the longer window.
        p.periodLimit = p.periodLimit
          ? { amountChf: Math.min(p.periodLimit.amountChf, num), days: Math.max(p.periodLimit.days, r.period_days) }
          : { amountChf: num, days: r.period_days };
        return true;
      }
      p.perOrderLimitChf = p.perOrderLimitChf === null ? num : Math.min(p.perOrderLimitChf, num);
      return true;
    case "items.item_category in":
      if (!list) return false;
      p.allowedCategories = intersect(p.allowedCategories, list);
      return true;
    case "merchant.merchant_category in":
      if (!list) return false;
      p.requiredMerchantCategories = intersect(p.requiredMerchantCategories, list);
      return true;
    case "order.return_window_days >=":
      if (num === null) return false;
      p.minReturnDays = Math.max(p.minReturnDays ?? 0, num);
      return true;
    case "items.requested_item =":
      if (str === null) return false;
      p.requestedItem ??= { phrase: str, tokens: itemTokens(str) };
      return p.requestedItem.phrase === str; // a second, different item cannot be expressed
    case "items.size =":
      if (str === null) return false;
      p.size ??= str;
      return p.size === str;
    case "merchant.familiar_on_card =":
      if (str !== "true") return false;
      p.familiarShopsOnly = true;
      return true;
    case "order.addons_allowed =":
      if (str !== "false") return false;
      p.noExtras = true;
      return true;
    case "session.integrity =":
      if (str !== "required") return false;
      p.sessionIntegrity = true;
      return true;
    case "items.unit_price_chf <=":
      if (num === null || (r.currency && r.currency !== "CHF")) return false;
      p.perUnitLimit = { amountChf: Math.min(p.perUnitLimit?.amountChf ?? num, num), unit: p.perUnitLimit?.unit ?? "item" };
      return true;
    case "orders.count <=":
      if (num === null || !r.period_days) return false;
      // Same merge as the period budget: the smaller count over the longer window is stricter than both.
      p.maxOrdersPerPeriod = p.maxOrdersPerPeriod
        ? { count: Math.min(p.maxOrdersPerPeriod.count, num), days: Math.max(p.maxOrdersPerPeriod.days, r.period_days) }
        : { count: num, days: r.period_days };
      return true;
    case "authorization.weekday in": {
      const days = list?.map((d) => WEEKDAYS.indexOf(d)).filter((d) => d >= 0);
      if (!days || days.length !== list?.length) return false;
      p.allowedWeekdays = p.allowedWeekdays ? p.allowedWeekdays.filter((d) => days.includes(d)) : days;
      return true;
    }
    case "items.item_category not_in":
      if (!list) return false;
      p.blockedCategories = [...new Set([...(p.blockedCategories ?? []), ...list])];
      return true;
    case "items.keywords not_in":
      if (!list) return false;
      p.blockedKeywords = [...new Set([...(p.blockedKeywords ?? []), ...list])];
      return true;
    case "order.refundable =":
      if (str !== "true") return false;
      p.refundableRequired = true;
      return true;
    default:
      return false;
  }
}

const describeRule = (r: MandateRule) => `${r.field} ${r.operator} ${JSON.stringify(r.value)}`;

// ---------- Output: DecisionResult → EngineVerdict ----------

const HEADLINES: Record<string, string> = {
  all_checks_passed: "Fits all your rules",
  over_order_limit: "Above your per-order limit",
  over_period_budget: "Over your spending budget",
  possible_split_order: "Looks like a split order",
  item_outside_purpose: "Item outside what you allowed",
  wrong_item: "Not the item you asked for",
  wrong_size: "Not the size you asked for",
  unrequested_addon: "Extra you did not ask for",
  final_sale: "This order cannot be returned",
  returns_too_short: "Return window too short",
  missing_info: "Some details are missing",
  shop_type_mismatch: "Not the type of shop",
  new_shop: "Not a shop you know",
  shop_used_other_card: "Shop known from your other card",
  lookalike_shop: "Shop name looks like a copy",
  duplicate_order: "Looks like a duplicate order",
  session_not_you: "This does not look like you",
  shop_text_manipulation: "Shop text tried to instruct us",
  requote_after_decline: "Same order after a decline",
  over_unit_limit: "Above your per-item limit",
  too_many_orders: "Too many orders for the period",
  not_allowed_day: "Not on a day you allowed",
  blocked_item: "Something you excluded",
  not_refundable: "Not refundable",
  no_shop_history: "No history to check the shop",
  over_card_limit: "Above your card's limit",
  guard_error: "Please check this purchase",
};
const FALLBACK_HEADLINE: Record<EngineDecisionValue, string> = {
  approve: "Fits all your rules",
  step_up: "Please check this purchase",
  decline: "Blocked by your rules",
};

/** Guard → what the app shows. "you" = a rule from the customer's instruction; "built_in" = a protection we always run. */
const CHECKS: Record<string, { label: string; source: CheckSource }> = {
  per_order_limit: { label: "Per-order limit", source: "you" },
  period_budget: { label: "Spending budget over time", source: "you" },
  split_order: { label: "No orders split to stay under the limit", source: "built_in" },
  item_scope: { label: "Only the categories you allowed", source: "you" },
  requested_item: { label: "Only the item you asked for", source: "you" },
  addon: { label: "No extras you did not ask for", source: "you" },
  return_terms: { label: "Return policy", source: "you" },
  merchant_type: { label: "Type of shop", source: "you" },
  familiarity: { label: "Only shops you have used", source: "you" },
  lookalike: { label: "Real shop, not a lookalike", source: "built_in" },
  duplicate: { label: "No duplicate orders", source: "built_in" },
  session: { label: "Looks like you", source: "you" },
  shop_text: { label: "Shop text is never obeyed", source: "built_in" },
  requote: { label: "No new price after a decline", source: "built_in" },
  per_unit_limit: { label: "Price per item, night or unit", source: "you" },
  order_frequency: { label: "How many orders per period", source: "you" },
  weekday: { label: "Days you allowed", source: "you" },
  blocked: { label: "Things you excluded", source: "you" },
  refundable: { label: "Refundable only", source: "you" },
  issuer_limits: { label: "Card limit per purchase", source: "built_in" },
};

function checkResult(g: GuardResult): CheckResult {
  if (g.verdict === "PASS") return "pass";
  if (g.verdict === "UNCERTAIN" || g.reason_code === "guard_error") return "unsure";
  return "fail";
}

const formatEvidence = (e: Evidence) => (e.comparator ? `${e.fact} ${e.value} (${e.comparator} ${e.threshold})` : `${e.fact} ${e.value}`);

function toCheck(g: GuardResult): Check {
  const meta = CHECKS[g.guard];
  return {
    key: g.guard,
    label: meta?.label ?? g.guard,
    your_words: null, // filled by the backend from the rules store (Step 4)
    source: meta?.source ?? "built_in",
    result: checkResult(g),
    fact: g.evidence.length ? g.evidence.map(formatEvidence).join("; ") : (g.message ?? null),
  };
}

export function toVerdict(r: DecisionResult): EngineVerdict {
  const lead = r.reason_codes[0];
  return {
    decision: r.decision,
    reason_codes: r.reason_codes,
    headline: (lead && HEADLINES[lead]) || FALLBACK_HEADLINE[r.decision],
    because: r.customer_message,
    checks: r.guards.filter((g) => g.verdict !== "SKIP").map(toCheck),
    uncertainty: r.guards.filter((g) => g.verdict === "UNCERTAIN").map((g) => g.message ?? g.reason_code ?? g.guard),
    shop_text_quarantine: r.flagged_shop_text.length ? r.flagged_shop_text.join(" | ") : null,
    engine_version: r.engine_version,
  };
}

/** A rule we could not express must not be ignored: at least ask. */
function askForRulesNotApplied(v: EngineVerdict, notApplied: string[]): EngineVerdict {
  const fact = notApplied.join("; ");
  const check: Check = { key: "rule_not_applied", label: "Rules we could not check", your_words: null, source: "you", result: "unsure", fact };
  const out: EngineVerdict = { ...v, checks: [...v.checks, check], uncertainty: [...v.uncertainty, `rules not checked: ${fact}`] };
  if (v.decision === "approve") {
    out.decision = "step_up";
    out.reason_codes = ["rule_not_applied"];
    out.headline = "Please check this purchase";
    out.because = `Your leash has a rule we cannot check yet (${fact}), so we ask you.`;
  } else {
    out.reason_codes = [...v.reason_codes, "rule_not_applied"];
  }
  return out;
}

function inactiveVerdict(status: string): EngineVerdict {
  return {
    decision: "decline",
    reason_codes: ["mandate_inactive"],
    headline: "Your leash is no longer active",
    because: `This leash is ${status}, so the agent may not buy anything with it.`,
    checks: [{ key: "leash_active", label: "Leash is active", your_words: null, source: "you", result: "fail", fact: `mandate status ${status}` }],
    uncertainty: [],
    shop_text_quarantine: null,
    engine_version: ENGINE_VERSION,
  };
}

// ---------- The port ----------

export class LeashEngine implements Engine {
  readonly version = ENGINE_VERSION;
  private readonly baselines: Baselines;
  private readonly ledgers = new Map<string, Ledger>();

  /**
   * Pass the bus so the customer's answers reach the run's ledger. Pass baselines built from the live pack's history
   * in live mode; without them, the local data pack (data/) is used.
   */
  constructor(bus?: LeashBus, baselines?: Baselines) {
    // Card history is loaded once here, not inside a decision.
    if (baselines) this.baselines = baselines;
    else {
      const pack = loadDataPack();
      this.baselines = buildBaselines(pack.history, pack.merchants, { cards: pack.cards.values(), accounts: pack.accounts.values() });
    }
    if (bus) this.follow(bus);
  }

  private ledgerFor(runId: string): Ledger {
    let ledger = this.ledgers.get(runId);
    if (!ledger) {
      ledger = new Ledger();
      this.ledgers.set(runId, ledger);
    }
    return ledger;
  }

  /** An approved ask counts as spend in this run; a declined or expired one does not. */
  follow(bus: LeashBus) {
    bus.on("decision", (d) => {
      if (d.status === "approved_by_you") this.ledgers.get(d.run_id)?.resolve(d.id, "approve");
      else if (d.status === "declined_by_you") this.ledgers.get(d.run_id)?.resolve(d.id, "decline");
    });
    bus.on("ask_expired", (d) => this.ledgers.get(d.run_id)?.expire(d.id));
  }

  decide(event: AuthorizationEvent, ctx: EngineContext): EngineVerdict {
    const { policy, notApplied, inactive } = policyFor(event.mandate, ctx.currentMandate);
    if (inactive) return inactiveVerdict(inactive);

    const ledger = this.ledgerFor(ctx.runId);
    // Same event shape. The two type files differ only in `context` (spend may be null live), which the engine never reads.
    const result = decide(event as unknown as EngineEvent, policy, ledger, this.baselines);
    const verdict = toVerdict(result);
    if (!notApplied.length) return verdict;

    const asked = askForRulesNotApplied(verdict, notApplied);
    // Keep the ledger in step with what we answer: an ask is not spend until the customer says yes.
    const entry = ledger.get(result.authorization_id);
    if (entry && asked.decision === "step_up" && entry.final_status === "approved") entry.final_status = "pending";
    return asked;
  }
}
