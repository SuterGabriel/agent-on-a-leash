# Portfolio plan: agent-on-a-leash for the ElevenLabs and Better Stack applications

Date: 25 September 2026 (hackathon submission day). Two parts: the plan we agreed on, then the deep-research
report it is based on, kept in full for reference. The report was produced from the research prompt in this
file's last section; its source labels were links in the original and are kept as labels here.

Repo state when this was written: voice layer (`packages/backend/src/voice`, `app-web/src/features/voice`),
Kim's app (`app-web/`), and the restart-safe snapshot with hash-chained token history are committed. The
README has no attack table yet. Verify before acting; the tree moves fast.

---

## Part 1: what we do, in order

### Where the report is right

- PostgreSQL with transactional budget reservation is the single biggest gap for Better Stack. The audit said the same.
- Cut the Next.js rewrite, the Python engine rewrite, a second LLM in the decision path, and any real card-network claim.
- The "claims under pressure" table is the most useful section. Most of those sentences can go into the README as written.
- The voice point is fair. A spoken yes that becomes the same HTTP call is honest but thin. Binding the tool call to the challenge is what makes it an ElevenLabs artifact.

### Three corrections

1. **Timeline.** The report assumes four to eight working days. Submission is today at 12:00. Its items 1 to 4 are post-hackathon work. Do not start Postgres before the jury.
2. **Signed capabilities are half there.** The token vault already has a hash-chained history. An Ed25519 signature on top is a day, but it only matters once a merchant simulator verifies it (report item 9). Same week, not today.
3. **Rate limiting and scoped principals are different sizes.** A per-IP limiter on wrong secrets is one hour. Separate agent, cardholder and admin credentials is a day and changes the app contract Kim built against. First one now, second after the jury.

### Before the jury (today, in order)

| # | Item | Effort | Why |
|---|---|---|---|
| 1 | README: one-sentence invariant, trust boundaries, attack \| protection \| test table, known limitations. Reuse the report's sentences. | 2 h | Highest return per hour for both companies and the jury. |
| 2 | Voice challenge binding: `resolve_ask` takes a required `decision_id`, rejects anything that does not match the open ask, returns remaining seconds. | 30 min | Turns "yes becomes HTTP" into a bound approval. Files: `app-web/src/features/voice/voice-tools.ts`, `packages/backend/src/voice/agentDefinition.ts`. |
| 3 | Guard the unauthenticated routes (`/api/runs`, `/demo/tokens/*`), Content-Type check in the JSON reader, `X-Content-Type-Options: nosniff`, a CSP header, per-IP limiter on wrong secrets. One attack test each. | 1.5 h | Removes the two findings an interviewer finds in ten minutes. |
| 4 | Create the ElevenLabs agent (`npm run voice:agent`), set `VITE_ELEVENLABS_AGENT_ID`, rehearse the injection scenario by voice once. | 30 min | The demo must be heard once before the pitch. |
| 5 | `AI_USE.md`, half a page: what AI assisted, what was reviewed by hand, why no model is authoritative. | 20 min | Better Stack asks for it explicitly. |

Skip everything else until after the jury.

### The week after (for the applications)

Follow the report's order 1, 2, 3, 5, then 4 and 10. About six focused days.

1. PostgreSQL ledger. Budget reservation, decision insert, step-up resolution and token redemption as transactions with constraints. The budget race and the double resolve become SQL answers. Two indexes with `EXPLAIN ANALYZE` output.
2. Signed decision capability (Ed25519 JWS: jti, authorization, merchant, amount, currency, policy hash, expiry, one use) plus a small Python FastAPI verifier as the merchant side. Covers ElevenLabs' Python signal at a real boundary.
3. OpenTelemetry: one trace per purchase with child spans per guard, structured logs with reason codes, outcome and latency metrics, exported by OTLP to Better Stack. One induced alert with runbook and short postmortem.
4. Voice hardening: interruption, "I'm not sure", stale and repeated tool calls rejected, visible tool state and remaining time.
5. Scoped principals (agent, cardholder, admin), demo routes off outside demo mode, failed-access audit.
6. Three-minute video and the 800-word write-up (structure in Part 2, section 5).

### Vocabulary caution

The Agent Payments Protocol and Visa Trusted Agent mapping in Part 2, section 6 is worth a README paragraph: it shows we know the field. Do not adopt that vocabulary in the UI. Kim's screens use the cardholder's words on purpose; the jury hears "mandate" and "capability" as jargon.

---

## Part 2: the research report (verbatim)

