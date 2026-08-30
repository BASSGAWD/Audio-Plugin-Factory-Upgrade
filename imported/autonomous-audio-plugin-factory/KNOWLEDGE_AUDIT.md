# OrangeJuce Knowledge Audit

Generated 2026-08-21T18:27:59.201Z — every number below is measured, not claimed.

## 1. Inventory

- Golden recipes: **13**
- Composable primitives: **10**
- Topology variants (engineering choices): **28**
- Graph nodes: **51**, reachable concepts: **130**

## 2. Curriculum coverage — overall 95%

`██████████` **Compressors** 100% (14/14)
`██████████` **Reverbs** 100% (7/7)
`██████████` **Delays** 100% (6/6)
`██████████` **Distortion** 100% (7/7)
`██████████` **Filters & EQ** 100% (6/6)
`██████████` **Modulation** 100% (4/4)
`██████████` **Pitch & Time** 100% (5/5)
`██████████` **Synthesis** 100% (5/5)
`██████████` **Engineering hygiene** 100% (8/8)
`░░░░░░░░░░` **Test invariants** 0% (0/3)

### Gap report (the shopping list)

- **Test invariants**: Reserved: audit-honesty anchor (not a real capability — see knowledgeAuditTest.ts); Reserved: permanently-blocked research demo (not a real capability — see researchCorpus.ts); Reserved: approvable research demo (not a real capability — see researchCorpus.ts)

## 3. Balance (modules per concept)

- **compressor** ×12: dynamics (recipe), comp_ff_rms (topology), comp_peak_punch (topology), comp_feedback_glue (topology), comp_lookahead_master (topology), comp_opto (topology), comp_fet_1176 (topology), comp_multiband_2band (topology), comp_deesser (topology), comp_parallel (topology), comp_midside (topology), comp_sidechain_ext (topology)
- **delay** ×6: delay (recipe), echo (primitive), delay_tape (topology), delay_digital (topology), delay_pingpong (topology), delay_multitap (topology)
- **reverb** ×5: reverb (recipe), reverb_schroeder (topology), reverb_fdn_plate (topology), reverb_room_er (topology), reverb_convolution (topology)
- **distortion** ×5: distortion (recipe), dist_softclip (topology), dist_tube_asym (topology), dist_fuzz (topology), dist_dynamic_sat (topology)
- **synthesizer** ×4: synth (recipe), synth_pad (topology), synth_wavetable (topology), synth_fm (topology)
- **equalizer** ×3: eq (recipe), eq_3band (topology), eq_biquad_bell (topology)

## 4. Trust tiers

| Tier | What | Contents | Validation |
|------|------|----------|------------|
| 1 | Gate-verified shipped code | golden recipes, primitives, topology variants | every module must score >= 97 in the regression suite before it can ship |
| 2 | Gate infrastructure | signal bank, measurements, semantic checks | covered by its own test suites (hardening, knobMath, signalBank) |
| 3 | Deterministic heuristics | intent classifier, requirements inference, tweak rules | spec + coverage-audit test suites |
| 4 | Learned, re-validated at use | candidate recipe memory, learned pitfalls (localStorage) | re-gated before reuse; pitfalls only bias prompts, never ship code |
| 5 | Model proposals | local LLM rework/edit suggestions | never trusted: must beat the incumbent's measured score to survive |

## 5. Demonstrated ability — 100% of benchmarks ship at the >= 97 floor (avg code health 99)

| Benchmark | Family | Min score | Code health | Ships? | Candidates | Topology chosen |
|-----------|--------|-----------|-------------|--------|------------|-----------------|
| Transparent mastering compressor | dynamics | 100 | 100 | yes | 4 | comp_lookahead_master |
| Drum smash compressor | dynamics | 100 | 97 | yes | 4 | comp_peak_punch |
| Vintage vocal compressor | dynamics | 100 | 97 | yes | 4 | comp_feedback_glue |
| Live vocal compressor | dynamics | 100 | 97 | yes | 4 | comp_feedback_glue |
| Plate vocal reverb | reverb | 100 | 100 | yes | 4 | reverb_fdn_plate |
| Tight drum room | reverb | 100 | 100 | yes | 4 | reverb_room_er |
| Shimmer reverb | reverb | 100 | 100 | yes | 4 | reverb_schroeder |
| Tape echo | delay | 100 | 100 | yes | 4 | delay_tape |
| Pristine digital delay | delay | 100 | 100 | yes | 4 | delay_digital |
| Tube saturation | saturator | 100 | 100 | yes | 2 | — |
| Hard fuzz | distortion | 100 | 100 | yes | 4 | dist_fuzz |
| Resonant filter sweep | filter | 100 | 97 | yes | 2 | — |
| 3-band EQ | eq | 100 | 100 | yes | 4 | eq_3band |
| Chorus | modulation | 100 | 100 | yes | 3 | — |
| Autotune | pitch | 100 | 97 | yes | 2 | — |
| Drum pads | sampler | 100 | 100 | yes | 2 | — |
| Synth pad | synthesizer | 100 | 100 | yes | 4 | synth_wavetable |
| Novel hybrid | hybrid_other | 100 | 100 | yes | 4 | — |

---
Regenerate with `npm run audit`. Coverage comes from the knowledge graph
(src/utils/knowledgeGraph.ts); ability comes from real gated builds.