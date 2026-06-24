import { useEffect, useMemo, useRef, useState } from "react";
import { useMusicauRecognition } from "./hooks/useMusicauRecognition";
import type { AudioSnapshot, MicrophoneStatus } from "./types/audio";
import type { ChordDetection } from "./pitch/types";
import { formatCents, formatFrequency, formatPercent } from "./utils/format";

type AppPage = "home" | "tuner" | "chords" | "practice" | "debug";

interface ChordEvent {
  id: number;
  chord: string;
  confidence: number;
  startedAt: number;
  endedAt: number | null;
}

interface LatencyMetrics {
  frameGapMs: number | null;
  lastUpdateAgeMs: number;
}

interface PracticeStats {
  score: number;
  attempts: number;
  hits: number;
  streak: number;
}

const TARGET_CHORDS = ["Em", "Am", "D", "G", "C"];
const PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const PAGE_LABELS: Record<AppPage, string> = {
  home: "Home",
  tuner: "Tuner",
  chords: "Chords",
  practice: "Practice",
  debug: "Debug",
};

const EMPTY_LATENCY: LatencyMetrics = {
  frameGapMs: null,
  lastUpdateAgeMs: 0,
};

export default function App() {
  const { status, snapshot, error, usingAudioWorklet, start, stop } =
    useMusicauRecognition();
  const [page, setPage] = useState<AppPage>("home");
  const [darkMode, setDarkMode] = useState(false);
  const [events, setEvents] = useState<ChordEvent[]>([]);
  const [practiceIndex, setPracticeIndex] = useState(0);
  const [practiceStats, setPracticeStats] = useState<PracticeStats>({
    score: 0,
    attempts: 0,
    hits: 0,
    streak: 0,
  });
  const [feedback, setFeedback] = useState("Waiting for your first chord.");
  const [latency, setLatency] = useState<LatencyMetrics>(EMPTY_LATENCY);
  const activeEventRef = useRef<ChordEvent | null>(null);
  const nextEventIdRef = useRef(1);
  const lastFrameRef = useRef<{ timestamp: number; updatedAt: number } | null>(null);
  const lastPracticeChordRef = useRef<string | null>(null);

  const lockedChord = snapshot.chordDetection;
  const candidateChord = snapshot.candidateChordDetection;
  const displayChord = lockedChord ?? candidateChord;
  const isConnected = status === "connected";
  const expectedChord = TARGET_CHORDS[practiceIndex];
  const statusLabel = useStatusLabel(status, snapshot, lockedChord, candidateChord);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const lastFrame = lastFrameRef.current;
      setLatency((current) => ({
        ...current,
        lastUpdateAgeMs: lastFrame ? performance.now() - lastFrame.updatedAt : 0,
      }));
    }, 250);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!snapshot.timestamp) {
      return;
    }

    const now = performance.now();
    const previous = lastFrameRef.current;
    lastFrameRef.current = { timestamp: snapshot.timestamp, updatedAt: now };
    setLatency({
      frameGapMs: previous ? now - previous.updatedAt : null,
      lastUpdateAgeMs: 0,
    });
  }, [snapshot.timestamp]);

  useEffect(() => {
    const currentChord = lockedChord;
    const now = performance.now();
    const activeEvent = activeEventRef.current;

    if (!currentChord) {
      if (activeEvent) {
        const closed = { ...activeEvent, endedAt: now };
        activeEventRef.current = null;
        setEvents((current) =>
          [closed, ...current.filter((event) => event.id !== closed.id)].slice(0, 10),
        );
      }
      return;
    }

    if (activeEvent?.chord === currentChord.chord) {
      const updated = {
        ...activeEvent,
        confidence: currentChord.confidence,
      };
      activeEventRef.current = updated;
      setEvents((current) =>
        current.map((event) => (event.id === updated.id ? updated : event)),
      );
      return;
    }

    const nextEvent = {
      id: nextEventIdRef.current,
      chord: currentChord.chord,
      confidence: currentChord.confidence,
      startedAt: now,
      endedAt: null,
    };
    nextEventIdRef.current += 1;
    activeEventRef.current = nextEvent;
    setEvents((current) => [nextEvent, ...current].slice(0, 10));
  }, [lockedChord]);

  useEffect(() => {
    if (!lockedChord || lastPracticeChordRef.current === lockedChord.chord) {
      return;
    }

    lastPracticeChordRef.current = lockedChord.chord;
    setPracticeStats((current) => {
      const matched = lockedChord.chord === expectedChord;
      const nextStreak = matched ? current.streak + 1 : 0;
      return {
        score: Math.max(0, current.score + (matched ? 100 + nextStreak * 10 : -15)),
        attempts: current.attempts + 1,
        hits: current.hits + (matched ? 1 : 0),
        streak: nextStreak,
      };
    });

    if (lockedChord.chord === expectedChord) {
      setFeedback(`${expectedChord} locked. Moving to the next chord.`);
      setPracticeIndex((current) => (current + 1) % TARGET_CHORDS.length);
    } else {
      setFeedback(`Heard ${lockedChord.chord}. Aim for ${expectedChord}.`);
    }
  }, [expectedChord, lockedChord]);

  const shellClass = darkMode ? "dark" : "";

  return (
    <main className={`${shellClass} min-h-screen bg-stone-100 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50`}>
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-4 sm:px-6 lg:px-8">
        <AppHeader
          darkMode={darkMode}
          isConnected={isConnected}
          page={page}
          status={status}
          statusLabel={statusLabel}
          usingAudioWorklet={usingAudioWorklet}
          onDarkModeChange={setDarkMode}
          onNavigate={setPage}
          onStart={start}
          onStop={stop}
        />

        {error ? (
          <div className="mt-4 rounded-md border border-red-400/40 bg-red-100 px-4 py-3 text-sm font-bold text-red-950 shadow-sm dark:bg-red-950/40 dark:text-red-100">
            {error}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 py-5">
          {page === "home" ? (
            <HomePage
              snapshot={snapshot}
              status={status}
              statusLabel={statusLabel}
              onNavigate={setPage}
              onStart={start}
            />
          ) : null}
          {page === "tuner" ? <TunerPage snapshot={snapshot} /> : null}
          {page === "chords" ? (
            <ChordRecognitionPage
              displayChord={displayChord}
              events={events}
              locked={Boolean(lockedChord)}
            />
          ) : null}
          {page === "practice" ? (
            <PracticePage
              detectedChord={lockedChord}
              expectedChord={expectedChord}
              feedback={feedback}
              practiceIndex={practiceIndex}
              stats={practiceStats}
              onExpectedChordChange={(index) => {
                setPracticeIndex(index);
                setFeedback(`Ready for ${TARGET_CHORDS[index]}.`);
              }}
              onReset={() => {
                setPracticeStats({ score: 0, attempts: 0, hits: 0, streak: 0 });
                setPracticeIndex(0);
                setFeedback("Practice reset. Start with Em.");
                lastPracticeChordRef.current = null;
              }}
            />
          ) : null}
          {page === "debug" ? (
            <DebugPage
              displayChord={displayChord}
              latency={latency}
              snapshot={snapshot}
              usingAudioWorklet={usingAudioWorklet}
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}

function useStatusLabel(
  status: MicrophoneStatus,
  snapshot: AudioSnapshot,
  lockedChord: ChordDetection | null,
  candidateChord: ChordDetection | null,
) {
  return useMemo(() => {
    if (status === "requesting") {
      return "Opening microphone";
    }
    if (status === "connected" && snapshot.debugMetrics.calibrating) {
      return "Calibrating";
    }
    if (status === "connected" && lockedChord) {
      return "Chord locked";
    }
    if (status === "connected" && candidateChord) {
      return "Checking chord";
    }
    if (status === "connected") {
      return snapshot.gateOpen ? "Listening" : "Quiet";
    }
    if (status === "denied") {
      return "Microphone blocked";
    }
    if (status === "error") {
      return "Audio error";
    }
    return "Ready";
  }, [candidateChord, lockedChord, snapshot, status]);
}

function AppHeader({
  darkMode,
  isConnected,
  page,
  status,
  statusLabel,
  usingAudioWorklet,
  onDarkModeChange,
  onNavigate,
  onStart,
  onStop,
}: {
  darkMode: boolean;
  isConnected: boolean;
  page: AppPage;
  status: MicrophoneStatus;
  statusLabel: string;
  usingAudioWorklet: boolean;
  onDarkModeChange: (enabled: boolean) => void;
  onNavigate: (page: AppPage) => void;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
}) {
  return (
    <header className="sticky top-0 z-20 -mx-4 border-b border-zinc-200/80 bg-stone-100/90 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <button
            className="flex min-w-0 items-center gap-3 rounded-md text-left transition hover:opacity-80"
            type="button"
            onClick={() => onNavigate("home")}
          >
            <img
              alt="MusiCau"
              className="h-11 w-11 rounded-md border border-zinc-200 bg-white object-contain p-1 dark:border-zinc-700 dark:bg-zinc-900"
              src="/assets/logo_MusiCau_mark.png"
            />
            <div className="min-w-0">
              <img alt="MusiCau" className="h-6 w-auto dark:brightness-125" src="/assets/logo_MusiCau.webp" />
              <p className="mt-1 text-xs font-black uppercase tracking-normal text-teal-700 dark:text-teal-300">
                Real-time guitar studio
              </p>
            </div>
          </button>
          <StatusPill label={statusLabel} status={status} />
        </div>

        <nav className="flex gap-2 overflow-x-auto pb-1 lg:pb-0">
          {(Object.keys(PAGE_LABELS) as AppPage[]).map((target) => (
            <button
              className={`min-h-10 whitespace-nowrap rounded-md border px-3 text-sm font-black transition ${
                page === target
                  ? "border-teal-700 bg-teal-700 text-white shadow-sm dark:border-teal-300 dark:bg-teal-300 dark:text-zinc-950"
                  : "border-zinc-300 bg-white text-zinc-700 hover:border-teal-500 hover:text-teal-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-teal-300"
              }`}
              key={target}
              type="button"
              onClick={() => onNavigate(target)}
            >
              {PAGE_LABELS[target]}
            </button>
          ))}
        </nav>

        <div className="flex flex-wrap items-center gap-2">
          <InlineBadge label="Engine" value={usingAudioWorklet ? "Worklet" : "Worker"} />
          <label className="flex min-h-10 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
            <input
              checked={darkMode}
              className="h-4 w-4 accent-teal-700"
              type="checkbox"
              onChange={(event) => onDarkModeChange(event.target.checked)}
            />
            Dark
          </label>
          {isConnected ? (
            <button
              className="min-h-10 rounded-md border border-zinc-900 bg-zinc-900 px-4 text-sm font-black text-white transition hover:bg-zinc-700 dark:border-zinc-200 dark:bg-zinc-200 dark:text-zinc-950"
              type="button"
              onClick={() => void onStop()}
            >
              Stop
            </button>
          ) : (
            <button
              className="min-h-10 rounded-md border border-teal-700 bg-teal-700 px-4 text-sm font-black text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-teal-300 dark:bg-teal-300 dark:text-zinc-950"
              disabled={status === "requesting"}
              type="button"
              onClick={() => void onStart()}
            >
              Start
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

function HomePage({
  snapshot,
  status,
  statusLabel,
  onNavigate,
  onStart,
}: {
  snapshot: AudioSnapshot;
  status: MicrophoneStatus;
  statusLabel: string;
  onNavigate: (page: AppPage) => void;
  onStart: () => Promise<void>;
}) {
  return (
    <section className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
      <div className="rounded-md border border-zinc-200 bg-white p-5 shadow-sm transition dark:border-zinc-800 dark:bg-zinc-900 sm:p-7">
        <p className="text-sm font-black uppercase tracking-normal text-teal-700 dark:text-teal-300">
          MusiCau
        </p>
        <h1 className="mt-4 max-w-3xl text-4xl font-black leading-tight sm:text-6xl">
          Guitar recognition for tuning, chords, and practice.
        </h1>
        <p className="mt-5 max-w-2xl text-base font-semibold leading-7 text-zinc-600 dark:text-zinc-300">
          A browser-based studio built around adaptive noise handling, live pitch
          tracking, stabilized chord detection, and gameplay feedback for real
          guitar sessions.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <button
            className="min-h-12 rounded-md border border-teal-700 bg-teal-700 px-5 font-black text-white transition hover:bg-teal-800 dark:border-teal-300 dark:bg-teal-300 dark:text-zinc-950"
            type="button"
            onClick={() => {
              void onStart();
              onNavigate("practice");
            }}
          >
            Start learning
          </button>
          <button
            className="min-h-12 rounded-md border border-zinc-900 bg-zinc-900 px-5 font-black text-white transition hover:bg-zinc-700 dark:border-zinc-200 dark:bg-zinc-200 dark:text-zinc-950"
            type="button"
            onClick={() => {
              void onStart();
              onNavigate("tuner");
            }}
          >
            Start tuning
          </button>
        </div>
      </div>

      <div className="grid gap-4">
        <LiveOverviewCard snapshot={snapshot} status={status} statusLabel={statusLabel} />
        <div className="grid gap-4 sm:grid-cols-2">
          <FeatureTile label="Noise aware" value="Adaptive gate" />
          <FeatureTile label="Pitch" value="YIN + checks" />
          <FeatureTile label="Chords" value="Stable state" />
          <FeatureTile label="Practice" value="Score + progress" />
        </div>
      </div>
    </section>
  );
}

function TunerPage({ snapshot }: { snapshot: AudioSnapshot }) {
  const detection = snapshot.detection;
  const cents = detection?.centsOff ?? null;
  const marker = 50 + Math.max(-50, Math.min(50, cents ?? 0));
  const label = detection ? `${detection.note}${detection.octave}` : "--";
  const guidance = getTuningGuidance(cents);

  return (
    <section className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
      <div className="rounded-md border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-black uppercase tracking-normal text-teal-700 dark:text-teal-300">
              Live note
            </p>
            <p className="mt-4 text-8xl font-black leading-none sm:text-9xl">{label}</p>
          </div>
          <ConfidenceRing value={detection?.confidence ?? 0} />
        </div>

        <div className="mt-10">
          <div className="relative h-6 rounded-full bg-gradient-to-r from-red-500 via-emerald-500 to-amber-400 shadow-inner">
            <div className="absolute left-1/2 top-[-0.65rem] h-11 w-px bg-zinc-950/70 dark:bg-white/80" />
            <div
              className="absolute top-[-0.45rem] h-10 w-3 rounded-full bg-zinc-950 shadow-lg transition-[left] duration-150 dark:bg-white"
              style={{ left: `calc(${marker}% - 0.375rem)` }}
            />
          </div>
          <div className="mt-3 grid grid-cols-3 text-xs font-black uppercase text-zinc-500 dark:text-zinc-400">
            <span>Flat</span>
            <span className="text-center">In tune</span>
            <span className="text-right">Sharp</span>
          </div>
        </div>
      </div>

      <div className="grid gap-4">
        <MetricPanel
          metrics={[
            ["Frequency", formatFrequency(detection?.frequency ?? null)],
            ["Cents", formatCents(cents)],
            ["Guidance", guidance],
            ["Gate", snapshot.gateOpen ? "Open" : "Closed"],
          ]}
          title="Tuning guidance"
        />
        <SignalPanel snapshot={snapshot} />
      </div>
    </section>
  );
}

function ChordRecognitionPage({
  displayChord,
  events,
  locked,
}: {
  displayChord: ChordDetection | null;
  events: ChordEvent[];
  locked: boolean;
}) {
  return (
    <section className="grid gap-5 xl:grid-cols-[1fr_0.9fr]">
      <div className="rounded-md border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="text-sm font-black uppercase tracking-normal text-teal-700 dark:text-teal-300">
              Current recognized chord
            </p>
            <ChordDisplay chord={displayChord} locked={locked} />
          </div>
          <ConfidenceRing value={displayChord?.confidence ?? 0} />
        </div>
        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          <WideMetric label="Root" value={displayChord?.root ?? "--"} />
          <WideMetric label="Quality" value={displayChord?.quality ?? "--"} />
          <WideMetric label="Confidence" value={formatPercent(displayChord?.confidence ?? null)} />
        </div>
        <div className="mt-5">
          <ChordNotes notes={displayChord?.pitchClasses ?? []} />
        </div>
      </div>

      <div className="grid gap-5">
        <ChromaPanel chord={displayChord} />
        <ChordHistory events={events} />
      </div>
    </section>
  );
}

function PracticePage({
  detectedChord,
  expectedChord,
  feedback,
  practiceIndex,
  stats,
  onExpectedChordChange,
  onReset,
}: {
  detectedChord: ChordDetection | null;
  expectedChord: string;
  feedback: string;
  practiceIndex: number;
  stats: PracticeStats;
  onExpectedChordChange: (index: number) => void;
  onReset: () => void;
}) {
  const accuracy = stats.attempts > 0 ? stats.hits / stats.attempts : 0;
  const progress = ((practiceIndex + 1) / TARGET_CHORDS.length) * 100;
  const matched = detectedChord?.chord === expectedChord;

  return (
    <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
      <div className="rounded-md border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-black uppercase tracking-normal text-teal-700 dark:text-teal-300">
              Expected chord
            </p>
            <p className="mt-4 text-8xl font-black leading-none sm:text-9xl">
              {expectedChord}
            </p>
          </div>
          <span
            className={`rounded-md px-3 py-2 text-sm font-black uppercase ${
              matched
                ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-400/20 dark:text-emerald-200"
                : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
            }`}
          >
            {matched ? "Hit" : "Live"}
          </span>
        </div>
        <div className="mt-7">
          <MiniFretboard targetChord={expectedChord} detected={detectedChord?.chord ?? null} />
        </div>
        <div className="mt-7 grid grid-cols-3 gap-2">
          {TARGET_CHORDS.map((chord, index) => (
            <button
              className={`min-h-12 rounded-md border px-3 text-lg font-black transition ${
                expectedChord === chord
                  ? "border-teal-700 bg-teal-700 text-white dark:border-teal-300 dark:bg-teal-300 dark:text-zinc-950"
                  : "border-zinc-300 bg-white hover:border-teal-500 dark:border-zinc-700 dark:bg-zinc-900"
              }`}
              key={chord}
              type="button"
              onClick={() => onExpectedChordChange(index)}
            >
              {chord}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-5">
        <div className="rounded-md border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-black">Performance feedback</h2>
              <p className="mt-3 text-lg font-bold text-zinc-600 dark:text-zinc-300">
                {feedback}
              </p>
            </div>
            <button
              className="min-h-10 rounded-md border border-zinc-300 px-4 text-sm font-black transition hover:border-teal-500 dark:border-zinc-700"
              type="button"
              onClick={onReset}
            >
              Reset
            </button>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <WideMetric label="Score" value={String(stats.score)} />
            <WideMetric label="Streak" value={String(stats.streak)} />
            <WideMetric label="Accuracy" value={formatPercent(accuracy)} />
            <WideMetric label="Detected" value={detectedChord?.chord ?? "--"} />
          </div>
        </div>

        <div className="rounded-md border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-black">Progress</h2>
            <span className="text-sm font-black text-zinc-500 dark:text-zinc-400">
              {practiceIndex + 1} / {TARGET_CHORDS.length}
            </span>
          </div>
          <div className="mt-5 h-4 rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div
              className="h-4 rounded-full bg-gradient-to-r from-teal-700 to-amber-400 transition-[width] duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-5 grid gap-2">
            {TARGET_CHORDS.map((chord, index) => (
              <div
                className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm font-black ${
                  index === practiceIndex
                    ? "border-teal-600 bg-teal-50 text-teal-900 dark:border-teal-300 dark:bg-teal-300/10 dark:text-teal-100"
                    : "border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400"
                }`}
                key={chord}
              >
                <span>{chord}</span>
                <span>{index < practiceIndex ? "Done" : index === practiceIndex ? "Now" : "Next"}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function DebugPage({
  displayChord,
  latency,
  snapshot,
  usingAudioWorklet,
}: {
  displayChord: ChordDetection | null;
  latency: LatencyMetrics;
  snapshot: AudioSnapshot;
  usingAudioWorklet: boolean;
}) {
  const detection = snapshot.detection;
  const metrics = snapshot.debugMetrics;

  return (
    <section className="grid gap-5 xl:grid-cols-[1fr_1fr]">
      <MetricPanel
        title="Signal metrics"
        metrics={[
          ["RMS", metrics.rms.toFixed(5)],
          ["Noise floor", metrics.noiseFloor.toFixed(5)],
          ["Threshold", metrics.threshold.toFixed(5)],
          ["SNR", metrics.signalToNoiseRatio.toFixed(2)],
          ["Gate", snapshot.gateOpen ? "Open" : "Closed"],
          ["Calibration", `${Math.round(metrics.calibrationProgress * 100)}%`],
        ]}
      />
      <MetricPanel
        title="Recognition metrics"
        metrics={[
          ["Current note", detection ? `${detection.note}${detection.octave}` : "--"],
          ["Current chord", metrics.currentChord ?? displayChord?.chord ?? "--"],
          ["Candidate chord", metrics.candidateChord ?? "--"],
          ["Pitch confidence", formatPercent(metrics.pitchConfidence)],
          ["Chord confidence", formatPercent(metrics.currentConfidence)],
          ["Candidate confidence", formatPercent(metrics.candidateConfidence)],
        ]}
      />
      <MetricPanel
        title="Latency metrics"
        metrics={[
          ["Mode", usingAudioWorklet ? "AudioWorklet" : "Analyser fallback"],
          ["Frame gap", formatMs(latency.frameGapMs)],
          ["UI age", formatMs(latency.lastUpdateAgeMs)],
          ["Hold remaining", formatMs(metrics.holdTimeRemaining)],
          ["Confirm progress", formatPercent(metrics.confirmationProgress)],
          ["State", snapshot.chordStability.state],
        ]}
      />
      <div className="rounded-md border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-xl font-black">Smoothed chord probabilities</h2>
        <div className="mt-5 flex flex-col gap-3">
          {Object.entries(metrics.smoothedProbabilities).length > 0 ? (
            Object.entries(metrics.smoothedProbabilities)
              .slice(0, 8)
              .map(([chord, confidence]) => (
                <CandidateRow confidence={confidence} key={chord} label={formatChordName(chord)} />
              ))
          ) : (
            <CandidateRow confidence={0} label="--" />
          )}
        </div>
      </div>
    </section>
  );
}

function LiveOverviewCard({
  snapshot,
  status,
  statusLabel,
}: {
  snapshot: AudioSnapshot;
  status: MicrophoneStatus;
  statusLabel: string;
}) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-black uppercase tracking-normal text-teal-700 dark:text-teal-300">
            Live system
          </p>
          <h2 className="mt-3 text-2xl font-black">{statusLabel}</h2>
        </div>
        <StatusPill label={status === "connected" ? "Online" : "Offline"} status={status} />
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <InlineMetric label="Note" value={snapshot.detection ? `${snapshot.detection.note}${snapshot.detection.octave}` : "--"} />
        <InlineMetric label="Chord" value={snapshot.chordDetection?.chord ?? snapshot.candidateChordDetection?.chord ?? "--"} />
        <InlineMetric label="RMS" value={snapshot.debugMetrics.rms.toFixed(4)} />
        <InlineMetric label="Noise" value={snapshot.debugMetrics.noiseFloor.toFixed(4)} />
      </div>
    </div>
  );
}

function FeatureTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-h-28 rounded-md border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs font-black uppercase text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-3 text-2xl font-black">{value}</p>
    </div>
  );
}

function StatusPill({ label, status }: { label: string; status: MicrophoneStatus | string }) {
  const active = status === "connected";
  return (
    <div
      className={`flex min-h-10 shrink-0 items-center justify-center rounded-md border px-3 text-sm font-black ${
        active
          ? "border-emerald-500/40 bg-emerald-100 text-emerald-900 dark:bg-emerald-400/20 dark:text-emerald-100"
          : "border-zinc-300 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
      }`}
    >
      {label}
    </div>
  );
}

function ChordDisplay({ chord, locked }: { chord: ChordDetection | null; locked: boolean }) {
  if (!chord) {
    return (
      <div className="mt-4 flex h-32 items-end">
        <p className="text-7xl font-black leading-none text-zinc-300 dark:text-zinc-700 sm:text-8xl">
          --
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 flex min-h-32 flex-wrap items-end gap-3">
      <p className="max-w-full break-words text-7xl font-black leading-none sm:text-8xl">
        {chord.chord}
      </p>
      <span
        className={`mb-2 rounded-md px-3 py-1 text-xs font-black uppercase ${
          locked
            ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-400/20 dark:text-emerald-100"
            : "bg-amber-100 text-amber-900 dark:bg-amber-300/20 dark:text-amber-100"
        }`}
      >
        {locked ? "Locked" : "Candidate"}
      </span>
    </div>
  );
}

function ConfidenceRing({ value }: { value: number }) {
  const degrees = Math.round(Math.max(0, Math.min(1, value)) * 360);
  return (
    <div
      className="grid h-24 w-24 shrink-0 place-items-center rounded-full transition"
      style={{
        background: `conic-gradient(#0f766e ${degrees}deg, rgba(161, 161, 170, 0.35) 0deg)`,
      }}
    >
      <div className="grid h-16 w-16 place-items-center rounded-full bg-white text-lg font-black text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
        {formatPercent(value)}
      </div>
    </div>
  );
}

function ChordNotes({ notes }: { notes: string[] }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-xs font-black uppercase text-zinc-500 dark:text-zinc-400">
        Chord notes
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {PITCH_CLASSES.map((note) => {
          const active = notes.includes(note);
          return (
            <span
              className={`grid h-11 min-w-11 place-items-center rounded-md border px-3 text-sm font-black transition ${
                active
                  ? "border-teal-700 bg-teal-700 text-white dark:border-teal-300 dark:bg-teal-300 dark:text-zinc-950"
                  : "border-zinc-200 bg-white text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-500"
              }`}
              key={note}
            >
              {note}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function ChromaPanel({ chord }: { chord: ChordDetection | null }) {
  const pitches =
    chord?.activePitchClasses ??
    PITCH_CLASSES.map((note) => ({ note, energy: 0, isChordTone: false }));

  return (
    <section className="rounded-md border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-xl font-black">Notes visualization</h2>
      <div className="mt-5 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
        {pitches.map((pitch) => (
          <div
            className={`min-h-24 rounded-md border p-2 transition ${
              pitch.isChordTone
                ? "border-teal-600/60 bg-teal-50 dark:border-teal-300/70 dark:bg-teal-300/10"
                : "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950"
            }`}
            key={pitch.note}
          >
            <div className="flex h-full flex-col justify-between">
              <div className="flex items-center justify-between gap-1">
                <span className="text-base font-black">{pitch.note}</span>
                <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400">
                  {Math.round(pitch.energy * 100)}
                </span>
              </div>
              <div className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-800">
                <div
                  className={`h-2 rounded-full transition-[width] duration-150 ${
                    pitch.isChordTone ? "bg-teal-700 dark:bg-teal-300" : "bg-zinc-400"
                  }`}
                  style={{ width: `${Math.max(4, pitch.energy * 100)}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SignalPanel({ snapshot }: { snapshot: AudioSnapshot }) {
  return (
    <section className="rounded-md border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-xl font-black">Real-time signal</h2>
      <div className="mt-5 flex flex-col gap-4">
        <SignalMeter label="Input" value={snapshot.rms} max={0.08} />
        <SignalMeter label="SNR" value={snapshot.debugMetrics.signalToNoiseRatio} max={8} />
        <SignalMeter label="Harmonics" value={snapshot.debugMetrics.harmonicConfidence} max={1} />
      </div>
    </section>
  );
}

function ChordHistory({ events }: { events: ChordEvent[] }) {
  return (
    <section className="rounded-md border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-xl font-black">Chord history</h2>
      <div className="mt-4 flex flex-col gap-3">
        {events.length > 0 ? (
          events.map((event) => <ChordEventRow event={event} key={event.id} />)
        ) : (
          <div className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm font-semibold text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400">
            No chords yet
          </div>
        )}
      </div>
    </section>
  );
}

function MetricPanel({
  metrics,
  title,
}: {
  metrics: Array<[string, string]>;
  title: string;
}) {
  return (
    <section className="rounded-md border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-xl font-black">{title}</h2>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {metrics.map(([label, value]) => (
          <InlineMetric label={label} key={label} value={value} />
        ))}
      </div>
    </section>
  );
}

function CandidateRow({ label, confidence }: { label: string; confidence: number }) {
  return (
    <div className="grid grid-cols-[minmax(3.5rem,5rem)_1fr_4rem] items-center gap-3">
      <span className="min-w-0 break-words text-xl font-black">{label}</span>
      <SignalMeter label="" value={confidence} max={1} compact />
      <span className="text-right text-sm font-black text-zinc-600 dark:text-zinc-300">
        {formatPercent(confidence)}
      </span>
    </div>
  );
}

function SignalMeter({
  label,
  value,
  max,
  compact = false,
}: {
  label: string;
  value: number;
  max: number;
  compact?: boolean;
}) {
  const percent = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={compact ? "" : "space-y-2"}>
      {label ? (
        <div className="flex items-center justify-between text-sm font-bold text-zinc-600 dark:text-zinc-300">
          <span>{label}</span>
          <span>{Math.round(percent)}%</span>
        </div>
      ) : null}
      <div className={`${compact ? "h-3" : "h-4"} rounded-full bg-zinc-200 dark:bg-zinc-800`}>
        <div
          className={`${compact ? "h-3" : "h-4"} rounded-full bg-gradient-to-r from-teal-700 to-amber-400 transition-[width] duration-150`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function WideMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-h-20 rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-xs font-black uppercase text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-2 min-w-0 break-words text-2xl font-black leading-tight">{value}</p>
    </div>
  );
}

function InlineMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-xs font-black uppercase text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-1 min-w-0 break-words text-base font-black">{value}</p>
    </div>
  );
}

function InlineBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="hidden min-h-10 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900 sm:flex">
      <span className="font-bold text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="font-black">{value}</span>
    </div>
  );
}

function MiniFretboard({
  targetChord,
  detected,
}: {
  targetChord: string;
  detected: string | null;
}) {
  const matched = targetChord === detected;
  return (
    <div className="rounded-md border border-zinc-700 bg-[#252a2c] p-4 shadow-inner">
      <div className="grid grid-rows-6 gap-3">
        {Array.from({ length: 6 }, (_, stringIndex) => (
          <div className="grid grid-cols-5 items-center gap-2" key={stringIndex}>
            {Array.from({ length: 5 }, (_, fret) => (
              <div
                className={`h-2 rounded-full transition ${
                  matched && fret === stringIndex % 5
                    ? "bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.8)]"
                    : fret === 0
                      ? "bg-amber-400"
                      : "bg-zinc-500"
                }`}
                key={fret}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function ChordEventRow({ event }: { event: ChordEvent }) {
  const duration = Math.max(0, (event.endedAt ?? performance.now()) - event.startedAt);

  return (
    <div className="grid grid-cols-[4rem_1fr] items-center gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="min-w-0 break-words text-2xl font-black">{event.chord}</p>
      <div>
        <div className="flex items-center justify-between gap-2 text-xs font-black uppercase text-zinc-500 dark:text-zinc-400">
          <span>{formatDuration(duration)}</span>
          <span>{formatPercent(event.confidence)}</span>
        </div>
        <div className="mt-2">
          <SignalMeter label="" value={event.confidence} max={1} compact />
        </div>
      </div>
    </div>
  );
}

function getTuningGuidance(cents: number | null): string {
  if (cents === null) {
    return "Play a single string";
  }
  if (Math.abs(cents) <= 5) {
    return "In tune";
  }
  if (cents < 0) {
    return "Tune up";
  }
  return "Tune down";
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${Math.round(durationMs)} ms`;
  }

  return `${(durationMs / 1000).toFixed(1)} s`;
}

function formatMs(durationMs: number | null): string {
  if (durationMs === null || !Number.isFinite(durationMs)) {
    return "--";
  }
  return `${Math.round(durationMs)} ms`;
}

function formatChordName(chord: string): string {
  return chord
    .replace(" Major 7", "maj7")
    .replace(" Minor 7", "m7")
    .replace(" Dominant 7th", "7")
    .replace(" Major", "")
    .replace(" Minor", "m")
    .replace(" Power", "5");
}