### Agent-on-a-Leash Portfolio Plan

The strongest version is not a larger hackathon demo. Turn it into a narrow, defensible authorization system by adding transactional SQL persistence, cryptographically transaction-bound capabilities, real observability, and a polished approval ceremony; cut anything that implies production payment security you have not implemented.

### 1. Company signals

#### ElevenLabs

The clearest official signal is unusually direct: the current Design Engineer posting says formal experience, certifications, and degrees are unnecessary; candidates should instead show that they solved impressively hard problems through projects, designs, or GitHub contributions. It also asks for end-to-end ownership, compelling web work, TypeScript/React, Next.js, design libraries such as shadcn and Framer Motion, and familiarity with APIs, cloud infrastructure, storage, and data structures. (Official posting)

| Signal | Public evidence | Portfolio implication |
|---|---|---|
| Artifacts over credentials | The role explicitly requests artifacts showing hard problems solved, rather than degrees or certifications. (Official posting) | Lead with the live system, attack tests, architecture decisions and demo, not the hackathon placement. |
| Zero-to-one ownership | Full-stack roles own product direction and ship across front and back ends; Creative Studio roles include experiments and enterprise workflows. (Careers page) | Show one complete purchase lifecycle instead of many disconnected features. |
| Interfaces are judged as products | Design roles ask candidates to establish the standard for AI interfaces and create demos good enough to spread on their own. (Design Engineer post) | The step-up screen, countdown, voice state and decision explanation need production-level polish. |
| Open source and API design matter | Developer Experience roles emphasize open-source projects, SDKs, API design and technical writing. (Developer Experience role) | Include a clean API contract, integration example, typed SDK surface and strong documentation. |
| Agents should take bounded action | ElevenAgents is positioned around agents that can talk, type and take action; client tools execute on the user's device and can cause visible UI behavior. (Platform; Tools explanation) | Voice must participate in the approval protocol, not narrate a prerecorded demo. |
| Permissions and approvals are product concepts | ElevenLabs exposes per-tool approval policies, scoped MCP tools, OAuth/auth connections and client-tool events. (Approval API; April changelog) | Make the distinction between "agent requested," "user approved" and "system authorized" visible in both UI and audit data. |
| Agents must be operable | Recent releases emphasize agents-as-code, tests, configuration branches, triage tickets and monitoring. (August changelog) | Version the voice-agent configuration and add automated conversation/tool tests. |

What they are effectively praising: technically difficult artifacts, high-quality interactive demos, strong product taste, open-source developer experience, rapid ownership and AI interfaces whose actions are visible and controllable. The evidence is stronger in official job descriptions and product releases than in founder interviews; no sufficiently specific founder interview was found that materially changed this reading.

Your current fit: the client-tool integration, shared tap/voice endpoint, polished phone prototype, deterministic authorization path and explicit refusal to let the voice agent decide are excellent signals.

Your current weakness: voice approval is not yet a compelling ElevenLabs artifact if it merely converts "yes" into the same HTTP call. The portfolio version should demonstrate interruptions, expiry, stale-tool-call rejection, challenge binding, tool errors and an explicit separation between conversation and authority.

#### Better Stack

Better Stack says it wants generalists who could eventually build Better Stack themselves and ship high-quality software with exceptional UX end to end. Its public hiring material repeatedly emphasizes rough-idea-to-live-app execution, side projects, speed, pragmatic cuts and direct ownership. (Current role summary; Public hiring post)

| Signal | Public evidence | Portfolio implication |
|---|---|---|
| End-to-end product engineering | Engineers are expected to own backend, frontend, product experience and deployment. (Engineering page) | Show one deployable repository with migrations, monitoring, UI, tests and operating instructions. |
| Security without framework dependence | The current role asks for basic web-security understanding without blindly relying on framework defaults. (Full-stack role) | Your framework-free Node backend helps only if the README explains authentication, parsing limits, timing-safe comparison, races and remaining risks. |
| SQL and measured performance | The role emphasizes SQL databases, query benchmarking and fast software. (Full-stack role) | The in-memory store is the most damaging gap. Add PostgreSQL, transactions, constraints and EXPLAIN ANALYZE evidence. |
| UI and UX are engineering work | Better Stack explicitly expects engineers to polish interfaces and seamless flows. (Engineering page) | The phone prototype is valuable, but error, reconnect, expiry and recovery states matter more than another attractive dashboard. |
| Honest AI-assisted engineering | It expects aggressive AI use but explicitly rejects "vibe coding"; engineers must know when to use an LLM and when to design or debug by hand. (Full-stack role) | Add an AI_USE.md explaining what AI assisted, what you reviewed manually and why authorization remains deterministic. |
| Unified telemetry | Better Stack ingests OTLP traces and correlates them with logs through shared trace and span IDs. (Tracing documentation) | Instrument the authorization lifecycle and link each decision to structured evidence. |
| Low-friction instrumentation | Its collector emphasizes OpenTelemetry, eBPF, batching, compression and remotely configurable collection. (Collector documentation) | Use standard OTLP rather than writing a bespoke "metrics dashboard." |
| Detection through resolution | Better Stack connects alerts to incidents, timelines, on-call workflows and postmortems. (Alert documentation) | Include one real alert, runbook and postmortem from an induced authorization failure. |
| Human approval before consequential AI action | Better Stack's AI SRE can investigate and propose a pull request, but asks for approval before acting. (Mobile product) | Your "agent proposes, deterministic system checks, human approves exceptions" model maps closely to this philosophy. |

