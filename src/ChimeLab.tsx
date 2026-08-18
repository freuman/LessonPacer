import { useState, useEffect } from 'react';
import {
  CHIME_VOICES, CHIME_MELODIES, CHIME_EVENTS, CHIME_PITCHES,
  voiceById, melodyById, playPair, unlockAudio,
  type ChimeEvent, type ChimeMelody, type ChimeSettings,
} from './chimes';

// Draws the melody's pitch shape, so you can see what it does before hearing it
function Contour({ melody }: { melody: ChimeMelody }) {
  const r = melody.ratios;
  const lo = Math.min(...r), hi = Math.max(...r);
  const span = hi - lo || 1;
  const pts = r.map((v, i) => {
    const x = r.length === 1 ? 30 : 4 + i * (52 / (r.length - 1));
    const y = hi === lo ? 9 : 16 - ((v - lo) / span) * 13;
    return { x, y };
  });
  return (
    <svg className="contour" viewBox="0 0 60 20" aria-hidden="true">
      {pts.length > 1 && (
        <polyline points={pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} />
      )}
      {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={1.9} />)}
    </svg>
  );
}

export default function ChimeLab({
  settings, onChange, onClose,
}: {
  settings: ChimeSettings;
  onChange: (next: ChimeSettings) => void;
  onClose: () => void;
}) {
  const [target, setTarget] = useState<ChimeEvent>('advance');
  const [melody, setMelody] = useState<string>(settings.melodies.advance);
  const [voice, setVoice] = useState<string>(settings.voices.advance);
  const [justSaved, setJustSaved] = useState(false);

  // Picking a different chime to edit loads whatever that chime uses today
  const pickTarget = (ev: ChimeEvent) => {
    setTarget(ev);
    setMelody(settings.melodies[ev]);
    setVoice(settings.voices[ev]);
    setJustSaved(false);
  };

  const preview = (v = voice, m = melody) => {
    unlockAudio();
    if (!settings.muted) playPair(v, m, settings);
  };

  useEffect(() => {
    if (!justSaved) return;
    const id = setTimeout(() => setJustSaved(false), 2200);
    return () => clearTimeout(id);
  }, [justSaved]);

  const dirty = melody !== settings.melodies[target] || voice !== settings.voices[target];
  const targetLabel = CHIME_EVENTS.find(e => e.id === target)!.label;

  const assign = () => {
    onChange({
      ...settings,
      voices:   { ...settings.voices,   [target]: voice  },
      melodies: { ...settings.melodies, [target]: melody },
    });
    setJustSaved(true);
    preview();
  };

  return (
    <div className="app lab">
      <div className="lab-card">

        <header className="lab-head">
          <div>
            <h1 className="app-title">Chime Lab</h1>
            <p className="lab-sub">
              Build the sounds LessonPacer plays during a lesson. Everything is generated
              live in your browser — pick a chime, choose how it sounds, then assign it.
            </p>
          </div>
          <button className="btn ghost" onClick={onClose}>← Back to Setup</button>
        </header>

        <div className="lab-master">
          <label className="chime-check">
            <input
              type="checkbox"
              checked={!settings.muted}
              onChange={e => onChange({ ...settings, muted: !e.target.checked })}
            />
            <span>Sound on</span>
          </label>
          <div className="chime-vol">
            <span className="chime-vol-label">Volume</span>
            <input
              type="range" min={0} max={100} step={5}
              value={Math.round(settings.volume * 100)}
              disabled={settings.muted}
              onChange={e => onChange({ ...settings, volume: Number(e.target.value) / 100 })}
            />
            <span className="chime-vol-num">{Math.round(settings.volume * 100)}%</span>
          </div>
          <div className="chime-vol">
            <span className="chime-vol-label">Pitch</span>
            <div className="pitch-chips">
              {CHIME_PITCHES.map(p => (
                <button
                  key={p.name}
                  className={`pitch-chip${settings.base === p.hz ? ' on' : ''}`}
                  title={`${p.hz.toFixed(1)} Hz`}
                  onClick={() => { onChange({ ...settings, base: p.hz }); preview(); }}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Step 1 ────────────────────────────────────────────────────── */}
        <section className="step">
          <h2 className="step-title"><span className="step-n">1</span> Choose which chime to change</h2>
          <div className="target-row">
            {CHIME_EVENTS.map(ev => (
              <div key={ev.id} className={`target${target === ev.id ? ' on' : ''}${settings.enabled[ev.id] ? '' : ' off'}`}>
                <button className="target-main" onClick={() => pickTarget(ev.id)}>
                  <span className="target-label">{ev.label}</span>
                  <span className="target-cur">
                    {voiceById(settings.voices[ev.id]).name} · {melodyById(settings.melodies[ev.id]).name}
                  </span>
                  <span className="target-hint">{ev.hint}</span>
                </button>
                <label className="target-toggle">
                  <input
                    type="checkbox"
                    checked={settings.enabled[ev.id]}
                    disabled={settings.muted}
                    onChange={e => onChange({
                      ...settings,
                      enabled: { ...settings.enabled, [ev.id]: e.target.checked },
                    })}
                  />
                  <span>{settings.enabled[ev.id] ? 'On' : 'Off'}</span>
                </label>
              </div>
            ))}
          </div>
        </section>

        {/* ── Step 2 ────────────────────────────────────────────────────── */}
        <section className="step">
          <h2 className="step-title">
            <span className="step-n">2</span> Choose your melody
            <span className="step-note">the shape — what it says</span>
          </h2>
          <div className="pick-grid melodies">
            {CHIME_MELODIES.map(m => (
              <button
                key={m.id}
                className={`pick${melody === m.id ? ' on' : ''}`}
                onClick={() => { setMelody(m.id); preview(voice, m.id); }}
              >
                <span className="pick-name">{m.name}</span>
                <Contour melody={m} />
              </button>
            ))}
          </div>
        </section>

        {/* ── Step 3 ────────────────────────────────────────────────────── */}
        <section className="step">
          <h2 className="step-title">
            <span className="step-n">3</span> Choose your sound
            <span className="step-note">the instrument — click to hear it</span>
          </h2>
          <div className="pick-grid voices">
            {CHIME_VOICES.map(v => (
              <button
                key={v.id}
                className={`pick${voice === v.id ? ' on' : ''}`}
                onClick={() => { setVoice(v.id); preview(v.id, melody); }}
              >
                <span className="pick-name">{v.name}</span>
                <span className="pick-meth">{v.meth}</span>
              </button>
            ))}
          </div>
        </section>

        {/* ── Step 4 ────────────────────────────────────────────────────── */}
        <section className="step">
          <h2 className="step-title"><span className="step-n">4</span> Assign it</h2>
          <div className="assign-bar">
            <div className="assign-what">
              <span className="assign-lead">{targetLabel}</span>
              <span className="assign-pair">
                {voiceById(voice).name} · {melodyById(melody).name}
                {dirty && <em className="assign-dirty">not assigned yet</em>}
                {!dirty && justSaved && <em className="assign-ok">assigned ✓</em>}
              </span>
            </div>
            <div className="assign-btns">
              <button className="btn ghost" onClick={() => preview()}>▶ Hear it</button>
              <button className="btn primary large" onClick={assign} disabled={!dirty}>
                {dirty ? `Assign to ${targetLabel}` : 'Already assigned'}
              </button>
            </div>
          </div>
          <p className="assign-foot">
            Your choices are saved in this browser. Set them again on any other device you use.
          </p>
        </section>

      </div>
    </div>
  );
}
