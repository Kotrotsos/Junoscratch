import React, { useRef, useState, useEffect, useCallback } from 'react';
import { ACCENT_PALETTES, DspAccent, clamp } from './tokens';
import { MidiLearnOverlayTag, useMidiLearnTarget } from './MidiLearnContext';
import { cn } from '../../utils';

export interface RotaryKnobProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  onChange: (val: number) => void;
  label?: string;
  minLabel?: string;
  maxLabel?: string;
  showZeroRingMarker?: boolean;
  showPerimeterDots?: boolean;
  size?: 'lg' | 'md' | 'sm';
  accent?: DspAccent;
  disabled?: boolean;
  formatValue?: (val: number) => string;
  midiId?: string;
  className?: string;
}

const SIZE_MAP = {
  lg: { outer: 90, cap: 76, needleLen: 15, needleWidth: 2.5, needleOffset: 6 },
  md: { outer: 68, cap: 56, needleLen: 12, needleWidth: 2.2, needleOffset: 5 },
  sm: { outer: 50, cap: 40, needleLen: 9, needleWidth: 2, needleOffset: 4 },
};

export function RotaryKnob({
  value,
  min,
  max,
  step = 0.1,
  defaultValue,
  onChange,
  label,
  minLabel,
  maxLabel,
  showZeroRingMarker = false,
  showPerimeterDots = false,
  size = 'lg',
  accent = 'blue',
  disabled = false,
  formatValue,
  midiId,
  className,
}: RotaryKnobProps) {
  const [pointerDown, setPointerDown] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [resetFlash, setResetFlash] = useState(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const startValRef = useRef(value);
  const hasMovedRef = useRef(false);
  const lastTapRef = useRef<{ time: number; x: number; y: number }>({ time: 0, x: 0, y: 0 });
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const midi = useMidiLearnTarget(midiId, label);

  const palette = ACCENT_PALETTES[accent];
  const dims = SIZE_MAP[size];

  const norm = clamp((value - min) / (max - min || 1), 0, 1);
  const angleDeg = -135 + norm * 270;

  const snapValue = useCallback(
    (raw: number) => {
      const snapped = Math.round(raw / step) * step;
      const decimals = step < 0.01 ? 3 : step < 0.1 ? 2 : step < 1 ? 1 : 0;
      return clamp(Number(snapped.toFixed(decimals)), min, max);
    },
    [min, max, step]
  );

  const resolvedDefault =
    defaultValue !== undefined ? snapValue(defaultValue) : snapValue((min + max) / 2);

  const formatReadout = useCallback(
    (val: number) =>
      formatValue
        ? formatValue(val)
        : step >= 1
        ? `${Math.round(val)}`
        : val.toFixed(1),
    [formatValue, step]
  );

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const triggerResetToDefault = useCallback(() => {
    if (disabled || midi.enabled) return;
    setPointerDown(false);
    setDragging(false);
    hasMovedRef.current = false;
    onChange(resolvedDefault);
    setResetFlash(true);
    if (resetTimerRef.current !== null) {
      clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = setTimeout(() => {
      setResetFlash(false);
      resetTimerRef.current = null;
    }, 520);
  }, [disabled, midi.enabled, onChange, resolvedDefault]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (midi.interceptLearnEvent(e)) return;
    if (disabled || e.button !== 0) return;

    const now = performance.now();
    const dt = now - lastTapRef.current.time;
    const dist = Math.hypot(
      e.clientX - lastTapRef.current.x,
      e.clientY - lastTapRef.current.y
    );

    if (dt > 0 && dt <= 300 && dist <= 6) {
      e.preventDefault();
      e.stopPropagation();
      lastTapRef.current = { time: 0, x: 0, y: 0 };
      triggerResetToDefault();
      return;
    }

    lastTapRef.current = { time: now, x: e.clientX, y: e.clientY };
    startXRef.current = e.clientX;
    startYRef.current = e.clientY;
    startValRef.current = value;
    hasMovedRef.current = false;
    setPointerDown(true);
  };

  useEffect(() => {
    if (!pointerDown) return;

    const handleMove = (e: PointerEvent) => {
      const dy = startYRef.current - e.clientY;
      const dx = e.clientX - startXRef.current;
      if (!hasMovedRef.current) {
        if (Math.abs(dy) < 2 && Math.abs(dx) < 2) return;
        hasMovedRef.current = true;
        lastTapRef.current = { time: 0, x: 0, y: 0 };
        setDragging(true);
      }
      const sensitivity = e.shiftKey ? 480 : 150;
      const delta = (dy / sensitivity) * (max - min);
      onChange(snapValue(startValRef.current + delta));
    };

    const handleUp = () => {
      setPointerDown(false);
      setDragging(false);
      hasMovedRef.current = false;
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [pointerDown, min, max, onChange, snapValue]);

  const handleWheel = (e: React.WheelEvent) => {
    if (disabled || midi.enabled) return;
    e.preventDefault();
    const dir = e.deltaY < 0 ? 1 : -1;
    const fine = e.shiftKey ? 0.25 : 1;
    const increment = Math.max(step, ((max - min) / 80) * fine) * dir;
    onChange(snapValue(value + increment));
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (disabled || midi.enabled) return;
    e.preventDefault();
    e.stopPropagation();
    lastTapRef.current = { time: 0, x: 0, y: 0 };
    triggerResetToDefault();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      triggerResetToDefault();
      return;
    }
    const stepDelta = Math.max(step, (max - min) / 40);
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      onChange(snapValue(value + stepDelta));
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      onChange(snapValue(value - stepDelta));
    }
  };

  const displayReadout = formatReadout(value);
  const defaultReadout = formatReadout(resolvedDefault);

  return (
    <div
      onContextMenu={midi.handleContextMenu}
      onDoubleClick={handleDoubleClick}
      title={
        midi.enabled
          ? undefined
          : `${label ? `${label}: ` : ''}${displayReadout} (Double-click to reset to ${defaultReadout})`
      }
      className={cn(
        'inline-flex flex-col items-center select-none relative',
        disabled && !midi.enabled && 'opacity-50 pointer-events-none',
        className
      )}
    >
      <MidiLearnOverlayTag
        midiId={midiId}
        binding={midi.binding}
        isArmed={midi.isArmed}
        midiLearnMode={midi.midiLearnMode}
        onUnbind={midi.unbind}
      />

      {/* Dragging or Default-Reset Value Tooltip */}
      {(dragging || resetFlash) && !midi.enabled && (
        <div className="absolute -top-7 z-30 px-2 py-0.5 rounded-md bg-[#111319] border border-white/15 font-mono text-[10px] tabular-nums text-white shadow-lg whitespace-nowrap pointer-events-none">
          {resetFlash && !dragging ? `Default · ${defaultReadout}` : displayReadout}
        </div>
      )}

      {/* Knob Assembly */}
      <div
        role="slider"
        tabIndex={disabled && !midi.enabled ? -1 : 0}
        aria-label={label || 'Rotary control'}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        onPointerDown={handlePointerDown}
        onWheel={handleWheel}
        onKeyDown={(e) => {
          if (midi.enabled && (e.key === 'Enter' || e.key === ' ')) {
            midi.interceptLearnEvent(e);
            return;
          }
          handleKeyDown(e);
        }}
        className={cn(
          'relative flex items-center justify-center touch-none rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6E93FF] transition-shadow',
          midi.enabled ? 'cursor-pointer' : 'cursor-ns-resize',
          midi.isArmed && 'ring-2 ring-[#FFB35C] shadow-[0_0_16px_rgba(255,159,67,0.55)]',
          !midi.isArmed && midi.enabled && midi.binding && 'ring-2 ring-[#38BDF8]/85',
          !midi.isArmed && midi.enabled && !midi.binding && 'ring-1 ring-[#38BDF8]/40 hover:ring-[#38BDF8]',
          !midi.enabled && midi.isLiveModulating && 'ring-1 ring-[#38BDF8]/65'
        )}
        style={{ width: dims.outer, height: dims.outer }}
      >
        {/* 0dB Small Ring Marker (top-right ~48 deg like SUB 1 / SUB 2) */}
        {showZeroRingMarker && (
          <span
            aria-hidden="true"
            className="absolute w-[6px] h-[6px] rounded-full border pointer-events-none"
            style={{
              top: '10%',
              right: '10%',
              borderColor: 'var(--hw-muted)',
            }}
          />
        )}

        {/* Perimeter Calibration Dots (12 o'clock, min, max like TONE & STABILISE) */}
        {showPerimeterDots && (
          <>
            {/* Top 12 o'clock dot */}
            <span
              aria-hidden="true"
              className="absolute -top-[4px] left-1/2 -translate-x-1/2 w-[3px] h-[3px] rounded-full pointer-events-none"
              style={{ backgroundColor: 'var(--hw-label)' }}
            />
            {/* Bottom-left -135 deg dot */}
            <span
              aria-hidden="true"
              className="absolute bottom-[10%] left-[7%] w-[3px] h-[3px] rounded-full pointer-events-none"
              style={{ backgroundColor: 'var(--hw-muted)' }}
            />
            {/* Bottom-right +135 deg dot */}
            <span
              aria-hidden="true"
              className="absolute bottom-[10%] right-[7%] w-[3px] h-[3px] rounded-full pointer-events-none"
              style={{ backgroundColor: 'var(--hw-muted)' }}
            />
          </>
        )}

        {/* Recessed Dark Collar Socket */}
        <div
          className="rounded-full flex items-center justify-center shadow-[inset_0_2px_6px_rgba(0,0,0,0.95),0_1px_0_rgba(255,255,255,0.08)]"
          style={{
            width: dims.outer - 4,
            height: dims.outer - 4,
            backgroundColor: 'var(--knob-collar)',
          }}
        >
          {/* Raised Machined Cylindrical Cap */}
          <div
            className="dsp-knob-cap rounded-full relative flex items-center justify-center transition-transform duration-75"
            style={{ width: dims.cap, height: dims.cap }}
          >
            {/* Rotating Pointer Needle */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{ transform: `rotate(${angleDeg}deg)` }}
            >
              <span
                className="block mx-auto rounded-full"
                style={{
                  marginTop: dims.needleOffset,
                  width: dims.needleWidth,
                  height: dims.needleLen,
                  backgroundColor: palette.bright,
                  boxShadow: palette.glow,
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Min / Max Scale Labels */}
      {(minLabel || maxLabel) && (
        <div
          className="w-full flex items-center justify-between px-0.5 -mt-0.5 text-[9px] leading-none font-mono tabular-nums"
          style={{ color: 'var(--hw-muted)' }}
        >
          <span>{minLabel}</span>
          <span>{maxLabel}</span>
        </div>
      )}

      {/* Primary Control Label (16px fixed row height for strict horizontal grid alignment) */}
      {label && (
        <span
          className="mt-1 h-4 flex items-center justify-center font-display font-semibold text-[9.5px] leading-none tracking-[0.08em] uppercase whitespace-nowrap cursor-pointer"
          style={{ color: 'var(--hw-label)' }}
        >
          {label}
        </span>
      )}
    </div>
  );
}

export interface MicroKnobProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number;
  onChange: (val: number) => void;
  label?: string;
  leftLabel?: string;
  rightLabel?: string;
  accent?: DspAccent;
  disabled?: boolean;
  formatValue?: (val: number) => string;
  midiId?: string;
  className?: string;
}

export function MicroKnob({
  value,
  min = 0,
  max = 100,
  step = 1,
  defaultValue,
  onChange,
  label,
  leftLabel,
  rightLabel,
  accent = 'blue',
  disabled = false,
  formatValue,
  midiId,
  className,
}: MicroKnobProps) {
  const [pointerDown, setPointerDown] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [resetFlash, setResetFlash] = useState(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const startValRef = useRef(value);
  const hasMovedRef = useRef(false);
  const lastTapRef = useRef<{ time: number; x: number; y: number }>({ time: 0, x: 0, y: 0 });
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackLabel = label || `${leftLabel || ''}/${rightLabel || ''}`;
  const midi = useMidiLearnTarget(midiId, fallbackLabel);

  const palette = ACCENT_PALETTES[accent];
  const norm = clamp((value - min) / (max - min || 1), 0, 1);
  const angleDeg = -130 + norm * 260;

  const snapValue = useCallback(
    (raw: number) => {
      const snapped = Math.round(raw / step) * step;
      const decimals = step < 0.1 ? 2 : step < 1 ? 1 : 0;
      return clamp(Number(snapped.toFixed(decimals)), min, max);
    },
    [min, max, step]
  );

  const resolvedDefault =
    defaultValue !== undefined ? snapValue(defaultValue) : snapValue((min + max) / 2);

  const formatReadout = useCallback(
    (val: number) => (formatValue ? formatValue(val) : `${Math.round(val)}%`),
    [formatValue]
  );

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const triggerResetToDefault = useCallback(() => {
    if (disabled || midi.enabled) return;
    setPointerDown(false);
    setDragging(false);
    hasMovedRef.current = false;
    onChange(resolvedDefault);
    setResetFlash(true);
    if (resetTimerRef.current !== null) {
      clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = setTimeout(() => {
      setResetFlash(false);
      resetTimerRef.current = null;
    }, 520);
  }, [disabled, midi.enabled, onChange, resolvedDefault]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (midi.interceptLearnEvent(e)) return;
    if (disabled || e.button !== 0) return;

    const now = performance.now();
    const dt = now - lastTapRef.current.time;
    const dist = Math.hypot(
      e.clientX - lastTapRef.current.x,
      e.clientY - lastTapRef.current.y
    );

    if (dt > 0 && dt <= 300 && dist <= 6) {
      e.preventDefault();
      e.stopPropagation();
      lastTapRef.current = { time: 0, x: 0, y: 0 };
      triggerResetToDefault();
      return;
    }

    lastTapRef.current = { time: now, x: e.clientX, y: e.clientY };
    startXRef.current = e.clientX;
    startYRef.current = e.clientY;
    startValRef.current = value;
    hasMovedRef.current = false;
    setPointerDown(true);
  };

  useEffect(() => {
    if (!pointerDown) return;

    const handleMove = (e: PointerEvent) => {
      const dy = startYRef.current - e.clientY;
      const dx = e.clientX - startXRef.current;
      if (!hasMovedRef.current) {
        if (Math.abs(dy) < 2 && Math.abs(dx) < 2) return;
        hasMovedRef.current = true;
        lastTapRef.current = { time: 0, x: 0, y: 0 };
        setDragging(true);
      }
      const sensitivity = e.shiftKey ? 320 : 110;
      const delta = (dy / sensitivity) * (max - min);
      onChange(snapValue(startValRef.current + delta));
    };

    const handleUp = () => {
      setPointerDown(false);
      setDragging(false);
      hasMovedRef.current = false;
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [pointerDown, min, max, onChange, snapValue]);

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (disabled || midi.enabled) return;
    e.preventDefault();
    e.stopPropagation();
    lastTapRef.current = { time: 0, x: 0, y: 0 };
    triggerResetToDefault();
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (disabled || midi.enabled) return;
    e.preventDefault();
    const dir = e.deltaY < 0 ? 1 : -1;
    onChange(snapValue(value + dir * Math.max(step, (max - min) / 50)));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      triggerResetToDefault();
      return;
    }
    const stepDelta = Math.max(step, (max - min) / 40);
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      onChange(snapValue(value + stepDelta));
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      onChange(snapValue(value - stepDelta));
    }
  };

  const readout = formatReadout(value);
  const defaultReadout = formatReadout(resolvedDefault);
  const titleName = label || `${leftLabel || ''} / ${rightLabel || ''}`.replace(/^\s*\/\s*|\s*\/\s*$/g, '');

  return (
    <div
      onContextMenu={midi.handleContextMenu}
      onDoubleClick={handleDoubleClick}
      title={
        midi.enabled
          ? undefined
          : `${titleName ? `${titleName}: ` : ''}${readout} (Double-click to reset to ${defaultReadout})`
      }
      className={cn(
        'inline-flex flex-col items-center select-none relative',
        disabled && !midi.enabled && 'opacity-50 pointer-events-none',
        className
      )}
    >
      <MidiLearnOverlayTag
        midiId={midiId}
        binding={midi.binding}
        isArmed={midi.isArmed}
        midiLearnMode={midi.midiLearnMode}
        onUnbind={midi.unbind}
        compact
      />

      {(dragging || resetFlash) && !midi.enabled && (
        <div className="absolute -top-6 z-30 px-1.5 py-0.5 rounded bg-[#111319] border border-white/15 font-mono text-[9px] tabular-nums text-white shadow-md whitespace-nowrap pointer-events-none">
          {resetFlash && !dragging ? `Default · ${defaultReadout}` : readout}
        </div>
      )}

      <div
        role="slider"
        tabIndex={disabled && !midi.enabled ? -1 : 0}
        aria-label={label || `${leftLabel || ''} ${rightLabel || ''}`.trim() || 'Trim control'}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        onPointerDown={handlePointerDown}
        onWheel={handleWheel}
        onKeyDown={(e) => {
          if (midi.enabled && (e.key === 'Enter' || e.key === ' ')) {
            midi.interceptLearnEvent(e);
            return;
          }
          handleKeyDown(e);
        }}
        className={cn(
          'w-[26px] h-[26px] rounded-full p-[3px] flex items-center justify-center shadow-[inset_0_2px_4px_rgba(0,0,0,0.92),0_1px_0_rgba(255,255,255,0.08)] touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6E93FF] transition-shadow',
          midi.enabled ? 'cursor-pointer' : 'cursor-ns-resize',
          midi.isArmed && 'ring-2 ring-[#FFB35C] shadow-[0_0_12px_rgba(255,159,67,0.55)]',
          !midi.isArmed && midi.enabled && midi.binding && 'ring-2 ring-[#38BDF8]/85',
          !midi.isArmed && midi.enabled && !midi.binding && 'ring-1 ring-[#38BDF8]/40 hover:ring-[#38BDF8]',
          !midi.enabled && midi.isLiveModulating && 'ring-1 ring-[#38BDF8]/65'
        )}
        style={{ backgroundColor: 'var(--knob-collar)' }}
      >
        <div className="w-[20px] h-[20px] rounded-full dsp-button-cap relative flex items-center justify-center">
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ transform: `rotate(${angleDeg}deg)` }}
          >
            <span
              className="block mx-auto mt-[2.5px] w-[2px] h-[5.5px] rounded-full"
              style={{
                backgroundColor: palette.bright,
                boxShadow: palette.glow,
              }}
            />
          </div>
        </div>
      </div>

      {leftLabel || rightLabel ? (
        <div
          className="mt-1 h-4 flex items-center justify-between gap-3.5 text-[9px] leading-none font-display font-semibold tracking-[0.07em] uppercase whitespace-nowrap cursor-pointer"
          style={{ color: 'var(--hw-muted)' }}
        >
          <span>{leftLabel}</span>
          <span>{rightLabel}</span>
        </div>
      ) : (
        label && (
          <span
            className="mt-1 h-4 flex items-center justify-center text-[9px] leading-none font-display font-semibold tracking-[0.06em] uppercase whitespace-nowrap cursor-pointer"
            style={{ color: 'var(--hw-muted)' }}
          >
            {label}
          </span>
        )
      )}
    </div>
  );
}
