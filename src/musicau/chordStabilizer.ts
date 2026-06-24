import type {
  ChordRecognitionState,
  ChordStabilityMetrics,
  MusicauChordDetection,
} from "./types";

export interface ChordStabilizerConfig {
  confirmationFrames: number;
  switchMargin: number;
  smoothingWindow: number;
  minHoldTimeMs: number;
  releaseTimeMs?: number;
}

export interface ChordStabilizerResult {
  chord: MusicauChordDetection | null;
  rawCandidate: MusicauChordDetection | null;
  metrics: ChordStabilityMetrics;
}

const EMPTY_METRICS: ChordStabilityMetrics = {
  state: "UNKNOWN",
  currentChord: null,
  candidateChord: null,
  currentConfidence: 0,
  candidateConfidence: 0,
  confirmationProgress: 0,
  holdTimeRemaining: 0,
  smoothedProbabilities: {},
};

export class ChordStateStabilizer {
  private state: ChordRecognitionState = "UNKNOWN";
  private activeChord: MusicauChordDetection | null = null;
  private pendingChord: string | null = null;
  private pendingFrames = 0;
  private lastChangeAt = -Infinity;
  private noCandidateStartedAt: number | null = null;
  private readonly history: Array<Record<string, number>> = [];
  private readonly latestDetections = new Map<string, MusicauChordDetection>();

  constructor(private readonly config: ChordStabilizerConfig) {}

  reset(): void {
    this.state = "UNKNOWN";
    this.activeChord = null;
    this.pendingChord = null;
    this.pendingFrames = 0;
    this.lastChangeAt = -Infinity;
    this.noCandidateStartedAt = null;
    this.history.length = 0;
    this.latestDetections.clear();
  }

  update(
    candidates: readonly MusicauChordDetection[],
    timestamp: number,
  ): ChordStabilizerResult {
    if (this.state === "CONFIRMED") {
      this.state = "LOCKED";
    }

    const instantDistribution = Object.fromEntries(
      candidates.map((candidate) => {
        this.latestDetections.set(candidate.chord, candidate);
        return [candidate.chord, candidate.confidence];
      }),
    );
    this.pushDistribution(instantDistribution);

    const smoothedProbabilities = this.smoothedProbabilities();
    if (candidates.length === 0) {
      return this.updateWithoutCandidates(smoothedProbabilities, timestamp);
    }

    this.noCandidateStartedAt = null;
    const best = this.activeChord
      ? this.bestReplacementCandidate(candidates, instantDistribution, smoothedProbabilities)
      : this.bestSmoothedCandidate(smoothedProbabilities);

    if (!best) {
      if (!this.activeChord) {
        this.state = "UNKNOWN";
      }
      this.pendingChord = null;
      this.pendingFrames = 0;
      return this.result(null, smoothedProbabilities, timestamp);
    }

    const candidate = this.withSmoothedConfidence(best.chord, best.confidence);
    if (!candidate) {
      return this.result(null, smoothedProbabilities, timestamp);
    }

    if (!this.activeChord) {
      this.confirmInitialCandidate(candidate, timestamp);
      return this.result(candidate, smoothedProbabilities, timestamp);
    }

    if (candidate.chord === this.activeChord.chord) {
      this.activeChord = {
        ...this.activeChord,
        confidence: candidate.confidence,
      };
      this.pendingChord = null;
      this.pendingFrames = 0;
      this.state = "LOCKED";
      return this.result(candidate, smoothedProbabilities, timestamp);
    }

    const holdRemaining = this.holdTimeRemaining(timestamp);
    if (holdRemaining > 0) {
      this.pendingChord = null;
      this.pendingFrames = 0;
      this.state = "LOCKED";
      return this.result(candidate, smoothedProbabilities, timestamp);
    }

    const rawReplacementBeatsCurrent =
      candidates[0]?.chord === candidate.chord &&
      candidate.chord !== this.activeChord.chord &&
      candidates[0].confidence >
        (instantDistribution[this.activeChord.chord] ?? 0) + this.config.switchMargin;
    const hasSwitchMargin =
      rawReplacementBeatsCurrent ||
      candidate.confidence >
        this.activeChord.confidence + this.config.switchMargin;
    if (!hasSwitchMargin) {
      this.pendingChord = null;
      this.pendingFrames = 0;
      this.state = "LOCKED";
      return this.result(candidate, smoothedProbabilities, timestamp);
    }

    this.confirmReplacementCandidate(candidate, timestamp);
    return this.result(candidate, smoothedProbabilities, timestamp);
  }

  getMetrics(): ChordStabilityMetrics {
    return this.result(null, this.smoothedProbabilities(), performance.now()).metrics;
  }

  private confirmInitialCandidate(
    candidate: MusicauChordDetection,
    timestamp: number,
  ): void {
    this.state = "CANDIDATE";
    this.advancePending(candidate.chord);

    if (this.pendingFrames >= this.config.confirmationFrames) {
      this.activate(candidate, timestamp);
    }
  }

  private confirmReplacementCandidate(
    candidate: MusicauChordDetection,
    timestamp: number,
  ): void {
    this.state = "CANDIDATE";
    this.advancePending(candidate.chord);

    if (this.pendingFrames >= this.config.confirmationFrames) {
      this.activate(candidate, timestamp);
    }
  }