Your current fit: the race-condition tests, attack-oriented mindset, framework-free HTTP service, SSE timeline and honest known-gaps list are unusually relevant.

Your current weakness: a Better Stack reviewer will immediately see that the strongest claims (concurrency safety, durable auditability and operational visibility) currently end at the single-process boundary.

### 2. Ranked build plan

Scores estimate application impact relative to one or two focused days of work. "Both" means the feature creates credible evidence for both applications rather than merely mentioning their technology.

| Rank | Addition | Score | What it proves | Concrete scope | Honest limit | Serves |
|---|---|---|---|---|---|---|
| 1 | PostgreSQL authorization ledger | 10/10 | SQL, transactions, concurrency, schema design and production judgment | Add migrations for mandates, attempts, decisions, budget reservations, step-ups and token redemptions. Enforce unique authorization IDs and atomic budget reservation in a transaction. Include two relevant indexes and EXPLAIN ANALYZE output. | Single database and region; no distributed consensus or payment settlement. | Better Stack first; ElevenLabs second |
| 2 | Signed decision capability | 9.5/10 | Security boundaries, replay prevention and transaction binding | Issue an Ed25519-signed JWS containing jti, authorization ID, merchant ID, amount, currency, policy hash, issue/expiry times and one-use semantics. Verify it in a merchant simulator and atomically set consumed_at. | This is an application authorization capability, not an EMV network token, card cryptogram or real payment authorization. | Both |
| 3 | OpenTelemetry lifecycle | 9.2/10 | Observability, debugging and operational ownership | Add a trace from purchase request through compiler, guards, step-up and redemption. Emit child spans per guard, structured logs with reason codes, and counters/histograms for outcomes and latency. Export by OTLP to Better Stack. | Local/demo traffic does not validate production capacity or alert quality. | Better Stack first |
| 4 | Authentication hardening | 9/10 | Practical web security without hiding behind a framework | Replace the shared secret with scoped agent, cardholder and admin principals; hash stored opaque credentials; protect every non-public route; disable demo routes in production; add request-size limits and rate limiting; audit failed access. | Not a complete IAM system, device-attestation solution or external security audit. | Better Stack first |
| 5 | Transaction-bound voice step-up | 8.8/10 | Correct ElevenAgents integration and trustworthy AI UX | Give the agent only read_pending_challenge and submit_step_up_response. Bind responses to challenge ID and nonce; reject expired, superseded and repeated calls; support interruption and "I'm not sure"; display tool state and remaining time in the UI. | Spoken approval is an accessibility interaction, not voice biometric authentication or SCA by itself. | ElevenLabs first |
| 6 | Typed rule compiler | 8.5/10 | Language-interface design without putting an LLM in authority | Compile supported phrases into a versioned AST with currency, merchant/category, per-order limit, period limit and effective dates. Show a confirmation preview; reject unsupported or ambiguous clauses rather than guessing. | It supports a deliberately small grammar and does not understand arbitrary natural language. | Both |
| 7 | Adversarial content corpus | 8.1/10 | Security honesty, evaluation discipline and regression testing | Add Unicode normalization, confusable-character fixtures, multilingual attacks, indirect/factual injections and mutation-based tests. Preserve suspicious source text as evidence and guarantee detection can never make a decision more permissive. | Heuristic detection cannot prove that merchant content is safe; unresolved content should increase risk or require review. | Both |
| 8 | Failure and performance suite | 7.8/10 | Measured performance rather than deadline marketing | Use autocannon or k6 for concurrent attempts and publish p50/p95/p99. Inject database delay, clock advancement, SSE disconnects and process termination. Test the exact eight-second and 120-second boundaries. | Laptop measurements are reproducible benchmarks, not a production SLO. | Better Stack first |
| 9 | Python verifier integration | 7.4/10 | Python, API interoperability and clear trust boundaries | Build a small FastAPI merchant simulator or Python SDK that verifies the public-key signature, amount, merchant, expiry and policy hash, then requests atomic redemption. Test it against TypeScript-issued tokens. | It is a reference relying-party integration, not a second source of authorization truth. | ElevenLabs first |
| 10 | Three-minute proof package | 7.2/10 | Communication, design polish and end-to-end ownership | Record one normal approval, one step-up through ElevenLabs and one attack/race rejection. Add captions, architecture animation, linked trace, test output and a final limitations screen. | A demo is evidence of behavior, not evidence of production readiness. | Both |

