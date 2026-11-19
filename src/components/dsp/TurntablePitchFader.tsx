import React, { useRef, useState, useEffect, useCallback } from 'react';
import { ACCENT_PALETTES, DspAccent, clamp } from './tokens';
import { MidiLearnOverlayTag, useMidiLearnTarget } from './MidiLearnContext';
import { cn } from '../../utils';

export interface TurntablePitchFaderProps {
  label?: string;
  value: number; // 0 to 100
  min?: number;
  max?: number;
  defaultValue?: number;
  active?: boolean;
  accent?: DspAccent;
  midiId?: string;
  onChange: (nextVal: number) => void;
  className?: string;
}

const SCALE_TICKS = Array.from({ length: 21 }, (_, i) => ({
  norm: i / 20,
  isCenter: i === 10,
  isMajor: i % 5 === 0,
}));

export function TurntablePitchFader({
  label = 'GROWL',
  value,
  min = 0,
  max = 100,
  defaultValue = 0,
  active = true,
  accent = 'amber',
  midiId = 'fmGrowl',
  onChange,
  className,
}: TurntablePitchFaderProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const palette = ACCENT_PALETTES[accent];
  const midi = useMidiLearnTarget(midiId, `${label} Turntable Fader`);

  const norm = clamp((value - min) / (max - min || 1), 0, 1);
  const isLit = active && value > 0.5;

  const updateFromClientX = useCallback(
    (clientX: number) => {
      if (!railRef.current) return;
      const rect = railRef.current.getBoundingClientRect();
      const pad = 18;
      const usable = Math.max(24, rect.width - pad * 2);
      const rawNorm = clamp((clientX - (rect.left + pad)) / usable, 0, 1);
      const nextVal = Math.round(min + rawNorm * (max - min));
      onChange(clamp(nextVal, min, max));
    },
    [min, max, onChange]
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    if (midi.interceptLearnEvent(e)) return;
    e.preventDefault();
    setDragging(true);
    updateFromClientX(e.clientX);
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => updateFromClientX(e.clientX);
    const onUp = () => setDragging(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, updateFromClientX]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const dir = e.deltaY < 0 || e.deltaX > 0 ? 1 : -1;
    const step = e.shiftKey ? 1 : 3;
    onChange(clamp(Math.round(value + dir * step), min, max));
  };

  return (
    <div
      onContextMenu={midi.handleContextMenu}
      className={cn(
        'relative flex items-center gap-2.5 px-3 py-1.5 rounded-xl dsp-module select-none',
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

      {/* Left Engraved Turntable Pitch Label + Quartz Lock Style Glow Indicator */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span
          aria-hidden="true"
          className="w-[5px] h-[5px] rounded-full transition-all duration-150"
          style={{
            backgroundColor: isLit ? palette.bright : 'rgba(255,255,255,0.16)',
            boxShadow: isLit ? palette.glow : 'none',
          }}
        />
        <span
          className="font-display text-[10px] font-bold tracking-[0.11em] uppercase whitespace-nowrap"
          style={{
            color: isLit ? 'var(--hw-title)' : 'var(--hw-muted)',
          }}
        >
          {label}
        </span>
      </div>

      {/* Center Technics-Style Recessed Pitch Slider Track + Graduated Scale */}
      <div
        ref={railRef}
        onPointerDown={handlePointerDown}
        onWheel={handleWheel}
        onDoubleClick={() => !midi.enabled && onChange(defaultValue)}
        title="Turntable Growl Throttle — drag to drive master FM & formant growl (double-click to reset)"
        className={cn(
          'relative flex-1 min-w-[165px] h-[28px] flex items-center touch-none transition-shadow rounded-lg px-[18px]',
          midi.enabled ? 'cursor-pointer' : 'cursor-ew-resize',
          midi.isArmed && 'ring-2 ring-[#FFB35C] shadow-[0_0_14px_rgba(255,159,67,0.5)]',
          !midi.isArmed && midi.enabled && midi.binding && 'ring-2 ring-[#38BDF8]/85',
          !midi.isArmed && midi.enabled && !midi.binding && 'ring-1 ring-[#38BDF8]/40 hover:ring-[#38BDF8]',
          !midi.enabled && midi.isLiveModulating && 'ring-1 ring-[#38BDF8]/65'
        )}
      >
        {/* Top & Bottom Precision Strobe / Pitch Scale Graduations */}
        <div
          aria-hidden="true"
          className="absolute inset-x-[18px] inset-y-0 pointer-events-none"
        >
          {SCALE_TICKS.map((tick, idx) => {
            const passed = tick.norm <= norm + 0.005 && isLit;
            return (
              <div
                key={idx}
                className="absolute top-0 bottom-0 -translate-x-1/2 flex flex-col justify-between items-center py-[1px]"
                style={{ left: `${tick.norm * 100}%` }}
              >
                <span
                  className={cn(
                    'w-[1px] rounded-full transition-colors duration-100',
                    tick.isCenter ? 'h-[5px] w-[1.5px]' : tick.isMajor ? 'h-[4px]' : 'h-[2.5px]'
                  )}
                  style={{
                    backgroundColor: passed
                      ? palette.bright
                      : tick.isCenter
                      ? 'rgba(255,255,255,0.42)'
                      : tick.isMajor
                      ? 'rgba(255,255,255,0.24)'
                      : 'rgba(255,255,255,0.11)',
                  }}
                />
                <span
                  className={cn(
                    'w-[1px] rounded-full transition-colors duration-100',
                    tick.isCenter ? 'h-[5px] w-[1.5px]' : tick.isMajor ? 'h-[4px]' : 'h-[2.5px]'
                  )}
                  style={{
                    backgroundColor: passed
                      ? palette.bright
                      : tick.isCenter
                      ? 'rgba(255,255,255,0.42)'
                      : tick.isMajor
                      ? 'rgba(255,255,255,0.24)'
                      : 'rgba(255,255,255,0.11)',
                  }}
                />
              </div>
            );
          })}
        </div>

        {/* Center Recessed Fader Slot Groove */}
        <div className="relative w-full h-[7px] rounded-full bg-[#090B10] shadow-[inset_0_2px_4px_rgba(0,0,0,0.95),0_1px_0_rgba(255,255,255,0.08)] overflow-hidden">
          {/* Glowing Phosphor Trail Inside Groove */}
          <div
            className="absolute inset-y-[1.5px] left-0 rounded-full transition-[width] duration-75"
            style={{
              width: `${norm * 100}%`,
              background: isLit
                ? `linear-gradient(90deg, ${palette.primary} 0%, ${palette.bright} 100%)`
                : 'rgba(255,255,255,0.15)',
              boxShadow: isLit ? palette.glow : 'none',
            }}
          />
        </div>

        {/* Machined 3D Record-Player Pitch Fader Cap */}
        <div
          aria-hidden="true"
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 pointer-events-none z-10"
          style={{
            left: `calc(18px + (100% - 36px) * ${norm})`,
          }}
        >
          <div
            className={cn(
              'w-[32px] h-[20px] rounded-[4px] relative flex items-center justify-center transition-transform duration-100',
              dragging && 'scale-[1.05]'
            )}
            style={{
              background:
                'linear-gradient(90deg, #4B5162 0%, #2F3442 26%, #181B24 50%, #2F3442 74%, #4B5162 100%)',
              boxShadow: isLit
                ? `0 4px 10px rgba(0,0,0,0.88), 0 0 0 1px #0B0D12, inset 0 1px 0 rgba(255,255,255,0.28), 0 0 calc(10px * var(--glow-scale, 1)) color-mix(in srgb, ${palette.primary} 55%, transparent)`
                : '0 4px 10px rgba(0,0,0,0.88), 0 0 0 1px #0B0D12, inset 0 1px 0 rgba(255,255,255,0.25)',
            }}
          >
            {/* Left & right machined grip ridges */}
            <span className="absolute left-[5px] inset-y-[3px] w-[1px] bg-white/18" />
            <span className="absolute right-[5px] inset-y-[3px] w-[1px] bg-white/18" />

            {/* Center Phosphor Hairline Index Stripe */}
            <span
              className="w-[2px] h-[14px] rounded-full"
              style={{
                backgroundColor: isLit ? palette.bright : '#E2E8F0',
                boxShadow: isLit ? palette.glow : '0 0 4px rgba(255,255,255,0.45)',
              }}
            />
          </div>
        </div>
      </div>

      {/* Right Calibrated Tabular Readout */}
      <span
        className="font-mono text-[10.5px] font-medium tabular-nums w-9 text-right shrink-0 whitespace-nowrap"
        style={{
          color: isLit ? palette.bright : 'var(--hw-muted)',
          textShadow: isLit ? `0 0 calc(8px * var(--glow-scale, 1)) ${palette.primary}` : undefined,
        }}
      >
        {Math.round(value)}%
      </span>
    </div>
  );
}
