# Unit type colors

Written 13 November 2026. The values live in `packages/surfaces/src/shared/tokens.css`. Change them there and here together.

## What the research supports

| Finding | What it means here | Source |
|---|---|---|
| Color and emotion pairings are largely shared across 30 nations (r = .88), with smaller local differences | A meaning-based choice is not only a Western habit, but it is a weak guide for abstract types | [Jonauskaite et al. 2020](https://biopen.bi.no/bi-xmlui/bitstream/11250/2761614/1/Jonauskaite_etal_2020_PsychScience.pdf) |
| A color's meaning depends on its context. The red-harms-performance effect did not survive correction for publication bias | Do not claim a color makes people think better. Use color to tell things apart and to match conventions | [Elliot and Maier, color-in-context](https://link.springer.com/article/10.3758/s13423-020-01772-1) |
| Argument maps use green for reasons that support and red for objections | Green and red already mean Supports and Opposes to this audience | [One Minute Mapper](https://www.reasoninglab.com/wp-content/uploads/2013/10/One-minute-mapper.pdf) |
| Any concept can be carried by a color if the colors in the set differ enough from each other in what they suggest | The set matters more than any one color | [Mukherjee et al. 2022](https://arxiv.org/html/2108.03685v4) |
| Good category palettes balance measured difference, different color names, and pleasant pairs | Types should have different plain names: violet, amber, blue | [Gramazio et al. 2017](https://connorgr.github.io/pdf/gramazio-2016-ccd.pdf), [Heer and Stone 2012](https://idl.uw.edu/papers/color-naming-models) |
| Small marks need larger color differences than large ones | A faint tint on a card is not enough | [Stone, Szafir and Setlur 2014](https://www.tableau.com/research/publications/engineering-model-color-difference-function-size) |
| Lower-chroma, lighter palettes read as calm and trustworthy | Keep the tints light and the strong color to a thin edge | [Bartram, Patra and Stone 2017](https://www.tableau.com/sites/default/files/2023-01/Affective%20Color%20CHI%202017.pdf) |

Not confirmed from a primary source in this pass: a hard limit on how many category colors people can search quickly (five to seven is a guideline, not a tested result), and specific hue-to-trait claims such as "blue means trust".

## What was wrong

Measured as CIEDE2000 between rendered colors, in normal vision and with protan and deutan simulation (Machado 2009). Around 2 is barely visible; category colors want 15 or more.

| Problem | Measured |
|---|---|
| Evidence was the Supports green | 2.5 apart. Evidence that opposes a claim was a green card on a red line |
| Protocol and Output were told apart only by people with full color vision | 20.7 normal, 1.8 deutan |
| Experiment and Code likewise | 35.2 normal, 4.1 protan |
| The type color reached a card only as a 5% tint | Weakest pair of card backgrounds 2.3 apart, under 1 with color blindness |
| Process types carried fixed hex colors | They ignored the dark theme, and chip text fell to 3.8:1 contrast |
| An imported vault brought the official defaults | Claim green and Evidence crimson, the colors of Supports and Opposes |

## The rules now

1. **Green and red belong to Supports and Opposes.** No type sits near either.
2. **Hue names the type.** The three argument types get the strongest, most differently named colors.
3. **Two lightness steps.** Neighbors that color-blind readers confuse by hue differ in lightness.
4. **A full-strength edge on every card.** The tint stays light; the left edge carries the color at full strength.
5. **Color is never the only signal.** The chip's letters (QUE, CLM, EVD) always say the type.
6. **Defaults are not choices.** A type carrying an old default, ours or the official plugin's, follows this palette. A color a lab picked itself still wins.

## The palette

Light theme, as `oklch(lightness chroma hue)`. The dark theme keeps each hue and raises lightness.

| Type | Color | Value | Why |
|---|---|---|---|
| Question | Violet | `0.50 0.17 300` | Furthest from both relation colors; dark step |
| Claim | Amber | `0.68 0.145 72` | The caution color: asserted, not yet shown. Kept clear of highlighter yellow |
| Evidence | Blue | `0.68 0.15 250` | Neutral toward agreement, so it can support or oppose |
| Source | Grey | `0.55 0.025 250` | Reference material, the background of an argument |
| Protocol | Cyan | `0.63 0.11 215` | |
| Experiment | Pink | `0.62 0.13 340` | |
| Run | Rose, dark | `0.50 0.13 5` | Sibling of Experiment, one step darker |
| Code | Olive | `0.68 0.105 112` | |
| Output | Teal | `0.68 0.12 185` | |

Request has no color of its own and follows Question.

## What it measures

| | Before | After |
|---|---|---|
| Weakest pair, normal vision | 8.3 | 16.1 |
| Weakest pair, protan or deutan | 1.8 | 6.7 |
| Nearest type to Supports | 2.5 (Evidence) | 19.0 (Output) |
| Nearest type to Opposes | 28.6 | 16.8 (Run) |
| Lowest chip text contrast | 3.8:1 | above 4.5:1 |

**Limits.** Eleven colors cannot all stay far apart for color-blind readers by hue alone; a search over the whole space topped out near 9. Claim and Code (6.7 protan), Protocol and Experiment (6.9 deutan), and Experiment and Output (7.0 deutan) are the weak pairs, which is why the chip letters matter. The numbers come from simulation, not from testing with people. The relation colors were not changed: nine relation hues are also crowded, and Addresses is close to the Evidence blue.
