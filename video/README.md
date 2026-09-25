# video · two short clips for the pitch

A Remotion project with two compositions, both landscape 1920 × 1080, 30 fps, silent, for the pitch screen.

- `AgentCardDecline`, 20 s: the app's payment details screen for purchase 3 of the manipulated-agent
  scenario (SCEN0004, AU0037). PixelHarbor asks CHF 520 for the monitor, the product page tells the agent
  the limit does not apply, the engine declines.
- `AgentCardVoice`, 10 s: the ask-me sheet with the "Read it to me" button turning into the Speaking and
  Listening pill, and three lines saying that ElevenLabs is built in as an accessibility layer and that the
  voice never decides.

Every line on the phone is what the app shows for that decision: the checks and the quarantined shop text
from `app-web/src/mocks/decisions.json`, the status sentence and check labels from
`app-web/src/features/shopping-card/demo-data.ts`. The captions on the right are ours.

## Run

```bash
cd video
npm install
npm run studio     # Remotion Studio, scrub the timeline
npm run render        # out/agent-card-decline.mp4, about a minute
npm run render:voice  # out/agent-card-voice.mp4, about half a minute
```

Inter is loaded from Google Fonts at render time, so rendering needs internet. `out/` is not committed.

The full guide, from what Remotion is to troubleshooting: [docs/VIDEO_GUIDE.md](../docs/VIDEO_GUIDE.md).

## Change it

Timing lives in the `T` table at the top of [src/AgentCardDecline.tsx](src/AgentCardDecline.tsx) (frame
numbers at 30 fps), the copy in `DECISION` and in the `Caption` elements. This folder is not part of the
root npm workspace; it has its own `node_modules`.
