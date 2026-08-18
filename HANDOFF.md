# Session handoff

**`CLAUDE.md` in this directory is the canonical project context, and Claude Code
loads it automatically.** This file exists for pasting into somewhere that
doesn't — claude.ai, a different tool, or a handoff to another person. If the two
disagree, `CLAUDE.md` wins.

Paste the block below into a new Claude Code session to pick up work on
LessonPacer with full context. Replace the final `TASK:` line with what you
actually want done — everything above it is background.

Trim the **Gotchas** and **Deferred** sections if the new task has nothing to do
with audio or git.

---

```
I'm working on LessonPacer, a lesson-pacing timer web app for teachers.

WHERE IT IS
/Users/freuman/AlexClaude/timer — note the folder is named `timer` and the npm
package is `lesson-timer`, NOT "lessonpacer". Searching the disk for
"lessonpacer" finds nothing but Dropbox marketing assets.
Ignore /Users/freuman/AlexClaude/effortless-timer entirely — it's a stale clone
of the same repo carrying abandoned work.

STACK
React 19 + Vite + TypeScript. Single-page app, no backend, no database.
All state persists to localStorage. Dev server runs on port 5175 (strictPort).

DEPLOY
GitHub Pages serves the `main` branch `/docs` folder at lessonpacer.com.
There is no CI — the committed docs/ folder IS the site.
To ship: `npm run build` (vite outDir is `docs`), then commit and push docs/.
public/CNAME and docs/CNAME both contain `lessonpacer.com` and must survive
every rebuild. Repo: github.com/freuman/LessonPacer

FILES
  src/App.tsx      — all views (setup / running / done / editing) + hash routing
  src/chimes.ts    — chime synthesis engine, voices, melodies, playback
  src/ChimeLab.tsx — the Chime Lab page
  src/index.css    — all styles

SHIPPED 2026-08-18
- Chime synthesis system: 18 voices, 16 melodies, all generated at runtime from
  Web Audio oscillators, filters and noise. No audio files, no MIDI. A chime is
  a melody (note ratios + timing) played in a voice (timbre); the two are
  independent, so any voice can play any melody.
- "Chime Lab" page at /#/chimes. Hash routing is deliberate: GitHub Pages has no
  server-side rewrites, so a real path like /chimes would 404 on refresh.
  Four steps: choose which chime -> choose melody -> choose sound -> Assign.
- Settings in localStorage key `lt-chimes-v2`: volume, muted, base pitch, and
  per-event voice/melody/enabled for advance | warning | complete.
  Migration from `lt-chimes-v1` is in place.
- Defaults (Sine Bell playing Rising Third / Low Pair / Arch) reproduce the
  app's original hardcoded chimes exactly, so existing users hear no change.
- All audio routes through a DynamicsCompressor limiter on the master bus.

ARCHITECTURE NOTES
- Presets live in localStorage as `lt-presets-v2` / `lt-last-v2`.
- The timer is wall-clock based (a `snapAt` timestamp), so it survives screen
  sleep and tab switches.
- The tick interval is created once with empty deps and reads chime settings
  through a ref — do not close over settings state inside it.
- The 1-minute warning threshold is hardcoded at 60s.

GOTCHAS LEARNED THE HARD WAY
- Run git with an explicit path: `git -C /Users/freuman/AlexClaude/timer ...`.
  The shell's cwd can reset to /Users/freuman/AlexClaude, which is a SEPARATE
  git repo, and a bare `git add -A` there stages ~100 unrelated files plus
  several embedded repos.
- To verify audio in a browser test, patch
  `AudioContext.prototype.createOscillator` and WRAP
  `osc.frequency.setValueAtTime`. Do NOT replace the `frequency` property with a
  plain object — chimes.ts calls setValueAtTime, so that throws and silently
  aborts playback after the first note, which looks exactly like an app bug.
- Web Audio clamps a DelayNode inside a feedback cycle to 128 samples, so
  Karplus-Strong cannot produce pitches above ~375 Hz. Don't reach for it.

DEFERRED
An "end-of-lesson link" — the teacher stores a URL (e.g. a YouTube song) opened
when a lesson finishes. It must be a BUTTON on the Lesson Complete screen, never
automatic: window.open() outside a user gesture is popup-blocked, and Chrome's
transient activation expires ~5s after the click. Rejected outright: uploading
audio files (localStorage is ~5MB, a song decodes to ~82MB of RAM, and Safari
evicts script-writable storage after 7 days without site interaction).

TASK: <what you want to do>
```
