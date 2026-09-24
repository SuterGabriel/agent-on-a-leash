# Learning: security review of the leash, what we built and what we skipped

Date: 24 September 2026. Status: three fixes built and tested, the rest decided.

## What was reviewed

A ten-point web security checklist for a spending agent: prompt injection, access control and IDOR, race conditions
on the budget, securing approvals, SSRF, XSS, CSRF, secrets, a tamper-proof audit log, and rate limiting. We checked
each point against the backend as it is, not as the checklist assumes it is.

## Built (tests: `packages/backend/test/security.test.ts`)

1. **One answer per ask.** The backend checked "still waiting", then awaited Viseca's `/resolve`, and only then
   stored the answer. Two answers arriving together both passed the check, so Viseca could receive approve *and*
   decline. Now the ask is claimed before the first `await`; the second answer gets `busy`.
2. **Budget at the moment of approval.** Automated decisions can't race (the worker handles one purchase at a time),
   but asks can: two asks of CHF 250 each fit a CHF 300 budget alone, not together. Approving now checks the budget
   again and reserves the amount until Viseca confirms. Over budget, the customer gets the overshoot in CHF and can
   still say "buy anyway". It is their money.
3. **Only the app can write.** The API had no auth and allowed any origin. Now writes under `/app/*` need the app's
   secret, one origin is allowed, and live mode won't start without both.

Details and settings: `docs/WORKFLOW/02_DEV2_BACKEND.md`, section App API security.

## Already covered

| Point | Where |
|---|---|
| Prompt injection | Rules decide, no model does. Shop text is flagged and quoted to the customer (`guards/shopText.ts`); it can make a purchase an ask, never an approval. |
| Approval bound to one purchase, amount, time | Viseca's `authorization_id` binds the amount; the 120 s answer window; decision-bound tokens: one shop, one maximum, 15 minutes, one payment (`tokens/vault.ts`). |
| Idempotency | Same `authorization_id` delivered twice → stored answer, counted once (`worker.ts`). |
| Secrets | `TEAM_API_KEY` lives only on the server. |
| Rate limiting | The session guard counts a quick series (`recent_attempt_count_10m`) as a signal. |

## Skipped, and why

- **SSRF.** We never fetch a shop URL. Viseca sends structured authorization events; there is nothing to fetch.
- **IDOR.** One customer, one leash, in memory: no ID can point at someone else's data yet. The ownership check
  comes with Supabase and real users.
- **CSRF.** The app authenticates with a header, not a cookie, so a foreign site can't make the browser send it.
- **Signed ElevenLabs URLs.** Voice is P1 and outside the challenge. If built, the backend fetches the signed URL.
- **Hash-chained audit log.** Good for a log about money, but after the hackathon. The token history is the cheap
  place to start.

## Q&A answers

- *"What if two approvals come in at once?"* Check and reservation happen in one step before anything waits, so
  both can't see the same money left. In a database that's `SELECT … FOR UPDATE`; in our single Node process it's
  the same guarantee.
- *"Can the agent approve its own purchase?"* No. It only ever gets a decision token, which pays once for one
  purchase. Approving needs the app's secret.
- *"Isn't a secret in the frontend readable?"* Yes. It keeps the agent and outsiders out, it is not a user login.
  Real sessions come with Supabase Auth.

## Takeaways

- Every "check, then await, then write" is a race. Claim before the first `await`.
- A check that was true when the engine decided can be false when the customer answers. Check again at the moment
  money moves.
- Test a checklist against the actual architecture: half of a generic web list (SSRF, IDOR, CSRF) didn't apply, and
  the real gaps (the resolve race, the budget across asks) weren't on it as written.
