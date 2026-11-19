import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { Upload, X, RotateCcw } from 'lucide-react';
import { CurvePlayMode, OscWaveType, Point } from '../../types';
import { clamp, mixHex } from './tokens';
import { MidiLearnOverlayTag, useMidiLearnTarget } from './MidiLearnContext';
import { cn } from '../../utils';

export type ActiveCurveLayer = 'speed' | 'pitch';

export interface SynthMasterScreenProps {
  title?: string;
  audioLabel: string;
  hasSample?: boolean;
  oscWave?: OscWaveType;
  onClearSample?: () => void;
  onRestoreSample?: () => void;
  durationSec: number;
  isPlaying: boolean;
  bypassed: boolean;
  speedActive: boolean;
  pitchActive: boolean;
  speedPoints: Point[];
  pitchPoints: Point[];
  onChangeSpeedPoints: (pts: Point[]) => void;
  onChangePitchPoints: (pts: Point[]) => void;
  curveMode?: CurvePlayMode;
  onChangeCurveMode?: (mode: CurvePlayMode) => void;
  curveSpeed?: number;
  onChangeCurveSpeed?: (speed: number) => void;
  playhead: number; // 0 - 1
  waveform: Float32Array | null;
  fftBins: Float32Array | null;
  liveWaveBars?: number[];
  onDropAudioFile?: (file: File) => void;
  onClickLoadAudio?: () => void;
  screenColor?: string;
  waveformColor?: string;
  speedColor?: string;
  pitchColor?: string;
  className?: string;
}

const RATE_MIN = 0.25;
const RATE_MAX = 20.0;

function rateToScrubberNorm(rate: number): number {
  const r = clamp(rate, RATE_MIN, RATE_MAX);
  return Math.log(r / RATE_MIN) / Math.log(RATE_MAX / RATE_MIN);
}

function scrubberNormToRate(norm: number): number {
  const n = clamp(norm, 0, 1);
  const raw = RATE_MIN * Math.pow(RATE_MAX / RATE_MIN, n);
  const step = raw < 2 ? 0.05 : raw < 8 ? 0.1 : 0.25;
  return clamp(Number((Math.round(raw / step) * step).toFixed(2)), RATE_MIN, RATE_MAX);
}

function buildCosineSplineArea(points: Point[], samples = 120): { area: string; stroke: string } {
  const sorted = [...points].sort((a, b) => a.x - b.x);
  if (sorted.length === 0) {
    return { area: 'M 0 100 L 1000 100 Z', stroke: 'M 0 50 L 1000 50' };
  }

  const evalAt = (t: number): number => {
    if (sorted.length === 1) return sorted[0].y;
    if (t <= sorted[0].x) return sorted[0].y;
    if (t >= sorted[sorted.length - 1].x) return sorted[sorted.length - 1].y;
    let p0 = sorted[0];
    let p1 = sorted[sorted.length - 1];
    for (let i = 0; i < sorted.length - 1; i++) {
      if (t >= sorted[i].x && t <= sorted[i + 1].x) {
        p0 = sorted[i];
        p1 = sorted[i + 1];
        break;
      }
    }
    if (p1.x === p0.x) return p0.y;
    const u = (t - p0.x) / (p1.x - p0.x);
    const s = (1 - Math.cos(u * Math.PI)) * 0.5;
    return p0.y + s * (p1.y - p0.y);
  };

  const lineParts: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const yNorm = clamp(evalAt(t), 0.03, 0.94);
    const svgX = (t * 1000).toFixed(1);
    const svgY = (100 - yNorm * 86).toFixed(2);
    lineParts.push(`${i === 0 ? 'M' : 'L'} ${svgX} ${svgY}`);
  }

  const stroke = lineParts.join(' ');
  const area = `${stroke} L 1000 100 L 0 100 Z`;
  return { area, stroke };
}

