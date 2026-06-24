import { useEffect, useMemo, useRef, useState } from "react";
import {
  useGuitarPitch,
  type ChordDetection,
  type RepresentativeNoteDetection,
} from "../engine";
import { formatFrequency, formatPercent } from "../utils/format";

interface DetectedNoteEntry {
  id: number;
  label: string;
  pitchLabel: string | null;
  frequency: number | null;
  confidence: number;
  alternatives: string[];
  startedAt: number;
  endedAt: number | null;
}

export function SimpleTrainerApp() {
  const { status, snapshot, error, start, stop } = useGuitarPitch();
  const [noteHistory, setNoteHistory] = useState<DetectedNoteEntry[]>([]);
  const activeEntryRef = useRef<DetectedNoteEntry | null>(null);
  const nextEntryIdRef = useRef(1);
  const representativeNote = snapshot.representativeNoteDetection;
  const chordDetection = snapshot.chordDetection;
  const candidateChordDetection = snapshot.candidateChordDetection;
  const displayLabel = chordDetection?.chord ?? "--";
  const displayConfidence = chordDetection?.confidence ?? null;

  const statusText = useMemo(() => {
    if (status === "connected") {
      return "Listening";
    }

    if (status === "requesting") {
      return "Opening microphone";
    }

    if (status === "denied") {
      return "Microphone blocked";
    }

    if (status === "error") {
      return "Microphone error";
    }

    return "Ready";
  }, [status]);

  useEffect(() => {
    const now = snapshot.timestamp || performance.now();
    const activeEntry = activeEntryRef.current;
    const representativeChordTone = representativeNoteForChord(
      chordDetection,
      representativeNote,
    );

    if (!chordDetection) {
      if (activeEntry) {
        const endedEntry = { ...activeEntry, endedAt: now };
        activeEntryRef.current = null;
        setNoteHistory((current) =>
          [endedEntry, ...current.filter((entry) => entry.id !== endedEntry.id)].slice(
            0,
            12,
          ),
        );
      }
      return;
    }

    if (activeEntry?.label === displayLabel) {
      const updatedEntry = {
        ...activeEntry,
        pitchLabel: representativeChordTone
          ? formatRepresentativeNote(representativeChordTone)
          : activeEntry.pitchLabel,
        frequency: representativeChordTone?.frequency ?? activeEntry.frequency,
        confidence: displayConfidence ?? activeEntry.confidence,
        alternatives: buildAlternatives(
          chordDetection?.pitchClasses ??
            candidateChordDetection?.pitchClasses ??
            representativeNote?.alternatives ??
            [],
        ),
      };
      activeEntryRef.current = updatedEntry;
      setNoteHistory((current) =>
        current.map((entry) =>
          entry.id === updatedEntry.id ? updatedEntry : entry,
        ),
      );
      return;
    }

    const closedEntry = activeEntry ? { ...activeEntry, endedAt: now } : null;
    const nextEntry: DetectedNoteEntry = {
      id: nextEntryIdRef.current,
      label: displayLabel,
      pitchLabel: representativeChordTone
        ? formatRepresentativeNote(representativeChordTone)
        : null,
      frequency: representativeChordTone?.frequency ?? null,
      confidence: displayConfidence ?? 0,
      alternatives: buildAlternatives(
        chordDetection?.pitchClasses ??
          candidateChordDetection?.pitchClasses ??
          representativeNote?.alternatives ??
          [],
      ),
      startedAt: chordDetection.stableSince ?? now,
      endedAt: null,
    };

    nextEntryIdRef.current += 1;
    activeEntryRef.current = nextEntry;

    setNoteHistory((current) => {
      const withoutClosed = closedEntry
        ? current.filter((entry) => entry.id !== closedEntry.id)
        : current;
      return [nextEntry, ...(closedEntry ? [closedEntry] : []), ...withoutClosed].slice(
        0,
        12,
      );
    });
  }, [
    candidateChordDetection,
    chordDetection,
    displayConfidence,
    displayLabel,
    representativeNote,
    snapshot.timestamp,
  ]);

  return (
    <main className="min-h-screen bg-[#f5f1e8] px-4 py-6 text-ink">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <header className="flex flex-col gap-4 border-b border-zinc-300 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-fret">
              Live guitar detection
            </p>
            <h1 className="mt-2 text-4xl font-black leading-tight">
              Guitar Chord Detector
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <span className="rounded bg-white px-3 py-2 text-sm font-semibold shadow-sm ring-1 ring-zinc-200">
              {statusText}
            </span>
            {status === "connected" ? (
              <button
                className="min-h-11 rounded bg-ink px-4 font-semibold text-white"
                type="button"
                onClick={() => void stop()}
              >
                Stop
              </button>
            ) : (
              <button
                className="min-h-11 rounded bg-fret px-4 font-semibold text-white disabled:opacity-60"
                disabled={status === "requesting"}
                type="button"
                onClick={() => void start()}
              >
                Start
              </button>
            )}
          </div>
        </header>

        {error ? (
          <div className="rounded border border-danger/30 bg-danger/10 p-4 text-sm font-semibold text-red-950">
            {error}
          </div>
        ) : null}

        <section className="rounded border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-bold uppercase tracking-wide text-fret">
                Detected
              </p>
              <p className="mt-3 text-8xl font-black leading-none">
                {displayLabel}
              </p>
            </div>

            <div className="grid min-w-56 gap-3">
              <Stat
                label="Confidence"
                value={formatPercent(displayConfidence)}
              />
              <Stat
                label="Decision"
                value={
                  chordDetection
                    ? "Stable chord"
                    : candidateChordDetection
                      ? "Probable chord"
                      : representativeNote
                        ? "Middle note"
                        : "Listening"
                }
              />
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <Stat
              label="Chord Tones"
              value={
                chordDetection?.pitchClasses.length
                  ? chordDetection.pitchClasses.join(" ")
                  : candidateChordDetection?.pitchClasses.length
                    ? candidateChordDetection.pitchClasses.join(" ")
                    : representativeNote?.alternatives.length
                      ? representativeNote.alternatives.join(" ")
                      : "--"
              }
            />
            <Stat
              label="Middle Note"
              value={
                representativeNote
                  ? `${formatRepresentativeNote(representativeNote)} ${formatFrequency(
                      representativeNote.frequency,
                    )}`
                  : "--"
              }
            />
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Stat
              label="Input Level"
              value={`${Math.round(Math.min(1, snapshot.rms / 0.08) * 100)}%`}
            />
          </div>
        </section>

        <section className="rounded border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold">Detected Events</h2>
              <p className="mt-1 text-sm text-zinc-600">
                Only major, minor, and power chords are accepted.
              </p>
            </div>
            <button
              className="min-h-10 rounded border border-zinc-300 px-4 font-semibold hover:bg-zinc-100"
              type="button"
              onClick={() => {
                activeEntryRef.current = null;
                setNoteHistory([]);
              }}
            >
              Clear
            </button>
          </div>

          <div className="mt-4 overflow-hidden rounded border border-zinc-200">
            {noteHistory.length > 0 ? (
              <div className="divide-y divide-zinc-200">
                {noteHistory.map((entry) => (
                  <DetectedNoteRow entry={entry} key={entry.id} />
                ))}
              </div>
            ) : (
              <p className="bg-zinc-50 p-4 text-sm font-medium text-zinc-600">
                Play a chord to start the list.
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

interface StatProps {
  label: string;
  value: string;
}

function Stat({ label, value }: StatProps) {
  return (
    <div className="rounded bg-zinc-50 p-4">
      <p className="text-sm font-semibold text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}

interface DetectedNoteRowProps {
  entry: DetectedNoteEntry;
}

function DetectedNoteRow({ entry }: DetectedNoteRowProps) {
  const durationMs = (entry.endedAt ?? performance.now()) - entry.startedAt;

  return (
    <div className="grid grid-cols-[0.8fr_1fr_1fr] items-center gap-3 bg-zinc-50 p-4 sm:grid-cols-[0.7fr_1fr_1fr_1fr]">
      <div>
        <p className="text-3xl font-black leading-none">{entry.label}</p>
        {!entry.endedAt ? (
          <p className="mt-1 text-xs font-bold uppercase tracking-wide text-signal">
            Current
          </p>
        ) : null}
      </div>
      <div>
        <p className="text-xs font-semibold text-zinc-500">Duration</p>
        <p className="text-lg font-black">{formatDuration(durationMs)}</p>
      </div>
      <div>
        <p className="text-xs font-semibold text-zinc-500">Pitch</p>
        <p className="text-lg font-black">
          {entry.frequency === null
            ? "Chord only"
            : `${entry.pitchLabel ?? ""} ${formatFrequency(entry.frequency)}`.trim()}
        </p>
      </div>
      <div className="hidden sm:block">
        <p className="text-xs font-semibold text-zinc-500">Similar</p>
        <p className="text-lg font-black">{entry.alternatives.join(" ")}</p>
      </div>
    </div>
  );
}

function formatRepresentativeNote(note: RepresentativeNoteDetection): string {
  return `${note.note}${note.octave}`;
}

function representativeNoteForChord(
  chord: ChordDetection | null,
  note: RepresentativeNoteDetection | null,
): RepresentativeNoteDetection | null {
  if (!chord || !note) {
    return null;
  }

  return chord.pitchClasses.includes(note.note) ? note : null;
}

function buildAlternatives(values: string[]): string[] {
  return [...new Set(values)].slice(0, 6);
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${Math.max(0, Math.round(durationMs))} ms`;
  }

  return `${(durationMs / 1000).toFixed(1)} s`;
}
