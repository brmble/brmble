# APM Test Fixtures

Synthetic audio fixtures used by the APM integration tests and the ApmBench CLI.

All files are **48 kHz, mono, 16-bit PCM WAV**. Each is 5 seconds long, generated
deterministically (fixed seed for any random content) so the test corpus is stable
across machines.

| File             | Content                                                                 | Target RMS    |
|------------------|-------------------------------------------------------------------------|---------------|
| near_speech.wav  | Three sines (700, 1200, 2400 Hz) + 4 Hz amplitude modulation            | ~-20 dBFS     |
| far_end.wav      | Two sines (400, 900 Hz) + 3 Hz amplitude modulation                     | ~-20 dBFS     |
| noise_speech.wav | near_speech.wav + white Gaussian noise (Random seed 42) at ~-35 dBFS    | ~-20 dBFS     |

**Why synthetic, not the Chromium voice_engine corpus?** The Chromium/WebRTC tree
stores its audio test fixtures behind `.sha1` → Google Cloud Storage indirection
rather than in-tree, so they cannot be fetched directly from gitiles. Synthetic
content gives deterministic, license-clean, CI-stable fixtures at the cost of not
exercising real speech. Real-speech regression testing should happen in manual
A/B sessions via the Settings → Voice → Testing virtual-mic toggle.

## Regenerate

These files are checked in. They were generated once by a one-shot script that is
not part of the tree (kept simple per YAGNI). If you need to change the corpus,
write a fresh generator — the format constraints are noted above.
