# Agent Card prototype · screen spec v3 (Figma page "UI mobile v3 · demo" + React /prototype)

Written 24 Sep 2026, evening. Concept: `06_product/09-concept-v4-agent-card.md`. Replaces the v2 spec's screens A, 01, 02 and the "Connected agents" parts of 03 and 06; the rest (04, 05, 07) keeps its copy with "your agent" instead of an agent name. Rules, tokens and components: `prototype-spec.md` §0-2, plus the two new pieces below. React is the source of truth for copy (`app/web/src/features/shopping-card/demo-data.ts`); if Figma and this file disagree, React wins for copy, Figma for visuals.

## New components

| Figma | React | Notes |
|---|---|---|
| Rule row · Review with evidence | `RuleRow mode="review" evidence` | third line, Text sm / text-tertiary, no quotes |
| Setting row | `SettingRow` | title 17 Semibold, evidence 13 grey, segmented control 32 high below, divider inset 16 |
| Analysis card | `AnalysisCard` | white card, 2 × 2 stats: value Display xs Bold tabular, label 13 grey |
| Shopping card · Off | `ShoppingCard variant="frozen" badge="Off"` | grey surface, lock + "Off" |

## Demo data

Customer: card CA0039 history (data pack persona "Oliver Graf", uses a virtual card for web shops). Main card World Mastercard Gold •• 7049. Agent Card •• 7310, expiry 09/30.
Analysis, last 90 days: 23 purchases · typical CHF 46 · biggest CHF 266 · about CHF 520 a month · biggest month CHF 894 · 12 shops · 4 purchases at night · Electronics, Dining, Clothing, Books, Household = 90 % of spend.
Suggested rules: Each payment CHF 300 (demo corrects to CHF 400) · In any 30 days CHF 1'500 · Only shops you know, 12 shops · Your usual categories, 5.
Task from the agent (SCEN0004): "Buy the 27-inch monitor I chose, from a seller I have bought from before, for CHF 400 or less. Do not add anything I did not ask for. Ask me when uncertain."
Payments: AU0035 PixelHarbor CHF 289.00 approved · AU0036 PixelHarbor CHF 289.00 declined, you already bought this · AU0039 PixelHarbour CHF 340.00 declined, not a shop you know · AU0040 PixelHarbor CHF 299.00 ask me, shop text gives orders · AU0037 PixelHarbor CHF 520.00 declined, over limit + shop text.

## Screens (frame name = `<flow>.<n> <Name>`)

### 01 · Get the Agent Card
- **1.1 Card tab · banner** — Nav "Card" · main card artwork · Lock · PIN · Replace · banner card: orange dot + "Let an AI agent shop for you, safely" + "An Agent Card with its own number and your rules. Your main card stays private." + secondary small "Get started" · Card settings group · Tab bar Card. After creation the banner becomes the row "Agent Card · •• 7310 · for your shopping agent" with pill Active.
- **1.2 How it works** — X close · card artwork · Hero "An Agent Card" / "For the AI shopping agent you already use. It carries your rules, not your money." · 3 rows with icons: "Your agent gets its own card" / "A separate number, linked to your card. Your real card number is never shared." · "Your rules travel with it" / "Limits, shops and when to ask you. Set from how you already shop, in under a minute." · "You stay in control" / "Every payment is checked and explained. Tighten or switch off in one tap." · primary "Continue".
- **1.3 Rules from your shopping** — Nav inline back · title "Rules from your shopping" · body "We looked at your last 90 days on this card and propose rules from it. Tap a value to change it." · Analysis card (23 · CHF 46 · CHF 266 · CHF 520) · group "Proposed rules": Each payment · CHF 300 · "Your biggest online payment was CHF 266" (chevron) / In any 30 days · CHF 1'500 · "About CHF 520 a month, your biggest month was CHF 894" (chevron) / Only shops you know · 12 shops · "HarborByte 21 times, PixelHarbor 6 times and 10 more. New shops ask you first" / Your usual categories · 5 · "Electronics, Dining, Clothing, Books, Household · 90% of what you spent" · group "What we tell the agent": the generated sentence in quotes, footer "This sentence is stored with the card. Every payment is checked against it and against the rules above." · primary "Use these rules".
- **1.3a Change a value (sheet)** — title "Each payment" · − CHF 300 + stepper (steps of 50) · "From the next payment: max CHF 400" · evidence line · Cancel · Save. (Before the card exists any value is allowed without Face ID.)
- **1.4 Smart settings** — title "Smart settings" · body "Pre-set from your shopping. Making a setting stricter is always one tap. Loosening later needs Face ID." · 4 Setting rows: "When we're not sure" / "You get one question and 2 minutes to answer" / Decline · **Ask me** · "At night, 23:00 to 06:00" / "Only 4 of your 23 purchases were at night. Declined ones wait in your morning summary" / **Decline, don't ask** · Ask me anyway · "Shops you haven't used" / "12 shops in the last 90 days. A new one asks you first" / Only known shops · **Ask me first** · "Learn from my answers" / "After you answer, we offer one rule. You decide each time" / **On** · Off · group "Always on" 3 locked rows, footer "Built into every Agent Card. These can't be switched off." · primary "Create card with Face ID".
- **1.5 Your Agent Card is ready** — card artwork · Hero "Your Agent Card is ready" / "Its own number, linked to your card •• 7049. Every payment with it is checked against your rules first." · group "Give this card to your agent": Card number •••• •••• •••• 7310 + "Show" · Expiry 09/30 · row "Copy card details" / "Number, expiry and security code" (chevron) · footer "Paste the details into your shopping agent's payment settings. Your main card number is never shared." · row "Add to Apple Wallet · Optional" · primary "Done".