Build order: for four working days, do 1, 2, 3, 5. For six to eight days, add 4, 6 and 10. Treat 7 to 9 as differentiators after the core system is credible.

What to cut:

- Do not rewrite the product in Next.js. The current React application can demonstrate interface quality; a rushed framework migration proves less than finishing the security and state model.
- Do not rewrite the decision engine in Python. Add the Python verifier at a genuine integration boundary instead.
- Do not add another LLM to classify purchases or prompt injection. It would weaken the strongest architectural decision: no probabilistic model in the authorization path.
- Do not build multi-agent orchestration. The product needs one untrusted shopping agent, one authorization service and one trusted cardholder surface.
- Do not attempt a real card-network integration. A precise simulator with cryptographic boundaries is more credible than a shallow payment API demo.
- Do not claim multilingual prompt-injection prevention. Build a corpus, improve normalization and document residual bypasses.
- Do not add generic dashboards, chat history or account settings. Every screen should serve request, decision, approval, evidence or incident investigation.
- Do not make SEO a major workstream. A server-rendered project page with correct metadata and an excellent demo is enough; the application itself is not an SEO product.

### 3. Claims under pressure

| Current claim | First senior challenge | README sentence |
|---|---|---|
| "Guardrails for AI shopping agents" | Where is the actual agent-to-merchant/payment trust boundary? | "This prototype authorizes simulated purchase attempts; it does not connect to a card network, move funds or establish merchant identity." |
| "20 deterministic guards" | Are they independent controls, or mostly branches counted as features? | "The engine contains 20 named checks with stable reason codes; the guard catalogue documents inputs, precedence, failure mode and test coverage for each." |
| "Checks every purchase within eight seconds" | Is eight seconds a measured SLO or just a timeout? | "Eight seconds is the caller deadline, not a production SLO; the benchmark section reports measured p50, p95 and p99 latency on specified hardware." |
| "Prevents concurrent budget overspend" | Only inside one Node process? | "The hackathon implementation serializes reservations only within one process; the PostgreSQL version uses an atomic transaction and is not claimed safe across multiple databases or regions." |
| "Decision-bound token" | Is it signed, audience-bound and one-use, or just an opaque bearer string? | "The capability is signed and bound to merchant, amount, currency, authorization, policy version and expiry, then consumed once through an atomic redemption record." |
| "Tokenised card" | Is this an actual network token? | "No card credential is tokenized: the demo issues an application-level authorization capability, not an EMV payment token or card cryptogram." |
| "Prompt injection is detected" | What happens with paraphrases, homoglyphs and other languages? | "The detector is a deliberately incomplete heuristic; known bypasses are documented, suspicious content can only increase strictness, and absence of a match is never treated as proof of safety." |
| "120-second step-up approval" | What prevents approval of the wrong or expired transaction? | "Each step-up response is bound to one challenge ID, purchase digest and expiry; stale, superseded, repeated and mismatched responses fail closed." |
| "Voice approval" | Is a spoken yes treated as authentication? | "Voice is an accessibility input to the authenticated cardholder session, not a biometric authenticator, and the ElevenLabs agent never makes the authorization decision." |
| "Every decision is stored" | What are the durability and tamper-resistance guarantees? | "The JSON snapshot is demo persistence rather than a durable audit ledger; production claims begin only with transactional database storage, backups and retention controls." |
| "Live over SSE" | What happens on reconnect, missed events or slow clients? | "SSE is a convenience view over persisted events; clients reconnect with an event cursor, while the database, not the stream, is the source of truth." |
| "236 passing tests" | Do they test useful invariants or implementation details? | "The suite count is secondary; the README maps each named attack to its invariant, protection and regression test and publishes the exact command and environment." |
| "Timing-safe secret comparison" | Does timing safety matter if parsing, lengths and routes leak outcomes? | "The comparison normalizes input shape before constant-time verification, but timing resistance does not compensate for the prototype's shared credential or previously public routes." |
| "Safe/secure" | Has anyone independently assessed it? | "This is a security-oriented prototype, not audited payment software; the threat model separates tested properties, assumptions and unresolved risks." |

