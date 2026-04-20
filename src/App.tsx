import { useState, useEffect, useRef } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

type Phase = 'setup' | 'running' | 'done';

interface Segment {
  id: string;
  name: string;
  duration: number; // minutes (may be fractional during a live run)
  color: string;
  notes?: string;
}

interface Preset {
  id: string;
  name: string;
  totalMinutes: number;
  segments: Segment[];
}

interface TState {
  snapAt: number;      // Date.now() at last snapshot — enables wall-clock persistence
  segIdx: number;
  segSecs: number;     // seconds left in current segment at snapAt
  totalSecs: number;   // total lesson seconds left at snapAt
  warnedId: string | null;
}

// ── Constants ────────────────────────────────────────────────────────────────

const COLORS = ['#4ade80', '#60a5fa', '#fb923c', '#c084fc', '#f472b6', '#34d399'];

const INITIAL_PRESETS: Preset[] = [
  {
    id: 'preset-effl-50',
    name: 'EFFL - 50 min',
    totalMinutes: 50,
    segments: [
      { id: 'e1', name: 'Activity',              duration: 20, color: COLORS[1] },
      { id: 'e2', name: 'Debrief + Margin Notes', duration: 10, color: COLORS[2] },
      { id: 'e3', name: 'Quicknotes',            duration:  5, color: COLORS[0] },
      { id: 'e4', name: 'CYU',                   duration: 15, color: COLORS[3] },
    ],
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(s: number): string {
  if (s < 0) s = 0;
  const r = Math.round(s);
  return `${Math.floor(r / 60)}:${(r % 60).toString().padStart(2, '0')}`;
}

function genId(): string {
  return Math.random().toString(36).slice(2, 9);
}

// Single shared AudioContext — Safari requires it to be resumed on a user gesture
let _audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext {
  if (!_audioCtx) _audioCtx = new AudioContext();
  return _audioCtx;
}
export function unlockAudio() {
  try { getAudioCtx().resume(); } catch { /* ignore */ }
}

function playTones(freqs: number[], gap = 0.15, dur = 0.22) {
  try {
    const ctx = getAudioCtx();
    ctx.resume().then(() => {
      freqs.forEach((f, i) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.connect(g); g.connect(ctx.destination);
        osc.frequency.value = f; osc.type = 'sine';
        const t = ctx.currentTime + i * (dur + gap);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.4, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        osc.start(t); osc.stop(t + dur + 0.05);
      });
    });
  } catch { /* ignore */ }
}

function loadLS<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : fallback; }
  catch { return fallback; }
}

function saveLS<T>(key: string, val: T) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ }
}

// ── SegmentBar ───────────────────────────────────────────────────────────────

interface DragState {
  borderIdx: number;
  startX: number;
  totalWidth: number;
  leftOrigSecs: number;
  rightOrigSecs: number;
  totalDurSecs: number;
}

function SegmentBar({
  segments, currentIdx, segProgress, warning,
  running = false,
  onDragStart, onDrag, onDragEnd,
}: {
  segments: Segment[];
  currentIdx: number;
  segProgress: number;
  warning: boolean;
  running?: boolean;
  onDragStart?: () => void;
  onDrag?: (borderIdx: number, leftNewSecs: number, rightNewSecs: number) => void;
  onDragEnd?: () => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);

  const total = segments.reduce((s, g) => s + g.duration, 0);
  if (total === 0) return null;

  // Border positions as percentages
  const borders: number[] = [];
  let cum = 0;
  for (let i = 0; i < segments.length - 1; i++) {
    cum += segments[i].duration;
    borders.push((cum / total) * 100);
  }

  const pointerDown = (e: React.PointerEvent<HTMLDivElement>, borderIdx: number) => {
    if (borderIdx < currentIdx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
    onDragStart?.();
    drag.current = {
      borderIdx,
      startX: e.clientX,
      totalWidth: barRef.current?.clientWidth ?? 1,
      leftOrigSecs: segments[borderIdx].duration * 60,
      rightOrigSecs: segments[borderIdx + 1].duration * 60,
      totalDurSecs: total * 60,
    };
  };

  const pointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const delta = (dx / d.totalWidth) * d.totalDurSecs;
    const min = 60;
    const clamped = Math.max(min - d.leftOrigSecs, Math.min(d.rightOrigSecs - min, delta));
    onDrag?.(d.borderIdx, d.leftOrigSecs + clamped, d.rightOrigSecs - clamped);
  };

  const pointerUp = () => {
    drag.current = null;
    onDragEnd?.();
  };

  return (
    <div
      ref={barRef}
      className="seg-bar"
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
    >
      {segments.map((seg, i) => {
        const isCurrent = i === currentIdx;
        const fill = i < currentIdx ? 100 : isCurrent ? segProgress * 100 : 0;
        return (
          <div
            key={seg.id}
            className={`seg-track${isCurrent ? ' current' : ''}${isCurrent && warning ? ' warning' : ''}`}
            style={{ flex: seg.duration, '--c': seg.color } as React.CSSProperties}
          >
            <div className="seg-fill" style={{ width: `${fill}%`, background: seg.color }} />
            <span className="seg-label">{seg.name}</span>
          </div>
        );
      })}

      {/* Drag handles — shown between segments that can still be adjusted */}
      {running && borders.map((pct, i) =>
        i >= currentIdx ? (
          <div
            key={`h${i}`}
            className="seg-drag-handle"
            style={{ left: `${pct}%` }}
            onPointerDown={e => pointerDown(e, i)}
            title="Drag to adjust segment times"
          />
        ) : null
      )}
    </div>
  );
}

// ── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  // Persistent state
  const [presets, setPresets] = useState<Preset[]>(() => {
    const stored = loadLS<Preset[]>('lt-presets-v2', INITIAL_PRESETS);
    return stored.map(p => ({
      ...p,
      totalMinutes: p.totalMinutes ?? p.segments.reduce((s, g) => s + g.duration, 0),
    }));
  });
  const [activeId, setActiveId] = useState<string>(() => {
    const ps = loadLS<Preset[]>('lt-presets-v2', INITIAL_PRESETS);
    const lid = loadLS<string>('lt-last-v2', INITIAL_PRESETS[0].id);
    return ps.find(p => p.id === lid) ? lid : (ps[0]?.id ?? '');
  });

  useEffect(() => { saveLS('lt-presets-v2', presets); }, [presets]);
  useEffect(() => { saveLS('lt-last-v2', activeId); }, [activeId]);

  const activePreset = presets.find(p => p.id === activeId) ?? presets[0];
  const presetSegments = activePreset?.segments ?? [];

  // Timer state
  const [phase, setPhase] = useState<Phase>('setup');
  const [isPaused, setIsPaused] = useState(false);
  const [warning, setWarning] = useState(false);
  const [liveSegs, setLiveSegs] = useState<Segment[]>([]);
  const [, setTick] = useState(0);

  // Wall-clock timer ref — snapAt enables persistence through sleep/tab-switch
  const ts = useRef<TState>({ snapAt: 0, segIdx: 0, segSecs: 0, totalSecs: 0, warnedId: null });
  const liveSegsRef = useRef<Segment[]>([]);
  const dragOriginSegs = useRef<Segment[] | null>(null);
  const dragOriginSegSecs = useRef<number>(0);
  const phaseRef = useRef<Phase>('setup');
  const pausedRef = useRef(false);

  useEffect(() => { liveSegsRef.current = liveSegs; }, [liveSegs]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  // Note: pausedRef is updated synchronously in togglePause to avoid race conditions

  // Single long-lived interval — all timing derived from wall clock
  useEffect(() => {
    const id = setInterval(() => {
      if (phaseRef.current !== 'running' || pausedRef.current) return;
      const segs = liveSegsRef.current;
      const elapsed = (Date.now() - ts.current.snapAt) / 1000;
      let segSecs = ts.current.segSecs - elapsed;
      let totalSecs = Math.max(0, ts.current.totalSecs - elapsed);
      let segIdx = ts.current.segIdx;

      // Advance through any segments that completed (catches up after sleep)
      let advanced = false;
      while (segSecs <= 0 && segIdx < segs.length - 1) {
        segIdx++;
        segSecs += segs[segIdx].duration * 60;
        advanced = true;
      }

      if (segSecs <= 0) {
        setPhase('done');
        playTones([880, 1100, 1320, 1100, 880], 0.08, 0.2);
        return;
      }

      if (advanced) {
        ts.current = { snapAt: Date.now(), segIdx, segSecs, totalSecs, warnedId: null };
        setWarning(false);
        playTones([880, 1100], 0.1, 0.22);
      } else {
        const segId = segs[segIdx]?.id;
        if (segSecs <= 61 && segSecs > 59 && ts.current.warnedId !== segId) {
          ts.current.warnedId = segId ?? null;
          setWarning(true);
          playTones([660, 660], 0.18, 0.2);
          setTimeout(() => setWarning(false), 4000);
        }
      }
      setTick(n => n + 1);
    }, 500);
    return () => clearInterval(id);
  }, []);

  // ── Snapshot helper ──────────────────────────────────────────────────────
  // Returns current timer values accounting for elapsed time since last snapshot

  const getSnap = (): TState => {
    if (pausedRef.current) return { ...ts.current };
    const elapsed = (Date.now() - ts.current.snapAt) / 1000;
    return {
      ...ts.current,
      segSecs: Math.max(0, ts.current.segSecs - elapsed),
      totalSecs: Math.max(0, ts.current.totalSecs - elapsed),
    };
  };

  // ── Actions ──────────────────────────────────────────────────────────────

  const start = () => {
    if (!presetSegments.length) return;
    unlockAudio(); // satisfies Safari's requirement for a user gesture before audio plays
    const live = presetSegments.map(s => ({ ...s }));
    setLiveSegs(live);
    liveSegsRef.current = live;
    ts.current = {
      snapAt: Date.now(),
      segIdx: 0,
      segSecs: live[0].duration * 60,
      totalSecs: live.reduce((s, g) => s + g.duration * 60, 0),
      warnedId: null,
    };
    setWarning(false);
    pausedRef.current = false;
    setIsPaused(false);
    setPhase('running');
  };

  const togglePause = () => {
    if (isPaused) {
      // Resume: reset snapAt so elapsed restarts from zero
      ts.current = { ...ts.current, snapAt: Date.now() };
      pausedRef.current = false;
      setIsPaused(false);
    } else {
      // Pause: commit current elapsed into snapshot values
      const snap = getSnap();
      ts.current = { ...snap, snapAt: Date.now() };
      pausedRef.current = true;
      setIsPaused(true);
    }
  };

  const goTo = (idx: number) => {
    const segs = liveSegsRef.current;
    if (idx < 0 || idx >= segs.length) return;
    ts.current = {
      snapAt: Date.now(),
      segIdx: idx,
      segSecs: segs[idx].duration * 60,
      totalSecs: segs.slice(idx).reduce((s, g) => s + g.duration * 60, 0),
      warnedId: null,
    };
    setWarning(false);
    setTick(n => n + 1);
  };

  // Skip to next segment; distribute remaining time proportionally to subsequent segments
  const nextRedistribute = () => {
    const snap = getSnap();
    const segs = liveSegsRef.current;
    const nextIdx = snap.segIdx + 1;
    if (nextIdx >= segs.length) return;

    const bonus = snap.segSecs;
    const futureSecs = segs.slice(nextIdx).reduce((s, g) => s + g.duration * 60, 0);
    let newSegs = segs;

    if (futureSecs > 0 && bonus > 0) {
      newSegs = segs.map((seg, i) => {
        if (i < nextIdx) return seg;
        const prop = (seg.duration * 60) / futureSecs;
        return { ...seg, duration: (seg.duration * 60 + bonus * prop) / 60 };
      });
      setLiveSegs(newSegs);
      liveSegsRef.current = newSegs;
    }

    ts.current = {
      snapAt: Date.now(),
      segIdx: nextIdx,
      segSecs: newSegs[nextIdx].duration * 60,
      totalSecs: snap.totalSecs, // wall-clock total unchanged
      warnedId: null,
    };
    setWarning(false);
    playTones([880, 1100], 0.1, 0.22);
    setTick(n => n + 1);
  };


  // Started late: subtract 1 min from total clock and scale all remaining segments proportionally
  const lateButton = () => {
    const snap = getSnap();
    if (snap.totalSecs <= 60) return;
    const factor = (snap.totalSecs - 60) / snap.totalSecs;
    const segs = liveSegsRef.current;
    const newSegs = segs.map((seg, i) =>
      i < snap.segIdx ? seg : { ...seg, duration: Math.max(1 / 60, seg.duration * factor) }
    );
    setLiveSegs(newSegs);
    liveSegsRef.current = newSegs;
    ts.current = {
      snapAt: Date.now(),
      segIdx: snap.segIdx,
      segSecs: Math.max(0, snap.segSecs * factor),
      totalSecs: snap.totalSecs - 60,
      warnedId: snap.warnedId,
    };
    setTick(n => n + 1);
  };


  // Drag handlers — always apply delta relative to segment durations at drag start
  const handleDragStart = () => {
    dragOriginSegs.current = liveSegsRef.current.map(s => ({ ...s }));
    dragOriginSegSecs.current = getSnap().segSecs; // freeze segSecs so drag delta doesn't accumulate
  };

  const handleDrag = (borderIdx: number, leftNewSecs: number, rightNewSecs: number) => {
    const origins = dragOriginSegs.current ?? liveSegsRef.current;
    const snap = getSnap();
    const newSegs = origins.map((seg, i) => {
      if (i === borderIdx) return { ...seg, duration: leftNewSecs / 60 };
      if (i === borderIdx + 1) return { ...seg, duration: rightNewSecs / 60 };
      return seg;
    });
    setLiveSegs(newSegs);
    liveSegsRef.current = newSegs;

    // If dragging the right edge of the current segment, update segSecs accordingly.
    // Always apply delta relative to dragOriginSegSecs — never accumulate on top of snap.segSecs.
    if (borderIdx === snap.segIdx) {
      const origDurSecs = origins[snap.segIdx].duration * 60;
      const delta = leftNewSecs - origDurSecs;
      ts.current = { ...snap, snapAt: Date.now(), segSecs: Math.max(0, dragOriginSegSecs.current + delta) };
    } else {
      ts.current = { ...snap, snapAt: Date.now() };
    }
    setTick(n => n + 1);
  };

  const handleDragEnd = () => {
    dragOriginSegs.current = null;
  };

  const reset = () => { start(); };

  const backToSetup = () => {
    setPhase('setup');
    pausedRef.current = false;
    setIsPaused(false);
    setWarning(false);
  };

  // ── Edit state ───────────────────────────────────────────────────────────

  const [editing, setEditing] = useState(false);
  const [editSegs, setEditSegs] = useState<Segment[]>([]);
  const [editName, setEditName] = useState('');
  const [editTotalMinutes, setEditTotalMinutes] = useState(0);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Allow body to scroll when edit form exceeds viewport height
  useEffect(() => {
    document.body.style.overflow = editing ? 'auto' : '';
    return () => { document.body.style.overflow = ''; };
  }, [editing]);

  const openEdit = () => {
    setEditSegs((activePreset?.segments ?? []).map(s => ({ ...s })));
    setEditName(activePreset?.name ?? '');
    setEditTotalMinutes(activePreset?.totalMinutes ?? 0);
    setEditing(true);
  };

  const updSeg = (id: string, field: keyof Segment, val: string | number) =>
    setEditSegs(ss => ss.map(s => s.id === id ? { ...s, [field]: val } : s));

  const saveEdit = (asNew: boolean) => {
    const rounded = editSegs.map(s => ({ ...s, duration: Math.round(s.duration) }));
    if (asNew) {
      const np: Preset = { id: genId(), name: editName, totalMinutes: editTotalMinutes, segments: rounded };
      setPresets(ps => [...ps, np]);
      setActiveId(np.id);
    } else {
      setPresets(ps => ps.map(p =>
        p.id === activeId ? { ...p, name: editName, totalMinutes: editTotalMinutes, segments: rounded } : p
      ));
    }
    setEditing(false);
  };

  const createNewPreset = () => {
    const np: Preset = {
      id: genId(),
      name: 'New Pacer',
      totalMinutes: 40,
      segments: [
        { id: genId(), name: 'Do Now',      duration:  5, color: COLORS[0] },
        { id: genId(), name: 'Activity',    duration: 25, color: COLORS[1] },
        { id: genId(), name: 'Wrap Up',     duration:  5, color: COLORS[2] },
        { id: genId(), name: 'Exit Ticket', duration:  5, color: COLORS[3] },
      ],
    };
    setPresets(ps => [...ps, np]);
    setActiveId(np.id);
    setEditSegs(np.segments.map(s => ({ ...s })));
    setEditName(np.name);
    setEditTotalMinutes(np.totalMinutes);
    setEditing(true);
  };

  const duplicatePreset = () => {
    if (!activePreset) return;
    const np: Preset = {
      ...activePreset,
      id: genId(),
      name: `${activePreset.name} (copy)`,
      segments: activePreset.segments.map(s => ({ ...s, id: genId() })),
    };
    setPresets(ps => [...ps, np]);
    setActiveId(np.id);
  };

  const deletePreset = (id: string) => {
    if (presets.length <= 1) return;
    const rem = presets.filter(p => p.id !== id);
    setPresets(rem);
    if (activeId === id) setActiveId(rem[0].id);
  };

  // ── Display values ───────────────────────────────────────────────────────

  const elapsed = (phase === 'running' && !isPaused) ? (Date.now() - ts.current.snapAt) / 1000 : 0;
  const dispSegSecs  = Math.max(0, ts.current.segSecs  - elapsed);
  const dispTotalSecs = Math.max(0, ts.current.totalSecs - elapsed);
  const segIdx = ts.current.segIdx;
  const curSeg  = liveSegs[segIdx];
  const nextSeg = liveSegs[segIdx + 1];
  const segProgress = curSeg ? 1 - dispSegSecs / (curSeg.duration * 60) : 0;

  // Pace: difference between wall-clock total and sum of planned remaining segments
  // Negative = we've added time to segments beyond what the clock allows
  const futurePlanSecs = liveSegs.slice(segIdx + 1).reduce((s, g) => s + g.duration * 60, 0);
  const paceGap = dispTotalSecs - (dispSegSecs + futurePlanSecs);
  const totalClass = paceGap >= -30 ? 'dim' : paceGap >= -120 ? 'pace-warn' : 'pace-behind';

  const totalDur = presetSegments.reduce((s, g) => s + g.duration, 0);

  // ── Edit view ────────────────────────────────────────────────────────────

  if (editing) {
    const editSum = editSegs.reduce((s, g) => s + g.duration, 0);
    const diff = editSum - editTotalMinutes;
    const balanced = diff === 0;
    const canBalance = editSegs.length > 0 && editSegs[editSegs.length - 1].duration - diff >= 1;

    return (
      <div className="app editing">
        <div className="setup-card">
          <h1>Edit Segments</h1>

          <div className="edit-top-row">
            <div className="field-row" style={{ flex: 1, marginBottom: 0 }}>
              <label>Preset name</label>
              <input className="text-input" value={editName} onChange={e => setEditName(e.target.value)} />
            </div>
            <div className="field-row" style={{ marginBottom: 0 }}>
              <label>Class duration</label>
              <div className="dur-ctrl">
                <button onClick={() => setEditTotalMinutes(t => Math.max(1, t - 1))}>−</button>
                <input
                  type="number"
                  className="dur-input"
                  value={editTotalMinutes}
                  min={1}
                  onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 1) setEditTotalMinutes(v); }}
                />
                <span className="dur-unit">min</span>
                <button onClick={() => setEditTotalMinutes(t => t + 1)}>+</button>
              </div>
            </div>
          </div>

          <div className="edit-list" style={{ marginTop: '20px' }}>
            {editSegs.map((seg, i) => (
              <div
                key={seg.id}
                className={`edit-seg-block${dragIdx === i ? ' dragging' : ''}${dragOverIdx === i && dragOverIdx !== dragIdx ? ' drag-over' : ''}`}
                onDragOver={e => { e.preventDefault(); if (dragOverIdx !== i) setDragOverIdx(i); }}
                onDrop={e => {
                  e.preventDefault();
                  if (dragIdx !== null && dragIdx !== i) {
                    setEditSegs(ss => {
                      const arr = [...ss];
                      const [item] = arr.splice(dragIdx, 1);
                      arr.splice(i, 0, item);
                      return arr;
                    });
                  }
                  setDragIdx(null); setDragOverIdx(null);
                }}
              >
                <div className="edit-row">
                  <div
                    className="drag-grip"
                    draggable
                    title="Drag to reorder"
                    onDragStart={e => {
                      const row = (e.currentTarget as HTMLElement).closest('.edit-seg-block') as HTMLElement;
                      if (row) e.dataTransfer.setDragImage(row, e.clientX - row.getBoundingClientRect().left, 20);
                      setDragIdx(i);
                    }}
                    onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
                  >⠿</div>
                  <div
                    className="color-swatch"
                    style={{ background: seg.color }}
                    title="Click to cycle color"
                    onClick={() => updSeg(seg.id, 'color', COLORS[(COLORS.indexOf(seg.color) + 1) % COLORS.length])}
                  />
                  <input
                    className="text-input seg-name-input"
                    value={seg.name}
                    onChange={e => updSeg(seg.id, 'name', e.target.value)}
                    placeholder="Segment name"
                  />
                  <div className="dur-ctrl">
                    <button onClick={() => updSeg(seg.id, 'duration', Math.max(1, seg.duration - 1))}>−</button>
                    <input
                      type="number"
                      className="dur-input"
                      value={seg.duration}
                      min={1}
                      onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 1) updSeg(seg.id, 'duration', v); }}
                    />
                    <span className="dur-unit">m</span>
                    <button onClick={() => updSeg(seg.id, 'duration', seg.duration + 1)}>+</button>
                  </div>
                  <button className="remove-btn" onClick={() => setEditSegs(ss => ss.filter(s => s.id !== seg.id))}>✕</button>
                </div>
                <input
                  className="text-input notes-input"
                  value={seg.notes ?? ''}
                  onChange={e => updSeg(seg.id, 'notes', e.target.value)}
                  placeholder="Notes (optional — visible during the timer)"
                />
              </div>
            ))}
          </div>

          <button
            className="add-row-btn"
            onClick={() => setEditSegs(ss => [...ss, {
              id: genId(), name: 'New Segment', duration: 10,
              color: COLORS[ss.length % COLORS.length],
            }])}
          >+ Add Segment</button>

          <div style={{ margin: '20px 0 8px' }}>
            <SegmentBar segments={editSegs} currentIdx={-1} segProgress={0} warning={false} />
          </div>

          <div className={`balance-row ${balanced ? 'exact' : diff > 0 ? 'over' : 'under'}`}>
            <span className="balance-tally">{editSum} / {editTotalMinutes} min</span>
            {balanced
              ? <span className="balance-msg exact">✓ Balanced</span>
              : <span className="balance-msg">{diff > 0 ? `${diff} min over` : `${Math.abs(diff)} min short`}</span>
            }
            {!balanced && (
              <button
                className="balance-btn"
                disabled={!canBalance}
                title={canBalance ? 'Adjust last segment to fill remaining time' : 'Last segment would go below 1 min'}
                onClick={() => setEditSegs(ss => ss.map((s, i) =>
                  i === ss.length - 1 ? { ...s, duration: s.duration - diff } : s
                ))}
              >Auto-balance last segment</button>
            )}
          </div>

          <div className="btn-row" style={{ marginTop: '20px' }}>
            <button className="btn ghost" onClick={() => setEditing(false)}>Cancel</button>
            <button className="btn primary" onClick={() => saveEdit(false)} disabled={!balanced}>
              Update &ldquo;{activePreset?.name}&rdquo;
            </button>
            <button className="btn outline" onClick={() => saveEdit(true)} disabled={!balanced}>Save as New Preset</button>
          </div>
          {!balanced && <p className="balance-hint">Balance your segments before saving.</p>}
        </div>
      </div>
    );
  }

  // ── Done view ────────────────────────────────────────────────────────────

  if (phase === 'done') {
    return (
      <div className="app done">
        <div className="done-inner">
          <div className="done-check">✓</div>
          <h1>Lesson Complete!</h1>
          <button className="btn primary large" onClick={backToSetup}>← Back to Setup</button>
        </div>
      </div>
    );
  }

  // ── Setup view ───────────────────────────────────────────────────────────

  if (phase === 'setup') {
    return (
      <div className="app">
        <a className="bmc-btn" href="https://www.buymeacoffee.com/freuman" target="_blank" rel="noreferrer">
          ☕ Buy me a coffee
        </a>
        <div className="setup-card">
          <h1 className="app-title">Lesson Pacer</h1>

          <div className="preset-tabs">
            {presets.map(p => (
              <div key={p.id} className={`preset-tab${p.id === activeId ? ' active' : ''}`}>
                <span onClick={() => setActiveId(p.id)}>{p.name}</span>
                {presets.length > 1 && (
                  <button className="del-preset" onClick={() => deletePreset(p.id)}>×</button>
                )}
              </div>
            ))}
            <button className="new-pacer-btn" onClick={createNewPreset} title="Create a new pacer from scratch">+ New Pacer</button>
          </div>

          <div className="seg-list-preview">
            {presetSegments.map(seg => (
              <div key={seg.id} className="seg-preview-row">
                <div className="dot" style={{ background: seg.color }} />
                <span className="seg-pname">{seg.name}</span>
                <span className="seg-pdur">{seg.duration} min</span>
              </div>
            ))}
          </div>

          <div style={{ marginBottom: '8px' }}>
            <SegmentBar segments={presetSegments} currentIdx={-1} segProgress={0} warning={false} />
          </div>
          <p className="total-label">Total: {totalDur} min</p>

          <div className="btn-row">
            <button className="btn ghost" onClick={openEdit}>✎ Edit Segments</button>
            <button className="btn ghost" onClick={duplicatePreset} title="Copy this preset as a new pacer">⧉ Duplicate</button>
            <button className="btn primary large" onClick={start} disabled={!presetSegments.length}>
              ▶ Start Lesson
            </button>
          </div>

          <div className="instructions">
            <p className="instructions-title">How to use</p>
            <ul>
              <li>Select a preset tab, then click <strong>▶ Start Lesson</strong>.</li>
              <li>The timer keeps running even if you switch tabs or your screen sleeps.</li>
              <li><strong>⏸</strong> pauses and resumes. <strong>◀ ▶</strong> jump between segments.</li>
              <li><strong>▶+</strong> skips to the next segment and distributes leftover time to future segments proportionally.</li>
              <li><strong>Late −1m</strong> subtracts 1 min from the total and scales all remaining segments down proportionally.</li>
              <li>Drag the dividers in the colored bar to resize adjacent segments on the fly.</li>
              <li>Click <strong>✎ Edit Segments</strong> to rename, adjust times, or drag <strong>⠿</strong> to reorder. Segments must sum to total class time before saving.</li>
              <li><strong>+ New Pacer</strong> creates a blank preset. <strong>⧉ Duplicate</strong> copies the active one.</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // ── Running view ─────────────────────────────────────────────────────────

  return (
    <div className="app running">
      <div className="running-bar">
        <SegmentBar
          segments={liveSegs}
          currentIdx={segIdx}
          segProgress={segProgress}
          warning={warning}
          running={true}
          onDragStart={handleDragStart}
          onDrag={handleDrag}
          onDragEnd={handleDragEnd}
        />
      </div>

      <div className="running-center">
        <div className="seg-name-display" style={{ color: curSeg?.color }}>
          {curSeg?.name ?? ''}
        </div>
        {curSeg?.notes && (
          <div className="seg-notes">{curSeg.notes}</div>
        )}

        <div className="timers-row">
          <div className="timer-block">
            <div className={`t-value${warning ? ' warn-glow' : ''}`} style={warning ? {} : { color: curSeg?.color }}>
              {fmt(dispSegSecs)}
            </div>
            <div className="t-label">this segment</div>
          </div>

          <div className="t-divider" />

          <div className="timer-block">
            <div className={`t-value ${totalClass}`}>{fmt(dispTotalSecs)}</div>
            <div className="t-label">total remaining</div>
          </div>
        </div>

        {nextSeg && (
          <div className="next-up">
            next: <span style={{ color: nextSeg.color }}>{nextSeg.name}</span>
          </div>
        )}
      </div>

      {isPaused && <div className="paused-badge">PAUSED</div>}

      <div className="controls">
        <button className="ctrl" onClick={() => goTo(segIdx - 1)} disabled={segIdx === 0} title="Previous segment">◀</button>
        <button className="ctrl pause-btn" onClick={togglePause} title={isPaused ? 'Resume' : 'Pause'}>
          {isPaused ? '▶' : '⏸'}
        </button>
        <button className="ctrl" onClick={nextRedistribute} disabled={segIdx >= liveSegs.length - 1}
          title="Next segment — gives remaining time to subsequent segments">▶+</button>

        <div className="ctrl-sep" />

        <button className="ctrl ctrl-label" onClick={lateButton}  title="Started late: −1 min from total, all remaining segments shrink proportionally">Late −1m</button>

        <div className="ctrl-sep" />

        <button className="ctrl ctrl-label" onClick={reset}       title="Restart lesson from the beginning">Restart</button>
        <button className="ctrl settings-btn" onClick={backToSetup} title="Back to setup">⚙</button>
      </div>
    </div>
  );
}
