import { describe, expect, it } from "vitest";
import {
  SUPPORTED_CHORD_NAMES,
  detectChordFromChroma,
  supportedChordFrequencyBoundaries,
} from "./chords";
import { DEFAULT_MUSICAU_ENGINE_CONFIG, MusicauRealtimeEngine } from "./engine";
import { midiToFrequency } from "./notes";
import { detectPitchYin } from "./pitchDetection";
import { evaluatePerformance } from "./performance";

const SAMPLE_RATE = 44100;

function synthGuitarNote(
  frequency: number,
  durationSeconds = 0.12,
  sampleRate = SAMPLE_RATE,
  gain = 1,
): Float32Array {
  const length = Math.floor(durationSeconds * sampleRate);
  const output = new Float32Array(length);

  for (let index = 0; index < length; index += 1) {
    const time = index / sampleRate;
    const envelope = Math.exp(-time * 5);
    output[index] =
      gain *
      envelope *
      (Math.sin(2 * Math.PI * frequency * time) * 0.75 +
        Math.sin(2 * Math.PI * frequency * 2 * time) * 0.22 +
        Math.sin(2 * Math.PI * frequency * 3 * time) * 0.12);
  }

  return output;
}

function synthChord(midis: number[]): Float32Array {
  const frames = midis.map((midi) => synthGuitarNote(midiToFrequency(midi), 0.18));
  const output = new Float32Array(frames[0].length);

  for (const frame of frames) {
    for (let index = 0; index < output.length; index += 1) {
      output[index] += frame[index] / midis.length;
    }
  }

  return output;
}

function mixSignals(...signals: Float32Array[]): Float32Array {
  const length = Math.max(...signals.map((signal) => signal.length));
  const output = new Float32Array(length);

  for (const signal of signals) {
    for (let index = 0; index < signal.length; index += 1) {
      output[index] += signal[index];
    }
  }

  return output;
}

function deterministicNoise(length: number, gain: number, seed = 17): Float32Array {
  const output = new Float32Array(length);
  let state = seed;

  for (let index = 0; index < length; index += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    output[index] = ((state / 0xffffffff) * 2 - 1) * gain;
  }

  return output;
}

function synthSpeechLike(length: number, gain = 0.04): Float32Array {
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const time = index / SAMPLE_RATE;
    const modulator = 0.55 + 0.45 * Math.sin(2 * Math.PI * 4.5 * time);
    output[index] =
      gain *
      modulator *
      (Math.sin(2 * Math.PI * 180 * time) * 0.4 +
        Math.sin(2 * Math.PI * 720 * time) * 0.35 +
        Math.sin(2 * Math.PI * 1320 * time) * 0.25 +
        Math.sin(2 * Math.PI * 2400 * time) * 0.2);
  }
  return output;
}

function synthFanNoise(length: number, gain = 0.035): Float32Array {
  const output = deterministicNoise(length, gain * 0.45, 44);
  for (let index = 0; index < length; index += 1) {
    const time = index / SAMPLE_RATE;
    output[index] +=
      gain *
      (Math.sin(2 * Math.PI * 58 * time) * 0.7 +
        Math.sin(2 * Math.PI * 116 * time) * 0.35);
  }
  return output;
}

function synthTvNoise(length: number, gain = 0.03): Float32Array {
  return mixSignals(
    deterministicNoise(length, gain * 0.55, 91),
    synthSpeechLike(length, gain * 0.8),
  );
}

function synthKeyboardClicks(length: number, gain = 0.09): Float32Array {
  const output = new Float32Array(length);
  for (let click = 600; click < length; click += 1400) {
    for (let offset = 0; offset < 12 && click + offset < length; offset += 1) {
      output[click + offset] = gain * Math.exp(-offset / 3);
    }
  }
  return output;
}

function calibratedEngine(noise: Float32Array): MusicauRealtimeEngine {
  const engine = new MusicauRealtimeEngine({
    sampleRate: SAMPLE_RATE,
    calibrationMs: 2500,
    minConfidence: 0.34,
    minimumThreshold: 0.0001,
  });

  for (let timestamp = 0; timestamp <= 2600; timestamp += 100) {
    engine.analyze(noise, timestamp);
  }

  return engine;
}

