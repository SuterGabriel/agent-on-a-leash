# Learning: merchant and product reputation check stays out of the build

Date: 24 September 2026. Status: decided, do not reopen before submission.

## What was proposed

A review check (`reputation.py`, Python, prototype only, not in the repo) that flags a purchase for step_up in two cases:

- **Product level:** a listing with at least 50 reviews and a rating below 2.5 or more than 40% one-star reviews. The shopping agent passes the rating along in the purchase request.
- **Merchant level:** a shop with a bad Trustpilot score. It uses the official Trustpilot API when `TRUSTPILOT_API_KEY` is set and falls back to a fictional snapshot otherwise.

Missing data (no profile, no ratings) never flags. The prototype ran correctly on its five demo cases.

## Why it is not in the build

1. **It never fires on the real run.** Viseca's merchants are synthetic. The authorization event has `merchant_id`, `merchant_name`, MCC, country and city, but no domain and no ratings. Every replayed scenario returns "no flag". PRODUCT_SPEC section 12 already lists merchant reputation services as out of scope.
2. **It trusts the party we are controlling.** Product ratings would come from the shopping agent. Since missing data is neutral, a compromised or prompt-injected agent gets past the check by leaving the field out or sending a fake 4.8. That contradicts the whole "leash" idea and is an easy jury question to lose.
3. **It doesn't fit the stack.** The engine is TypeScript and uses `approve | decline | step_up`. The prototype is Python and returns `"ask"`. Porting it the day before submission costs time we don't have.
4. **Smaller issues:** Trustpilot's TrustScore is not a star average, so "1.8/5" mixes two scales. A malformed API response raises `KeyError` at startup instead of being treated as missing data.

## What we do instead

- Mention it in the pitch and Q&A as the next step, based on **issuer data**, not scraping: *"Next step: feed Viseca's own dispute and chargeback rates per merchant into the same step_up rule."* Viseca already holds that data, it can't be spoofed by the agent, and it needs no third-party terms.
- If we want a visual, a mock "shop rated poorly → step_up" card in the judge view costs far less than wiring in Python.

## Takeaways

- Before adding a signal, check that the field actually exists in the authorization event (`data/schemas/authorization_event.schema.json`). A check that never fires on the jury's replay is invisible.
- Never let the agent supply the data used to judge the agent. Signals must come from the issuer or from sources the control layer fetches itself.
- "Missing data is neutral" is the right default for noisy signals, but it turns any agent-supplied signal into an opt-out.
