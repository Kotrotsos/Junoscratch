import React, { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ACCENT_PALETTES, DspAccent, clamp } from './tokens';
import { MidiLearnOverlayTag, useMidiLearnTarget } from './MidiLearnContext';
import { OttFlavorMode, SubThumpMode } from '../../types';
import { cn } from '../../utils';

/* ============================================================================
 * 1. DisperserPhaseDisplay — 16-Stage All-Pass Laser Group-Delay Curve (DISPERSER)
 * ============================================================================ */
export interface DisperserPhaseDisplayProps {
  freqHz: number; // 80..1200
  liveFreqHz?: number;
  amount: number; // 0..100
  pinch: number; // 0..100
  onChangeFreqHz: (hz: number) => void;
  accent?: DspAccent;
  midiId?: string;
  className?: string;
}

export const DisperserPhaseDisplay = React.memo(function DisperserPhaseDisplay({
  freqHz,
  liveFreqHz,
  amount,
  pinch,
  onChangeFreqHz,
  accent = 'cyan',
  midiId,
  className,
}: DisperserPhaseDisplayProps) {
  const palette = ACCENT_PALETTES[accent];
  const midi = useMidiLearnTarget(midiId, 'Disperser Pinch Freq');
  const [dragging, setDragging] = useState(false);
  const startYRef = useRef(0);
  const startValRef = useRef(freqHz);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (midi.interceptLearnEvent(e)) return;
    e.preventDefault();
    startYRef.current = e.clientY;
    startValRef.current = freqHz;
    setDragging(true);
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const dy = startYRef.current - e.clientY;
      const raw = startValRef.current + (dy / 140) * (1200 - 80);
      const next = clamp(Math.round(raw / 5) * 5, 80, 1200);
      onChangeFreqHz(next);
    };
    const onUp = () => setDragging(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, onChangeFreqHz]);

  const dispHz = liveFreqHz ?? freqHz;
  const pinchNorm = clamp((dispHz - 80) / 1500, 0.08, 0.9);
  const amtNorm = clamp(amount / 100, 0, 1);
  const qNorm = clamp(pinch / 100, 0, 1);

  const buildChirpPath = () => {
    const pts: string[] = [];
    const steps = 60;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const dist = Math.abs(u - pinchNorm);
      // Dispersive chirp: compressed high-frequency cycles near pinch point, stretched low tail
      const localCycles = 1.5 + (2.5 + amtNorm * 6.5) * Math.exp(-dist * (3.2 + qNorm * 4.5));
      const env = 0.25 + 0.75 * Math.exp(-Math.pow((u - pinchNorm) / (0.38 - qNorm * 0.16), 2));
      const yVal = Math.sin(u * Math.PI * 2 * localCycles) * env * (0.35 + amtNorm * 0.65);
      const x = u * 100;
      const y = 19 - yVal * 13;
      pts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    return pts.join(' ');
  };

  return (
    <div className="relative w-full min-w-0" onContextMenu={midi.handleContextMenu}>
      <MidiLearnOverlayTag
        midiId={midiId}
        binding={midi.binding}
        isArmed={midi.isArmed}
        midiLearnMode={midi.midiLearnMode}
        onUnbind={midi.unbind}
        compact
      />
      <div
        onPointerDown={handlePointerDown}
        title="Drag vertically to adjust All-Pass Disperser pinch frequency (80–1200 Hz)"
        className={cn(
          'dsp-well rounded-[14px] w-full min-w-[82px] h-[68px] px-2.5 py-1.5 relative overflow-hidden flex flex-col justify-between select-none transition-shadow',
          midi.enabled ? 'cursor-pointer' : 'cursor-ns-resize',
          midi.isArmed && 'ring-2 ring-[#FFB35C] shadow-[0_0_14px_rgba(255,159,67,0.5)]',
          !midi.isArmed && midi.enabled && midi.binding && 'ring-2 ring-[#38BDF8]/85',
          !midi.isArmed && midi.enabled && !midi.binding && 'ring-1 ring-[#38BDF8]/40 hover:ring-[#38BDF8]',
          className
        )}
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{ background: palette.wellGlow }}
        />

        <div className="relative z-10 flex items-center justify-between gap-1 whitespace-nowrap">
          <span className="font-display font-semibold text-[8.5px] tracking-[0.09em] uppercase text-[#8A92A8]">
            PINCH
          </span>
          <span
            className="font-mono text-[10px] font-medium tabular-nums"
            style={{
              color: palette.bright,
              textShadow: `0 0 8px ${palette.primary}`,
            }}
          >
            {Math.round(dispHz)} Hz
          </span>
        </div>

        <svg
          className="relative z-10 w-full h-[36px] overflow-visible pointer-events-none"
          viewBox="0 0 100 38"
          preserveAspectRatio="none"
        >
          <line
            x1="0"
            y1="19"
            x2="100"
            y2="19"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="1"
          />
          <line
            x1={pinchNorm * 100}
            y1="3"
            x2={pinchNorm * 100}
            y2="35"
            stroke={palette.primary}
            strokeOpacity="0.35"
            strokeDasharray="2 2"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={buildChirpPath()}
            fill="none"
            stroke={palette.bright}
            strokeWidth="1.65"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            style={{ filter: `drop-shadow(0 0 5px ${palette.primary})` }}
          />
        </svg>
      </div>
    </div>
  );
});

