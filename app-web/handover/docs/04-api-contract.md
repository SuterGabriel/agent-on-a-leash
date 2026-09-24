# App API contract (our backend)

The small API between the mobile app and our backend. The backend talks to the Viseca API; the app never does. Type source: `app/web/src/types/decision.ts`.

## Endpoints

| Method | Path | Used by | Calls Viseca |
|---|---|---|---|
| GET | `/app/leash/suggest` | 1.3 Rules from your shopping (v4) | no (reads the history CSV) |
| POST | `/app/leash/parse` | optional "In your words" path | no |
| POST | `/app/leash` | S3 confirm | `POST /v1/mandates` + `/confirm` |
| GET | `/app/leash` | S4, S7 | `GET /v1/mandates/{id}` (cached) |
| PATCH | `/app/leash/rules` | S8 tighten | `PATCH /v1/mandates/{id}` |
| DELETE | `/app/leash` | S9 revoke | `DELETE /v1/mandates/{id}` |
| POST | `/app/leash/pause` | S7 | no (engine flag) |
| GET | `/app/feed` | S4 | no |
| GET | `/app/decisions/:id` | S5 | no |
| GET | `/app/asks` | S4, S6 | no |
| POST | `/app/asks/:id/resolve` | S6 | `POST /v1/authorizations/{id}/resolve` |
| POST | `/app/suggestions/:id/accept` | S5, S6 | no (learned rule, engine-side) |
| GET | `/app/stream` | all | no (SSE: `decision`, `ask`, `ask_expired`, `leash_changed`) |
| GET | `/judge/decisions?run_id=` | J | no |

## Parse response

```json
{
  "instruction": "Order our household groceries for delivery. Keep each order at or below CHF 120 including delivery, ...",
  "rules": [
    {
      "key": "order_limit",
      "label": "Each order CHF 120 or less, delivery included",
      "your_words": { "text": "each order at or below CHF 120 including delivery", "start": 49, "end": 98 },
      "hard_rule": { "field": "authorization.billing_amount_chf", "operator": "<=", "value": 120, "currency": "CHF", "scope": "purchase" }
    }
  ],
  "built_in": ["shop_text", "duplicate", "lookalike", "session"],
  "uncertainty_policy": "ask",
  "open_questions": [{ "id": "q1", "text": "Should two orders within 10 minutes count as one order?", "options": ["Yes", "No"] }],
  "not_understood": []
}
```

`start` and `end` are character offsets in the instruction, so the app can underline the words that made each rule.

## Decision object (what S4, S5, S6 render)

```ts
type CheckResult = "pass" | "fail" | "unsure";

interface Check {
  key: string;              // "order_limit", "known_shop", "shop_text" ...
  label: string;            // "Each order CHF 120 or less, delivery included"
  your_words: string | null;// null for built-in protections
  source: "you" | "built_in" | "learned";
  result: CheckResult;
  fact: string | null;      // "CHF 126.00 (groceries 118 + delivery 8)"
}

interface Decision {
  id: string;               // live authorization_id (mock: AU id)
  decision: "approve" | "decline" | "step_up";
  status: "approved" | "declined" | "waiting_for_you" | "approved_by_you" | "declined_by_you" | "expired";
  reason_codes: string[];
  headline: string;         // "Not a shop you know"
  because: string;          // one sentence, rule + fact
  checks: Check[];          // failing and unsure first in the UI
  uncertainty: string[];
  shop_text_quarantine: string | null;
  amount: { value: number; currency: string; chf: number };
  merchant: { id: string; name: string; category: string; country: string };
  items: { name: string; category: string; qty: number; unit_price: number; currency: string }[];
  group_id: string | null;  // burst grouping
  deadline_at?: string;     // for asks
  suggestion?: { id: string; text: string };  // learned rule offer
  actions: string[];
}
```

## What the engine sends to Viseca

`POST /v1/authorizations/{id}/decision` with `decision`, `reason_codes`, `customer_message` (= `because`) and `evidence` (one entry per check). The full `checks[]` goes to our backend, not only to Viseca.


## v4 additions (24 Sep evening)

Types for every request and response the app makes: `app/web/src/features/shopping-card/api/types.ts`. Hookup and test checklist: `app/web/docs/backend-hookup.md`. New: `GET /app/leash/suggest` (rules with `evidence` and `hard_rule`, smart defaults, `instruction_generated`), `PATCH /app/leash/rules` carries `face_id_confirmed` for looser values, `POST /app/leash/pause`, SSE event names `decision`, `ask`, `ask_expired`, `leash_changed`.
