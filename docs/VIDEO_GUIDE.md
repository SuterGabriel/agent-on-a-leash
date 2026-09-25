# Video guide: Remotion

How to open, change and render the 20-second video in [`video/`](../video). For anyone on the team; no Remotion
experience assumed.

## 1. What Remotion is

Remotion turns a React component into a video. You write a component that reads the current frame number and
returns what the picture looks like at that frame. Remotion opens it in a headless Chrome, screenshots every
frame, and hands the frames to FFmpeg, which encodes the MP4. There is no timeline editor: the code is the
timeline.

Three ideas carry everything:

- **Composition.** A component plus an id, a size, a frame rate and a length in frames. Ours is `AgentCardDecline`,
  1920 × 1080, 30 fps, 600 frames, so 20 seconds.
- **Frame.** `useCurrentFrame()` returns the frame being drawn, 0 to 599. Everything on screen must be a pure
  function of that number. No `setTimeout`, no CSS transitions, no state that ticks on its own; they would render
  differently in the Studio and in the encoder.
- **interpolate.** `interpolate(frame, [30, 45], [0, 1])` maps frames 30 to 45 onto 0 to 1. With `extrapolateLeft`
  and `extrapolateRight` set to `"clamp"`, it stays at 0 before and 1 after. Opacity, position, scale and typed
  text length are all built from this one function.

## 2. Set up once

Node 20 or newer (we used 24). The folder has its own `package.json` and is not part of the root workspace.

```bash
cd video
npm install
```

The first render or Studio start downloads Chrome Headless Shell (about 108 MB) into `node_modules/.remotion`.
Inter is fetched from Google Fonts while rendering. Both need internet; after that, the Studio works offline and
only the font still needs the network.

## 3. Start the Studio

```bash
npm run studio
```

It opens `http://localhost:3000`. On the left is the list of compositions (one). The big area is the preview, the
bar underneath is the timeline: drag to scrub, space to play, arrow keys step one frame. Edits in `src/` hot-reload
while it runs. The **Render** button in the top right renders from the Studio with the same result as the command
line, which is handy for trying a codec or a scale without remembering flags.

## 4. Render

```bash
npm run render                    # out/agent-card-decline.mp4, about a minute
npm run still                     # out/frame.png at frame 400, the "Declined" beat
```

The same commands with options, run directly:

```bash
npx remotion render src/index.ts AgentCardDecline out/test.mp4 --frames=300-420   # one section
npx remotion render src/index.ts AgentCardDecline out/test.mp4 --scale=0.5        # quick, half size
npx remotion render src/index.ts AgentCardDecline out/test.mp4 --concurrency=8    # more cores
npx remotion still  src/index.ts AgentCardDecline out/f.png --frame=180           # any single frame
```

`out/` is ignored by git. Share the MP4 by hand.

## 5. How the video is built

| File | What |
|---|---|
| `src/index.ts` | registers the root, nothing else |
| `src/Root.tsx` | declares the one `<Composition>`; add a second one here |
| `src/AgentCardDecline.tsx` | the whole video: timing, copy, phone screen, captions |
| `remotion.config.ts` | JPEG frames, overwrite output |

Inside `AgentCardDecline.tsx`, top to bottom:

- **`T`**, the beat table. Frame numbers at 30 fps: the shop text appears at 90, types from 100 to 195, the
  checklist starts at 210 with a row every 22 frames, the decline lands at 330, the status sentence at 345, the
  closing caption at 480, the wordmark at 540. Move a beat by changing one number; everything that follows it
  reads from `T`.
- **`C`**, the app's iOS greys, copied from `app-web/src/styles/figma-tokens.css`. The video is monochrome like the
  app: no green, red or yellow.
- **`DECISION`**, the copy on the phone. It is what the app shows for decision AU0037: the checks and the
  quarantined shop text from `app-web/src/mocks/decisions.json`, the status sentence and check labels from the
  `checkCopy` and `statusSentence` tables in `app-web/src/features/shopping-card/demo-data.ts`. The shop quote is the
  real sentence from the data pack, minus its last clause so it fits the box.