/* ============================================================================
 * 2. ReeseMirrorDisplay — Opposing Twin Notch & Peak Mirror Curve (REESE NOTCH)
 * ============================================================================ */
export interface ReeseMirrorDisplayProps {
  depth: number; // 0..100
  sweep: number; // 0..100
  onChangeSweep: (val: number) => void;
  accent?: DspAccent;
  midiId?: string;
  className?: string;
}

export const ReeseMirrorDisplay = React.memo(function ReeseMirrorDisplay({
  depth,
  sweep,
  onChangeSweep,
  accent = 'violet',
  midiId,
  className,
}: ReeseMirrorDisplayProps) {
  const palette = ACCENT_PALETTES[accent];
  const midi = useMidiLearnTarget(midiId, 'Reese Mirror Sweep');
  const [dragging, setDragging] = useState(false);
  const startYRef = useRef(0);
  const startValRef = useRef(sweep);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (midi.interceptLearnEvent(e)) return;
    e.preventDefault();
    startYRef.current = e.clientY;
    startValRef.current = sweep;
    setDragging(true);
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const dy = startYRef.current - e.clientY;
      const next = clamp(Math.round(startValRef.current + (dy / 110) * 100), 0, 100);
      onChangeSweep(next);
    };
    const onUp = () => setDragging(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, onChangeSweep]);

  const sweepNorm = clamp(sweep / 100, 0, 1);
  const depthNorm = clamp(depth / 100, 0, 1);
  // Opposing notches fold inward as sweep rises
  const leftNotchX = 14 + sweepNorm * 28;
  const rightNotchX = 86 - sweepNorm * 28;

  const buildMirrorPath = () => {
    const pts: string[] = [];
    const steps = 44;
    for (let i = 0; i <= steps; i++) {
      const x = (i / steps) * 100;
      const dipL = Math.exp(-Math.pow((x - leftNotchX) / 6.2, 2)) * (4 + depthNorm * 12);
      const dipR = Math.exp(-Math.pow((x - rightNotchX) / 6.2, 2)) * (4 + depthNorm * 12);
      const pkL = Math.exp(-Math.pow((x - (leftNotchX + 9)) / 6.5, 2)) * (2 + depthNorm * 7);
      const pkR = Math.exp(-Math.pow((x - (rightNotchX - 9)) / 6.5, 2)) * (2 + depthNorm * 7);
      const y = clamp(18 + dipL + dipR - pkL - pkR, 4, 34);
      pts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    return pts.join(' ');
  };

  const curve = buildMirrorPath();

  return (
    <div className="relative flex-1 min-w-[78px] max-w-[106px]" onContextMenu={midi.handleContextMenu}>
      <MidiLearnOverlayTag
        midiId={midiId}
        binding={midi.binding}
        isArmed={midi.isArmed}
        midiLearnMode={midi.midiLearnMode}
        onUnbind={midi.unbind}
        compact
      />
      <div
        onPointerDown={handlePointerDown}
        title="Drag vertically to sweep opposing Reese mirror notches inward/outward"
        className={cn(
          'dsp-well rounded-[14px] w-full h-[66px] px-2.5 py-2 relative overflow-hidden flex flex-col justify-between select-none transition-shadow',
          midi.enabled ? 'cursor-pointer' : 'cursor-ns-resize',
          midi.isArmed && 'ring-2 ring-[#FFB35C] shadow-[0_0_14px_rgba(255,159,67,0.5)]',
          !midi.isArmed && midi.enabled && midi.binding && 'ring-2 ring-[#38BDF8]/85',
          !midi.isArmed && midi.enabled && !midi.binding && 'ring-1 ring-[#38BDF8]/40 hover:ring-[#38BDF8]',
          className
        )}
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{ background: palette.wellGlow }}
        />

        <div className="relative z-10 flex items-center justify-between gap-1 whitespace-nowrap">
          <span className="font-display font-semibold text-[8px] tracking-[0.08em] uppercase text-[#8690A6]">
            SWEEP
          </span>
          <span
            className="font-mono text-[9.5px] font-medium tabular-nums"
            style={{ color: palette.bright, textShadow: `0 0 7px ${palette.primary}` }}
          >
            {Math.round(sweep)}%
          </span>
        </div>

        <svg
          className="relative z-10 w-full h-[36px] overflow-visible pointer-events-none"
          viewBox="0 0 100 38"
          preserveAspectRatio="none"
        >
          <line
            x1="50"
            y1="2"
            x2="50"
            y2="36"
            stroke="rgba(255,255,255,0.1)"
            strokeDasharray="2 2"
            strokeWidth="1"
          />
          <path
            d={`${curve} L 100 36 L 0 36 Z`}
            fill={palette.primary}
            fillOpacity="0.16"
          />
          <path
            d={curve}
            fill="none"
            stroke={palette.bright}
            strokeWidth="1.65"
            vectorEffect="non-scaling-stroke"
            style={{ filter: `drop-shadow(0 0 5px ${palette.primary})` }}
          />
        </svg>
      </div>
    </div>
  );
});

