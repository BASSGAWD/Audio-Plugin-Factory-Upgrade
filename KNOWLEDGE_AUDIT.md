# OrangeJuce Knowledge Audit

Generated 2026-07-16T09:46:40.131Z — every number below is measured, not claimed.

## 1. Inventory

- Golden recipes: **10**
- Composable primitives: **10**
- Topology variants (engineering choices): **12**
- Graph nodes: **32**, reachable concepts: **83**

## 2. Curriculum coverage — overall 76%

`██████░░░░` **Compressors** 57% (8/14)
`█████████░` **Reverbs** 86% (6/7)
`███████░░░` **Delays** 67% (4/6)
`█████████░` **Distortion** 86% (6/7)
`████████░░` **Filters & EQ** 83% (5/6)
`████████░░` **Modulation** 75% (3/4)
`████████░░` **Pitch & Time** 80% (4/5)
`██████░░░░` **Synthesis** 60% (3/5)
`██████████` **Engineering hygiene** 100% (8/8)

### Gap report (the shopping list)

- **Compressors**: Parallel (NY) compression; Multiband compression; Sidechain input (external key); Internal sidechain filtering (de-esser); Opto/VCA/FET circuit models; Stereo linking / mid-side
- **Reverbs**: Convolution / impulse responses
- **Delays**: Multi-tap patterns; Ping-pong / stereo spread
- **Distortion**: Dynamic (level-tracking) saturation
- **Filters & EQ**: Biquad / RBJ cookbook forms
- **Modulation**: Phaser (allpass cascade)
- **Pitch & Time**: Spectral (FFT) processing
- **Synthesis**: Wavetable synthesis; FM synthesis

## 3. Balance (modules per concept)

- **compressor** ×5: dynamics (recipe), comp_ff_rms (topology), comp_peak_punch (topology), comp_feedback_glue (topology), comp_lookahead_master (topology)
- **reverb** ×4: reverb (recipe), reverb_schroeder (topology), reverb_fdn_plate (topology), reverb_room_er (topology)
- **delay** ×4: delay (recipe), echo (primitive), delay_tape (topology), delay_digital (topology)
- **distortion** ×4: distortion (recipe), dist_softclip (topology), dist_tube_asym (topology), dist_fuzz (topology)

## 4. Trust tiers

| Tier | What | Contents | Validation |
|------|------|----------|------------|
| 1 | Gate-verified shipped code | golden recipes, primitives, topology variants | every module must score >= 97 in the regression suite before it can ship |
| 2 | Gate infrastructure | signal bank, measurements, semantic checks | covered by its own test suites (hardening, knobMath, signalBank) |
| 3 | Deterministic heuristics | intent classifier, requirements inference, tweak rules | spec + coverage-audit test suites |
| 4 | Learned, re-validated at use | candidate recipe memory, learned pitfalls (localStorage) | re-gated before reuse; pitfalls only bias prompts, never ship code |
| 5 | Model proposals | local LLM rework/edit suggestions | never trusted: must beat the incumbent's measured score to survive |

## 5. Demonstrated ability — 100% of benchmarks ship at the >= 97 floor

| Benchmark | Family | Min score | Ships? | Candidates | Topology chosen |
|-----------|--------|-----------|--------|------------|-----------------|
| Transparent mastering compressor | dynamics | 100 | yes | 4 | comp_lookahead_master |
| Drum smash compressor | dynamics | 100 | yes | 4 | comp_peak_punch |
| Vintage vocal compressor | dynamics | 100 | yes | 4 | comp_feedback_glue |
| Live vocal compressor | dynamics | 100 | yes | 4 | comp_feedback_glue |
| Plate vocal reverb | reverb | 100 | yes | 4 | reverb_fdn_plate |
| Tight drum room | reverb | 100 | yes | 4 | reverb_room_er |
| Shimmer reverb | reverb | 100 | yes | 4 | reverb_schroeder |
| Tape echo | delay | 100 | yes | 4 | delay_tape |
| Pristine digital delay | delay | 100 | yes | 3 | delay_digital |
| Tube saturation | saturator | 100 | yes | 2 | — |
| Hard fuzz | distortion | 100 | yes | 4 | dist_fuzz |
| Resonant filter sweep | filter | 100 | yes | 2 | — |
| 3-band EQ | eq | 100 | yes | 3 | — |
| Chorus | modulation | 100 | yes | 2 | — |
| Autotune | pitch | 100 | yes | 2 | — |
| Drum pads | sampler | 100 | yes | 2 | — |
| Synth pad | synthesizer | 100 | yes | 2 | — |
| Novel hybrid | hybrid_other | 100 | yes | 1 | — |

---
Regenerate with `npm run audit`. Coverage comes from the knowledge graph
(src/utils/knowledgeGraph.ts); ability comes from real gated builds.