  private activate(candidate: MusicauChordDetection, timestamp: number): void {
    this.activeChord = candidate;
    this.lastChangeAt = timestamp;
    this.noCandidateStartedAt = null;
    this.pendingChord = null;
    this.pendingFrames = 0;
    this.state = "CONFIRMED";
  }

  private updateWithoutCandidates(
    smoothedProbabilities: Record<string, number>,
    timestamp: number,
  ): ChordStabilizerResult {
    if (!this.activeChord) {
      this.clearPending();
      this.history.length = 0;
      return this.result(null, {}, timestamp);
    }

    if (this.noCandidateStartedAt === null) {
      this.noCandidateStartedAt = timestamp;
    }

    if (timestamp - this.noCandidateStartedAt >= this.releaseTimeMs()) {
      this.activeChord = null;
      this.lastChangeAt = -Infinity;
      this.noCandidateStartedAt = null;
      this.clearPending();
      this.history.length = 0;
      return this.result(null, {}, timestamp);
    }

    this.clearPending();
    this.state = "LOCKED";
    return this.result(null, smoothedProbabilities, timestamp);
  }

  private clearPending(): void {
    this.pendingChord = null;
    this.pendingFrames = 0;
    if (!this.activeChord) {
      this.state = "UNKNOWN";
    }
  }

  private releaseTimeMs(): number {
    return this.config.releaseTimeMs ?? 180;
  }

  private advancePending(chord: string): void {
    if (this.pendingChord === chord) {
      this.pendingFrames += 1;
      return;
    }

    this.pendingChord = chord;
    this.pendingFrames = 1;
  }

  private pushDistribution(distribution: Record<string, number>): void {
    this.history.push(distribution);
    while (this.history.length > this.config.smoothingWindow) {
      this.history.shift();
    }
  }

  private smoothedProbabilities(): Record<string, number> {
    if (this.history.length === 0) {
      return {};
    }

    const totals = new Map<string, number>();
    for (const distribution of this.history) {
      for (const [chord, confidence] of Object.entries(distribution)) {
        totals.set(chord, (totals.get(chord) ?? 0) + confidence);
      }
    }

    return Object.fromEntries(
      [...totals.entries()]
        .map(([chord, total]) => [chord, total / this.history.length] as const)
        .sort((left, right) => right[1] - left[1]),
    );
  }

  private bestSmoothedCandidate(
    probabilities: Record<string, number>,
  ): { chord: string; confidence: number } | null {
    const [best] = Object.entries(probabilities).sort(
      (left, right) => right[1] - left[1],
    );
    if (!best || best[1] <= 0) {
      return null;
    }

    return {
      chord: best[0],
      confidence: best[1],
    };
  }

  private bestReplacementCandidate(
    candidates: readonly MusicauChordDetection[],
    instantDistribution: Record<string, number>,
    smoothedProbabilities: Record<string, number>,
  ): { chord: string; confidence: number } | null {
    if (!this.activeChord) {
      return this.bestSmoothedCandidate(smoothedProbabilities);
    }

    const rawBest = candidates[0];
    if (!rawBest || rawBest.chord === this.activeChord.chord) {
      return this.bestSmoothedCandidate(smoothedProbabilities);
    }

    const currentInstantConfidence = instantDistribution[this.activeChord.chord] ?? 0;
    const rawBeatsCurrent =
      rawBest.confidence > currentInstantConfidence + this.config.switchMargin;
    if (!rawBeatsCurrent) {
      return this.bestSmoothedCandidate(smoothedProbabilities);
    }

    return {
      chord: rawBest.chord,
      confidence: rawBest.confidence,
    };
  }

  private withSmoothedConfidence(
    chord: string,
    confidence: number,
  ): MusicauChordDetection | null {
    const detection = this.latestDetections.get(chord);
    return detection ? { ...detection, confidence } : null;
  }

  private holdTimeRemaining(timestamp: number): number {
    if (!this.activeChord) {
      return 0;
    }

    return Math.max(0, this.config.minHoldTimeMs - (timestamp - this.lastChangeAt));
  }

  private result(
    candidate: MusicauChordDetection | null,
    smoothedProbabilities: Record<string, number>,
    timestamp: number,
  ): ChordStabilizerResult {
    const confirmationProgress =
      this.state === "CANDIDATE"
        ? Math.min(1, this.pendingFrames / this.config.confirmationFrames)
        : this.state === "CONFIRMED" || this.state === "LOCKED"
          ? 1
          : 0;
    const candidateChord = candidate?.chord ?? this.pendingChord;
    const candidateConfidence =
      candidate?.confidence ??
      (candidateChord ? smoothedProbabilities[candidateChord] ?? 0 : 0);

    return {
      chord: this.activeChord,
      rawCandidate: candidate,
      metrics: {
        ...EMPTY_METRICS,
        state: this.state,
        currentChord: this.activeChord?.chord ?? null,
        candidateChord: candidateChord ?? null,
        currentConfidence: this.activeChord?.confidence ?? 0,
        candidateConfidence,
        confirmationProgress,
        holdTimeRemaining: this.holdTimeRemaining(timestamp),
        smoothedProbabilities,
      },
    };
  }
}