describe("MusiCau DSP", () => {
  it("detects an E2 sine/harmonic note within one hertz", () => {
    const signal = synthGuitarNote(82.41);
    const result = detectPitchYin(signal, SAMPLE_RATE, 70, 1400, 0.12);

    expect(result).not.toBeNull();
    expect(result?.frequency).toBeCloseTo(82.41, 0);
  });

  it("maps a chroma vector to a major chord", () => {
    const chroma = [1, 0, 0, 0, 0.86, 0, 0, 0.92, 0, 0, 0, 0];
    const chord = detectChordFromChroma(chroma);

    expect(chord?.chord).toBe("C Major");
    expect(chord?.notes).toEqual(["C", "E", "G"]);
  });

  it("limits chord recognition to Em, Am, D, G, and C", () => {
    const aMajorChroma = [0, 1, 0, 0, 0.88, 0, 0, 0, 0, 1, 0, 0];
    const chord = detectChordFromChroma(aMajorChroma);

    expect(SUPPORTED_CHORD_NAMES).toEqual([
      "E Minor",
      "A Minor",
      "D Major",
      "G Major",
      "C Major",
    ]);
    expect(chord?.chord).not.toBe("A Major");
    expect(chord?.chord ? SUPPORTED_CHORD_NAMES.includes(chord.chord) : true).toBe(
      true,
    );
  });

  it("recognizes A minor from A, C, and E chroma", () => {
    const aMinor = [0.78, 0, 0, 0, 0.84, 0, 0, 0, 0, 1, 0, 0];
    const chord = detectChordFromChroma(aMinor);

    expect(chord?.chord).toBe("A Minor");
    expect(chord?.notes).toEqual(["A", "C", "E"]);
  });

  it("prefers G over Em when a G shape has D support and extra E leakage", () => {
    const gWithExtraE = [
      0, 0, 0.42, 0, 0.48, 0, 0, 1, 0, 0, 0, 0.68,
    ];
    const chord = detectChordFromChroma(gWithExtraE);

    expect(chord?.chord).toBe("G Major");
  });

  it("still recognizes Em when E, G, and B dominate without D support", () => {
    const eMinor = [0, 0, 0.04, 0, 1, 0, 0, 0.82, 0, 0, 0, 0.76];
    const chord = detectChordFromChroma(eMinor);

    expect(chord?.chord).toBe("E Minor");
  });

  it("keeps Em when light D leakage is present but E remains dominant", () => {
    const eMinorWithDLeakage = [
      0, 0, 0.22, 0, 1, 0, 0, 0.84, 0, 0, 0, 0.78,
    ];
    const chord = detectChordFromChroma(eMinorWithDLeakage);

    expect(chord?.chord).toBe("E Minor");
  });

  it("builds broadened open-position frequency boundaries for supported chords", () => {
    const boundaries = supportedChordFrequencyBoundaries();

    expect(Object.keys(boundaries)).toEqual([
      "E Minor",
      "A Minor",
      "D Major",
      "G Major",
      "C Major",
    ]);
    expect(boundaries["E Minor"][0]).toMatchObject({
      note: "E2",
      frequency: 82.41,
    });
    expect(boundaries["A Minor"].map((boundary) => boundary.note)).toEqual([
      "A2",
      "E3",
      "A3",
      "C4",
      "E4",
    ]);
    expect(boundaries["D Major"].some((boundary) => boundary.note === "F#4")).toBe(
      true,
    );
    expect(boundaries["G Major"][0].minFrequency).toBeLessThan(98);
    expect(boundaries["C Major"][0].maxFrequency).toBeGreaterThan(130.81);
  });

  it("runs note and chord analysis through the realtime engine", () => {
    const noteEngine = new MusicauRealtimeEngine({
      sampleRate: SAMPLE_RATE,
      calibrationMs: 0,
      minimumThreshold: 0.0001,
      minConfidence: 0.35,
    });
    const chordEngine = new MusicauRealtimeEngine({
      sampleRate: SAMPLE_RATE,
      calibrationMs: 0,
      minimumThreshold: 0.0001,
      minConfidence: 0.35,
    });
    const noteFrame = noteEngine.analyze(synthGuitarNote(110));
    let chordFrame = chordEngine.analyze(synthChord([43, 47, 50, 55, 59, 67]), 0);
    for (let frame = 1; frame < 5; frame += 1) {
      chordFrame = chordEngine.analyze(
        synthChord([43, 47, 50, 55, 59, 67]),
        frame * 100,
      );
    }

    expect(noteFrame.note?.note).toBe("A2");
    expect(chordFrame.chord?.root).toBe("G");
    expect(chordFrame.debugMetrics.currentChord).toBe(chordFrame.chord?.chord);
    expect(chordFrame.debugMetrics.confirmationProgress).toBe(1);
    expect(chordFrame.debugMetrics.smoothedProbabilities["G Major"]).toBeGreaterThan(0);
  });

  it("uses the requested anti-flicker defaults", () => {
    expect(DEFAULT_MUSICAU_ENGINE_CONFIG.chordConfirmationFrames).toBe(5);
    expect(DEFAULT_MUSICAU_ENGINE_CONFIG.chordSwitchMargin).toBe(0.01);
    expect(DEFAULT_MUSICAU_ENGINE_CONFIG.chordSmoothingWindow).toBe(12);
    expect(DEFAULT_MUSICAU_ENGINE_CONFIG.chordMinHoldMs).toBe(350);
  });

  it("calibrates the ambient floor before opening detection", () => {
    const noise = deterministicNoise(Math.floor(0.12 * SAMPLE_RATE), 0.008);
    const engine = new MusicauRealtimeEngine({
      sampleRate: SAMPLE_RATE,
      calibrationMs: 2500,
      minimumThreshold: 0.0001,
    });

    const calibratingFrame = engine.analyze(noise, 0);
    const readyFrame = engine.analyze(mixSignals(synthGuitarNote(110), noise), 2800);

    expect(calibratingFrame.debugMetrics.calibrating).toBe(true);
    expect(calibratingFrame.note).toBeNull();
    expect(readyFrame.debugMetrics.calibrating).toBe(false);
    expect(readyFrame.debugMetrics.threshold).toBeGreaterThan(
      readyFrame.debugMetrics.noiseFloor,
    );
    expect(readyFrame.note?.note).toBe("A2");
  });

  it.each([
    ["clean guitar", () => deterministicNoise(Math.floor(0.18 * SAMPLE_RATE), 0.001)],
    ["guitar with speech", () => synthSpeechLike(Math.floor(0.18 * SAMPLE_RATE), 0.025)],
    ["guitar with TV audio", () => synthTvNoise(Math.floor(0.18 * SAMPLE_RATE), 0.022)],
    ["guitar with fan noise", () => synthFanNoise(Math.floor(0.18 * SAMPLE_RATE), 0.03)],
    ["guitar with keyboard clicks", () => synthKeyboardClicks(Math.floor(0.18 * SAMPLE_RATE), 0.07)],
  ])("recognizes A2 under benchmark condition: %s", (_, noiseFactory) => {
    const noise = noiseFactory();
    const engine = calibratedEngine(noise);
    const frame = engine.analyze(mixSignals(synthGuitarNote(110, 0.18, SAMPLE_RATE, 0.9), noise), 3000);

    expect(frame.debugMetrics.signalToNoiseRatio).toBeGreaterThan(1.5);
    expect(frame.note?.note).toBe("A2");
    expect(frame.note?.harmonicConfidence).toBeGreaterThan(0.18);
  });

  it("accepts a slightly detuned guitar and reports cents offset", () => {
    const detunedFrequency = 110 * 2 ** (-18 / 1200);
    const noise = deterministicNoise(Math.floor(0.18 * SAMPLE_RATE), 0.006, 123);
    const engine = calibratedEngine(noise);
    const frame = engine.analyze(
      mixSignals(synthGuitarNote(detunedFrequency, 0.18), noise),
      3000,
    );

    expect(frame.note?.note).toBe("A2");
    expect(frame.note?.centsOff).toBeLessThan(-10);
    expect(frame.note?.centsOff).toBeGreaterThan(-25);
  });

  it("scores gameplay performance with pitch and timing", () => {
    const result = evaluatePerformance(
      { note: "E2", timestamp: 1000 },
      {
        timestamp: 1030,
        note: {
          note: "E2",
          pitchClass: "E",
          octave: 2,
          frequency: 82.4,
          centsOff: -1,
          confidence: 0.96,
          yinConfidence: 0.96,
          autocorrelationConfidence: 0.93,
          harmonicConfidence: 0.91,
          gateOpen: true,
          noiseFloorDb: -70,
        },
      },
    );

    expect(result.correct).toBe(true);
    expect(result.score).toBeGreaterThan(85);
  });
});
