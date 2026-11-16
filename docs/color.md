# Colors for unit types and relations

The palette for unit types and relation lines, the rules it follows, and how far apart the colors measure. The values live in `packages/surfaces/src/shared/tokens.css`. Change them there and here together.

## Rules

1. **Green and red belong to Supports and Opposes.** No type sits near either, because evidence can oppose a claim and must not look like agreement.
2. **Hue names the type.** The three argument types get the strongest, most differently named colors: violet, amber, blue.
3. **Two lightness steps.** Neighbors that color-blind readers confuse by hue differ in lightness.
4. **A full-strength edge on every card.** The card's tint stays light (8% in the light theme, 12% in the dark). The left edge carries the color at full strength.
5. **Color is never the only signal.** The chip's letters (QUE, CLM, EVD) always say the type.
6. **A lab's own color wins.** A type whose color a lab picked keeps it. A type carrying a default color, this project's or the official plugin's, follows this palette.

## Unit types

As `oklch(lightness chroma hue)`. The dark theme keeps each hue and raises lightness.

| Type | Color | Light theme | Dark theme | Note |
|---|---|---|---|---|
| Question | Violet | `0.50 0.17 300` | `0.68 0.17 300` | Furthest from both relation colors. Dark step |
| Claim | Amber | `0.68 0.145 72` | `0.78 0.15 72` | Asserted, not yet shown. Kept clear of highlighter yellow |
| Evidence | Blue | `0.68 0.15 250` | `0.75 0.135 250` | Neutral toward agreement, so it can support or oppose |
| Source | Grey | `0.55 0.025 250` | `0.72 0.02 250` | Reference material, the background of an argument |
| Protocol | Cyan | `0.63 0.11 215` | `0.68 0.12 215` | |
| Experiment | Pink | `0.62 0.13 340` | `0.84 0.12 340` | |
| Run | Rose, dark | `0.50 0.13 5` | `0.68 0.075 5` | Sibling of Experiment, one step darker |
| Code | Olive | `0.68 0.105 112` | `0.84 0.12 112` | |
| Output | Teal | `0.68 0.12 185` | `0.81 0.07 185` | |
| A canvas inside a canvas | Slate | `0.55 0.04 280` | `0.72 0.04 280` | |

A unit with no type uses the muted text color. Request has no color of its own and follows Question.

## Relations

A relation's color comes from its base, and is the same in every Tidy mode and every base. The canvas legend reads from the same tokens.

| Relation | Light theme | Dark theme |
|---|---|---|
| Supports | `0.56 0.13 155` | `0.74 0.13 155` |
| Opposes | `0.56 0.17 28` | `0.72 0.15 28` |
| Addresses | `0.56 0.13 245` | `0.74 0.11 245` |
| Informs | `0.56 0.05 250` | `0.74 0.04 250` |
| Derived from | `0.56 0.09 200` | `0.74 0.08 200` |
| Grounds | `0.56 0.09 185` | `0.76 0.09 185` |
| Follows | `0.56 0.09 225` | `0.76 0.08 225` |
| Describes activity | `0.56 0.13 340` | `0.74 0.11 340` |
| Request target | `0.54 0.15 300` | `0.72 0.13 300` |

## Found words

Words found by a search are marked with a translucent highlighter yellow (`oklch(0.86 0.17 95 / 0.5)`) behind the text's own color, at 600 weight, so a match is not told by color alone. The row a person is on marks more strongly. In forced-colors mode the system's Mark colors take over.

## What it measures

Differences are CIEDE2000 between rendered colors, in normal vision and with protan and deutan simulation (Machado 2009). Around 2 is barely visible. Category colors want 15 or more.

| Measure | Value |
|---|---|
| Weakest pair of types, normal vision | 16.1 |
| Weakest pair of types, protan or deutan | 6.7 |
| Nearest type to Supports | 19.0 (Output) |
| Nearest type to Opposes | 16.8 (Run) |
| Lowest chip text contrast | Above 4.5:1 |

## Limits

- This many colors cannot all stay far apart for color-blind readers by hue alone. Claim and Code (6.7 protan), Protocol and Experiment (6.9 deutan), and Experiment and Output (7.0 deutan) are the weak pairs, which is why the chip letters matter.
- The numbers come from simulation, not from testing with people.
- Nine relation hues are crowded. Addresses is close to the Evidence blue.

## Research behind the rules

| Finding | What it means here | Source |
|---|---|---|
| Color and emotion pairings are largely shared across 30 nations (r = .88), with smaller local differences | A meaning-based choice is not only a Western habit, but it is a weak guide for abstract types | [Jonauskaite et al. 2020](https://biopen.bi.no/bi-xmlui/bitstream/11250/2761614/1/Jonauskaite_etal_2020_PsychScience.pdf) |
| A color's meaning depends on its context | Color is used to tell things apart and to match conventions, not to change how people think | [Elliot and Maier, color-in-context](https://link.springer.com/article/10.3758/s13423-020-01772-1) |
| Argument maps use green for reasons that support and red for objections | Green and red already mean Supports and Opposes to this audience | [One Minute Mapper](https://www.reasoninglab.com/wp-content/uploads/2013/10/One-minute-mapper.pdf) |
| Any concept can be carried by a color if the colors in the set differ enough in what they suggest | The set matters more than any one color | [Mukherjee et al. 2022](https://arxiv.org/html/2108.03685v4) |
| Good category palettes balance measured difference, different color names, and pleasant pairs | Types have different plain names: violet, amber, blue | [Gramazio et al. 2017](https://connorgr.github.io/pdf/gramazio-2016-ccd.pdf), [Heer and Stone 2012](https://idl.uw.edu/papers/color-naming-models) |
| Small marks need larger color differences than large ones | A faint tint on a card is not enough, so the edge is full strength | [Stone, Szafir and Setlur 2014](https://www.tableau.com/research/publications/engineering-model-color-difference-function-size) |
| Lower-chroma, lighter palettes read as calm and trustworthy | Tints stay light, and the strong color stays on a thin edge | [Bartram, Patra and Stone 2017](https://www.tableau.com/sites/default/files/2023-01/Affective%20Color%20CHI%202017.pdf) |
