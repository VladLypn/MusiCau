# MusiCau Chord Frequency Boundaries

MusiCau does not use one fixed frequency range per chord, such as `C7 = 130 Hz to 523 Hz`.
Chord recognition is chroma based:

1. FFT bins are accepted only inside the guitar-analysis range.
2. Each accepted bin is mapped to the nearest equal-tempered note.
3. A bin contributes to that note only if it is within `+-45 cents` of the note center.
4. Notes are folded into 12 pitch classes: `C C# D D# E F F# G G# A A# B`.
5. Chord templates are matched against those pitch classes.

## Active Frequency Ranges

For the current simple trainer path:

- Pitch detection: `80 Hz` to `1400 Hz`
- Harmonic chord fundamentals: `80 Hz` to `1400 Hz`
- Direct chroma FFT bins: `80 Hz` to `2520 Hz`
- Front band-pass: approximately `65.6 Hz` to `2240 Hz`

For the default MusiCau realtime engine:

- Pitch detection: `70 Hz` to `1400 Hz`
- Harmonic chord fundamentals: `70 Hz` to `1400 Hz`
- Direct chroma FFT bins: `70 Hz` to `2520 Hz`
- Front band-pass: approximately `57.4 Hz` to `2240 Hz`

## Note Window Formula

For a note center frequency `f`, MusiCau accepts FFT-bin energy for that note when:

```text
low  = f * 2^(-45 / 1200)
high = f * 2^( 45 / 1200)
```

Example:

```text
D3 center = 146.83 Hz
D3 window = 143.06 Hz to 150.70 Hz
```

## Guitar-Range Note Windows

| Note | Low Hz | Center Hz | High Hz |
|---|---:|---:|---:|
| E2 | 80.29 | 82.41 | 84.58 |
| F2 | 85.07 | 87.31 | 89.61 |
| F#2 | 90.13 | 92.50 | 94.93 |
| G2 | 95.48 | 98.00 | 100.58 |
| G#2 | 101.16 | 103.83 | 106.56 |
| A2 | 107.18 | 110.00 | 112.90 |
| A#2 | 113.55 | 116.54 | 119.61 |
| B2 | 120.30 | 123.47 | 126.72 |
| C3 | 127.46 | 130.81 | 134.26 |
| C#3 | 135.04 | 138.59 | 142.24 |
| D3 | 143.06 | 146.83 | 150.70 |
| D#3 | 151.57 | 155.56 | 159.66 |
| E3 | 160.58 | 164.81 | 169.15 |
| F3 | 170.13 | 174.61 | 179.21 |
| F#3 | 180.25 | 185.00 | 189.87 |
| G3 | 190.97 | 196.00 | 201.16 |
| G#3 | 202.32 | 207.65 | 213.12 |
| A3 | 214.36 | 220.00 | 225.79 |
| A#3 | 227.10 | 233.08 | 239.22 |
| B3 | 240.61 | 246.94 | 253.44 |
| C4 | 254.91 | 261.63 | 268.52 |
| C#4 | 270.07 | 277.18 | 284.48 |
| D4 | 286.13 | 293.66 | 301.40 |
| D#4 | 303.14 | 311.13 | 319.32 |
| E4 | 321.17 | 329.63 | 338.31 |
| F4 | 340.27 | 349.23 | 358.42 |
| F#4 | 360.50 | 369.99 | 379.74 |
| G4 | 381.94 | 392.00 | 402.32 |
| G#4 | 404.65 | 415.30 | 426.24 |
| A4 | 428.71 | 440.00 | 451.59 |
| A#4 | 454.20 | 466.16 | 478.44 |
| B4 | 481.21 | 493.88 | 506.89 |
| C5 | 509.83 | 523.25 | 537.03 |
| C#5 | 540.14 | 554.37 | 568.96 |
| D5 | 572.26 | 587.33 | 602.80 |
| D#5 | 606.29 | 622.25 | 638.64 |
| E5 | 642.34 | 659.26 | 676.62 |
| F5 | 680.54 | 698.46 | 716.85 |
| F#5 | 721.00 | 739.99 | 759.48 |
| G5 | 763.88 | 783.99 | 804.64 |
| G#5 | 809.30 | 830.61 | 852.48 |
| A5 | 857.42 | 880.00 | 903.17 |
| A#5 | 908.41 | 932.33 | 956.88 |
| B5 | 962.42 | 987.77 | 1013.78 |
| C6 | 1019.65 | 1046.50 | 1074.06 |
| C#6 | 1080.28 | 1108.73 | 1137.93 |
| D6 | 1144.52 | 1174.66 | 1205.59 |
| D#6 | 1212.58 | 1244.51 | 1277.28 |
| E6 | 1284.68 | 1318.51 | 1353.23 |

## Chord Templates

These templates are matched as pitch classes across any valid octave:

| Quality | Intervals | Example C chord tones |
|---|---|---|
| Major | `0, 4, 7` | C E G |
| Minor | `0, 3, 7` | C D# G |
| Dominant 7th | `0, 4, 7, 10` | C E G A# |
| Major 7th | `0, 4, 7, 11` | C E G B |
| Minor 7th | `0, 3, 7, 10` | C D# G A# |
| Suspended 2nd | `0, 2, 7` | C D G |
| Suspended 4th | `0, 5, 7` | C F G |
| Power | `0, 7` | C G |

So `C7` means MusiCau saw strong enough energy in the pitch classes `C`, `E`, `G`, and `A#` across the active guitar frequency range. It does not mean a single C7-specific frequency band was detected.