export const SynthMasterScreen = React.memo(function SynthMasterScreen({
  title = 'JUNOSCRATCH',
  audioLabel,
  hasSample = true,
  oscWave = 'SAW',
  onClearSample,
  onRestoreSample,
  durationSec,
  isPlaying,
  bypassed,
  speedActive,
  pitchActive,
  speedPoints,
  pitchPoints,
  onChangeSpeedPoints,
  onChangePitchPoints,
  curveMode = 'continuous',
  onChangeCurveMode,
  curveSpeed = 1.0,
  onChangeCurveSpeed,
  playhead,
  waveform,
  fftBins,
  liveWaveBars,
  onDropAudioFile,
  onClickLoadAudio,
  screenColor = '#0C0F17',
  waveformColor = '#9D7BFF',
  speedColor = '#6E93FF',
  pitchColor = '#FF9A3E',
  className,
}: SynthMasterScreenProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const rateTrackRef = useRef<HTMLDivElement>(null);
  const [activeLayer, setActiveLayer] = useState<ActiveCurveLayer>('speed');
  const [dragging, setDragging] = useState<{ layer: ActiveCurveLayer; index: number } | null>(null);
  const [draggingRate, setDraggingRate] = useState(false);
  const [hoveredNode, setHoveredNode] = useState<{ layer: ActiveCurveLayer; index: number } | null>(null);
  const [isDragOverFile, setIsDragOverFile] = useState(false);

  const curveModeMidi = useMidiLearnTarget('curveMode', 'Curve Playhead Mode');
  const curveSpeedMidi = useMidiLearnTarget('curveSpeed', 'Curve Playhead Speed');

  // Theme-derived screen, waveform, speed curve, and growl/pitch curve palette
  const screenTop = useMemo(() => mixHex(screenColor, '#000000', 0.24), [screenColor]);
  const screenMid = screenColor;
  const screenBottom = useMemo(() => mixHex(screenColor, '#1D2538', 0.26), [screenColor]);

  const waveBright = useMemo(() => mixHex(waveformColor, '#FFFFFF', 0.38), [waveformColor]);

  const speedBright = useMemo(() => mixHex(speedColor, '#FFFFFF', 0.36), [speedColor]);
  const speedMid = useMemo(() => mixHex(speedColor, screenColor, 0.28), [speedColor, screenColor]);
  const speedDeep = useMemo(() => mixHex(speedColor, screenColor, 0.62), [speedColor, screenColor]);

  const pitchBright = useMemo(() => mixHex(pitchColor, '#FFFFFF', 0.36), [pitchColor]);
  const pitchMid = useMemo(() => mixHex(pitchColor, screenColor, 0.28), [pitchColor, screenColor]);
  const pitchDeep = useMemo(() => mixHex(pitchColor, screenColor, 0.62), [pitchColor, screenColor]);

  const sortedSpeed = useMemo(() => [...speedPoints].sort((a, b) => a.x - b.x), [speedPoints]);
  const sortedPitch = useMemo(() => [...pitchPoints].sort((a, b) => a.x - b.x), [pitchPoints]);

  const speedPaths = useMemo(() => buildCosineSplineArea(sortedSpeed), [sortedSpeed]);
  const pitchPaths = useMemo(() => buildCosineSplineArea(sortedPitch), [sortedPitch]);

  // Stabilise-style Bipolar Transient Bar Graph (centered symmetrically on horizontal midline)
  const bipolarBars = useMemo((): number[] => {
    const barCount = 64;

    // 1. Live note playback: real-time transient & harmonic bipolar bars
    if (isPlaying) {
      if (liveWaveBars && liveWaveBars.length > 0) {
        return liveWaveBars;
      }
      if (fftBins && fftBins.length > 0) {
        const bars: number[] = [];
        for (let i = 0; i < barCount; i++) {
          const binIdx = Math.min(
            fftBins.length - 1,
            Math.floor((i / (barCount - 1)) * Math.min(64, fftBins.length))
          );
          const db = Number.isFinite(fftBins[binIdx]) ? fftBins[binIdx] : -100;
          const u = i / (barCount - 1);
          const edgeTaper = 0.45 + 0.55 * Math.sin(u * Math.PI);
          bars.push(clamp(((db + 86) / 74) * edgeTaper, 0.05, 0.92));
        }
        return bars;
      }
    }

    // 2. Loaded sample resting state: downsample sample buffer into subtle bipolar bars
    if (hasSample && waveform && waveform.length > 0) {
      const bars: number[] = [];
      const step = Math.max(1, Math.floor(waveform.length / barCount));
      for (let i = 0; i < barCount; i++) {
        const idx = Math.min(waveform.length - 1, i * step);
        bars.push(clamp(waveform[idx] * 0.72, 0.04, 0.74));
      }
      return bars;
    }

    // 3. Idle OSC-only resting contour so Waveform colour theming is always visible
    const idlePattern = [
      0.14, 0.28, 0.21, 0.36, 0.19, 0.12, 0.31, 0.44, 0.26, 0.2, 0.39, 0.25, 0.16, 0.33, 0.48, 0.29,
    ];
    const waveScale =
      oscWave === 'SUPER' ? 1.12 : oscWave === 'TRI' ? 0.78 : oscWave === 'SYNC' ? 1.05 : 0.94;
    return Array.from({ length: barCount }, (_, i) => {
      const u = i / (barCount - 1);
      const env = 0.38 + 0.62 * Math.sin(u * Math.PI);
      return clamp(idlePattern[i % idlePattern.length] * waveScale * env, 0.04, 0.48);
    });
  }, [isPlaying, liveWaveBars, fftBins, hasSample, waveform, oscWave]);

  const getNormCoords = useCallback((clientX: number, clientY: number) => {
    if (!stageRef.current) return null;
    const rect = stageRef.current.getBoundingClientRect();
    return {
      x: clamp((clientX - rect.left) / rect.width, 0, 1),
      y: clamp((1 - (clientY - rect.top) / rect.height) / 0.86, 0.02, 0.98),
    };
  }, []);

  const handleStagePointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    if ((e.target as HTMLElement).closest('[data-hud-control="true"]')) return;

    const coords = getNormCoords(e.clientX, e.clientY);
    if (!coords) return;

    const checkHit = (pts: Point[]) => {
      let bestIdx = -1;
      let bestDist = 0.045;
      pts.forEach((p, idx) => {
        const d = Math.hypot(p.x - coords.x, (p.y - coords.y) * 0.85);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = idx;
        }
      });
      return bestIdx;
    };

    const primaryPts = activeLayer === 'speed' ? sortedSpeed : sortedPitch;
    const secondaryPts = activeLayer === 'speed' ? sortedPitch : sortedSpeed;
    const secondaryLayer: ActiveCurveLayer = activeLayer === 'speed' ? 'pitch' : 'speed';

    const hitPrimary = checkHit(primaryPts);
    if (hitPrimary !== -1) {
      setDragging({ layer: activeLayer, index: hitPrimary });
      return;
    }

    const hitSecondary = checkHit(secondaryPts);
    if (hitSecondary !== -1) {
      setActiveLayer(secondaryLayer);
      setDragging({ layer: secondaryLayer, index: hitSecondary });
      return;
    }

    const next = [...primaryPts, coords].sort((a, b) => a.x - b.x);
    const newIdx = next.findIndex((p) => p.x === coords.x && p.y === coords.y);
    if (activeLayer === 'speed') {
      onChangeSpeedPoints(next);
    } else {
      onChangePitchPoints(next);
    }
    setDragging({ layer: activeLayer, index: newIdx });
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const coords = getNormCoords(e.clientX, e.clientY);
      if (!coords) return;

      const list = dragging.layer === 'speed' ? [...sortedSpeed] : [...sortedPitch];
      const idx = dragging.index;
      if (!list[idx]) return;

      const minX = idx === 0 ? 0 : list[idx - 1].x + 0.015;
      const maxX = idx === list.length - 1 ? 1 : list[idx + 1].x - 0.015;

      list[idx] = {
        x: idx === 0 ? 0 : idx === list.length - 1 ? 1 : clamp(coords.x, minX, maxX),
        y: coords.y,
      };

      if (dragging.layer === 'speed') {
        onChangeSpeedPoints(list);
      } else {
        onChangePitchPoints(list);
      }
    };

    const onUp = () => setDragging(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, sortedSpeed, sortedPitch, getNormCoords, onChangeSpeedPoints, onChangePitchPoints]);

  const removeInteriorNode = (layer: ActiveCurveLayer, idx: number) => {
    const list = layer === 'speed' ? sortedSpeed : sortedPitch;
    if (list.length <= 2 || idx === 0 || idx === list.length - 1) return;
    const filtered = list.filter((_, i) => i !== idx);
    if (layer === 'speed') onChangeSpeedPoints(filtered);
    else onChangePitchPoints(filtered);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-hud-control="true"]')) return;
    e.preventDefault();
    const coords = getNormCoords(e.clientX, e.clientY);
    if (!coords) return;

    const tryDelete = (pts: Point[], layer: ActiveCurveLayer): boolean => {
      for (let i = 1; i < pts.length - 1; i++) {
        if (Math.hypot(pts[i].x - coords.x, pts[i].y - coords.y) < 0.055) {
          removeInteriorNode(layer, i);
          return true;
        }
      }
      return false;
    };

    if (!tryDelete(activeLayer === 'speed' ? sortedSpeed : sortedPitch, activeLayer)) {
      tryDelete(
        activeLayer === 'speed' ? sortedPitch : sortedSpeed,
        activeLayer === 'speed' ? 'pitch' : 'speed'
      );
    }
  };

  const safeCurveSpeed = clamp(curveSpeed || 1, RATE_MIN, RATE_MAX);
  const rateNorm = rateToScrubberNorm(safeCurveSpeed);
  const effectiveCycleSec = durationSec / safeCurveSpeed;

  const updateRateFromClientX = useCallback(
    (clientX: number) => {
      if (!rateTrackRef.current || !onChangeCurveSpeed) return;
      const rect = rateTrackRef.current.getBoundingClientRect();
      const rawNorm = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      onChangeCurveSpeed(scrubberNormToRate(rawNorm));
    },
    [onChangeCurveSpeed]
  );

  useEffect(() => {
    if (!draggingRate) return;
    const onMove = (e: PointerEvent) => updateRateFromClientX(e.clientX);
    const onUp = () => setDraggingRate(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [draggingRate, updateRateFromClientX]);

  const timeTicks = useMemo(() => {
    const positions = [0.12, 0.28, 0.44, 0.6, 0.76, 0.92];
    const decimals = effectiveCycleSec < 1.5 ? 2 : 1;
    return positions.map((pos) => ({
      pos,
      label: `${(pos * effectiveCycleSec).toFixed(decimals)}s`,
    }));
  }, [effectiveCycleSec]);

  const formatNodeReadout = (layer: ActiveCurveLayer, p: Point) => {
    if (layer === 'speed') {
      const spd = p.y <= 0.5 ? 0.2 + (p.y / 0.5) * 0.8 : 1.0 + ((p.y - 0.5) / 0.5) * 1.8;
      return `SPEED ${spd.toFixed(2)}x`;
    }
    const st = (p.y - 0.5) * 24;
    return `PITCH ${st >= 0 ? '+' : ''}${st.toFixed(1)} st`;
  };

  const showPlayhead = isPlaying || (curveMode === 'continuous' && playhead > 0.002);

  return (
    <div
      ref={stageRef}
      onPointerDown={handleStagePointerDown}
      onContextMenu={handleContextMenu}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOverFile(true);
      }}
      onDragLeave={() => setIsDragOverFile(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOverFile(false);
        const file = e.dataTransfer.files?.[0];
        if (file && onDropAudioFile) {
          onDropAudioFile(file);
        }
      }}
      style={{
        borderRadius: 'var(--module-radius)',
        background: `linear-gradient(180deg, ${screenTop} 0%, ${screenMid} 54%, ${screenBottom} 100%)`,
      }}
      className={cn(
        'w-full h-[265px] sm:h-[290px] relative overflow-hidden select-none cursor-crosshair touch-none',
        'shadow-[inset_0_4px_18px_rgba(0,0,0,0.95),inset_0_0_0_1px_rgba(0,0,0,0.9),0_1px_0_rgba(255,255,255,0.12)]',
        isDragOverFile && 'ring-2 ring-[var(--accent-blue)]',
        className
      )}
    >
      {/* Vertical Time Grid Hairlines + Bottom Calibrated Time Axis (never collides with top HUD) */}
      {timeTicks.map(({ pos, label }) => (
        <div
          key={pos}
          className="absolute top-0 bottom-0 pointer-events-none"
          style={{ left: `${pos * 100}%` }}
        >
          <div className="w-[1px] h-full bg-white/[0.045]" />
          <span className="absolute bottom-2 -translate-x-1/2 font-mono text-[9px] tabular-nums text-[#6B7489]">
            {label}
          </span>
        </div>
      ))}

      {/* Subtle Unity Reference Horizon (1.0x Speed / 0 st Pitch) */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 h-[1px] bg-white/[0.05] pointer-events-none"
        style={{ top: `${100 - 0.5 * 86}%` }}
      />

      {/* Top HUD Bar: Left Sample Controls + Right Curve Mode, Curve Speed & Layer Selector */}
      <div
        data-hud-control="true"
        className="absolute top-2.5 inset-x-3.5 z-20 flex flex-wrap items-center justify-between gap-2 pointer-events-none"
      >
        {/* Left: Audio Sample Status + Remove/Load Sample */}
        <div className="flex flex-wrap items-center gap-1.5 pointer-events-auto">
          {hasSample ? (
            <>
              <button
                type="button"
                onClick={onClickLoadAudio}
                className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full bg-black/45 border border-white/12 text-[#AEB6CA] hover:text-white hover:border-white/28 transition-colors cursor-pointer font-mono text-[10px] whitespace-nowrap shrink-0 focus-visible:outline-none"
                title="Load WAV, MP3, OGG, or M4A audio file"
              >
                <Upload size={10.5} />
                <span className="max-w-[145px] truncate">{audioLabel}</span>
              </button>

              {onClearSample && (
                <button
                  type="button"
                  onClick={onClearSample}
                  className="inline-flex items-center gap-1 h-6 px-2.5 rounded-full bg-[#1F161D]/85 border border-[#FB7185]/28 text-[#FDA4AF] hover:bg-[#2D1B25] hover:text-white hover:border-[#FB7185]/55 transition-colors cursor-pointer font-display text-[9px] font-semibold tracking-[0.07em] uppercase whitespace-nowrap shrink-0 focus-visible:outline-none"
                  title="Remove sample to synthesize purely with the OSC and FM engines"
                >
                  <X size={10} strokeWidth={2.3} />
                  <span>Remove Sample</span>
                </button>
              )}
            </>
          ) : (
            <>
              <span
                className="font-mono text-[10px] font-medium px-1.5 whitespace-nowrap shrink-0"
                style={{ color: 'var(--accent-cyan-bright)' }}
              >
                OSC Only
              </span>

              <button
                type="button"
                onClick={onClickLoadAudio}
                className="inline-flex items-center gap-1 h-6 px-2.5 rounded-full bg-black/45 border border-white/12 text-[#AEB6CA] hover:text-white hover:border-white/30 transition-colors cursor-pointer font-display text-[9px] font-semibold tracking-[0.07em] uppercase whitespace-nowrap shrink-0 focus-visible:outline-none"
                title="Load custom WAV, MP3, OGG, or M4A sample"
              >
                <Upload size={10} />
                <span>Load Sample</span>
              </button>

              {onRestoreSample && (
                <button
                  type="button"
                  onClick={onRestoreSample}
                  className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-black/45 border border-white/10 text-[#8B94AA] hover:text-white hover:border-white/25 transition-colors cursor-pointer font-display text-[9px] font-semibold tracking-[0.07em] uppercase whitespace-nowrap shrink-0 focus-visible:outline-none"
                  title="Restore built-in granular sample loop"
                >
                  <RotateCcw size={10} />
                  <span>Restore Loop</span>
                </button>
              )}
            </>
          )}
        </div>

        {/* Right: Playhead Mode (Continuous / One-Shot) + Curve Speed + Active Curve Selector */}
        <div className="flex flex-wrap items-center gap-1.5 pointer-events-auto">
          {/* Continuous vs One-Shot Playhead Mode */}
          {onChangeCurveMode && (
            <div className="relative" onContextMenu={curveModeMidi.handleContextMenu}>
              <MidiLearnOverlayTag
                midiId="curveMode"
                binding={curveModeMidi.binding}
                isArmed={curveModeMidi.isArmed}
                midiLearnMode={curveModeMidi.midiLearnMode}
                onUnbind={curveModeMidi.unbind}
                compact
              />
              <div
                onPointerDownCapture={(e) => {
                  if (curveModeMidi.interceptLearnEvent(e)) return;
                }}
                className={cn(
                  'h-6 flex items-center gap-0.5 bg-black/50 border border-white/12 rounded-full p-0.5 transition-shadow',
                  curveModeMidi.isArmed && 'ring-2 ring-[#FFB35C]',
                  !curveModeMidi.isArmed &&
                    curveModeMidi.enabled &&
                    curveModeMidi.binding &&
                    'ring-2 ring-[#38BDF8]/85',
                  !curveModeMidi.isArmed &&
                    curveModeMidi.enabled &&
                    !curveModeMidi.binding &&
                    'ring-1 ring-[#38BDF8]/45'
                )}
              >
                <button
                  type="button"
                  onClick={() => !curveModeMidi.enabled && onChangeCurveMode('continuous')}
                  title="Continuous playhead: keeps its phase and resumes smoothly without restarting on note play"
                  className={cn(
                    'h-5 px-2 rounded-full font-display text-[9px] font-semibold tracking-[0.07em] uppercase transition-colors cursor-pointer whitespace-nowrap shrink-0',
                    curveMode === 'continuous'
                      ? 'bg-white/14 text-white'
                      : 'text-[#737C91] hover:text-[#BAC3D6]'
                  )}
                >
                  Continuous
                </button>
                <button
                  type="button"
                  onClick={() => !curveModeMidi.enabled && onChangeCurveMode('oneshot')}
                  title="One-Shot playhead: retriggers from start on play and sweeps once to the end"
                  className={cn(
                    'h-5 px-2 rounded-full font-display text-[9px] font-semibold tracking-[0.07em] uppercase transition-colors cursor-pointer whitespace-nowrap shrink-0',
                    curveMode === 'oneshot'
                      ? 'bg-white/14 text-white'
                      : 'text-[#737C91] hover:text-[#BAC3D6]'
                  )}
                >
                  One-Shot
                </button>
              </div>
            </div>
          )}

          {/* Playhead Curve Speed Scrubber (0.25x – 20.0x, zero focus capture so keys always play) */}
          {onChangeCurveSpeed && (
            <div className="relative" onContextMenu={curveSpeedMidi.handleContextMenu}>
              <MidiLearnOverlayTag
                midiId="curveSpeed"
                binding={curveSpeedMidi.binding}
                isArmed={curveSpeedMidi.isArmed}
                midiLearnMode={curveSpeedMidi.midiLearnMode}
                onUnbind={curveSpeedMidi.unbind}
                compact
              />
              <div
                onPointerDown={(e) => {
                  e.stopPropagation();
                  if (curveSpeedMidi.interceptLearnEvent(e)) return;
                  e.preventDefault();
                  setDraggingRate(true);
                  updateRateFromClientX(e.clientX);
                }}
                onWheel={(e) => {
                  e.preventDefault();
                  if (curveSpeedMidi.enabled) return;
                  const dir = e.deltaY < 0 ? 1 : -1;
                  const nextNorm = clamp(rateNorm + dir * 0.04, 0, 1);
                  onChangeCurveSpeed(scrubberNormToRate(nextNorm));
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (!curveSpeedMidi.enabled) onChangeCurveSpeed(1.0);
                }}
                title="Adjust how fast the playhead moves through the curves (0.25x – 20x · double-click for 1.00x)"
                className={cn(
                  'h-6 px-2.5 flex items-center gap-2 bg-black/50 border border-white/12 rounded-full select-none touch-none transition-shadow',
                  curveSpeedMidi.enabled ? 'cursor-pointer' : 'cursor-ew-resize',
                  curveSpeedMidi.isArmed && 'ring-2 ring-[#FFB35C]',
                  !curveSpeedMidi.isArmed &&
                    curveSpeedMidi.enabled &&
                    curveSpeedMidi.binding &&
                    'ring-2 ring-[#38BDF8]/85',
                  !curveSpeedMidi.isArmed &&
                    curveSpeedMidi.enabled &&
                    !curveSpeedMidi.binding &&
                    'ring-1 ring-[#38BDF8]/45'
                )}
              >
                <span className="font-display text-[9px] font-semibold tracking-[0.07em] uppercase text-[#8A93A8] whitespace-nowrap shrink-0">
                  Rate
                </span>
                <div
                  ref={rateTrackRef}
                  className="relative w-16 h-[5px] rounded-full bg-white/12 flex items-center"
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${rateNorm * 100}%`,
                      backgroundColor: activeLayer === 'speed' ? speedBright : pitchBright,
                    }}
                  />
                  <span
                    className="absolute -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.85)]"
                    style={{ left: `${rateNorm * 100}%` }}
                  />
                </div>
                <span
                  className="font-mono text-[9.5px] tabular-nums w-10 text-right whitespace-nowrap shrink-0"
                  style={{ color: activeLayer === 'speed' ? speedBright : pitchBright }}
                >
                  {safeCurveSpeed >= 10 ? safeCurveSpeed.toFixed(1) : safeCurveSpeed.toFixed(2)}x
                </span>
              </div>
            </div>
          )}

          {/* Curve Layer Selector */}
          <div className="h-6 flex items-center gap-0.5 bg-black/50 border border-white/12 rounded-full p-0.5">
            <button
              type="button"
              onClick={() => setActiveLayer('speed')}
              className={cn(
                'h-5 px-2.5 rounded-full font-display text-[9px] font-semibold tracking-[0.07em] uppercase transition-colors cursor-pointer whitespace-nowrap shrink-0',
                activeLayer === 'speed' ? 'bg-white/12' : 'text-[#737C91] hover:text-[#BAC3D6]'
              )}
              style={activeLayer === 'speed' ? { color: speedBright } : undefined}
            >
              Speed Curve
            </button>
            <button
              type="button"
              onClick={() => setActiveLayer('pitch')}
              className={cn(
                'h-5 px-2.5 rounded-full font-display text-[9px] font-semibold tracking-[0.07em] uppercase transition-colors cursor-pointer whitespace-nowrap shrink-0',
                activeLayer === 'pitch' ? 'bg-white/12' : 'text-[#737C91] hover:text-[#BAC3D6]'
              )}
              style={activeLayer === 'pitch' ? { color: pitchBright } : undefined}
            >
              Growl / Pitch
            </button>
            <button
              type="button"
              onClick={() => {
                if (activeLayer === 'speed') {
                  onChangeSpeedPoints([
                    { x: 0, y: 0.5 },
                    { x: 1, y: 0.5 },
                  ]);
                } else {
                  onChangePitchPoints([
                    { x: 0, y: 0.5 },
                    { x: 1, y: 0.5 },
                  ]);
                }
              }}
              className="h-5 px-2 rounded-full font-display text-[9px] font-semibold tracking-[0.07em] uppercase text-[#737C91] hover:text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
              title="Flatten selected envelope to unity"
            >
              Flat
            </button>
          </div>
        </div>
      </div>

      {/* Center Hardware Emblem + Dual Phosphor Dots */}
      <div className="absolute inset-x-0 top-[46px] flex items-center justify-center pointer-events-none z-10">
        <div className="flex items-center gap-1.5">
          <span
            className="font-display font-bold text-[20px] tracking-[0.08em] uppercase"
            style={{ color: mixHex(screenColor, '#9BA5BE', 0.34) }}
          >
            {title}
          </span>
          <div className="flex flex-col gap-[3.5px] ml-0.5">
            <span
              className="w-[4.5px] h-[4.5px] rounded-full"
              style={{
                backgroundColor: pitchColor,
                boxShadow: `0 0 calc(8px * var(--glow-scale, 1)) ${pitchColor}`,
              }}
            />
            <span
              className="w-[4.5px] h-[4.5px] rounded-full"
              style={{
                backgroundColor: speedColor,
                boxShadow: `0 0 calc(8px * var(--glow-scale, 1)) ${speedColor}`,
              }}
            />
          </div>
        </div>
      </div>

      {/* Ambient Bottom Floor Glow */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-28 pointer-events-none transition-opacity duration-200"
        style={{
          opacity: bypassed ? 0.16 : 0.82,
          background: `radial-gradient(ellipse 38% 80% at 28% 100%, color-mix(in srgb, ${speedColor} 42%, transparent) 0%, transparent 75%), radial-gradient(ellipse 40% 75% at 62% 100%, color-mix(in srgb, ${pitchColor} 38%, transparent) 0%, transparent 75%)`,
        }}
      />

      {/* Main SVG Stage: Stabilise-Style Bipolar Transient Bar Graph + Themeable Speed & Growl/Pitch Curves */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox="0 0 1000 100"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="synth-speed-grad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={speedColor} stopOpacity="0.72" />
            <stop offset="68%" stopColor={speedMid} stopOpacity="0.8" />
            <stop offset="100%" stopColor={speedDeep} stopOpacity="0.88" />
          </linearGradient>
          <linearGradient id="synth-pitch-grad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={pitchColor} stopOpacity="0.72" />
            <stop offset="68%" stopColor={pitchMid} stopOpacity="0.8" />
            <stop offset="100%" stopColor={pitchDeep} stopOpacity="0.88" />
          </linearGradient>
        </defs>

        {/* Speed Envelope */}
        <path
          d={speedPaths.area}
          fill="url(#synth-speed-grad)"
          style={{
            mixBlendMode: 'screen',
            opacity: speedActive ? 0.86 : 0.14,
          }}
        />
        <path
          d={speedPaths.stroke}
          fill="none"
          stroke={speedBright}
          strokeWidth={activeLayer === 'speed' ? '2' : '1.2'}
          vectorEffect="non-scaling-stroke"
          style={{
            opacity: speedActive ? (activeLayer === 'speed' ? 0.95 : 0.55) : 0.18,
          }}
        />

        {/* Pitch / Growl Envelope */}
        <path
          d={pitchPaths.area}
          fill="url(#synth-pitch-grad)"
          style={{
            mixBlendMode: 'screen',
            opacity: pitchActive ? 0.84 : 0.14,
          }}
        />
        <path
          d={pitchPaths.stroke}
          fill="none"
          stroke={pitchBright}
          strokeWidth={activeLayer === 'pitch' ? '2' : '1.2'}
          vectorEffect="non-scaling-stroke"
          style={{
            opacity: pitchActive ? (activeLayer === 'pitch' ? 0.95 : 0.55) : 0.18,
          }}
        />
      </svg>

      {/* Stabilise-Style Bipolar Transient Bar Scope Layer (renders crisp non-distorted rounded bars on note play) */}
      <div
        aria-hidden="true"
        className="absolute inset-x-4 top-[38px] bottom-[22px] flex items-center justify-between pointer-events-none z-10"
      >
        {/* Center Zero-Crossing Axis Line (exact Stabilise aesthetic) */}
        <div
          className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[1px] transition-opacity duration-150"
          style={{
            backgroundColor: waveformColor,
            opacity: isPlaying ? 0.48 : hasSample ? 0.24 : 0.16,
          }}
        />

        {bipolarBars.map((amp, i) => {
          const highlight = i % 3 === 1;
          const scaleY = clamp(amp, 0.06, 0.98);
          const barOpacity = isPlaying
            ? highlight
              ? 0.96
              : 0.7
            : hasSample
            ? highlight
              ? 0.42
              : 0.28
            : highlight
            ? 0.26
            : 0.16;
          return (
            <span
              key={i}
              className="w-[2.5px] sm:w-[3px] h-[92%] rounded-full origin-center will-change-transform"
              style={{
                transform: `scaleY(${scaleY.toFixed(3)})`,
                backgroundColor: highlight ? waveBright : waveformColor,
                opacity: barOpacity,
                boxShadow:
                  isPlaying && highlight
                    ? `0 0 calc(7px * var(--glow-scale, 1)) ${waveformColor}`
                    : undefined,
              }}
            />
          );
        })}
      </div>

      {/* Live or Parked Modulation Playhead (GPU-composited translateX) */}
      {showPlayhead && (
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none z-20 will-change-transform"
          style={{
            transform: `translateX(${(clamp(playhead, 0, 1) * 100).toFixed(2)}%)`,
          }}
        >
          <div
            className={cn(
              'w-[1.5px] h-full transition-opacity duration-150',
              isPlaying ? 'bg-white/95 opacity-100' : 'bg-white/55 opacity-50'
            )}
            style={{
              boxShadow: isPlaying ? `0 0 12px #FFFFFF, 0 0 4px ${speedBright}` : undefined,
            }}
          />
        </div>
      )}

      {/* Interactive Speed Curve Nodes */}
      {speedActive &&
        sortedSpeed.map((pt, idx) => {
          const isFocused =
            (dragging?.layer === 'speed' && dragging.index === idx) ||
            (hoveredNode?.layer === 'speed' && hoveredNode.index === idx);
          return (
            <div
              key={`spd-${idx}`}
              onPointerEnter={() => setHoveredNode({ layer: 'speed', index: idx })}
              onPointerLeave={() => setHoveredNode(null)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                removeInteriorNode('speed', idx);
              }}
              className="absolute -translate-x-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center z-20 cursor-grab active:cursor-grabbing"
              style={{
                left: `${pt.x * 100}%`,
                top: `${100 - pt.y * 86}%`,
              }}
            >
              <span
                className={cn(
                  'rounded-full border-2 transition-transform duration-100',
                  isFocused
                    ? 'w-3.5 h-3.5 scale-110'
                    : activeLayer === 'speed'
                    ? 'w-2.5 h-2.5'
                    : 'w-2 h-2 opacity-60'
                )}
                style={{
                  backgroundColor: screenMid,
                  borderColor: speedBright,
                  boxShadow: `0 0 calc(8px * var(--glow-scale, 1)) ${speedColor}`,
                }}
              />
              {isFocused && (
                <span
                  className="absolute -top-7 px-2 py-0.5 rounded bg-[#0E1016]/95 border border-white/15 font-mono text-[9.5px] tabular-nums whitespace-nowrap pointer-events-none shadow-lg"
                  style={{ color: speedBright }}
                >
                  {formatNodeReadout('speed', pt)}
                </span>
              )}
            </div>
          );
        })}

      {/* Interactive Pitch / Growl Curve Nodes */}
      {pitchActive &&
        sortedPitch.map((pt, idx) => {
          const isFocused =
            (dragging?.layer === 'pitch' && dragging.index === idx) ||
            (hoveredNode?.layer === 'pitch' && hoveredNode.index === idx);
          return (
            <div
              key={`pit-${idx}`}
              onPointerEnter={() => setHoveredNode({ layer: 'pitch', index: idx })}
              onPointerLeave={() => setHoveredNode(null)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                removeInteriorNode('pitch', idx);
              }}
              className="absolute -translate-x-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center z-20 cursor-grab active:cursor-grabbing"
              style={{
                left: `${pt.x * 100}%`,
                top: `${100 - pt.y * 86}%`,
              }}
            >
              <span
                className={cn(
                  'rounded-full border-2 transition-transform duration-100',
                  isFocused
                    ? 'w-3.5 h-3.5 scale-110'
                    : activeLayer === 'pitch'
                    ? 'w-2.5 h-2.5'
                    : 'w-2 h-2 opacity-60'
                )}
                style={{
                  backgroundColor: screenMid,
                  borderColor: pitchBright,
                  boxShadow: `0 0 calc(8px * var(--glow-scale, 1)) ${pitchColor}`,
                }}
              />
              {isFocused && (
                <span
                  className="absolute -top-7 px-2 py-0.5 rounded bg-[#0E1016]/95 border border-white/15 font-mono text-[9.5px] tabular-nums whitespace-nowrap pointer-events-none shadow-lg"
                  style={{ color: pitchBright }}
                >
                  {formatNodeReadout('pitch', pt)}
                </span>
              )}
            </div>
          );
        })}

      {/* Drag & Drop File Overlay */}
      {isDragOverFile && (
        <div className="absolute inset-0 z-30 bg-[#0E121B]/85 backdrop-blur-xs flex items-center justify-center pointer-events-none">
          <span
            className="font-display text-sm font-semibold tracking-[0.08em] uppercase"
            style={{ color: speedBright }}
          >
            Drop Audio File to Load into Granular Buffer
          </span>
        </div>
      )}

      {bypassed && (
        <div className="absolute bottom-2.5 right-4 pointer-events-none z-10 font-mono text-[9px] text-[#9BA3B8]">
          FX Bypassed
        </div>
      )}
    </div>
  );
});
