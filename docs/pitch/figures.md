# Figures for the pitch

Nine SVGs, 1200 px wide, light surface, one claim each. Eight come from `npm run figures` (`scripts/pitch-figures.mjs`, the numbers are constants at the top of the file with the file each was measured into next to it). The ninth, `comparison.svg`, comes from `npm run compare`, which re-runs the engine on the public set. Open any of them in a browser or drop it on a slide.

| Figure | What it shows | Data | Where the pitch uses it |
|---|---|---|---|
| `numbers.svg` | Eight stat tiles: 45 of 45, 28 of 28, 0 of 185 after the deadline, 268 ms, 0.04 ms, 21 checks, 262 tests, 2 learned rules | `docs/HACKATHON.md` section 2 | The numbers slide |
| `comparison.svg` | No control, a plain limit and our engine on the 28 risky public purchases: 0, 6 and 28 caught | `npm run compare`, `comparison.md` | 0:58, the comparison on the laptop |
| `limit-vs-engine-by-kind.svg` | The same 28 by kind of risk. A limit scores only in "over the limit or the budget"; the engine catches all six kinds | `comparison.md`, "by kind of problem" | Q&A: what does a limit miss |
| `money-unchecked.svg` | CHF 5,899 paid unchecked with no control, CHF 4,173 with a plain limit, CHF 0 with the engine | `comparison.md`, first table | With the comparison |
| `live-before-after.svg` | The seven live scenarios run twice: every question answered no (52 of 74 asked) against every question answered yes (28 of 74). The asked band shrinks as shops become known | `live-figures-asks-declined.md`, `live-figures-asks-approved.md` | Q&A: why does it ask so often |
| `why-we-asked.svg` | The 28 questions of the yes pass by reason: 16 were a first purchase at a shop | `live-figures-asks-approved.md`, "why we asked" | Q&A: why does it ask so often |
| `latency-vs-deadline.svg` | Six timings on a log scale from 0.04 ms (engine median) to 664 ms (slowest live decision), against the 8,000 ms deadline | `docs/HACKATHON.md` section 3, `live-figures-*.md` | Section 3 on the slide; Q&A: why not faster |
| `viseca-list-status.svg` | Viseca's 19 requirement rows in their five headings: 15 built, 3 partial, 1 not built on purpose | `docs/HACKATHON.md` section 10 | Submission; Q&A: what is not built |
| `guards-by-family.svg` | The 21 checks in five families, worded as the app shows them | `packages/engine/src/decide.ts`, `packages/backend/src/engine/leashEngine.ts` | Section 6: the shape of the problem |

## Using a figure on another page

Every SVG has a `viewBox`, so it scales to whatever width it is given. Three ways, in order of preference:

1. **Inline it.** Copy the whole `<svg>…</svg>` block from the file into the page. `figures.html` has all nine inlined already, one per `<section class="fig">`, so a page can lift a block from there. Give the container `svg { width: 100%; height: auto; }`.
2. **Reference it.** `<img src="docs/pitch/numbers.svg" alt="The numbers, measured 24 and 25 September" width="1200">`. Adjust the path to where the page lives.
3. **Use the PNG.** `docs/pitch/png/<name>.png`, rendered at 2400 px wide, for anything that cannot take SVG.

The figures are drawn on a light surface (`#fcfcfb`) with their own text colours, so they look the same in a dark page; put them in a light frame rather than recolouring. Do not redraw them in a chart library: the numbers and wording are the evidence, and the generator is the single source.

Two things to know when re-measuring. The live figures are per pass, and only the seven scenarios both passes ran are compared side by side; the 59 percent in `HACKATHON.md` is the no pass over all ten scenarios. The `destination` guard is wired in the engine but has no label or family in `leashEngine.ts` yet; the figure files it under Shop as "Hotel in the city you named".
