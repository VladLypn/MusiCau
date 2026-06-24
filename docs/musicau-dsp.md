# MusiCau Real-Time Guitar Recognition

MusiCau's browser engine lives in `src/musicau`. It is designed for real-time microphone feedback with a deterministic DSP stage first and an optional neural model second. The deterministic path is intentionally complete on its own so lessons still work when a TensorFlow.js model has not been downloaded.

## Runtime Pipeline

Audio is captured with the Web Audio API using disabled browser echo cancellation, noise suppression, and automatic gain control. `src/musicau/audio/createMusicauAudioGraph.ts` prefers an AudioWorklet capture processor that posts 2048-sample transferable frames to a Web Worker. At 44.1 kHz this keeps capture latency near 46 ms while keeping the UI thread out of the DSP loop. The analyser node remains available for compatibility and visualization.

The analysis chain is:

1. DC removal and guitar band-pass filtering.
2. Startup ambient calibration for the first 2.5 seconds.
3. Hann windowing and FFT magnitude spectrum.
4. Adaptive RMS thresholding and spectral subtraction.
5. YIN pitch detection.
6. Autocorrelation validation.
7. Harmonic validation.
8. Chroma extraction.
9. Chord candidate ranking and confidence scoring.
10. Temporal chord smoothing and state stabilization.
11. Optional ML feature extraction with Meyda, Essentia.js, and TensorFlow.js.

## YIN

YIN estimates the fundamental period with the difference function:

```text
d_t(tau) = sum_j (x_j - x_{j + tau})^2
```

MusiCau then computes the cumulative mean normalized difference:

```text
d'_t(tau) = d_t(tau) / ((1 / tau) * sum_{j=1..tau} d_t(j))
```

The first local minimum below the threshold is converted to frequency as `sampleRate / tau`. A parabolic refinement around the minimum improves sub-bin accuracy, which is what lets slightly detuned strings stay stable around the nearest note.

## Autocorrelation

Autocorrelation is used as a validator rather than the primary detector:

```text
r(tau) = sum_j x_j * x_{j + tau}
```

The engine searches near the YIN lag and scores the normalized correlation. If YIN and autocorrelation disagree by too many cents, confidence is reduced instead of snapping to the wrong octave.

## Adaptive Noise Floor

There is no user-controlled microphone sensitivity. MusiCau assumes the first 2-3 seconds after microphone activation contain ambient sound only. During that window it initializes both an RMS noise floor and an FFT-bin noise spectrum.

The RMS floor follows the requested rolling estimator:

```text
noiseFloor = alpha * noiseFloor + (1 - alpha) * currentRMS
threshold = max(noiseFloor * multiplier, minimumThreshold)
```

The default alpha is `0.995` and the default multiplier is `3`. When a guitar note is active, the floor still adapts, but more slowly, so a classroom or cafe can get louder during a session without the current note being absorbed into the floor.

Each analysis frame exposes:

```ts
{
  rms: number;
  noiseFloor: number;
  threshold: number;
  signalToNoiseRatio: number;
  harmonicConfidence: number;
  pitchConfidence: number;
  currentChord: string | null;
  candidateChord: string | null;
  currentConfidence: number;
  candidateConfidence: number;
  confirmationProgress: number;
  holdTimeRemaining: number;
  smoothedProbabilities: Record<string, number>;
  calibrating: boolean;
  calibrationProgress: number;
}
```

## FFT and Spectral Subtraction

The FFT converts the current chunk into frequency bins. The adaptive noise reducer maintains a per-bin floor and subtracts it:

```text
clean[k] = max(0, magnitude[k] - noiseFloor[k] * strength)
```

Bins that remain close to the estimated spectral floor are zeroed before pitch and chord decisions are accepted. Speech, TV-like broadband content, fan noise, high-frequency keyboard clicks, and short impulse events are rejected before note/chord decisions are accepted.

## Confidence Scoring

Accepted notes combine:

- RMS strength relative to the adaptive noise floor.
- Harmonic-series consistency.
- Pitch stability over recent frames.
- Agreement between YIN, FFT-bin support, and autocorrelation.

This keeps random speech peaks and broadband noise from becoming guitar notes, while still allowing slightly detuned strings to pass with a cents offset.

## Chroma

Each FFT bin between the guitar limits is mapped to the nearest MIDI note and folded into one of 12 pitch classes:

```text
pitchClass = round(12 * log2(f / 440) + 69) mod 12
```

Bins far from a chromatic center are down-weighted, so imperfect tuning is tolerated without turning broadband noise into chord tones.

## Chord Matching

Chord templates cover major, minor, dominant 7th, major 7th, minor 7th, suspended, and power chords. Each candidate is scored with cosine similarity, chord-tone coverage, root support, missing-tone penalties, and extra-tone penalties. This allows common guitar realities: missing fifths, strong harmonics, duplicate octaves, and small amounts of background noise.

## Chord Stabilization

Instant chord candidates are not displayed immediately. They first pass through a temporal state machine:

```text
UNKNOWN -> CANDIDATE -> CONFIRMED -> LOCKED
```

Defaults:

- `CONFIRMATION_FRAMES = 4`
- `SWITCH_MARGIN = 0.05`
- `SMOOTHING_WINDOW = 8`
- `MIN_HOLD_TIME_MS = 500`

The stabilizer stores recent chord probability distributions and selects from moving-average confidence scores. A replacement chord must survive the confirmation period, the current chord's minimum hold time, and the confidence hysteresis margin before becoming active. This prevents visible flicker between related chords during strums, brief missed notes, and one-frame confidence spikes.

Each frame exposes chord stability diagnostics:

```ts
{
  currentChord: string | null;
  candidateChord: string | null;
  currentConfidence: number;
  candidateConfidence: number;
  confirmationProgress: number;
  holdTimeRemaining: number;
  smoothedProbabilities: Record<string, number>;
}
```

## Gameplay API

The public entry point is `src/musicau/index.ts`:

```ts
import { MusicauRealtimeEngine, evaluatePerformance } from "./musicau";

const engine = new MusicauRealtimeEngine({ sampleRate: 44100 });
const note = engine.detectNote(audioChunk);
const chord = engine.detectChord(audioChunk);
const score = evaluatePerformance({ note: "E2" }, { note });
```

Returned note detections include frequency, cents offset, confidence, YIN/autocorrelation/harmonic sub-scores, gate state, and noise floor. Chord detections include notes, missing notes, extra notes, chroma, alternatives, and confidence.

## ML Second Stage

`src/musicau/ml` exposes feature adapters. Meyda and Essentia.js are loaded dynamically when installed; TensorFlow.js is also loaded dynamically so the deterministic app remains usable without a model bundle.

The expected neural input bundle is:

- Log spectrogram frames.
- 12-bin chroma vector.
- Harmonic feature summary.

The expected output is:

- Note probabilities.
- Chord probabilities.
- Confidence.

The Python scaffold in `training/musicau` builds CNN, CRNN, and Transformer experiments with clean/noised guitar recordings.
