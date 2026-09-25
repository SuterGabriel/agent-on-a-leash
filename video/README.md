# video · one declined purchase, 20 seconds

A Remotion project with a single composition, `AgentCardDecline`: the phone shows the app's payment
details screen for purchase 3 of the manipulated-agent scenario (SCEN0004, AU0037). PixelHarbor asks
CHF 520 for the monitor, the product page tells the agent the limit does not apply, the engine declines.
Landscape 1920 × 1080, 30 fps, silent, for the pitch screen.

Every line on the phone is what the app shows for that decision: the checks and the quarantined shop text
from `app-web/src/mocks/decisions.json`, the status sentence and check labels from
`app-web/src/features/shopping-card/demo-data.ts`. The captions on the right are ours.

## Run

```bash
cd video
npm install
npm run studio     # Remotion Studio, scrub the timeline
npm run render     # out/agent-card-decline.mp4, about a minute
```

Inter is loaded from Google Fonts at render time, so rendering needs internet. `out/` is not committed.

The full guide, from what Remotion is to troubleshooting: [docs/VIDEO_GUIDE.md](../docs/VIDEO_GUIDE.md).

## Change it

Timing lives in the `T` table at the top of [src/AgentCardDecline.tsx](src/AgentCardDecline.tsx) (frame
numbers at 30 fps), the copy in `DECISION` and in the `Caption` elements. This folder is not part of the
root npm workspace; it has its own `node_modules`.