### 4. Relevant project precedents

Public evidence rarely proves that one repository alone caused a hire. These three cases are defensible because the project and subsequent joining or acquisition were publicly linked; use them as presentation precedents, not as promises that README style guarantees employment.

**llama.cpp to Hugging Face.** The founding GGML/llama.cpp team joined Hugging Face in February 2026 while the projects remained open source and community-led. Hugging Face specifically highlighted the project's importance to local AI and committed long-term resources to it. (Official announcement)

What made it work: a technically unmistakable thesis (practical local inference on ordinary hardware); a fast path from clone to working output; concrete platform, model and backend support rather than vague "AI infrastructure"; performance and compatibility that users could reproduce; sustained open-source usage and contribution, not only a launch video; documentation that lets the artifact demonstrate engineering depth before the author explains it.

Lesson: your equivalent is not "236 tests." It is one reproducible command that demonstrates a race, shows the protection and links the resulting trace.

**OpenClaw to OpenAI.** OpenClaw founder Peter Steinberger joined OpenAI to work on personal agents, while OpenClaw moved into an open-source foundation supported by OpenAI. (Reuters)

What made it work: a memorable product identity and clear user-facing agent use case; a real artifact people could install and operate, not a speculative framework; integrations and visible actions that demonstrated agency; public discussion of security and operational trade-offs; strong product narrative around what a personal agent should be able to do.

Lesson: "agent-on-a-leash" is a strong name and thesis. Preserve the memorable metaphor, but immediately define the leash as deterministic policy, human escalation and transaction-bound authority.

**Turborepo to Vercel.** Vercel acquired Turborepo and Jared Palmer joined to lead build-performance work; Vercel emphasized the open-source CLI and the project's focus on build speed and developer experience. (Vercel announcement)

What made it work: one legible performance problem; immediate installation and an opinionated happy path; benchmarks and observable improvement; clear terminology and architecture for a complicated domain; a product-quality website and documentation layer around deep infrastructure.

Lesson: infrastructure artifacts succeed when the interface is simpler than the system beneath it. Your first screen should say "What the agent attempted, which authority it had, and why the result followed", not expose 20 guards at once.

Pattern to copy, in this order: one-sentence problem and non-negotiable invariant; thirty-second demo; exact trust boundaries; attack/protection/test table; reproducible quick start; measured results; architecture and data model; known limitations; short design narrative; small integration example.

### 5. README and write-up

#### README structure

```text
# agent-on-a-leash

One sentence:
A deterministic authorization layer that lets AI shopping agents request
purchases without giving them authority to approve those purchases.

[Live demo] [3-minute video] [Architecture] [Run tests]

## Why this exists
- User problem
- Threat: confused or manipulated agents with payment access
- Non-goal: autonomous payment network

## Demo
1. Normal purchase → approve
2. Limit exceeded → step_up
3. Merchant injection → quarantine + stricter result
4. Expired/replayed capability → decline

## Safety invariant
Untrusted text and AI output may propose facts and actions.
They can never reduce the strictness of an authorization decision.

## System boundaries
- Shopping agent: untrusted requester
- Authorization service: deterministic policy authority
- Banking app: trusted user surface
- ElevenLabs agent: accessibility interface, not decision-maker
- Merchant simulator: relying party
- PostgreSQL: source of truth

## Architecture
Diagram plus one paragraph on each boundary.

## Decision lifecycle
request → normalize → reserve → evaluate → approve/decline/step_up
→ human response → capability issue → merchant verification → redemption

## Attack | protection | test
Centrepiece table below.

## Rule language
Supported grammar, compiled AST example and ambiguity behavior.

## ElevenLabs integration
Tools, permissions, challenge binding, timeout and failure behavior.

## Data model
Tables, constraints, transaction boundaries and relevant indexes.

## Observability
Trace structure, metrics, alerts and example incident.

## Performance
Hardware, command, dataset and p50/p95/p99 results.

## Security model
Assets, attackers, trust assumptions and out-of-scope threats.

## Known limitations
Prominent, specific and unqualified.

## Run locally
Five commands or fewer; deterministic seed data.

## Test
Unit, integration, race, property and attack-test commands.

## API
Short endpoint table plus OpenAPI link.

## AI use
What AI assisted, what was manually verified and why no LLM is authoritative.

## Project history
Swiss {ai} Weeks Hackathon Zurich, Viseca challenge, September 2026.
State what existed at the hackathon and what was added afterward.
```

