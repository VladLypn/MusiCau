import { describe, expect, it } from "vitest";
import {
  formatNote,
  frequencyToNote,
  isNoteWithinTolerance,
  noteToMidi,
} from "./music";

describe("frequencyToNote", () => {
  it.each([
    [82.41, "E2"],
    [110, "A2"],
    [146.83, "D3"],
    [196, "G3"],
    [246.94, "B3"],
    [329.63, "E4"],
  ])("maps %d Hz to %s", (frequency, expected) => {
    expect(formatNote(frequencyToNote(frequency))).toBe(expected);
  });

  it("reports cents offset around the nearest chromatic note", () => {
    expect(frequencyToNote(109.7)).toMatchObject({
      note: "A",
      octave: 2,
      centsOff: -5,
    });
  });
});

describe("note matching", () => {
  it("parses note names with octaves", () => {
    expect(noteToMidi("E2")).toBe(40);
    expect(noteToMidi("C#4")).toBe(61);
  });

  it("matches the same note within tolerance", () => {
    expect(isNoteWithinTolerance(frequencyToNote(82.41), "E2")).toBe(true);
  });
});
