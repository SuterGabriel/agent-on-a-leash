# Pitch site

Five static slides for the jury: the case, the demo, backend and engine, the evidence figures, Viseca's list row by
row. No build step. Open `index.html` in a browser, arrow keys move between slides, print gives one page per slide.

## Deploy

```bash
cd pitch && npx vercel --prod
```

or drag this folder onto vercel.com/new. Then set `LINKS.demo` at the top of `index.html` to the deployed app-web
URL plus `/prototype`; until then it points at the local dev server. `LINKS.github` is the repo.

## Screens (three screenshots still to take)

Take them from the running app and drop them into `assets/`; a phone whose file is missing is hidden, nothing breaks.

| File | Open | What to capture |
|---|---|---|
| `assets/screen-1-3-rules.png` | `/prototype?screen=1.3` | Rules from your shopping |
| `assets/screen-3-1-home.png` | `/prototype?screen=3.1` | Agent Card home after a quiet approval |
| `assets/screen-5-2-stopped.png` | `/prototype?screen=5.2` | Payment stopped, lookalike shop |
| `assets/screen-4-2-ask-checks.png` | `/prototype?screen=4.2` | Ask me with the shop text quoted |

Crop to the phone screen only (no bezel), portrait, any width above 600 px.

## Figures

`figures/fig-0.svg` to `fig-4.svg` are exports of `docs/pitch/*.svg` (`numbers`, `comparison`, `limit-vs-engine-by-kind`,
`money-unchecked`, `live-before-after`). When a number is re-measured, run `npm run figures` at the repo root and copy
the changed SVG here under the same `fig-N` name. `docs/pitch/figures.md` says where every number comes from.

## The table on slide 5

Transcribed from `docs/HACKATHON.md` section 10, which is checked against the code. Change it there first.
