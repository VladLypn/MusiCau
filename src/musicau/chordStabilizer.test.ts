import { describe, expect, it } from "vitest";
import { ChordStateStabilizer } from "./chordStabilizer";
import type { ChordQuality, MusicauChordDetection, PitchClass } from "./types";

const TEST_CONFIG = {
  confirmationFrames: 4,
  switchMargin: 0.05,
  smoothingWindow: 8,
  minHoldTimeMs: 500,
  releaseTimeMs: 180,
};

function chord(
  name: string,
  confidence: number,
  root = name.replace(/ .*/, "") as PitchClass,
  quality: ChordQuality = "Major",
): MusicauChordDetection {
  return {
    chord: name,
    root,
    quality,
    notes: [root],
    confidence,
    missingNotes: [],
    extraNotes: [],
    chroma: Array.from({ length: 12 }, () => 0),
    alternatives: [],
  };
}

function updateWith(
  stabilizer: ChordStateStabilizer,
  name: string,
  confidence: number,
  timestamp: number,
) {
  return stabilizer.update([chord(name, confidence)], timestamp);
}

describe("ChordStateStabilizer", () => {
  it("requires four consecutive frames before confirming a chord", () => {
    const stabilizer = new ChordStateStabilizer(TEST_CONFIG);

    for (let frame = 1; frame < 4; frame += 1) {
      const result = updateWith(stabilizer, "G Major", 0.84, frame * 80);
      expect(result.chord).toBeNull();
      expect(result.metrics.state).toBe("CANDIDATE");
    }

    const confirmed = updateWith(stabilizer, "G Major", 0.84, 320);
    expect(confirmed.chord?.chord).toBe("G Major");
    expect(confirmed.metrics.state).toBe("CONFIRMED");

    const locked = updateWith(stabilizer, "G Major", 0.84, 400);
    expect(locked.metrics.state).toBe("LOCKED");
  });

  it("does not flicker during rapid alternating chord predictions", () => {
    const stabilizer = new ChordStateStabilizer(TEST_CONFIG);
    for (let frame = 0; frame < 4; frame += 1) {
      updateWith(stabilizer, "G Major", 0.84, frame * 100);
    }

    for (let frame = 0; frame < 12; frame += 1) {
      const name = frame % 2 === 0 ? "D Major" : "G Major";
      const result = updateWith(stabilizer, name, 0.88, 700 + frame * 100);
      expect(result.chord?.chord).toBe("G Major");
    }
  });

  it("smooths noisy one-frame prediction spikes", () => {
    const stabilizer = new ChordStateStabilizer(TEST_CONFIG);
    for (let frame = 0; frame < 4; frame += 1) {
      updateWith(stabilizer, "C Major", 0.86, frame * 100);
    }

    const spike = updateWith(stabilizer, "F Major", 0.99, 650);
    expect(spike.chord?.chord).toBe("C Major");
    expect(spike.metrics.candidateChord).toBe("F Major");
    expect(spike.metrics.state).toBe("LOCKED");
  });

  it("applies confidence hysteresis before switching on brief similar chords", () => {
    const stabilizer = new ChordStateStabilizer(TEST_CONFIG);
    for (let frame = 0; frame < 4; frame += 1) {
      updateWith(stabilizer, "G Major", 0.82, frame * 100);
    }

    for (let frame = 0; frame < 3; frame += 1) {
      const result = updateWith(stabilizer, "D Major", 0.86, 1200 + frame * 100);
      expect(result.chord?.chord).toBe("G Major");
      expect(result.metrics.candidateChord).not.toBeNull();
    }
  });

  it("enforces minimum hold time before replacement confirmation", () => {
    const stabilizer = new ChordStateStabilizer(TEST_CONFIG);
    for (let frame = 0; frame < 4; frame += 1) {
      updateWith(stabilizer, "A Major", 0.78, frame * 100);
    }

    const held = updateWith(stabilizer, "E Major", 0.98, 550);
    expect(held.chord?.chord).toBe("A Major");
    expect(held.metrics.holdTimeRemaining).toBeGreaterThan(0);

    let result = held;
    for (let frame = 0; frame < 15; frame += 1) {
      result = updateWith(stabilizer, "E Major", 0.98, 1100 + frame * 100);
    }

    expect(result.chord?.chord).toBe("E Major");
    expect(["CONFIRMED", "LOCKED"]).toContain(result.metrics.state);
  });

  it("releases the current chord after sustained empty candidate frames", () => {
    const stabilizer = new ChordStateStabilizer(TEST_CONFIG);
    for (let frame = 0; frame < 4; frame += 1) {
      updateWith(stabilizer, "G Major", 0.84, frame * 100);
    }

    const briefGap = stabilizer.update([], 450);
    expect(briefGap.chord?.chord).toBe("G Major");
    expect(briefGap.metrics.currentChord).toBe("G Major");

    const released = stabilizer.update([], 640);
    expect(released.chord).toBeNull();
    expect(released.metrics.currentChord).toBeNull();
    expect(released.metrics.state).toBe("UNKNOWN");
  });

  it("switches from the current frame candidate before old smoothing decays", () => {
    const stabilizer = new ChordStateStabilizer({
      ...TEST_CONFIG,
      confirmationFrames: 3,
      minHoldTimeMs: 0,
      smoothingWindow: 12,
      switchMargin: 0.01,
    });

    for (let frame = 0; frame < 6; frame += 1) {
      updateWith(stabilizer, "G Major", 0.9, frame * 100);
    }

    let result = updateWith(stabilizer, "D Major", 0.72, 700);
    expect(result.chord?.chord).toBe("G Major");
    expect(result.metrics.candidateChord).toBe("D Major");

    result = updateWith(stabilizer, "D Major", 0.74, 800);
    expect(result.chord?.chord).toBe("G Major");
    expect(result.metrics.candidateChord).toBe("D Major");

    result = updateWith(stabilizer, "D Major", 0.76, 900);
    expect(result.chord?.chord).toBe("D Major");
    expect(result.metrics.state).toBe("CONFIRMED");
  });
});
