export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function amplitudeToDb(amplitude: number): number {
  return 20 * Math.log10(Math.max(1e-8, amplitude));
}

export function dbToAmplitude(db: number): number {
  return 10 ** (db / 20);
}

export function calculateRms(buffer: Float32Array): number {
  if (buffer.length === 0) {
    return 0;
  }

  let sumSquares = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    const sample = buffer[index];
    sumSquares += sample * sample;
  }

  return Math.sqrt(sumSquares / buffer.length);
}

export function removeDc(buffer: Float32Array): Float32Array {
  if (buffer.length === 0) {
    return buffer;
  }

  let mean = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    mean += buffer[index];
  }
  mean /= buffer.length;

  const output = new Float32Array(buffer.length);
  for (let index = 0; index < buffer.length; index += 1) {
    output[index] = buffer[index] - mean;
  }

  return output;
}

export function applyHannWindow(buffer: Float32Array): Float32Array {
  const output = new Float32Array(buffer.length);
  const denominator = Math.max(1, buffer.length - 1);

  for (let index = 0; index < buffer.length; index += 1) {
    const windowValue = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / denominator);
    output[index] = buffer[index] * windowValue;
  }

  return output;
}

export function nextPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(1, value)));
}

export class BiquadBandpass {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(
    sampleRate: number,
    lowFrequency = 70,
    highFrequency = 1800,
  ) {
    const centerFrequency = Math.sqrt(lowFrequency * highFrequency);
    const q = centerFrequency / (highFrequency - lowFrequency);
    const omega = (2 * Math.PI * centerFrequency) / sampleRate;
    const alpha = Math.sin(omega) / (2 * q);
    const cosOmega = Math.cos(omega);
    const a0 = 1 + alpha;

    this.b0 = alpha / a0;
    this.b1 = 0;
    this.b2 = -alpha / a0;
    this.a1 = (-2 * cosOmega) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  process(input: Float32Array): Float32Array {
    const output = new Float32Array(input.length);

    for (let index = 0; index < input.length; index += 1) {
      const x0 = input[index];
      const y0 =
        this.b0 * x0 +
        this.b1 * this.x1 +
        this.b2 * this.x2 -
        this.a1 * this.y1 -
        this.a2 * this.y2;

      output[index] = y0;
      this.x2 = this.x1;
      this.x1 = x0;
      this.y2 = this.y1;
      this.y1 = y0;
    }

    return output;
  }
}

export function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function spectralCentroid(
  magnitudes: Float32Array,
  frequencies: Float32Array,
): number {
  let weighted = 0;
  let total = 0;

  for (let index = 0; index < magnitudes.length; index += 1) {
    const magnitude = magnitudes[index];
    weighted += magnitude * frequencies[index];
    total += magnitude;
  }

  return total > 0 ? weighted / total : 0;
}
