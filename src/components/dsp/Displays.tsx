import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ACCENT_PALETTES, DspAccent, frequencyToNote, formatFilterFreq, clamp } from './tokens';
import { MidiLearnOverlayTag, useMidiLearnTarget } from './MidiLearnContext';
import { cn } from '../../utils';

/* ============================================================================
 * 1. LcdFreqDisplay — Recessed Phosphor Readout (SUB 1 / SUB 2)
 * ============================================================================ */
export interface LcdFreqDisplayProps {
  frequency: number;
  minFreq?: number;
  maxFreq?: number;
  step?: number;
  onChangeFrequency?: (hz: number) => void;
  allowNoteMode?: boolean;
  accent?: DspAccent;
  meterLevel?: number; // 0 to 1
  labelPrimary?: string;
  labelSecondary?: string;
  unit?: string;
  formatCustomValue?: (val: number) => string;
  formatSecondaryValue?: (val: number) => { main: string; unit?: string };
  midiId?: string;
  className?: string;
}

export const LcdFreqDisplay = React.memo(function LcdFreqDisplay({
  frequency,
  minFreq = 20,
  maxFreq = 160,
  step = 1,
  onChangeFrequency,
  allowNoteMode = true,
  accent = 'blue',
  meterLevel = 0.65,
  labelPrimary = 'FREQ',
  labelSecondary = 'NOTE',
  unit = 'Hz',
  formatCustomValue,
  formatSecondaryValue,
  midiId,
  className,
}: LcdFreqDisplayProps) {
  const [mode, setMode] = useState<'freq' | 'note'>('freq');
  const [dragging, setDragging] = useState(false);
  const startYRef = useRef(0);
  const startFreqRef = useRef(frequency);
  const midi = useMidiLearnTarget(midiId, labelPrimary);

  const palette = ACCENT_PALETTES[accent];

  const handlePointerDown = (e: React.PointerEvent) => {
    if (midi.interceptLearnEvent(e)) return;
    if (!onChangeFrequency) return;
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    startYRef.current = e.clientY;
    startFreqRef.current = frequency;
    setDragging(true);
  };

  useEffect(() => {
    if (!dragging || !onChangeFrequency) return;
    const onMove = (e: PointerEvent) => {
      const dy = startYRef.current - e.clientY;
      const span = maxFreq - minFreq;
      const raw = startFreqRef.current + (dy / 140) * span;
      const snapped = Math.round(raw / step) * step;
      const decimals = step < 0.1 ? 2 : step < 1 ? 1 : 0;
      const next = clamp(Number(snapped.toFixed(decimals)), minFreq, maxFreq);
      onChangeFrequency(next);
    };
    const onUp = () => setDragging(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, minFreq, maxFreq, step, onChangeFrequency]);

  const segments = 9;
  const activeSegments = Math.round(clamp(meterLevel, 0, 1) * segments);

  let mainValue: string;
  let showUnit: string;

  if (mode === 'note' && allowNoteMode) {
    if (formatSecondaryValue) {
      const sec = formatSecondaryValue(frequency);
      mainValue = sec.main;
      showUnit = sec.unit || '';
    } else {
      mainValue = frequencyToNote(frequency);
      showUnit = '';
    }
  } else if (formatCustomValue) {
    mainValue = formatCustomValue(frequency);
    showUnit = unit;
  } else {
    mainValue = step < 1 ? frequency.toFixed(1) : `${Math.round(frequency)}`;
    showUnit = unit;
  }

  return (
    <div className="relative flex-1 w-full min-w-0" onContextMenu={midi.handleContextMenu}>
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
        title={onChangeFrequency ? 'Drag vertically to adjust value' : undefined}
        className={cn(
          'dsp-well rounded-[14px] w-full min-w-[78px] h-[68px] px-2.5 py-2 relative overflow-hidden flex flex-col justify-between select-none transition-shadow',
          midi.enabled ? 'cursor-pointer' : onChangeFrequency && 'cursor-ns-resize',
          midi.isArmed && 'ring-2 ring-[#FFB35C] shadow-[0_0_14px_rgba(255,159,67,0.5)]',
          !midi.isArmed && midi.enabled && midi.binding && 'ring-2 ring-[#38BDF8]/85',
          !midi.isArmed && midi.enabled && !midi.binding && 'ring-1 ring-[#38BDF8]/40 hover:ring-[#38BDF8]',
          className
        )}
      >
      {/* Ambient Phosphor Glow at Bottom of Glass Well */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{ background: palette.wellGlow }}
      />

      {/* Top Mode Tabs */}
      <div className="relative z-10 flex items-center justify-between gap-1.5 text-[8.5px] font-display font-semibold tracking-[0.06em] uppercase whitespace-nowrap">
        <button
          type="button"
          onClick={() => !midi.enabled && setMode('freq')}
          className="cursor-pointer transition-colors focus-visible:outline-none"
          style={{
            color: mode === 'freq' ? palette.bright : '#5A6070',
            textShadow: mode === 'freq' ? `0 0 8px ${palette.primary}` : undefined,
          }}
        >
          {labelPrimary}
        </button>
        {allowNoteMode && (
          <button
            type="button"
            onClick={() => !midi.enabled && setMode('note')}
            className="cursor-pointer transition-colors focus-visible:outline-none"
            style={{
              color: mode === 'note' ? palette.bright : '#5A6070',
              textShadow: mode === 'note' ? `0 0 8px ${palette.primary}` : undefined,
            }}
          >
            {labelSecondary}
          </button>
        )}
      </div>

      {/* Bottom Numeric Readout + Right Vertical Bar Ladder */}
      <div className="relative z-10 flex items-end justify-between gap-1">
        <div className="flex items-baseline gap-1 leading-none">
          <span
            className="font-display font-medium text-[22px] tracking-tight tabular-nums leading-none"
            style={{
              color: palette.bright,
              textShadow: `0 0 12px ${palette.primary}`,
            }}
          >
            {mainValue}
          </span>
          {showUnit && (
            <span
              className="font-sans text-[10.5px] font-medium"
              style={{ color: palette.primary }}
            >
              {showUnit}
            </span>
          )}
        </div>

        {/* Right-edge 9-Segment Level Ladder */}
        <div className="flex flex-col-reverse gap-[2px] pb-0.5">
          {Array.from({ length: segments }).map((_, idx) => {
            const lit = idx < activeSegments;
            return (
              <span
                key={idx}
                className="w-[5px] h-[1.5px] rounded-full transition-colors duration-100"
                style={{
                  backgroundColor: lit ? palette.bright : 'rgba(255,255,255,0.14)',
                  boxShadow: lit ? `0 0 4px ${palette.primary}` : undefined,
                }}
              />
            );
          })}
        </div>
      </div>
      </div>
    </div>
  );
});

/* ============================================================================
 * 2. HarmonicTubeDisplay — Recessed Mode & Vacuum Tube Screen (TONE)
 * ============================================================================ */
export interface HarmonicTubeDisplayProps {
  modes?: string[];
  mode: string;
  onChangeMode: (nextMode: string) => void;
  drive?: number; // 0 to 1 intensity of filament glow
  accent?: DspAccent;
  midiId?: string;
  className?: string;
}

export const HarmonicTubeDisplay = React.memo(function HarmonicTubeDisplay({
  modes = ['TUBE', 'TAPE', 'WARM', 'CLIP'],
  mode,
  onChangeMode,
  drive = 0.65,
  accent = 'amber',
  midiId,
  className,
}: HarmonicTubeDisplayProps) {
  const palette = ACCENT_PALETTES[accent];
  const midi = useMidiLearnTarget(midiId, 'Tone Mode');
  const idx = Math.max(0, modes.indexOf(mode));

  const cycle = (dir: -1 | 1) => {
    const nextIdx = (idx + dir + modes.length) % modes.length;
    onChangeMode(modes[nextIdx]);
  };

  const glowIntensity = 0.45 + clamp(drive, 0, 1) * 0.55;

  return (
    <div className="relative flex-1 min-w-[78px] max-w-[104px]" onContextMenu={midi.handleContextMenu}>
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
      {/* Warm Radial Filament Bloom */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none transition-opacity duration-150"
        style={{
          background: `radial-gradient(circle at 50% 68%, color-mix(in srgb, ${palette.primary} 35%, transparent) 0%, color-mix(in srgb, ${palette.primary} 12%, transparent) 45%, transparent 78%)`,
          opacity: glowIntensity,
        }}
      />

      {/* Mode Title */}
      <span
        className="relative z-10 font-display font-semibold text-[8.5px] tracking-[0.1em] uppercase"
        style={{
          color: palette.bright,
          textShadow: `0 0 8px ${palette.primary}`,
        }}
      >
        {mode}
      </span>

      {/* Left Chevron + Glowing Tube / Filament Vector + Right Chevron */}
      <div className="relative z-10 w-full flex items-center justify-between">
        <button
          type="button"
          onClick={() => !midi.enabled && cycle(-1)}
          aria-label="Previous harmonic mode"
          className="w-4 h-6 flex items-center justify-center text-[#788094] hover:text-white transition-colors cursor-pointer focus-visible:outline-none"
        >
          <ChevronLeft size={11} strokeWidth={2} />
        </button>

        {/* Glowing Vacuum Tube Filament SVG */}
        <svg
          width="26"
          height="34"
          viewBox="0 0 26 34"
          fill="none"
          className="overflow-visible"
          style={{
            filter: `drop-shadow(0 0 ${6 + drive * 8}px ${palette.primary})`,
          }}
        >
          {/* Outer glass envelope */}
          <rect
            x="6.5"
            y="4"
            width="13"
            height="23"
            rx="6.5"
            stroke={palette.primary}
            strokeOpacity={0.55 + drive * 0.35}
            strokeWidth="1.2"
            fill={palette.primary}
            fillOpacity={0.1}
          />
          {/* Top tip */}
          <line
            x1="13"
            y1="1.8"
            x2="13"
            y2="4"
            stroke={palette.bright}
            strokeWidth="1.3"
            strokeLinecap="round"
          />
          {/* Inner glowing cathode coils */}
          <rect
            x="9.5"
            y="8.5"
            width="7"
            height="13.5"
            rx="3.5"
            stroke={palette.bright}
            strokeWidth="1.3"
            fill={palette.bright}
            fillOpacity={0.22}
          />
          <line
            x1="13"
            y1="7"
            x2="13"
            y2="24"
            stroke="#FFF7ED"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          {/* Base pins */}
          <line x1="10" y1="27.5" x2="10" y2="30.5" stroke={palette.primary} strokeWidth="1.1" />
          <line x1="13" y1="27.5" x2="13" y2="31" stroke={palette.primary} strokeWidth="1.1" />
          <line x1="16" y1="27.5" x2="16" y2="30.5" stroke={palette.primary} strokeWidth="1.1" />
        </svg>

        <button
          type="button"
          onClick={() => !midi.enabled && cycle(1)}
          aria-label="Next harmonic mode"
          className="w-4 h-6 flex items-center justify-center text-[#788094] hover:text-white transition-colors cursor-pointer focus-visible:outline-none"
        >
          <ChevronRight size={11} strokeWidth={2} />
        </button>
      </div>
      </div>
    </div>
  );
});

/* ============================================================================
 * 3. WaveformScopeDisplay — Recessed Bipolar Transient Scope (STABILISE)
 * ============================================================================ */
const DEFAULT_SCOPE_BARS = [
  0.22, 0.48, 0.35, 0.62, 0.28, 0.18, 0.52, 0.78, 0.44, 0.32, 0.68, 0.41,
  0.24, 0.56, 0.88, 0.47, 0.36, 0.74, 0.58, 0.29, 0.84, 0.51, 0.38, 0.64,
  0.31, 0.45, 0.2,
];

export interface WaveformScopeDisplayProps {
  amount?: number; // 0 to 1 compression/stabilise amount
  samples?: number[];
  accent?: DspAccent;
  className?: string;
}

export const WaveformScopeDisplay = React.memo(function WaveformScopeDisplay({
  amount = 0.58,
  samples = DEFAULT_SCOPE_BARS,
  accent = 'violet',
  className,
}: WaveformScopeDisplayProps) {
  const palette = ACCENT_PALETTES[accent];

  return (
    <div
      className={cn(
        'dsp-well rounded-[14px] flex-1 min-w-[78px] max-w-[104px] h-[66px] px-2 py-2 relative overflow-hidden flex items-center justify-center select-none',
        className
      )}
    >
      {/* Ambient Violet Bottom Glow */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{ background: palette.wellGlow }}
      />

      {/* Center Zero-Crossing Axis Line */}
      <div
        aria-hidden="true"
        className="absolute left-1.5 right-1.5 top-1/2 -translate-y-1/2 h-[1px] opacity-40"
        style={{ backgroundColor: palette.primary }}
      />

      {/* Bipolar Transient Bars (GPU-composited scaleY — zero layout reflow) */}
      <div className="relative z-10 w-full h-full flex items-center justify-between gap-[1.5px] px-0.5">
        {samples.map((rawAmp, i) => {
          // Higher stabilise tames extreme peaks toward a controlled tight dynamic contour
          const tamed = rawAmp * (1 - amount * 0.45) + 0.35 * amount * (rawAmp > 0.25 ? 1 : 0.4);
          const scaleY = clamp((tamed * 85) / 88, 0.11, 1);
          const highlight = i % 3 === 1;
          return (
            <span
              key={i}
              className="w-[1.6px] h-[88%] rounded-full origin-center will-change-transform"
              style={{
                transform: `scaleY(${scaleY.toFixed(3)})`,
                backgroundColor: highlight ? palette.bright : palette.primary,
                opacity: highlight ? 0.95 : 0.68,
                boxShadow: highlight ? `0 0 6px ${palette.primary}` : undefined,
              }}
            />
          );
        })}
      </div>
    </div>
  );
});

/* ============================================================================
 * 4. DualFilterBar — Recessed HP / LP Bandpass Strip (40 Hz — 10 kHz)
 * ============================================================================ */
export interface DualFilterBarProps {
  hpFreq: number; // 20 - 400 Hz
  lpFreq: number; // 800 - 20000 Hz
  onChangeHp: (hz: number) => void;
  onChangeLp: (hz: number) => void;
  accent?: DspAccent;
  hpMidiId?: string;
  lpMidiId?: string;
  className?: string;
}

const FILTER_SPECTRUM_BARS = [
  0.22, 0.34, 0.28, 0.48, 0.62, 0.45, 0.74, 0.86, 0.68, 0.92, 0.78, 0.64, 0.82, 0.58, 0.7, 0.46,
  0.52, 0.36, 0.24,
];

export const DualFilterBar = React.memo(function DualFilterBar({
  hpFreq,
  lpFreq,
  onChangeHp,
  onChangeLp,
  accent = 'emerald',
  hpMidiId,
  lpMidiId,
  className,
}: DualFilterBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [draggingHandle, setDraggingHandle] = useState<'hp' | 'lp' | null>(null);
  const palette = ACCENT_PALETTES[accent];
  const hpMidi = useMidiLearnTarget(hpMidiId, 'High-Pass Filter');
  const lpMidi = useMidiLearnTarget(lpMidiId, 'Low-Pass Filter');

  // Map hpFreq (20..400) -> 0.09..0.43 normalized X
  const hpNorm =
    0.09 +
    clamp((Math.log10(hpFreq) - Math.log10(20)) / (Math.log10(400) - Math.log10(20)), 0, 1) * 0.34;
  // Map lpFreq (800..20000) -> 0.57..0.91 normalized X
  const lpNorm =
    0.57 +
    clamp((Math.log10(lpFreq) - Math.log10(800)) / (Math.log10(20000) - Math.log10(800)), 0, 1) *
      0.34;

  const updateFromPointer = useCallback(
    (clientX: number, target: 'hp' | 'lp') => {
      if (!trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const xNorm = clamp((clientX - rect.left) / rect.width, 0, 1);

      if (target === 'hp') {
        const t = clamp((xNorm - 0.09) / 0.34, 0, 1);
        const hz = Math.pow(10, Math.log10(20) + t * (Math.log10(400) - Math.log10(20)));
        onChangeHp(Math.round(hz));
      } else {
        const t = clamp((xNorm - 0.57) / 0.34, 0, 1);
        const hz = Math.pow(10, Math.log10(800) + t * (Math.log10(20000) - Math.log10(800)));
        onChangeLp(Math.round(hz));
      }
    },
    [onChangeHp, onChangeLp]
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const xNorm = (e.clientX - rect.left) / rect.width;
    if (hpMidi.enabled || lpMidi.enabled) {
      if (xNorm < 0.5 && hpMidi.enabled) {
        hpMidi.interceptLearnEvent(e);
        return;
      }
      if (xNorm >= 0.5 && lpMidi.enabled) {
        lpMidi.interceptLearnEvent(e);
        return;
      }
    }
    e.preventDefault();
    const distHp = Math.abs(xNorm - hpNorm);
    const distLp = Math.abs(xNorm - lpNorm);
    const chosen = distHp <= distLp ? 'hp' : 'lp';
    setDraggingHandle(chosen);
    updateFromPointer(e.clientX, chosen);
  };

  useEffect(() => {
    if (!draggingHandle) return;
    const onMove = (e: PointerEvent) => updateFromPointer(e.clientX, draggingHandle);
    const onUp = () => setDraggingHandle(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [draggingHandle, updateFromPointer]);

  const hpX = hpNorm * 100;
  const lpX = lpNorm * 100;
  const slopeW = 10;
  const curvePath = `M ${Math.max(0, hpX - slopeW)} 32 Q ${hpX - slopeW * 0.24} 9.5 ${hpX} 10.5 L ${lpX} 10.5 Q ${lpX + slopeW * 0.24} 9.5 ${Math.min(100, lpX + slopeW)} 32`;
  const areaPath = `${curvePath} Z`;

  return (
    <div className={cn('flex flex-col select-none w-full relative', className)}>
      {(hpMidi.midiLearnMode || lpMidi.midiLearnMode) && (
        <div className="flex items-center justify-between px-1 mb-0.5 pointer-events-auto">
          <div className="relative h-3 w-12">
            <MidiLearnOverlayTag
              midiId={hpMidiId}
              binding={hpMidi.binding}
              isArmed={hpMidi.isArmed}
              midiLearnMode={hpMidi.midiLearnMode}
              onUnbind={hpMidi.unbind}
              compact
            />
          </div>
          <div className="relative h-3 w-12">
            <MidiLearnOverlayTag
              midiId={lpMidiId}
              binding={lpMidi.binding}
              isArmed={lpMidi.isArmed}
              midiLearnMode={lpMidi.midiLearnMode}
              onUnbind={lpMidi.unbind}
              compact
            />
          </div>
        </div>
      )}
      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onDoubleClick={(e) => {
          if (hpMidi.enabled || lpMidi.enabled || !trackRef.current) return;
          const rect = trackRef.current.getBoundingClientRect();
          const xNorm = (e.clientX - rect.left) / rect.width;
          if (xNorm < 0.5) onChangeHp(20);
          else onChangeLp(20000);
        }}
        title="Drag left or right slope to adjust High-Pass and Low-Pass filters (double-click side to open)"
        style={{
          boxShadow: draggingHandle
            ? `inset 0 2px 6px rgba(0,0,0,0.92), 0 0 calc(12px * var(--glow-scale, 1)) color-mix(in srgb, ${palette.primary} 48%, transparent)`
            : undefined,
        }}
        className={cn(
          'dsp-well h-[34px] rounded-full px-2.5 relative flex items-center justify-between overflow-hidden touch-none transition-shadow',
          hpMidi.enabled || lpMidi.enabled ? 'cursor-pointer' : 'cursor-ew-resize',
          (hpMidi.isArmed || lpMidi.isArmed) &&
            'ring-2 ring-[#FFB35C] shadow-[0_0_12px_rgba(255,159,67,0.5)]',
          !hpMidi.isArmed &&
            !lpMidi.isArmed &&
            (hpMidi.enabled || lpMidi.enabled) &&
            'ring-1 ring-[#38BDF8]/45 hover:ring-[#38BDF8]'
        )}
      >
        {/* Ambient Recessed Phosphor Underglow */}
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{ background: palette.wellGlow }}
        />

        {/* Passband-Carved Harmonic Bars */}
        <div
          aria-hidden="true"
          className="absolute inset-x-3 bottom-[3px] top-[9px] flex items-end justify-between gap-[2px] pointer-events-none"
        >
          {FILTER_SPECTRUM_BARS.map((barAmp, i) => {
            const barPos = (i / (FILTER_SPECTRUM_BARS.length - 1)) * 84 + 8;
            const inPassband = barPos >= hpX - 2 && barPos <= lpX + 2;
            return (
              <span
                key={i}
                className="w-[2px] rounded-t-full transition-opacity duration-100"
                style={{
                  height: `${Math.round(barAmp * 100)}%`,
                  backgroundColor: inPassband ? palette.primary : 'rgba(255,255,255,0.14)',
                  opacity: inPassband ? 0.36 : 0.14,
                }}
              />
            );
          })}
        </div>

        {/* Glowing Bandpass Filter Curve + Shaded Passband + Cutoff Knee Dots */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none overflow-visible"
          viewBox="0 0 100 34"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="dual-filter-passband-grad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={palette.primary} stopOpacity="0.4" />
              <stop offset="100%" stopColor={palette.primary} stopOpacity="0.06" />
            </linearGradient>
          </defs>

          <path d={areaPath} fill="url(#dual-filter-passband-grad)" />

          <path
            d={curvePath}
            fill="none"
            stroke={palette.bright}
            strokeWidth="1.75"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            style={{
              filter: `drop-shadow(0 0 calc(6px * var(--glow-scale, 1)) ${palette.primary})`,
            }}
          />
        </svg>

        {/* Glowing Interactive HP & LP Knee Indicators (non-distorted circular dots) */}
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-[10px] -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none transition-transform duration-100',
            draggingHandle === 'hp' ? 'w-[7px] h-[7px] scale-115' : 'w-[5px] h-[5px]'
          )}
          style={{
            left: `${hpX}%`,
            backgroundColor: '#FFFFFF',
            boxShadow: palette.glow,
          }}
        />
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-[10px] -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none transition-transform duration-100',
            draggingHandle === 'lp' ? 'w-[7px] h-[7px] scale-115' : 'w-[5px] h-[5px]'
          )}
          style={{
            left: `${lpX}%`,
            backgroundColor: '#FFFFFF',
            boxShadow: palette.glow,
          }}
        />

        {/* Left & Right Luminous Cutoff Readouts with Scrim Contrast */}
        <span
          className="relative z-10 px-1.5 py-[1px] rounded-full bg-black/55 font-mono text-[9px] font-medium tabular-nums pointer-events-none whitespace-nowrap"
          style={{
            color: palette.bright,
            textShadow: `0 0 calc(7px * var(--glow-scale, 1)) ${palette.primary}`,
          }}
        >
          {formatFilterFreq(hpFreq)}
        </span>

        <span
          className="relative z-10 px-1.5 py-[1px] rounded-full bg-black/55 font-mono text-[9px] font-medium tabular-nums pointer-events-none whitespace-nowrap"
          style={{
            color: palette.bright,
            textShadow: `0 0 calc(7px * var(--glow-scale, 1)) ${palette.primary}`,
          }}
        >
          {formatFilterFreq(lpFreq)}
        </span>
      </div>

      {/* HP / LP Bottom Labels */}
      <div
        className="mt-1 h-4 flex items-center justify-between px-2.5 text-[9px] leading-none font-display font-semibold tracking-[0.07em] uppercase"
        style={{ color: palette.bright, opacity: 0.88 }}
      >
        <span>HP</span>
        <span>LP</span>
      </div>
    </div>
  );
});

/* ============================================================================
 * 5. OscWaveDisplay — Recessed Live Synthesizer Waveform & Interval Screen (OSC)
 * ============================================================================ */
export interface OscWaveDisplayProps {
  waves?: string[];
  wave: string;
  onChangeWave: (nextWave: string) => void;
  shape?: number; // 0..100 (PWM duty / Sync harmonics)
  detune?: number; // 0..100 (Supersaw spread)
  ringMod?: boolean;
  intervalSemitones?: number;
  onCycleInterval?: () => void;
  accent?: DspAccent;
  midiId?: string;
  className?: string;
}

export const OscWaveDisplay = React.memo(function OscWaveDisplay({
  waves = ['SAW', 'PULSE', 'SUPER', 'SYNC', 'METAL', 'TRI'],
  wave,
  onChangeWave,
  shape = 50,
  detune = 35,
  ringMod = false,
  intervalSemitones = 0,
  onCycleInterval,
  accent = 'cyan',
  midiId,
  className,
}: OscWaveDisplayProps) {
  const palette = ACCENT_PALETTES[accent];
  const midi = useMidiLearnTarget(midiId, 'OSC Waveform');
  const idx = Math.max(0, waves.indexOf(wave));

  const cycle = (dir: -1 | 1) => {
    const nextIdx = (idx + dir + waves.length) % waves.length;
    onChangeWave(waves[nextIdx]);
  };

  // Compute live single-cycle waveshape preview SVG path (x: 0..100, y: 6..34)
  const buildWavePath = (phaseOffset = 0, ampScale = 1): string => {
    const pts: string[] = [];
    const steps = 64;
    const shapeNorm = clamp(shape / 100, 0.06, 0.94);

    for (let i = 0; i <= steps; i++) {
      const t = (i / steps + phaseOffset) % 1;
      let yVal = 0;

      switch (wave) {
        case 'SAW':
        case 'SUPER':
          yVal = 1 - 2 * t;
          break;
        case 'PULSE': {
          const duty = 0.12 + shapeNorm * 0.76;
          yVal = t < duty ? 0.88 : -0.88;
          break;
        }
        case 'SYNC': {
          const syncRatio = 1.2 + shapeNorm * 4.5;
          const slavePhase = (t * syncRatio) % 1;
          const windowEnv = 1 - t * 0.55;
          yVal = Math.sin(slavePhase * Math.PI * 2) * windowEnv;
          break;
        }
        case 'METAL': {
          const inharmRatio = 1.414 + shapeNorm * 5.95;
          const modIdx = 1.6 + shapeNorm * 3.2;
          const modWave = Math.sin(t * Math.PI * 2 * inharmRatio);
          yVal = Math.sin(t * Math.PI * 2 + modWave * modIdx) * 0.94;
          break;
        }
        case 'TRI':
        default:
          yVal = t < 0.5 ? -1 + 4 * t : 3 - 4 * t;
          break;
      }

      if (ringMod) {
        yVal *= Math.cos(t * Math.PI * 6);
      }

      const x = (i / steps) * 100;
      const y = 20 - yVal * 12.5 * ampScale;
      pts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    return pts.join(' ');
  };

  const primaryPath = buildWavePath(0, 1);
  const detuneSpread = clamp(detune / 100, 0, 1);
  const secondaryPath =
    wave === 'SUPER' || detuneSpread > 0.2
      ? buildWavePath(0.06 + detuneSpread * 0.12, 0.82)
      : null;

  const intervalLabel =
    intervalSemitones === 0
      ? 'UNI'
      : `${intervalSemitones > 0 ? '+' : ''}${intervalSemitones}st`;

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
        onPointerDownCapture={(e) => {
          if (midi.interceptLearnEvent(e)) return;
        }}
        className={cn(
          'dsp-well rounded-[14px] w-full min-w-[82px] h-[68px] px-2 py-1.5 relative overflow-hidden flex flex-col justify-between select-none transition-shadow',
          midi.enabled && 'cursor-pointer',
          midi.isArmed && 'ring-2 ring-[#FFB35C] shadow-[0_0_14px_rgba(255,159,67,0.5)]',
          !midi.isArmed && midi.enabled && midi.binding && 'ring-2 ring-[#38BDF8]/85',
          !midi.isArmed && midi.enabled && !midi.binding && 'ring-1 ring-[#38BDF8]/40 hover:ring-[#38BDF8]',
          className
        )}
      >
      {/* Ambient Cyan Phosphor Glow */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{ background: palette.wellGlow }}
      />

      {/* Top Row: Wave Name + OSC 2 Interval Selector */}
      <div className="relative z-10 flex items-center justify-between gap-1">
        <span
          className="font-display font-semibold text-[8.5px] tracking-[0.1em] uppercase"
          style={{
            color: palette.bright,
            textShadow: `0 0 8px ${palette.primary}`,
          }}
        >
          {wave}
        </span>

        {onCycleInterval && (
          <button
            type="button"
            onClick={() => !midi.enabled && onCycleInterval()}
            title="Click to cycle OSC 2 harmonic interval (UNI, +7st, +12st, -12st)"
            className="font-mono text-[8.5px] tabular-nums text-[#8E96AA] hover:text-white transition-colors cursor-pointer focus-visible:outline-none"
          >
            {ringMod ? `RM·${intervalLabel}` : intervalLabel}
          </button>
        )}
      </div>

      {/* Bottom Row: Left Chevron + Live Oscilloscope SVG + Right Chevron */}
      <div className="relative z-10 w-full flex items-center justify-between gap-0.5">
        <button
          type="button"
          onClick={() => !midi.enabled && cycle(-1)}
          aria-label="Previous oscillator waveform"
          className="w-3.5 h-6 flex items-center justify-center text-[#788094] hover:text-white transition-colors cursor-pointer shrink-0 focus-visible:outline-none"
        >
          <ChevronLeft size={11} strokeWidth={2} />
        </button>

        <svg
          className="flex-1 h-[36px] overflow-visible pointer-events-none"
          viewBox="0 0 100 40"
          preserveAspectRatio="none"
        >
          <line
            x1="0"
            y1="20"
            x2="100"
            y2="20"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="1"
          />
          {secondaryPath && (
            <path
              d={secondaryPath}
              fill="none"
              stroke={palette.primary}
              strokeOpacity="0.42"
              strokeWidth="1.3"
              vectorEffect="non-scaling-stroke"
            />
          )}
          <path
            d={primaryPath}
            fill="none"
            stroke={palette.bright}
            strokeWidth="1.8"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            style={{ filter: `drop-shadow(0 0 5px ${palette.primary})` }}
          />
        </svg>

        <button
          type="button"
          onClick={() => !midi.enabled && cycle(1)}
          aria-label="Next oscillator waveform"
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
 * 6. FormantTractDisplay — Recessed Vocal Tract F1/F2 + Notch Curve (VOWEL TRACT)
 * ============================================================================ */
const VOWEL_PRESET_STOPS = [
  { label: 'UU', val: 0 },
  { label: 'OO', val: 25 },
  { label: 'AA', val: 50 },
  { label: 'EE', val: 75 },
  { label: 'II', val: 100 },
];

export interface FormantTractDisplayProps {
  vowel: number; // 0..100
  talk: number; // 0..100
  notchActive: boolean;
  notchDepth: number; // 0..100
  f1Hz?: number;
  f2Hz?: number;
  onChangeVowel: (nextVal: number) => void;
  accent?: DspAccent;
  midiId?: string;
  className?: string;
}

export const FormantTractDisplay = React.memo(function FormantTractDisplay({
  vowel,
  talk,
  notchActive,
  notchDepth,
  f1Hz = 520,
  f2Hz = 1320,
  onChangeVowel,
  accent = 'amber',
  midiId,
  className,
}: FormantTractDisplayProps) {
  const palette = ACCENT_PALETTES[accent];
  const midi = useMidiLearnTarget(midiId, 'Vowel Morph');

  // Nearest phoneme label
  const activeStopIdx = Math.min(
    VOWEL_PRESET_STOPS.length - 1,
    Math.max(0, Math.round((clamp(vowel, 0, 100) / 100) * (VOWEL_PRESET_STOPS.length - 1)))
  );
  const phoneme = VOWEL_PRESET_STOPS[activeStopIdx].label;

  const stepVowel = (dir: -1 | 1) => {
    const nextIdx = (activeStopIdx + dir + VOWEL_PRESET_STOPS.length) % VOWEL_PRESET_STOPS.length;
    onChangeVowel(VOWEL_PRESET_STOPS[nextIdx].val);
  };

  // Map F1 (250..800) & F2 (750..2400) to normalized 0..100 X positions
  const f1X = 14 + clamp((f1Hz - 250) / 600, 0, 1) * 28;
  const f2X = 48 + clamp((f2Hz - 750) / 1650, 0, 1) * 38;
  const notchX = (f1X + f2X) * 0.5;
  const peakAmp = 5 + clamp(talk / 100, 0, 1) * 11;
  const dipAmp = notchActive ? clamp(notchDepth / 100, 0, 1) * 10 : 0;

  const buildCurve = () => {
    const pts: string[] = [];
    const steps = 48;
    for (let i = 0; i <= steps; i++) {
      const x = (i / steps) * 100;
      const g1 = Math.exp(-Math.pow((x - f1X) / 9.5, 2)) * peakAmp;
      const g2 = Math.exp(-Math.pow((x - f2X) / 10.5, 2)) * (peakAmp * 0.9);
      const dip = Math.exp(-Math.pow((x - notchX) / 6.5, 2)) * dipAmp;
      const y = clamp(25 - g1 - g2 + dip, 4, 34);
      pts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    return pts.join(' ');
  };

  const curvePath = buildCurve();

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
        onPointerDownCapture={(e) => {
          if (midi.interceptLearnEvent(e)) return;
        }}
        className={cn(
          'dsp-well rounded-[14px] w-full min-w-[82px] h-[68px] px-2 py-1.5 relative overflow-hidden flex flex-col justify-between select-none transition-shadow',
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

        {/* Top Row: Phoneme + F1/F2 Readout */}
        <div className="relative z-10 flex items-center justify-between gap-1 whitespace-nowrap">
          <span
            className="font-display font-semibold text-[8.5px] tracking-[0.09em] uppercase"
            style={{
              color: palette.bright,
              textShadow: `0 0 8px ${palette.primary}`,
            }}
          >
            {phoneme}
          </span>
          <span className="font-mono text-[8px] tabular-nums text-[#8E96AA]">
            {Math.round(f1Hz)}·{Math.round(f2Hz / 100) / 10}k
          </span>
        </div>

        {/* Bottom Row: Chevrons + Formant Twin-Peak & Notch SVG */}
        <div className="relative z-10 w-full flex items-center justify-between gap-0.5">
          <button
            type="button"
            onClick={() => !midi.enabled && stepVowel(-1)}
            aria-label="Previous vowel formant"
            className="w-3.5 h-6 flex items-center justify-center text-[#788094] hover:text-white transition-colors cursor-pointer shrink-0 focus-visible:outline-none"
          >
            <ChevronLeft size={11} strokeWidth={2} />
          </button>

          <svg
            className="flex-1 h-[36px] overflow-visible pointer-events-none"
            viewBox="0 0 100 38"
            preserveAspectRatio="none"
          >
            <line
              x1="0"
              y1="25"
              x2="100"
              y2="25"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="1"
            />
            <path
              d={`${curvePath} L 100 36 L 0 36 Z`}
              fill={palette.primary}
              fillOpacity="0.16"
            />
            <path
              d={curvePath}
              fill="none"
              stroke={palette.bright}
              strokeWidth="1.7"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              style={{ filter: `drop-shadow(0 0 5px ${palette.primary})` }}
            />
          </svg>

          <button
            type="button"
            onClick={() => !midi.enabled && stepVowel(1)}
            aria-label="Next vowel formant"
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
 * 7. BitcrushScopeDisplay — Recessed Staircase Quantizer Screen (BITCRUSH)
 * ============================================================================ */
export interface BitcrushScopeDisplayProps {
  crush: number; // 0..100
  bits?: number; // live effective bit depth
  accent?: DspAccent;
  midiId?: string;
  className?: string;
}

export const BitcrushScopeDisplay = React.memo(function BitcrushScopeDisplay({
  crush,
  bits,
  accent = 'amber',
  midiId,
  className,
}: BitcrushScopeDisplayProps) {
  const palette = ACCENT_PALETTES[accent];
  const midi = useMidiLearnTarget(midiId, 'Bitcrush Depth');
  const norm = clamp(crush / 100, 0, 1);
  const effectiveBits = bits ?? Number((16 - norm * 12).toFixed(1));
  const quantSteps = Math.max(3, Math.round(18 - norm * 14));

  const buildStaircasePath = () => {
    const pts: string[] = [];
    const total = 44;
    for (let i = 0; i <= total; i++) {
      const t = i / total;
      const rawSin = Math.sin(t * Math.PI * 2);
      const yQuant =
        norm <= 0.02 ? rawSin : Math.round(rawSin * quantSteps) / quantSteps;
      const x = t * 100;
      const y = 19 - clamp(yQuant, -1, 1) * 13;
      pts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    return pts.join(' ');
  };

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
          'dsp-well rounded-[14px] w-full h-[66px] px-2.5 py-2 relative overflow-hidden flex flex-col justify-between select-none transition-shadow',
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

        {/* Top Row: Bit Depth Readout */}
        <div className="relative z-10 flex items-center justify-between gap-1 whitespace-nowrap">
          <span className="font-display font-semibold text-[8.5px] tracking-[0.08em] uppercase text-[#8690A6]">
            BITS
          </span>
          <span
            className="font-mono font-medium text-[10px] tabular-nums"
            style={{
              color: palette.bright,
              textShadow: `0 0 8px ${palette.primary}`,
            }}
          >
            {effectiveBits.toFixed(1)}b
          </span>
        </div>

        {/* Quantized Staircase Sine SVG */}
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
            stroke="rgba(255,255,255,0.09)"
            strokeWidth="1"
          />
          <path
            d={buildStaircasePath()}
            fill="none"
            stroke={palette.bright}
            strokeWidth="1.7"
            vectorEffect="non-scaling-stroke"
            style={{ filter: `drop-shadow(0 0 5px ${palette.primary})` }}
          />
        </svg>
      </div>
    </div>
  );
});