#### Attack table

| Attack | Protection | Test |
|---|---|---|
| Merchant text says "ignore the limit" | Merchant content is tagged untrusted, quarantined and can only increase decision strictness | Injection fixture asserts the outcome cannot move from decline/step_up to approve |
| Unicode or homoglyph obfuscation | Unicode normalization plus a documented confusable-character heuristic | Mutation corpus contains mixed-script variants and records known misses |
| Two concurrent purchases exceed the monthly budget | Budget reservation and decision insertion occur in one database transaction | Parallel attempts prove no committed state exceeds the configured limit |
| Duplicate authorization ID | Database uniqueness constraint plus idempotent response semantics | Repeated and concurrent duplicates return the original outcome without double reservation |
| Step-up resolves twice | Conditional update accepts only pending → approved/declined | Simultaneous yes/no attempts produce exactly one terminal transition |
| Approval arrives after 120 seconds | Database-side expiry check in the same transaction as resolution | Boundary tests cover just-before, exact-expiry and just-after timestamps |
| Capability is replayed | Signed jti, short expiry and atomic one-use redemption | Second redemption is rejected even when requests arrive concurrently |
| Merchant or amount is changed | Signature covers merchant, amount, currency, authorization and policy hash | Bit-change and field-substitution tests fail verification |
| Wrong secret types or malformed JSON | Strict schema, body-size limit and normalized authentication failure | Arrays, objects, duplicate headers, oversized bodies and invalid encodings are rejected |
| SSE client disconnects | Persisted ordered events with reconnect cursor; SSE is not authoritative | Disconnect/reconnect test receives missing events without duplicating decisions |
| ElevenLabs repeats a tool call | Tool call is bound to challenge ID, nonce and current state | Duplicate and stale client-tool calls fail closed |
| Process stops after reservation | Transaction rollback or explicit reservation expiry | Fault injection between reservation and decision leaves no permanent spend |

#### Technical write-up: Building authority around an unreliable agent

AI shopping agents create an uncomfortable inversion of traditional application security. The component interpreting the user's request is also the component reading merchant-controlled text and proposing an action. It is useful precisely because it is flexible, but that flexibility makes it a poor source of payment authority.

Agent-on-a-leash separates proposal from authorization. A shopping agent may propose a purchase and provide the available merchant context. It cannot approve the purchase, modify the cardholder's rules or manufacture payment authority. Those powers belong to a deterministic authorization service and, when necessary, an authenticated cardholder surface.

The cardholder starts with a small mandate expressed in plain language: "Groceries, maximum CHF 120 per order and CHF 400 per month." The compiler converts supported language into a versioned typed policy. Before activation, the application displays the resulting category, limits, currency and time period. Ambiguous or unsupported language is rejected rather than guessed. Natural language is therefore an input format, not the runtime security policy.

For each purchase attempt, the service validates the request, creates an idempotent authorization record and reserves any relevant budget inside a database transaction. Twenty named guards then evaluate the normalized request. They cover limits, merchant and category restrictions, duplicate IDs, mandate status, timing and suspicious merchant content. Each guard returns a stable reason code and structured evidence.

The key invariant is monotonic strictness: untrusted content can never make the result more permissive. If merchant text contains "ignore the cardholder's limit," the text is preserved as evidence and may raise the result from approval to step-up or decline. It cannot turn a decline into an approval. The injection detector remains heuristic. Unicode tricks, other languages and apparently factual sentences can evade pattern matching, so the system does not equate "not detected" with "trusted."

A result can be approve, decline or step_up. Step-up creates a challenge bound to the authorization ID, merchant, amount, purchase digest and 120-second expiry. The cardholder sees those values in the banking interface. They can answer by tapping or through an ElevenLabs voice interaction, but both paths submit the same challenge-bound command. The ElevenLabs agent may read the pending question and relay an explicit response; it never selects the result. Spoken approval is an accessibility mechanism inside the cardholder session, not voice biometric authentication.

Resolution is a state transition rather than a generic "yes" endpoint. Only the first valid response can move a pending challenge to a terminal state. Expired, repeated, superseded or mismatched responses fail closed. This is tested with simultaneous approval and rejection attempts as well as exact expiry-boundary cases.