- **`fade`, `rise`, `pop`**, three helpers over `interpolate`: opacity 0 to 1, a slide from a few pixels below, and a
  small overshoot for the pill and the fail marks.
- **`useInter`**, font loading. `delayRender()` tells Remotion to wait, the Google Fonts stylesheet is added, the
  four weights are loaded, `continueRender()` releases it. Without this the first frames would render in Arial.
- **`PhoneScreen`**, the app's payment details screen drawn at its native 393 × 852 and scaled by 1.1 in the parent.
  The layout is the one in `app-web/src/features/shopping-card/screens/detail-screens.tsx`: header, status
  sentence, quarantined shop text, checklist. The screen is taller than the phone, so `scroll` translates the
  content down while the checklist fills and back up for the verdict, like a thumb would.
- **`Caption`**, one line of text on the right for one range of frames, fading in at `from` and out before `to`.
- **`AgentCardDecline`**, the composition: dark background, the phone on the left, the label, the captions, the
  wordmark and the footnote on the right.

A pattern worth copying for new elements: compute a start frame, derive `opacity` and `transform` from it with the
helpers, and pass them as inline style. Nothing else is needed to animate.

## 6. Common changes

**Change a sentence.** Captions are the `text` and `sub` props of the `Caption` elements. Phone copy is in
`DECISION`. Keep the phone copy identical to what the app shows; the footnote promises that.

**Move or stretch a beat.** Edit `T`. If the total changes, update `durationInFrames` in `AGENT_CARD_DECLINE` at
the bottom of the file. Both Root and the render read from that constant.

**Show a different purchase.** Pick a decision id in `app-web/src/mocks/decisions.json`, copy its checks, amount,
merchant and `shop_text_quarantine` into `DECISION`, and take the app's wording for it from `checkCopy`,
`statusSentence` and `shopQuote` in `demo-data.ts`. Only the failing and "you" checks are shown, failing first, as
`checksFor` does in the app.

**Add a second video.** Create `src/OtherVideo.tsx` exporting a component and a constant like
`AGENT_CARD_DECLINE`, add a second `<Composition>` in `src/Root.tsx` with a new `id`, render it by that id.

**Vertical for a phone or a social post.** Set width 1080 and height 1920 in the constant, then stack the phone
above the captions in `AgentCardDecline` instead of side by side.

**Add a voiceover.** Put the MP3 in `video/public/`, then inside the composition:

```tsx
import { Audio, staticFile } from "remotion";
<Audio src={staticFile("voiceover.mp3")} />
```

Remotion mixes it in at render time. The Studio plays it while scrubbing.

## 7. When something goes wrong

| Symptom | Cause | Do |
|---|---|---|
| The render prints only `Node.js v24…` and stops | The Chrome download was hidden behind `--silent` or failed | Run `npx remotion render …` without `--silent` to see the download, then again |
| Text renders in Arial | No internet, or Google Fonts blocked; the loader gives up and continues | Get online, or put the Inter `.woff2` files in `public/` and load them with `staticFile` in `useInter` |
| `delayRender was called but not cleared after 30000ms` | The font fetch hangs | Check the network; `delayRender("…", { timeoutInMilliseconds: 60000 })` if it is just slow |
| Studio shows the change, the MP4 does not | An old bundle | Delete `node_modules/.cache` and render again |
| Frames jump or elements flicker | Something not derived from the frame: state, timers, CSS transitions | Rewrite it with `interpolate` on `useCurrentFrame()` |
| Render is slow | Default concurrency is half the cores | `--concurrency=8`, or `--scale=0.5` while iterating |
| `npm run render` in the repo root does nothing | The scripts live in `video/` | `cd video` first |

## 8. Further reading

- Remotion fundamentals: https://www.remotion.dev/docs/the-fundamentals
- `interpolate` and easing: https://www.remotion.dev/docs/interpolate
- Sequences for chaining scenes: https://www.remotion.dev/docs/sequence
- CLI flags for render and still: https://www.remotion.dev/docs/cli/render
