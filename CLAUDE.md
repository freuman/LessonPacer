# LessonPacer

A lesson-pacing timer for teachers, live at **https://lessonpacer.com**.
A teacher builds a lesson out of timed segments, starts it, and the app counts
down through them — chiming at each segment change, one minute before a segment
ends, and when the lesson finishes.

> **This directory is named `timer`, not `lessonpacer`.** The npm package is
> `lesson-timer`. Searching the disk for "lessonpacer" turns up nothing but
> marketing assets in Dropbox.
>
> **Ignore `../effortless-timer` completely.** It is a stale second clone of
> this same repo carrying abandoned Effortless/Postgres/magic-links work. Never
> read from it, diff against it, or offer it as an option.

## Stack

React 19 + Vite + TypeScript. A single-page app with **no backend and no
database** — all state lives in the browser's localStorage. Dev server runs on
port 5175 (`strictPort`, so it errors rather than silently moving).

## Deploying

GitHub Pages serves the **`main` branch's `/docs` folder** at lessonpacer.com.
There is no CI: **the committed `docs/` folder IS the website.**

```bash
npm run build   # tsc && vite build — vite's outDir is `docs`
# then commit and push docs/ to main
```

`public/CNAME` and `docs/CNAME` both contain `lessonpacer.com` and must survive
every rebuild. A normal build preserves them. Repo: `github.com/freuman/LessonPacer`.

Pushing to `main` publishes to the live public site. Confirm with the user before
pushing unless they've already asked for it in the current exchange.

## Structure

```
src/App.tsx       All views — setup, running, done, editing — plus hash routing
src/chimes.ts     Chime synthesis engine: voices, melodies, playback
src/ChimeLab.tsx  The Chime Lab page
src/index.css     All styles
docs/             Build output. This is what gets served. Do not hand-edit.
```

## Routing

Hash-based (`/#/chimes`), read from `location.hash` with a `hashchange`
listener. This is deliberate — GitHub Pages has no server-side rewrites, so a
real path like `/chimes` would 404 on refresh. Keep new routes hash-based.

## The chime system

Sounds are **generated at runtime** from Web Audio oscillators, filters and
noise. There are no audio files and no MIDI anywhere, so adding a voice costs
nothing in download size.

The core idea: **a chime is a melody played in a voice.**

- A **melody** (`CHIME_MELODIES`) is pitch ratios plus timing — the shape that
  carries meaning: rising for "move on", a repeated note for "warning", a
  flourish for "finished".
- A **voice** (`CHIME_VOICES`) is timbre only — how the instrument sounds.

The two are independent, so any of the 18 voices can play any of the 16
melodies. Keep them independent; don't bake a melody into a voice.

Voices are built from inharmonic partials, FM, filtered noise, pitch glides and
detuning — not bare oscillator waveforms. Using only the four basic waveforms is
what made an earlier version sound like cheap MIDI.

Everything routes through a `DynamicsCompressor` limiter on the master bus, so
no stack of partials can produce a painful spike in a classroom. Leave it in.

The `classic` voice playing `rise3` / `lowpair` / `arch` reproduces the app's
original hardcoded chimes exactly. **Preserve that** — it's why existing users
hear no change until they choose something else.

## localStorage keys

| Key | Holds |
| --- | --- |
| `lt-presets-v2` | The teacher's saved lesson presets |
| `lt-last-v2` | Which preset was last active |
| `lt-chimes-v2` | Volume, mute, base pitch, and per-event voice/melody/enabled |

`lt-chimes-v1` is the older format; migration lives in `App.tsx`. When changing
a schema, bump the key and merge field by field against defaults so older or
partial stored objects still yield a complete one.

## Conventions and gotchas

- **Run git with an explicit path**: `git -C /Users/freuman/AlexClaude/timer …`.
  The shell's working directory can reset to `/Users/freuman/AlexClaude`, which
  is a **separate git repo**; a bare `git add -A` there stages ~100 unrelated
  files and several embedded repos.
- **The tick interval is created once** with empty deps. It reads chime settings
  through a ref (`chimesRef`). Never close over settings state inside it.
- **Timing is wall-clock based** via a `snapAt` timestamp, so the lesson survives
  screen sleep and tab switches. Don't replace it with accumulated tick counts.
- **The 1-minute warning threshold is hardcoded at 60s** — deliberately, so it
  stays predictable.
- **Testing audio in a browser**: patch `AudioContext.prototype.createOscillator`
  and *wrap* `osc.frequency.setValueAtTime`. Do **not** replace the `frequency`
  property with a plain object — `chimes.ts` calls `setValueAtTime`, so that
  throws and silently aborts playback after the first note, which looks
  identical to an app bug.
- **Don't reach for Karplus-Strong.** Web Audio clamps a `DelayNode` inside a
  feedback cycle to 128 samples, so it can't produce pitches above ~375 Hz, and
  a resonant filter in the loop pushes gain above 1 and runs away.

## Decided against

- **Uploading audio files.** localStorage is ~5 MB (a 3½-minute MP3 is ~4.5 MB
  base64), a full song decodes to ~82 MB of RAM, and Safari evicts
  script-writable storage after 7 days without site interaction.
- **Auto-opening a URL at lesson end.** `window.open()` outside a user gesture is
  popup-blocked, and Chrome's transient activation expires ~5s after a click —
  useless 50 minutes later. If this is revisited, it must be a **button** on the
  Lesson Complete screen, with the synthesized chime still firing automatically.