### 03 · Everyday
- **3.1 Agent Card home** — Nav inline back "Card" title "Agent Card" · card artwork · quick actions Freeze · Rules · Details · Budget meter "This month · CHF 1'211.00 left · of CHF 1'500 · CHF 289.00 spent · Rolling 30 days · CHF 289.00 frees up 11 Sep" · group "Waiting for you": PixelHarbor · "27-inch computer monitor · 1:54 left" + black pill · CHF 299.00 · group "What your agent was asked to buy": the task instruction in quotes (chevron → 6.1), footer "4 rules from this task are checked on every payment, next to your card rules." · group "Activity": PixelHarbour CHF 340.00 struck "Declined: not a shop you know · Today 11:30" · PixelHarbor CHF 289.00 struck "Declined: you already bought this · Today 10:05" · PixelHarbor CHF 289.00 "Approved · Today 09:40".
- **3.1b no payments yet** — "No payments yet. When your agent pays, you'll see it here." · **3.1c offline** — info card "Payments paused. Nothing will be bought until we're back."

### 04 · Ask me (unchanged structure, neutral copy)
- **4.0 Push** — "Your agent wants to pay CHF 299 at PixelHarbor" / "Tap to answer. 2:00 left."
- **4.1 Ask me sheet** — ring 1:54 · "Your agent wants to pay" · rows Shop PixelHarbor · Item 27-inch computer monitor · Amount CHF 299.00 · Card Agent Card •• 7310 · "Why we ask" + the decision's `because` · "See checks" · Decline · Approve (Face ID).
- **4.2 See checks** — checklist: Not sure "Shop text can't change your rules · The shop said: pre-authorised" first, then passes · Shop text box.
- **4.3 Approved by you** — "Paid CHF 299.00 at PixelHarbor" / "Your agent was told to go ahead. It counts toward this month's budget." · Done.
- **4.4 You declined · learned rule** — "You declined. Nothing was bought." / "Your agent was told why." · card "Always decline when a shop gives orders?" + "Your answer becomes a rule. You can remove it any time under Rules." · Just this time · Yes, always.
- **4.5 Time's up** — ring 0:00 grey · "Time's up" · "Nothing was bought. Your agent was told why." · OK.

### 05 · Declined payment
- **5.1 Push** — "We stopped a payment at PixelHarbour" / "It looks like PixelHarbor, but it isn't. Nothing was bought."
- **5.2 Payment details** — icon · "PixelHarbour" · CHF 340.00 struck · pill Declined · status card "Declined by Viseca: not a shop you know. 'PixelHarbour' is not 'PixelHarbor', where you bought 6 times." · "Checked against your rules": Fail "Only sellers you bought from" · your words "from a seller I have bought from before" · "Fail · PixelHarbour, never used. PixelHarbor: 6 times" then 3 passes · rows Item · Card Agent Card •• 7310 · Time · primary "OK" · secondary "Block shops that look like my known shops".
- **5.2b shop gave orders** — AU0037 with the shop text box. **5.2c approved** — AU0035, pill Approved, "Approved by Viseca. It fits all your rules."

### 06 · Rules
- **6.1 Rules (control centre)** — Nav inline "Rules" · Budget meter · group "From your shopping" (the 4 rules, settings mode, evidence lines, footer "Tap a value to change it. Stricter applies at once, looser needs Face ID.") · group "Smart settings" (4 Setting rows) · group "What your agent was asked to buy" (instruction quote + 4 task rule rows with your words, footer "Sent by your agent with its first payment. Checked on every payment, next to your card rules.") · group "Learned from your answers" (rule · "Added today" · Remove) · group "Always on" · secondary "Pause for 24 hours" · destructive text "Turn off Agent Card".
- **6.2 Tighten (sheet)** — "Each payment" · stepper CHF 350 · "From the next payment: max CHF 350" · evidence · "Stricter applies at once." · Cancel · Save. **6.2b Loosen** — CHF 450 · "Looser needs Face ID." · Save with Face ID.
- **6.3 Details** — group Card: Number •••• 7310 · Linked to World Mastercard Gold •• 7049 · Online only (locked toggle) · group "Shops you know" 6 rows with counts and Block · group Notifications: Questions (locked on) · Risky stops · Morning summary.

### 07 · Was this you (P1, unchanged) · 08 · Stop
- **8.1 Pause (sheet)** — "Pause the Agent Card?" / "No agent can pay with it for 24 hours. Waiting questions are cancelled. Your rules stay. Your main card is not affected." · Cancel · Pause.
- **8.2 Turn off (sheet)** — "Turn off the Agent Card?" / "The card number stops working and your agent can't pay anymore. Waiting questions are cancelled. Your history stays." · Cancel · Turn off (destructive, Face ID). After: 1.1 with the banner.

## Prototype path (Figma "Prototype" page + React)
1.1 Get started → 1.2 → 1.3 (tap CHF 300 → 1.3a → 400 → Save) → Use these rules → 1.4 → Face ID → 1.5 → Done → 3.1 → demo: approve (quiet) → lookalike (push → 5.2) → ask (push → 4.1 → See checks → Decline → 4.4 → Yes, always) → Rules 6.1 (learned rule visible) → Turn off Agent Card → 8.2 → 1.1.
