# Guitar Note Game

Production-ready real-time guitar note recognition built with React, TypeScript, Vite, Tailwind CSS, the Web Audio API, and Pitchy.

## Project Structure

```text
src/
  audio/        microphone session setup and browser permission handling
  pitch/        Pitchy integration, RMS amplitude filtering, noise gate
  utils/        music note math, formatting helpers
  components/   reusable UI and game components
  hooks/        React hooks for detection and challenge matching
  types/        shared TypeScript contracts
```

## Install

```bash
npm install
```

## Commands

```bash
npm run dev      # start Vite dev server
npm run build    # type-check and build production assets
npm run test     # run utility tests
npm run lint     # lint TypeScript and React code
```

## Usage

1. Start the app with `npm run dev`.
2. Open the local URL shown by Vite.
3. Click `Start Mic` and allow microphone access.
4. Play one clean guitar note at a time.

The detector updates every 40 ms, filters signals outside 80 Hz to 1400 Hz, applies an adjustable RMS noise gate, and accepts note challenges within +/-50 cents.

## Game API

```tsx
<NoteChallenge
  targetNote="E2"
  detection={snapshot.detection}
  onCorrectNoteDetected={() => {
    console.log("Correct note");
  }}
/>
```

`NoteChallenge` is intentionally separated from microphone ownership so future chord or model-backed recognizers can feed it the same normalized detection shape.

## Additional Simple App

This project also includes a smaller app that consumes the shared engine exports from `src/engine.ts`.

```text
http://127.0.0.1:5173/simple.html
```

The simple app is a minimal live guitar detector: it accepts only major, minor, and power chords, and keeps showing the previous accepted chord until a different chord is accepted.