/* ============================================================================
 * 3. VinylPlatterDisplay — Turntable Platter & Motorized Tape-Stop BRAKE
 * ============================================================================ */
export interface VinylPlatterDisplayProps {
  scratchAmount: number; // 0..100
  brakeActive: boolean;
  onToggleBrake: () => void;
  playheadPhase?: number; // 0..1
  accent?: DspAccent;
  midiId?: string;
  className?: string;
}

export const VinylPlatterDisplay = React.memo(function VinylPlatterDisplay({
  scratchAmount,
  brakeActive,
  onToggleBrake,
  playheadPhase = 0,
  accent = 'amber',
  midiId,
  className,
}: VinylPlatterDisplayProps) {
  const palette = ACCENT_PALETTES[accent];
  const midi = useMidiLearnTarget(midiId, 'Turntable Tape-Stop Brake');
  const angleDeg = brakeActive ? 210 : (playheadPhase * 360 + scratchAmount * 1.8) % 360;

  return (
    <div className="relative flex-1 min-w-[82px] max-w-[108px]" onContextMenu={midi.handleContextMenu}>
      <MidiLearnOverlayTag
        midiId={midiId}
        binding={midi.binding}
        isArmed={midi.isArmed}
        midiLearnMode={midi.midiLearnMode}
        onUnbind={midi.unbind}
        compact
      />
      <div
        onPointerDownCapture={(e) => {
          if (midi.interceptLearnEvent(e)) return;
        }}
        className={cn(
          'dsp-well rounded-[14px] w-full h-[66px] px-2 py-1.5 relative overflow-hidden flex flex-col justify-between select-none transition-shadow',
          midi.enabled && 'cursor-pointer',
          midi.isArmed && 'ring-2 ring-[#FFB35C] shadow-[0_0_14px_rgba(255,159,67,0.5)]',
          !midi.isArmed && midi.enabled && midi.binding && 'ring-2 ring-[#38BDF8]/85',
          !midi.isArmed && midi.enabled && !midi.binding && 'ring-1 ring-[#38BDF8]/40 hover:ring-[#38BDF8]',
          className
        )}
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{ background: palette.wellGlow }}
        />

        <div className="relative z-10 flex items-center justify-between gap-1 whitespace-nowrap">
          <span className="font-display font-semibold text-[8px] tracking-[0.08em] uppercase text-[#8A92A8]">
            DECK
          </span>
          <span
            className="font-mono text-[8.5px] font-medium tabular-nums"
            style={{ color: brakeActive ? '#FDA4AF' : palette.bright }}
          >
            {brakeActive ? 'STOP' : '33⅓'}
          </span>
        </div>

        <div className="relative z-10 flex items-center justify-between gap-1.5">
          {/* Rotating Vinyl Platter SVG */}
          <svg width="34" height="34" viewBox="0 0 36 36" className="shrink-0 overflow-visible">
            <circle
              cx="18"
              cy="18"
              r="15.5"
              fill="rgba(10,12,18,0.85)"
              stroke={brakeActive ? '#FB7185' : palette.primary}
              strokeOpacity="0.65"
              strokeWidth="1.3"
            />
            <circle
              cx="18"
              cy="18"
              r="10.5"
              fill="none"
              stroke="rgba(255,255,255,0.12)"
              strokeWidth="0.9"
            />
            <g transform={`rotate(${angleDeg.toFixed(1)} 18 18)`}>
              <line
                x1="18"
                y1="18"
                x2="18"
                y2="4"
                stroke={brakeActive ? '#FDA4AF' : palette.bright}
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </g>
            <circle cx="18" cy="18" r="3.2" fill={brakeActive ? '#FB7185' : palette.bright} />
          </svg>

          {/* Motorized Tape-Stop BRAKE Button */}
          <button
            type="button"
            onClick={() => !midi.enabled && onToggleBrake()}
            title="Motorized Turntable Tape-Stop Brake (click to spin down / release to spin up)"
            className={cn(
              'px-1.5 py-1.5 rounded-lg border font-display text-[8.5px] font-bold tracking-[0.08em] uppercase whitespace-nowrap cursor-pointer transition-colors focus-visible:outline-none',
              brakeActive
                ? 'bg-[#FB7185]/25 border-[#FB7185]/80 text-[#FFE4E6] shadow-[0_0_10px_rgba(251,113,133,0.45)]'
                : 'bg-white/[0.04] border-white/15 text-[#A5AEBF] hover:text-white hover:border-white/35'
            )}
          >
            BRAKE
          </button>
        </div>
      </div>
    </div>
  );
});