After approval, the service issues a short-lived signed capability. Its claims bind it to one authorization, merchant, maximum amount, currency, policy version and expiry. A merchant integration verifies the signature and claims, then redeems its unique identifier once. Redemption and the consumed_at update are atomic, preventing two concurrent requests from spending the same capability. This object is intentionally described as an application authorization capability. It is not a card-network token, EMV cryptogram or evidence that funds moved.

The attack/protection/test table is the centre of the engineering argument. It avoids the weak claim that a test count proves security. Instead, every important assertion identifies an attacker action, the enforced invariant and a reproducible regression test. Race tests cover concurrent budget reservations, duplicate authorization IDs and double resolution. Mutation tests change signed fields. Fault tests terminate work between reservation and decision. Authentication tests include malformed and adversarial input shapes.

Every authorization produces correlated traces, logs and metrics. A request trace contains child spans for parsing, reservation, individual guards, step-up and redemption. Structured logs use authorization and reason identifiers rather than raw secrets. Metrics report outcomes and latency without high-cardinality cardholder labels. An induced database-latency alert links to a runbook and a short postmortem, demonstrating the path from detection to diagnosis rather than adding a decorative dashboard.

The architecture still has explicit limits. It does not identify real merchants, tokenize cards, perform strong customer authentication or process payments. The injection detector cannot establish that merchant content is benign. A single PostgreSQL deployment does not solve multi-region consistency. No independent security review has been performed.

Those limits are part of the artifact. The project is intended to demonstrate where authority should live when probabilistic agents take consequential actions: outside the model, inside a narrow, testable and observable protocol.

### 6. Viseca commerce context

#### Mandates, not prompts

The strongest industry analogy is the Agent Payments Protocol. AP2 models authorization through cryptographically verifiable checkout and payment mandates, including open mandates that contain constraints and closed mandates bound to a finalized transaction. (AP2 specification; Core concepts)

| Project concept | Industry-aligned framing |
|---|---|
| Plain-language rules | User intent compiled into an open authorization mandate |
| Purchase attempt | Candidate checkout assembled by the shopping agent |
| Deterministic guard result | Constraint evaluation by the authorization service |
| Step-up | Return to a trusted surface for human-present authorization |
| Approved purchase digest | Closed, transaction-specific authorization |
| Decision-bound token | Application capability scoped to one finalized checkout |
| Audit record | Evidence chain for authorization and dispute investigation |

Do not claim AP2 compliance unless you implement its credential formats, signatures, role verification and receipts. AP2 also calls for preventing double spend, binding open and closed mandates, managing receipts and releasing payment credentials only after verifying final mandates. (Security considerations; Implementation considerations)

#### Trusted-agent identity

Visa's Trusted Agent Protocol separates agent recognition, consumer recognition and payment containers, using signatures, timestamps, key identifiers and nonces. It binds authorization to the merchant domain and operation and requires invalid signatures to be blocked. (Visa overview; Technical specification)

That exposes a limitation in the current product: a purchase request identifies an agent logically, but it does not establish a cryptographically registered agent identity. State this directly rather than presenting the shared bearer secret as agent attestation.

#### Tokenized payments

Mastercard describes registered agents using dynamic, cryptographically secured agentic tokens so transactions are traceable and authenticated. It also describes tokenization and verifiable payment details such as merchant, product and amount. (Acceptance framework; Agent Pay)

Therefore: call your object a signed authorization capability or decision capability; do not call it a tokenized card; state that a future issuer integration could exchange a verified capability or mandate for a real network/payment token; show merchant, amount, currency and expiry prominently because they are authorization fields, not UI decoration.

#### Step-up confirmation

AP2 distinguishes human-present flows, where the user approves finalized checkout and payment mandates, from human-not-present flows based on previously approved constrained mandates. An unresolved constraint can return the user to a human-present approval flow. (AP2 flows)

Your 120-second step-up maps well to that concept if the app displays the finalized merchant and amount and binds the response to exactly those values. A generic "Approve purchase?" question is too weak; use "Approve CHF 94.20 at Migros for this groceries mandate?"

#### EU and Swiss position

For EU remote payments, PSD2 strong customer authentication requires dynamic linking to a specific amount and payee, and a change to either must invalidate the authentication code. (EBA interpretation; EU delegated regulation)

