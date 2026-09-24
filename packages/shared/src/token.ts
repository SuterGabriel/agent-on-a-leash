// Decision-bound tokens (demo). After an approval the agent gets a token for exactly that purchase:
// one shop, one maximum amount, a short life, one payment. Simulated: no card numbers, no network.

export type TokenStatus = "active" | "used" | "expired" | "revoked";

export interface TokenEvent {
  at: string;
  /** issued, charged, declined, refunded, expired, revoked */
  type: string;
  detail: string;
}

export interface DecisionToken {
  /** "tok_demo_7f3a91c2" — clearly not a card number. */
  id: string;
  /** "DEMO token ••91c2" */
  label: string;
  decision_id: string;
  merchant_id: string;
  merchant_name: string;
  approved_chf: number;
  max_chf: number;
  /** One sentence: why the maximum is what it is. */
  max_reason: string;
  expires_at: string;
  status: TokenStatus;
  charged_chf: number;
  history: TokenEvent[];
}

export type TokenRefusal = "unknown_token" | "token_used" | "token_expired" | "token_revoked" | "wrong_merchant" | "over_amount" | "invalid_amount";

/** Result of a (simulated) merchant charge against a token. */
export interface ChargeResult {
  ok: boolean;
  code: "charged" | "refunded" | "refund_rejected" | TokenRefusal;
  /** One sentence for the customer and the jury. */
  message: string;
  token: DecisionToken | null;
}
