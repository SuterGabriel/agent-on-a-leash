import { randomBytes } from "node:crypto";
import type { ChargeResult, DecisionToken, TokenEvent } from "@leash/shared";

// Stands in for the issuer's token service. Our rules decide; the token enforces the decision:
// a fooled agent can't spend more, somewhere else, later, or twice.

export const TOKEN_TOLERANCE = 0.05; // rounding room, but never above the customer's own limits
export const TOKEN_TTL_MS = 15 * 60 * 1000;

const round2 = (n: number) => Math.round(n * 100) / 100;
const chf = (n: number) => `CHF ${n.toFixed(2)}`;

export interface IssueInput {
  decision_id: string;
  merchant_id: string;
  merchant_name: string;
  approved_chf: number;
  /** The leash's tightest per-order limit, if any. */
  order_limit_chf?: number | null;
  /** Budget left after this approval, if the leash has a period budget. */
  budget_left_chf?: number | null;
}

/** Maximum = approved + tolerance, capped by the per-order limit and the remaining budget. */
export function tokenMax(input: IssueInput, tolerance = TOKEN_TOLERANCE): { max: number; reason: string } {
  const withTolerance = round2(input.approved_chf * (1 + tolerance));
  let max = withTolerance;
  let reason = `Approved ${chf(input.approved_chf)} plus ${Math.round(tolerance * 100)}% rounding room.`;
  if (input.order_limit_chf != null && input.order_limit_chf < max) {
    max = Math.max(input.approved_chf, input.order_limit_chf);
    reason = `Approved ${chf(input.approved_chf)}, capped at your ${chf(input.order_limit_chf)} per order.`;
  }
  if (input.budget_left_chf != null && input.approved_chf + input.budget_left_chf < max) {
    max = round2(input.approved_chf + input.budget_left_chf);
    reason = `Approved ${chf(input.approved_chf)}, capped by what's left of your budget.`;
  }
  return { max: round2(max), reason };
}

export class TokenVault {
  private tokens = new Map<string, DecisionToken>();
  private byDecision = new Map<string, string>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = TOKEN_TTL_MS,
    private readonly tolerance = TOKEN_TOLERANCE,
  ) {}

  private event(t: DecisionToken, type: string, detail: string, at = this.now()) {
    const e: TokenEvent = { at: new Date(at).toISOString(), type, detail };
    t.history.push(e);
  }

  /** Called only after an approval (automated or by the customer). One token per decision. */
  issue(input: IssueInput): DecisionToken {
    const existing = this.forDecision(input.decision_id);
    if (existing) return existing;
    const suffix = randomBytes(4).toString("hex");
    const { max, reason } = tokenMax(input, this.tolerance);
    const t: DecisionToken = {
      id: `tok_demo_${suffix}`,
      label: `DEMO token ••${suffix.slice(-4)}`,
      decision_id: input.decision_id,
      merchant_id: input.merchant_id,
      merchant_name: input.merchant_name,
      approved_chf: round2(input.approved_chf),
      max_chf: max,
      max_reason: reason,
      expires_at: new Date(this.now() + this.ttlMs).toISOString(),
      status: "active",
      charged_chf: 0,
      history: [],
    };
    this.event(t, "issued", `Only at ${t.merchant_name}, up to ${chf(max)}, one payment, until ${t.expires_at}.`);
    this.tokens.set(t.id, t);
    this.byDecision.set(input.decision_id, t.id);
    return t;
  }

  get(id: string): DecisionToken | undefined {
    const t = this.tokens.get(id);
    if (t) this.expireIfDue(t);
    return t;
  }

  forDecision(decisionId: string): DecisionToken | undefined {
    const id = this.byDecision.get(decisionId);
    return id ? this.get(id) : undefined;
  }

  list(): DecisionToken[] {
    return [...this.tokens.values()].map((t) => (this.expireIfDue(t), t));
  }

  private expireIfDue(t: DecisionToken, at = this.now()) {
    if (t.status === "active" && at > Date.parse(t.expires_at)) {
      t.status = "expired";
      this.event(t, "expired", "Not used in time. Nothing can be charged with it anymore.", Date.parse(t.expires_at));
    }
  }

  /** Stands in for the network/issuer authorization when a merchant charges the token. `at` lets a demo jump ahead in time. */
  charge(id: string, merchantId: string, amountChf: number, at = this.now(), merchantName = merchantId): ChargeResult {
    const t = this.tokens.get(id);
    if (!t) return { ok: false, code: "unknown_token", message: "This token doesn't exist.", token: null };
    this.expireIfDue(t, at);
    const refuse = (code: Exclude<ChargeResult["code"], "charged" | "refunded" | "refund_rejected">, message: string): ChargeResult => {
      this.event(t, "declined", `${chf(amountChf)} at ${merchantName}: ${message}`, at);
      return { ok: false, code, message, token: t };
    };
    if (t.status === "used") return refuse("token_used", "This token was already used. It pays once.");
    if (t.status === "expired") return refuse("token_expired", "This token expired unused.");
    if (t.status === "revoked") return refuse("token_revoked", "You revoked the leash, so this token no longer works.");
    if (merchantId !== t.merchant_id) return refuse("wrong_merchant", `This token only works at ${t.merchant_name}.`);
    // A charge is a positive, finite amount. Zero, negative, NaN or infinite never reach the amount check below.
    if (!Number.isFinite(amountChf) || amountChf <= 0) return refuse("invalid_amount", "A charge must be a positive amount.");
    if (amountChf > t.max_chf) return refuse("over_amount", `${chf(amountChf)} is more than this token allows (${chf(t.max_chf)}).`);
    t.status = "used";
    t.charged_chf = round2(amountChf);
    this.event(t, "charged", `${chf(amountChf)} charged by ${t.merchant_name}. Token used up.`, at);
    return { ok: true, code: "charged", message: `${chf(amountChf)} paid to ${t.merchant_name}. The token is now used up.`, token: t };
  }

  /** Refunds still work after the token is used up; the money goes back to the card. */
  refund(id: string, amountChf: number): ChargeResult {
    const t = this.tokens.get(id);
    if (!t) return { ok: false, code: "unknown_token", message: "This token doesn't exist.", token: null };
    if (!(amountChf > 0) || amountChf > t.charged_chf) {
      return { ok: false, code: "refund_rejected", message: `Only up to ${chf(t.charged_chf)} can be refunded.`, token: t };
    }
    t.charged_chf = round2(t.charged_chf - amountChf);
    this.event(t, "refunded", `${chf(amountChf)} refunded to your card.`);
    return { ok: true, code: "refunded", message: `${chf(amountChf)} refunded to your card.`, token: t };
  }

  /** Revoking the leash kills every token that hasn't paid yet. Returns the tokens that changed. */
  revokeActive(exceptDecisionId?: string): DecisionToken[] {
    const changed: DecisionToken[] = [];
    for (const t of this.tokens.values()) {
      this.expireIfDue(t);
      if (t.status === "active" && t.decision_id !== exceptDecisionId) {
        t.status = "revoked";
        this.event(t, "revoked", "Leash revoked. This token can't pay anymore.");
        changed.push(t);
      }
    }
    return changed;
  }
}
