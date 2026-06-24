export { useGuitarPitch } from "./hooks/useGuitarPitch";
export { useNoteMatch } from "./hooks/useNoteMatch";
export { NoteChallenge } from "./components/NoteChallenge";
export { DEFAULT_DETECTION_CONFIG, GuitarPitchDetector } from "./pitch/detector";
export { ChordDetector } from "./pitch/chordDetector";
export { calculateRms } from "./musicau/dsp";
export {
  formatNote,
  frequencyToMidi,
  frequencyToNote,
  getTuningStatus,
  isNoteWithinTolerance,
  midiToFrequency,
  noteToMidi,
  STANDARD_GUITAR_RANGE,
  tuningStatusLabel,
} from "./utils/music";
export type {
  ChordDetection,
  NoteDetection,
  MusicalNote,
  RepresentativeNoteDetection,
  TuningStatus,
} from "./pitch/types";
export type {
  AudioSnapshot,
  AudioDebugMetrics,
  AdaptiveNoiseConfig,
  MicrophoneStatus,
  PitchDetectionConfig,
} from "./types/audio";
