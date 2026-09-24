# Rules, settings and why it was flagged

Kim's focus area. How the customer sets rules, how rules change over time, how settings are organised, and how the app explains a decision.

## 1. How the rules actually travel (important for design)

What looked like "the API key adds the prompt back to the agent" is the mandate snapshot. The mandate the customer confirms is not only stored. The API copies it into **every purchase event** our engine receives: the original instruction word for word, the `hard_rules` and the `uncertainty_policy`. So at decision time the engine always has the customer's own words next to the purchase. The key only identifies our team.

| What travels with each purchase | What does not |
|---|---|
| `instruction` (the customer's exact words) | `guidance` (our explanations) |
| `hard_rules` (price, period, category, ...) | `open_questions` and the customer's answers |
| `uncertainty_policy` (ask, decline, approve) | Our rule labels and "your words" mapping |

What this means:

- **Design:** we can promise "every decision is checked against what you said", and show those words on the decision card.
- **Engine:** fuzzy checks (is a fragrance gift set "household groceries"? is a trail shoe a "road-running shoe"?) can compare the item with the instruction text, not with a guess.
- **Backend:** everything that is not in the event (answers to open questions, labels, learned rules) must live in our own store.
- **Timing:** a run uses a snapshot taken at run start. A PATCH only reaches later runs. To make "Tighten" feel instant, our engine reads the latest mandate too and applies the stricter of the two.
- **Shop text** never becomes part of the rules. It is quoted as evidence only.

## 2. Three kinds of rules

| Kind | Where it comes from | Can the customer change it? | Shown as |
|---|---|---|---|
| Your rules | The instruction, confirmed with Face ID | Tighten in one tap. Loosen = new leash | Normal row, your words underneath |
| Built-in protections | Always on for every leash | No | Row with lock icon |
| Learned from you | Accepted "Always do this?" suggestions | Remove any time | Row with date "Added 24 Sep" |

Plus **live state** that is not a rule but must be visible: budget used, what frees up when, known shops, known devices.

## 3. Rule row anatomy

Every rule, everywhere (review, settings, decision card), uses the same row:

| Part | Example | Notes |
|---|---|---|
| Label | Each order CHF 120 or less | Plain language, starts with the subject |
| Value | CHF 120 | Tappable value, tabular numbers |
| Your words | "at or below CHF 120 including delivery" | Quote style, small, grey. Missing for built-in rules |
| State | CHF 76.50 left, frees up Mon 09:12 | Only for budget and time rules |
| Result | Pass / Fail / Unsure + fact | Only on the decision card and Ask me |
| Action | Tighten | Opens S8. Never "loosen" |

## 4. Dynamic rules: ideas ranked

| Idea | What the customer gets | Effort | Pick |
|---|---|---|---|
| Rolling budget with "frees up" | Knows when money is available again | Low (engine has the data) | P0 |
| Learned rule after an answer | "Always decline add-ons" in one tap | Medium (reason code to rule map) | P0 |
| New shop becomes known after approval | No second ask for the same shop | Low | P0 |
| Suggest tighten after repeated declines | "3 lookalike shops this month. Block all lookalikes?" | Medium | P1 |
| Done after one purchase | One-item tasks close themselves | Low (backend revokes after first approval) | P1 |
| Night lock 00:00-06:00 | Agent can't buy at night | Low (engine-side rule) | P1 |
| Pause 24 h | Stop without losing rules | Low | P1 |

Suggestion map (reason code to learned rule):

| Reason on the decision | Suggested learned rule |
|---|---|
| `unrequested_addon` | Always decline when something is added I didn't ask for |
| `shop_text_manipulation` | Always decline when a shop gives orders |
| `lookalike_shop` | Block shops that look like my known shops |
| `new_shop` (customer approved) | Add this shop to known shops (automatic, no question) |
| `possible_split_order` | Treat orders within 10 min as one order |
| `session_not_you` | Always decline purchases from a new phone at night |

## 5. Settings: the control center (S7)

Problem with the lo-fi: rules, budget, protections and actions were mixed on one card. New structure, top to bottom, iOS grouped list, one idea per group:

| Order | Group | Rows | Interaction |
|---|---|---|---|
| 1 | Header | Agent name, card •• 4821, status pill Active / Paused / Off | none |
| 2 | This week | Budget bar, "CHF 76.50 left, frees up Mon 09:12" | Tap: list of what counts |
| 3 | What you told us | The instruction as a quote | "Change" = start a new leash |
| 4 | Your rules | One row per rule (anatomy above) | Tap row: S8 Tighten |
| 5 | When unsure | Ask me / Decline, "If you don't answer in 2 min, nothing is bought" | Segmented control, Ask me to Decline only |
| 6 | Learned from you | Learned rules with date | Swipe or tap to remove |
| 7 | Known shops | Shop name + times used, "New" tag for recent | Tap: Block |
| 8 | Always on | Built-in protections, lock icons | Read only, tap for one-line explanation |
| 9 | Notifications | Asks (always, locked), Declines, Daily summary | Toggles |
| 10 | Bottom | Pause 24 h, Revoke agent (red) | Confirm sheets |

Rules for this screen:
- Only one primary action per group. No inline buttons inside rows except "Tighten" chevrons.
- Destructive actions only at the bottom, never next to rules.
- Numbers right-aligned, tabular, CHF first.
- Maximum 6 rules visible. More goes behind "Show all".

Mobbin references for this structure: see `02_research/mobbin/references.md` (GoHenry "Limits and controls" is the closest: limits group with Edit, where the card works, blocks).

## 6. Why it was flagged: the decision card (S5) and Ask me (S6)

Same 5 parts as the build guide, but the "Evidence" becomes a **rule checklist**. This is the one pattern that makes "why" readable in 5 seconds.

| Part | Content | Example AU0039 |
|---|---|---|
| Headline | Status pill + reason in 4-6 words | Declined · Not a shop you know |
| Because | One sentence: rule + fact | "PixelHarbour" is not "PixelHarbor", where you bought 6 times. |
| Checked against your rules | One row per rule: pass, fail, unsure + fact. Failing row first and highlighted | Fail: Only sellers you bought from · Pass: CHF 400 or less (CHF 340) · Pass: The 27-inch monitor only |
| Uncertainty | What we don't know, or "Nothing, clear rule" | Nothing, clear rule |
| From the shop (untrusted) | Grey box, quoted, only if shop text tried to give orders | (not shown here) |
| Actions | OK · suggested tighten | OK · Block lookalike shops |

Design details:
- Result icons: check (pass), cross (fail), question mark (unsure). Colour is secondary, the icon and word carry the meaning.
- Tap a failing row: it expands to show the customer's words from the instruction.
- Approvals use the same card but collapsed: "Fits all your rules" with the checklist behind "See checks".
- The Ask me sheet shows the checklist in compact form (only the unsure row expanded), so the decision stays one screen.
- Never show a confidence percentage. Use "Sure" or "Not sure, because ...".

The engine must send the checklist. New field `checks[]` in the decision (see `05-engineering-backlog.md` and `07-api-contract.md`).
