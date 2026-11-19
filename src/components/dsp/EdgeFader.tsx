import React, { useRef, useState, useEffect, useCallback } from 'react';
import { clamp } from './tokens';
import { MidiLearnOverlayTag, useMidiLearnTarget } from './MidiLearnContext';
import { cn } from '../../utils';

export interface EdgeFaderProps {
  label: string;
  value: number; // e.g. -60 to +12 dB
  min?: number;
  max?: number;
  defaultValue?: number;
  meterLevel?: number; // 0 to 1 live signal level
  onChange: (val: number) => void;
  height?: number;
  midiId?: string;
  className?: string;
}

export const EdgeFader = React.memo(function EdgeFader({
  label,
  value,
  min = -60,
  max = 12,
  defaultValue = 0,
  meterLevel = 0.62,
  onChange,
  height = 178,
  midiId,
  className,
}: EdgeFaderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const midi = useMidiLearnTarget(midiId, `${label} Fader`);

  const norm = clamp((value - min) / (max - min || 1), 0, 1);

  const updateFromClientY = useCallback(
    (clientY: number) => {
      if (!trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const pad = 12;
      const usable = rect.height - pad * 2;
      const rawNorm = clamp(1 - (clientY - (rect.top + pad)) / usable, 0, 1);
      const nextVal = min + rawNorm * (max - min);
      onChange(Number(nextVal.toFixed(1)));
    },
    [min, max, onChange]
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    if (midi.interceptLearnEvent(e)) return;
    e.preventDefault();
    setDragging(true);
    updateFromClientY(e.clientY);
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => updateFromClientY(e.clientY);
    const onUp = () => setDragging(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, updateFromClientY]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const dir = e.deltaY < 0 ? 1 : -1;
    onChange(clamp(Number((value + dir * 0.8).toFixed(1)), min, max));
  };

  const formattedDb =
    value <= min + 0.2 ? '-∞ dB' : `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`;

  const activeMeter = clamp(meterLevel * norm * 1.15, 0, 1);

  return (
    <div
      onContextMenu={midi.handleContextMenu}
      className={cn(
        'flex flex-col items-center justify-between select-none relative shrink-0',
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

      {dragging && !midi.enabled && (
        <div className="absolute -top-6 z-30 px-1.5 py-0.5 rounded bg-[#111319] border border-white/15 font-mono text-[9px] tabular-nums text-white shadow-md whitespace-nowrap pointer-events-none">
          {formattedDb}
        </div>
      )}

      {/* Recessed Stadium Fader Well */}
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={`${label} level fader`}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        onPointerDown={handlePointerDown}
        onWheel={handleWheel}
        onDoubleClick={() => !midi.enabled && onChange(defaultValue)}
        onKeyDown={(e) => {
          if (midi.enabled && (e.key === 'Enter' || e.key === ' ')) {
            midi.interceptLearnEvent(e);
          }
        }}
        style={{ height }}
        className={cn(
          'w-[22px] rounded-full dsp-recessed-slot relative flex flex-col items-center py-2.5 touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6E93FF] transition-shadow',
          midi.enabled ? 'cursor-pointer' : 'cursor-ns-resize',
          midi.isArmed && 'ring-2 ring-[#FFB35C] shadow-[0_0_14px_rgba(255,159,67,0.55)]',
          !midi.isArmed && midi.enabled && midi.binding && 'ring-2 ring-[#38BDF8]/85',
          !midi.isArmed && midi.enabled && !midi.binding && 'ring-1 ring-[#38BDF8]/40 hover:ring-[#38BDF8]',
          !midi.enabled && midi.isLiveModulating && 'ring-1 ring-[#38BDF8]/65'
        )}
      >
        {/* Top Peak Indicator Dot */}
        <span
          className={cn(
            'w-[2.5px] h-[2.5px] rounded-full mb-1.5 transition-colors',
            activeMeter > 0.92
              ? 'bg-[#FF9A3E] shadow-[0_0_5px_#FF9A3E]'
              : 'bg-[#6F7586]'
          )}
        />

        {/* Dual Stereo Guide & Meter Rails */}
        <div className="relative flex-1 w-full flex items-center justify-center gap-[4px]">
          {/* Left stereo rail */}
          <div className="w-[1.5px] h-full bg-[#252934] rounded-full relative overflow-hidden">
            <div
              className="absolute inset-0 bg-gradient-to-t from-[#6F778B] via-[#B8C0D4] to-white rounded-full origin-bottom will-change-transform"
              style={{ transform: `scaleY(${activeMeter.toFixed(3)})` }}
            />
          </div>

          {/* Center slot */}
          <div className="w-[2px] h-full bg-[#090B0E] rounded-full" />

          {/* Right stereo rail */}
          <div className="w-[1.5px] h-full bg-[#252934] rounded-full relative overflow-hidden">
            <div
              className="absolute inset-0 bg-gradient-to-t from-[#6F778B] via-[#B8C0D4] to-white rounded-full origin-bottom will-change-transform"
              style={{ transform: `scaleY(${Math.max(0, activeMeter * 0.96).toFixed(3)})` }}
            />
          </div>

          {/* Machined Horizontal Fader Cap */}
          <div
            className="absolute left-1/2 -translate-x-1/2 w-[18px] h-[9px] rounded-[3px] bg-gradient-to-b from-[#3A3E4A] to-[#1F222A] shadow-[0_3px_6px_rgba(0,0,0,0.85),0_0_0_1px_#0E1015,inset_0_1px_0_rgba(255,255,255,0.22)] flex items-center justify-center pointer-events-none"
            style={{
              bottom: `calc(${norm * 100}% - 4.5px)`,
            }}
          >
            <span className="w-[12px] h-[1.5px] rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.85)]" />
          </div>
        </div>
      </div>

      {/* Bottom Label (IN / OUT) */}
      <span
        className="mt-2 font-display font-semibold text-[9px] tracking-[0.12em] uppercase"
        style={{ color: 'var(--hw-muted)' }}
      >
        {label}
      </span>
    </div>
  );
});
