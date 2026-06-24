export type TuningStatus = "in-tune" | "slightly-flat" | "slightly-sharp";

export interface MusicalNote {
  note: string;
  octave: number;
  centsOff: number;
}

export interface NoteDetection extends MusicalNote {
  frequency: number;
  confidence: number;
  status: TuningStatus;
}

export interface ChordDetection {
  chord: string;
  root: string;
  quality: string;
  confidence: number;
  pitchClasses: string[];
  activePitchClasses: Array<{
    note: string;
    energy: number;
    isChordTone: boolean;
  }>;
  bassNote?: string;
  alternatives?: Array<{
    chord: string;
    confidence: number;
  }>;
  stableSince?: number;
}

export interface RepresentativeNoteDetection {
  note: string;
  octave: number;
  frequency: number;
  confidence: number;
  alternatives: string[];
}