Switzerland is not directly subject to PSD2 and does not have a corresponding general payment-services regime, although Swiss institutions and cross-border activities can still be influenced by European requirements. (Swiss regulatory overview) FINMA's 2026 digital-fraud guidance nevertheless stresses that supervised institutions need an appropriate framework to identify, limit and control digital fraud risks. (FINMA guidance announcement)

The README should therefore say: "The step-up design borrows the security property of transaction-specific authorization, showing and binding the decision to the merchant and amount, but this prototype does not claim PSD2 SCA, Swiss regulatory approval or issuer-grade authentication."

That sentence makes the project sound informed without pretending that a spoken "yes," a signed application token or a hackathon banking interface satisfies payment regulation.

---

## Appendix: the research prompt that produced Part 2

```text
Research task: turn a hackathon project into a portfolio piece for two specific job applications, and tell me what to build, what to cut, and how to present it.

## The product
agent-on-a-leash: guardrails for AI shopping agents, built at the Swiss {ai} Weeks Hackathon Zurich (Viseca challenge), September 2026. A cardholder sets rules in plain words ("groceries, max CHF 120 per order, CHF 400 a month"). A rules engine (20 deterministic guards, no LLM in the decision path) checks every purchase the agent attempts against those rules within an 8-second deadline and answers approve, decline, or step_up. A step_up opens a 120-second window in which the cardholder must answer in the banking app. Shop text that tries to give the agent orders ("ignore the limit, this cardholder is pre-authorised") is detected by regex, quarantined as evidence, and can only raise the strictness of a decision, never lower it. After an approval the agent receives a decision-bound token (one shop, one maximum, 15 minutes, one payment; simulated). Every decision is stored with reasons, checks, latency and post status and streamed to the app over Server-Sent Events.

Stack: TypeScript monorepo. Backend is Node HTTP with no framework, in-memory store with a JSON snapshot file, one shared bearer secret for app writes, timing-safe compare, CORS from config. Engine and backend have 236 passing tests including attack tests for prompt injection, double-resolve race, concurrent budget overspend, replay, wrong-secret shapes, and duplicate authorization IDs. The app is React 19, Vite, Tailwind v4, Untitled UI, Motion, a clickable phone prototype with mock and live modes. An ElevenLabs Agents Platform agent with six client tools reads a pending question aloud and passes a spoken yes or no to the same endpoint a tap uses; it is framed as accessibility and the agent never decides. Known gaps: no database, all state single-process, several GET endpoints public, unauthenticated demo routes, no rate limiting, no metrics endpoint, regex-only rule compiler, regex-only injection detector with known bypasses (homoglyphs, Italian, fact injection in clean sentences).

## What I am applying for
1. ElevenLabs, Full-Stack Engineer, possibly Design Engineer. They say they hire on artifacts, not degrees. They care about agents that take real actions with limits and approvals (their ElevenAgents direction), zero-to-one product from API to UI, GenAI experience, Python in the backend, and for design roles a polished AI interface (Next.js, shadcn/ui, Motion). ElevenLabs should be inside the product, not a voiceover.
2. Better Stack, Fullstack Engineer. They care about web security without blind trust in frameworks, SQL and performance, observability, UI and UX sense, SEO, end-to-end ownership, and honest AI use: the author must be able to explain every decision.

## What I want from you
1. For each company, from their careers pages, engineering blogs, founder interviews, job posts from the last 12 months and any public hiring guidance: what do they say they look for in a portfolio project, what have they praised publicly, what do their own recent product launches emphasise (ElevenLabs Agents Platform and client tools; Better Stack Telemetry, logs, uptime, incident management). Cite sources.
2. Given the product above, rank the ten most valuable additions I could make in one to two days each, by impact on these two applications divided by effort. For each: what it proves, the concrete scope, the honest limits to state, and which company it serves. Prefer things that make sense inside the product (a cardholder, an agent, a card, a 120-second window) over demos bolted on.
3. Which of the product's current claims would a senior engineer at either company challenge first, and how should the README pre-empt each one in a sentence.
4. Find three to five public portfolio projects or open-source repos that got their authors hired at similar AI or infrastructure companies, and say what made them work: README structure, tests, demo video, write-up.
5. Draft the structure of a README and a short technical write-up (about 800 words) that would satisfy both companies at once, with the attack | protection | test table as a centrepiece.
6. Anything about the Viseca agentic commerce context (mandates, tokenised cards, step-up confirmation, EU or Swiss regulation on agent payments) that would make the project read as informed rather than a toy. Cite sources.

Format: a report with sections in the order above, sources as links, no filler. Be strict: where the product is weak, say so.
```
