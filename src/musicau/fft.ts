import { nextPowerOfTwo } from "./dsp";

export interface FftResult {
  real: Float32Array;
  imaginary: Float32Array;
  magnitudes: Float32Array;
  frequencies: Float32Array;
}

export function magnitudeSpectrum(
  input: Float32Array,
  sampleRate: number,
  requestedSize = input.length,
): FftResult {
  const size = nextPowerOfTwo(requestedSize);
  const real = new Float32Array(size);
  const imaginary = new Float32Array(size);
  real.set(input.subarray(0, Math.min(input.length, size)));

  radix2Fft(real, imaginary);

  const binCount = size / 2;
  const magnitudes = new Float32Array(binCount);
  const frequencies = new Float32Array(binCount);

  for (let bin = 0; bin < binCount; bin += 1) {
    magnitudes[bin] = Math.hypot(real[bin], imaginary[bin]) / binCount;
    frequencies[bin] = (bin * sampleRate) / size;
  }

  return { real, imaginary, magnitudes, frequencies };
}

function radix2Fft(real: Float32Array, imaginary: Float32Array): void {
  const size = real.length;
  if ((size & (size - 1)) !== 0) {
    throw new Error("FFT size must be a power of two.");
  }

  let reversed = 0;
  for (let index = 1; index < size; index += 1) {
    let bit = size >> 1;
    while ((reversed & bit) !== 0) {
      reversed ^= bit;
      bit >>= 1;
    }
    reversed ^= bit;

    if (index < reversed) {
      const tempReal = real[index];
      real[index] = real[reversed];
      real[reversed] = tempReal;

      const tempImaginary = imaginary[index];
      imaginary[index] = imaginary[reversed];
      imaginary[reversed] = tempImaginary;
    }
  }

  for (let length = 2; length <= size; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    const wLengthReal = Math.cos(angle);
    const wLengthImaginary = Math.sin(angle);

    for (let start = 0; start < size; start += length) {
      let wReal = 1;
      let wImaginary = 0;
      const halfLength = length >> 1;

      for (let offset = 0; offset < halfLength; offset += 1) {
        const evenIndex = start + offset;
        const oddIndex = evenIndex + halfLength;
        const oddReal = real[oddIndex] * wReal - imaginary[oddIndex] * wImaginary;
        const oddImaginary =
          real[oddIndex] * wImaginary + imaginary[oddIndex] * wReal;

        real[oddIndex] = real[evenIndex] - oddReal;
        imaginary[oddIndex] = imaginary[evenIndex] - oddImaginary;
        real[evenIndex] += oddReal;
        imaginary[evenIndex] += oddImaginary;

        const nextWReal = wReal * wLengthReal - wImaginary * wLengthImaginary;
        wImaginary = wReal * wLengthImaginary + wImaginary * wLengthReal;
        wReal = nextWReal;
      }
    }
  }
}