/* ============================================================================
 * 4. SpectralGateDisplay — 8-Band Vocoder Spectral Gate Analyzer (SPECTRAL GATE)
 * ============================================================================ */
export interface SpectralGateDisplayProps {
  bands: number[]; // length 8, values 0..1
  threshold: number; // 0..100
  onChangeThreshold: (val: number) => void;
  accent?: DspAccent;
  midiId?: string;
  className?: string;
}

export const SpectralGateDisplay = React.memo(function SpectralGateDisplay({
  bands,
  threshold,
  onChangeThreshold,
  accent = 'emerald',
  midiId,
  className,
}: SpectralGateDisplayProps) {
  const palette = ACCENT_PALETTES[accent];
  const midi = useMidiLearnTarget(midiId, 'Spectral Gate Threshold');
  const [dragging, setDragging] = useState(false);
  const startYRef = useRef(0);
  const startValRef = useRef(threshold);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (midi.interceptLearnEvent(e)) return;
    e.preventDefault();
    startYRef.current = e.clientY;
    startValRef.current = threshold;
    setDragging(true);
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const dy = startYRef.current - e.clientY;
      const next = clamp(Math.round(startValRef.current + (dy / 120) * 100), 0, 100);
      onChangeThreshold(next);
    };
    const onUp = () => setDragging(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, onChangeThreshold]);

  const threshNorm = clamp(threshold / 100, 0.08, 0.92);
  const safeBands =
    bands.length === 8 ? bands : [0.24, 0.48, 0.36, 0.72, 0.56, 0.68, 0.42, 0.28];

  return (
    <div className="relative w-full min-w-0" onContextMenu={midi.handleContextMenu}>
      <MidiLearnOverlayTag
        midiId={midiId}
        binding={midi.binding}
        isArmed={midi.isArmed}
        midiLearnMode={midi.midiLearnMode}
        onUnbind={midi.unbind}
        compact
      />
      <div
        onPointerDown={handlePointerDown}
        title="Drag vertically to set 8-band Spectral Gate threshold"
        className={cn(
          'dsp-well rounded-[14px] w-full min-w-[82px] h-[68px] px-2.5 py-1.5 relative overflow-hidden flex flex-col justify-between select-none transition-shadow',
          midi.enabled ? 'cursor-pointer' : 'cursor-ns-resize',
          midi.isArmed && 'ring-2 ring-[#FFB35C] shadow-[0_0_14px_rgba(255,159,67,0.5)]',
          !midi.isArmed && midi.enabled && midi.binding && 'ring-2 ring-[#38BDF8]/85',
          !midi.isArmed && midi.enabled && !midi.binding && 'ring-1 ring-[#38BDF8]/40 hover:ring-[#38BDF8]',
          className
        )}
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{ background: palette.wellGlow }}
        />

        <div className="relative z-10 flex items-center justify-between gap-1 whitespace-nowrap">
          <span className="font-display font-semibold text-[8.5px] tracking-[0.08em] uppercase text-[#8A92A8]">
            GATE
          </span>
          <span
            className="font-mono text-[9.5px] font-medium tabular-nums"
            style={{ color: palette.bright, textShadow: `0 0 8px ${palette.primary}` }}
          >
            {Math.round(threshold)}%
          </span>
        </div>

        {/* 8 Vocoder Filterbank Columns + Draggable Threshold Line */}
        <div className="relative z-10 w-full h-[36px] flex items-end justify-between gap-[3px] pt-1 pb-0.5">
          {/* Horizontal Threshold Gate Hairline */}
          <div
            aria-hidden="true"
            className="absolute inset-x-0 h-[1.5px] pointer-events-none z-20"
            style={{
              bottom: `${Math.round(threshNorm * 88)}%`,
              backgroundColor: palette.bright,
              boxShadow: `0 0 6px ${palette.primary}`,
              opacity: 0.85,
            }}
          />

          {safeBands.map((lvl, idx) => {
            const clampedLvl = clamp(lvl, 0.08, 0.96);
            const open = clampedLvl >= threshNorm * 0.85;
            return (
              <div
                key={idx}
                className="flex-1 h-full flex items-end justify-center overflow-hidden"
              >
                <span
                  className="w-full h-full rounded-t-[2px] origin-bottom will-change-transform transition-opacity duration-75"
                  style={{
                    transform: `scaleY(${clampedLvl.toFixed(3)})`,
                    backgroundColor: open ? palette.bright : 'rgba(255,255,255,0.16)',
                    opacity: open ? 0.92 : 0.35,
                    boxShadow: open ? `0 0 6px ${palette.primary}` : undefined,
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

/* ============================================================================
 * 5. SubThumpDisplay — Sub-Harmonic Transient Pitch-Spike Curve (SUB THUMP)
 * ============================================================================ */
const THUMP_MODES: SubThumpMode[] = ['FAST', 'PUNCH', '808'];

export interface SubThumpDisplayProps {
  amount: number; // 0..100
  mode: SubThumpMode;
  onChangeMode: (next: SubThumpMode) => void;
  accent?: DspAccent;
  midiId?: string;
  className?: string;
}

export const SubThumpDisplay = React.memo(function SubThumpDisplay({
  amount,
  mode,
  onChangeMode,
  accent = 'amber',
  midiId,
  className,
}: SubThumpDisplayProps) {
  const palette = ACCENT_PALETTES[accent];
  const midi = useMidiLearnTarget(midiId, 'Sub Thump Mode');
  const idx = Math.max(0, THUMP_MODES.indexOf(mode));

  const cycle = (dir: -1 | 1) => {
    const next = THUMP_MODES[(idx + dir + THUMP_MODES.length) % THUMP_MODES.length];
    onChangeMode(next);
  };

  const amtNorm = clamp(amount / 100, 0, 1);
  const tau = mode === 'FAST' ? 7.5 : mode === '808' ? 2.4 : 4.2;

  const buildSpikePath = () => {
    const pts: string[] = [];
    const steps = 32;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const env = Math.exp(-t * tau) * (0.25 + amtNorm * 0.75);
      const x = t * 100;
      const y = 32 - env * 26;
      pts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    return pts.join(' ');
  };

  const curve = buildSpikePath();

  return (
    <div className="relative flex-1 min-w-[78px] max-w-[106px]" onContextMenu={midi.handleContextMenu}>
      <MidiLearnOverlayTag
        midiId={midiId}
        binding={midi.binding}
        isArmed={midi.isArmed}
        midiLearnMode={midi.midiLearnMode}
        onUnbind={midi.unbind}
        compact
      />
      <div
        onPointerDownCapture={(e) => {
          if (midi.interceptLearnEvent(e)) return;
        }}
        className={cn(
          'dsp-well rounded-[14px] w-full h-[66px] px-2 py-2 relative overflow-hidden flex flex-col items-center justify-between select-none transition-shadow',
          midi.enabled && 'cursor-pointer',
          midi.isArmed && 'ring-2 ring-[#FFB35C] shadow-[0_0_14px_rgba(255,159,67,0.5)]',
          !midi.isArmed && midi.enabled && midi.binding && 'ring-2 ring-[#38BDF8]/85',
          !midi.isArmed && midi.enabled && !midi.binding && 'ring-1 ring-[#38BDF8]/40 hover:ring-[#38BDF8]',
          className
        )}
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{ background: palette.wellGlow }}
        />

        <span
          className="relative z-10 font-display font-semibold text-[8.5px] tracking-[0.09em] uppercase"
          style={{ color: palette.bright, textShadow: `0 0 8px ${palette.primary}` }}
        >
          {mode}
        </span>

        <div className="relative z-10 w-full flex items-center justify-between gap-0.5">
          <button
            type="button"
            onClick={() => !midi.enabled && cycle(-1)}
            aria-label="Previous Sub Thump decay mode"
            className="w-3.5 h-6 flex items-center justify-center text-[#788094] hover:text-white transition-colors cursor-pointer shrink-0 focus-visible:outline-none"
          >
            <ChevronLeft size={11} strokeWidth={2} />
          </button>

          <svg
            className="flex-1 h-[34px] overflow-visible pointer-events-none"
            viewBox="0 0 100 36"
            preserveAspectRatio="none"
          >
            <path d={`${curve} L 100 34 L 0 34 Z`} fill={palette.primary} fillOpacity="0.18" />
            <path
              d={curve}
              fill="none"
              stroke={palette.bright}
              strokeWidth="1.8"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              style={{ filter: `drop-shadow(0 0 5px ${palette.primary})` }}
            />
          </svg>

          <button
            type="button"
            onClick={() => !midi.enabled && cycle(1)}
            aria-label="Next Sub Thump decay mode"
            className="w-3.5 h-6 flex items-center justify-center text-[#788094] hover:text-white transition-colors cursor-pointer shrink-0 focus-visible:outline-none"
          >
            <ChevronRight size={11} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
});

/* ============================================================================
 * 6. OttMultibandDisplay — 3-Band Upward/Downward OTT Meter (OTT MULTIBAND)
 * ============================================================================ */
const OTT_MODES: OttFlavorMode[] = ['UPWARD', 'SLAM', 'CRISP'];

export interface OttMultibandDisplayProps {
  amount: number; // 0..100
  mode: OttFlavorMode;
  bands?: [number, number, number];
  onChangeMode: (next: OttFlavorMode) => void;
  accent?: DspAccent;
  midiId?: string;
  className?: string;
}

export const OttMultibandDisplay = React.memo(function OttMultibandDisplay({
  amount,
  mode,
  bands = [0.58, 0.68, 0.76],
  onChangeMode,
  accent = 'emerald',
  midiId,
  className,
}: OttMultibandDisplayProps) {
  const palette = ACCENT_PALETTES[accent];
  const midi = useMidiLearnTarget(midiId, 'OTT Flavor Mode');
  const idx = Math.max(0, OTT_MODES.indexOf(mode));

  const cycle = (dir: -1 | 1) => {
    const next = OTT_MODES[(idx + dir + OTT_MODES.length) % OTT_MODES.length];
    onChangeMode(next);
  };

  const amtNorm = clamp(amount / 100, 0, 1);
  const bandLabels = ['L', 'M', 'H'];

  return (
    <div className="relative flex-1 min-w-[78px] max-w-[106px]" onContextMenu={midi.handleContextMenu}>
      <MidiLearnOverlayTag
        midiId={midiId}
        binding={midi.binding}
        isArmed={midi.isArmed}
        midiLearnMode={midi.midiLearnMode}
        onUnbind={midi.unbind}
        compact
      />
      <div
        onPointerDownCapture={(e) => {
          if (midi.interceptLearnEvent(e)) return;
        }}
        className={cn(
          'dsp-well rounded-[14px] w-full h-[66px] px-2 py-1.5 relative overflow-hidden flex flex-col items-center justify-between select-none transition-shadow',
          midi.enabled && 'cursor-pointer',
          midi.isArmed && 'ring-2 ring-[#FFB35C] shadow-[0_0_14px_rgba(255,159,67,0.5)]',
          !midi.isArmed && midi.enabled && midi.binding && 'ring-2 ring-[#38BDF8]/85',
          !midi.isArmed && midi.enabled && !midi.binding && 'ring-1 ring-[#38BDF8]/40 hover:ring-[#38BDF8]',
          className
        )}
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{ background: palette.wellGlow }}
        />

        <span
          className="relative z-10 font-display font-semibold text-[8px] tracking-[0.09em] uppercase whitespace-nowrap"
          style={{ color: palette.bright, textShadow: `0 0 8px ${palette.primary}` }}
        >
          {mode}
        </span>

        <div className="relative z-10 w-full flex items-center justify-between gap-0.5">
          <button
            type="button"
            onClick={() => !midi.enabled && cycle(-1)}
            aria-label="Previous OTT dynamics flavor"
            className="w-3.5 h-6 flex items-center justify-center text-[#788094] hover:text-white transition-colors cursor-pointer shrink-0 focus-visible:outline-none"
          >
            <ChevronLeft size={11} strokeWidth={2} />
          </button>

          {/* 3-Band L / M / H OTT Upward Lift Bars */}
          <div className="flex-1 h-[36px] flex items-end justify-around gap-1.5 px-1 pt-1">
            {bands.map((rawLvl, bIdx) => {
              const lifted = clamp(rawLvl * (0.55 + amtNorm * 0.45) + amtNorm * 0.2, 0.16, 0.96);
              return (
                <div key={bIdx} className="flex flex-col items-center justify-end h-full gap-0.5 flex-1">
                  <div className="w-full flex-1 bg-white/[0.06] rounded-[3px] relative overflow-hidden flex items-end">
                    <span
                      className="w-full h-full rounded-[2px] origin-bottom will-change-transform transition-opacity duration-75"
                      style={{
                        transform: `scaleY(${lifted.toFixed(3)})`,
                        backgroundColor: palette.bright,
                        boxShadow: `0 0 6px ${palette.primary}`,
                      }}
                    />
                  </div>
                  <span className="font-mono text-[7px] leading-none text-[#8A92A8]">
                    {bandLabels[bIdx]}
                  </span>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => !midi.enabled && cycle(1)}
            aria-label="Next OTT dynamics flavor"
            className="w-3.5 h-6 flex items-center justify-center text-[#788094] hover:text-white transition-colors cursor-pointer shrink-0 focus-visible:outline-none"
          >
            <ChevronRight size={11} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
});
