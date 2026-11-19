import React from 'react';
import { Headphones, Power, Repeat, Lock, Sparkles } from 'lucide-react';
import { ACCENT_PALETTES, DspAccent } from './tokens';
import { MidiLearnOverlayTag, useMidiLearnTarget } from './MidiLearnContext';
import { cn } from '../../utils';

export type HardwareIconType = 'phase' | 'solo' | 'power' | 'loop' | 'lock' | 'spark';

export interface IconToggleButtonProps {
  icon: HardwareIconType;
  active: boolean;
  onToggle: () => void;
  accent?: DspAccent;
  label?: string;
  size?: 'sm' | 'md';
  midiId?: string;
}

function PhaseGlyph({ size = 11 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <circle cx="7" cy="7" r="4.2" />
      <line x1="3.2" y1="10.8" x2="10.8" y2="3.2" />
    </svg>
  );
}

function MacroDieGlyph({ size = 11 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="2" width="10" height="10" rx="2.4" />
      <circle cx="4.8" cy="4.8" r="0.85" fill="currentColor" stroke="none" />
      <circle cx="9.2" cy="4.8" r="0.85" fill="currentColor" stroke="none" />
      <circle cx="7" cy="7" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="4.8" cy="9.2" r="0.85" fill="currentColor" stroke="none" />
      <circle cx="9.2" cy="9.2" r="0.85" fill="currentColor" stroke="none" />
    </svg>
  );
}

export interface MacroRandomizeButtonProps {
  onRandomize: () => void;
  accent?: DspAccent;
  label?: string;
  size?: 'xs' | 'sm' | 'md';
  midiId?: string;
  className?: string;
}

export function MacroRandomizeButton({
  onRandomize,
  accent = 'cyan',
  label = 'Macro Randomize Module',
  size = 'sm',
  midiId,
  className,
}: MacroRandomizeButtonProps) {
  const [pressedFlash, setPressedFlash] = React.useState(false);
  const [badgeFlash, setBadgeFlash] = React.useState(false);
  const pressTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const badgeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const palette = ACCENT_PALETTES[accent];
  const midi = useMidiLearnTarget(midiId, label);

  const dimClass =
    size === 'xs'
      ? 'w-[20px] h-[20px]'
      : size === 'sm'
      ? 'w-[24px] h-[24px]'
      : 'w-[30px] h-[30px]';
  const innerDimClass =
    size === 'xs'
      ? 'w-[16px] h-[16px]'
      : size === 'sm'
      ? 'w-[20px] h-[20px]'
      : 'w-[24px] h-[24px]';
  const iconPx = size === 'xs' ? 10 : size === 'sm' ? 11.5 : 13;

  React.useEffect(() => {
    return () => {
      if (pressTimerRef.current !== null) clearTimeout(pressTimerRef.current);
      if (badgeTimerRef.current !== null) clearTimeout(badgeTimerRef.current);
    };
  }, []);

  const triggerMacroRandomize = () => {
    onRandomize();
    setPressedFlash(true);
    setBadgeFlash(true);
    if (pressTimerRef.current !== null) clearTimeout(pressTimerRef.current);
    if (badgeTimerRef.current !== null) clearTimeout(badgeTimerRef.current);
    pressTimerRef.current = setTimeout(() => {
      setPressedFlash(false);
      pressTimerRef.current = null;
    }, 180);
    badgeTimerRef.current = setTimeout(() => {
      setBadgeFlash(false);
      badgeTimerRef.current = null;
    }, 520);
  };

  return (
    <div
      className={cn('relative inline-flex items-center justify-center', className)}
      onContextMenu={midi.handleContextMenu}
    >
      <MidiLearnOverlayTag
        midiId={midiId}
        binding={midi.binding}
        isArmed={midi.isArmed}
        midiLearnMode={midi.midiLearnMode}
        onUnbind={midi.unbind}
        compact
      />

      {badgeFlash && !midi.enabled && (
        <div className="absolute -top-6 right-0 z-30 px-1.5 py-0.5 rounded bg-[#111319] border border-white/15 font-mono text-[8.5px] tracking-[0.04em] text-white shadow-md whitespace-nowrap pointer-events-none">
          Randomized
        </div>
      )}

      <button
        type="button"
        onClick={(e) => {
          if (midi.interceptLearnEvent(e)) return;
          triggerMacroRandomize();
        }}
        aria-label={label}
        title={`${label} — Randomize only this module's parameters`}
        className={cn(
          dimClass,
          'rounded-full p-[2px] flex items-center justify-center shadow-[inset_0_1px_3px_rgba(0,0,0,0.9),0_1px_0_rgba(255,255,255,0.08)] cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6E93FF] transition-transform duration-150 active:scale-90',
          midi.isArmed && 'ring-2 ring-[#FFB35C] shadow-[0_0_12px_rgba(255,159,67,0.55)]',
          !midi.isArmed && midi.enabled && midi.binding && 'ring-2 ring-[#38BDF8]/85',
          !midi.isArmed && midi.enabled && !midi.binding && 'ring-1 ring-[#38BDF8]/40 hover:ring-[#38BDF8]',
          !midi.enabled && midi.isLiveModulating && 'ring-1 ring-[#38BDF8]/65'
        )}
        style={{ backgroundColor: 'var(--knob-collar)' }}
      >
        <span
          className={cn(
            innerDimClass,
            'rounded-full flex items-center justify-center transition-all duration-150',
            pressedFlash ? 'dsp-button-cap-pressed' : 'dsp-button-cap group-hover:brightness-115'
          )}
          style={{
            color: pressedFlash ? palette.bright : 'var(--hw-muted)',
            filter: pressedFlash ? `drop-shadow(0 0 6px ${palette.primary})` : undefined,
            transform: pressedFlash ? 'rotate(90deg)' : 'rotate(0deg)',
          }}
        >
          <MacroDieGlyph size={iconPx} />
        </span>
      </button>
    </div>
  );
}

export function IconToggleButton({
  icon,
  active,
  onToggle,
  accent = 'blue',
  label,
  size = 'sm',
  midiId,
}: IconToggleButtonProps) {
  const palette = ACCENT_PALETTES[accent];
  const midi = useMidiLearnTarget(midiId, label || `${icon} toggle`);
  const dimClass = size === 'sm' ? 'w-[24px] h-[24px]' : 'w-[30px] h-[30px]';
  const innerDimClass = size === 'sm' ? 'w-[20px] h-[20px]' : 'w-[24px] h-[24px]';
  const iconPx = size === 'sm' ? 11 : 13;

  const renderGlyph = () => {
    switch (icon) {
      case 'phase':
        return <PhaseGlyph size={iconPx} />;
      case 'solo':
        return <Headphones size={iconPx} strokeWidth={1.8} />;
      case 'power':
        return <Power size={iconPx} strokeWidth={2} />;
      case 'loop':
        return <Repeat size={iconPx} strokeWidth={1.9} />;
      case 'lock':
        return <Lock size={iconPx} strokeWidth={1.9} />;
      case 'spark':
        return <Sparkles size={iconPx} strokeWidth={1.9} />;
    }
  };

  return (
    <div className="relative inline-flex items-center justify-center" onContextMenu={midi.handleContextMenu}>
      <MidiLearnOverlayTag
        midiId={midiId}
        binding={midi.binding}
        isArmed={midi.isArmed}
        midiLearnMode={midi.midiLearnMode}
        onUnbind={midi.unbind}
        compact
      />
      <button
        type="button"
        onClick={(e) => {
          if (midi.interceptLearnEvent(e)) return;
          onToggle();
        }}
        aria-pressed={active}
        aria-label={label || `${icon} toggle`}
        title={label || icon.toUpperCase()}
        className={cn(
          dimClass,
          'rounded-full p-[2px] flex items-center justify-center shadow-[inset_0_1px_3px_rgba(0,0,0,0.9),0_1px_0_rgba(255,255,255,0.08)] cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6E93FF] transition-shadow',
          midi.isArmed && 'ring-2 ring-[#FFB35C] shadow-[0_0_12px_rgba(255,159,67,0.55)]',
          !midi.isArmed && midi.enabled && midi.binding && 'ring-2 ring-[#38BDF8]/85',
          !midi.isArmed && midi.enabled && !midi.binding && 'ring-1 ring-[#38BDF8]/40 hover:ring-[#38BDF8]',
          !midi.enabled && midi.isLiveModulating && 'ring-1 ring-[#38BDF8]/65'
        )}
        style={{ backgroundColor: 'var(--knob-collar)' }}
      >
        <span
          className={cn(
            innerDimClass,
            'rounded-full flex items-center justify-center transition-all duration-150',
            active ? 'dsp-button-cap-pressed' : 'dsp-button-cap group-hover:brightness-110'
          )}
          style={{
            color: active ? palette.bright : 'var(--hw-muted)',
            filter: active ? `drop-shadow(0 0 5px ${palette.primary})` : undefined,
          }}
        >
          {renderGlyph()}
        </span>
      </button>
    </div>
  );
}

export interface HardwarePillButtonProps {
  label: string;
  active: boolean;
  onToggle: () => void;
  accent?: DspAccent;
  midiId?: string;
  className?: string;
}

export function HardwarePillButton({
  label,
  active,
  onToggle,
  accent = 'neutral',
  midiId,
  className,
}: HardwarePillButtonProps) {
  const palette = ACCENT_PALETTES[accent];
  const midi = useMidiLearnTarget(midiId, label);

  return (
    <div className="relative inline-flex" onContextMenu={midi.handleContextMenu}>
      <MidiLearnOverlayTag
        midiId={midiId}
        binding={midi.binding}
        isArmed={midi.isArmed}
        midiLearnMode={midi.midiLearnMode}
        onUnbind={midi.unbind}
        compact
      />
      <button
        type="button"
        onClick={(e) => {
          if (midi.interceptLearnEvent(e)) return;
          onToggle();
        }}
        aria-pressed={active}
        className={cn(
          'rounded-full p-[3px] shadow-[inset_0_2px_4px_rgba(0,0,0,0.9),0_1px_0_rgba(255,255,255,0.08)] cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6E93FF] transition-shadow',
          midi.isArmed && 'ring-2 ring-[#FFB35C] shadow-[0_0_12px_rgba(255,159,67,0.55)]',
          !midi.isArmed && midi.enabled && midi.binding && 'ring-2 ring-[#38BDF8]/85',
          !midi.isArmed && midi.enabled && !midi.binding && 'ring-1 ring-[#38BDF8]/40 hover:ring-[#38BDF8]',
          !midi.enabled && midi.isLiveModulating && 'ring-1 ring-[#38BDF8]/65',
          className
        )}
        style={{ backgroundColor: 'var(--knob-collar)' }}
      >
        <span
          className={cn(
            'px-4 py-1.5 rounded-full flex items-center justify-center font-display text-[10px] font-semibold tracking-[0.12em] uppercase whitespace-nowrap transition-all duration-150',
            active ? 'dsp-button-cap-pressed' : 'dsp-button-cap group-hover:brightness-110'
          )}
          style={{
            color: active ? palette.bright : 'var(--hw-label)',
            textShadow: active ? `0 0 8px ${palette.primary}` : undefined,
          }}
        >
          {label}
        </span>
      </button>
    </div>
  );
}

export interface SegmentedSwitchProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  accent?: DspAccent;
  className?: string;
}

export function SegmentedSwitch<T extends string>({
  options,
  value,
  onChange,
  accent = 'blue',
  className,
}: SegmentedSwitchProps<T>) {
  const palette = ACCENT_PALETTES[accent];

  return (
    <div
      className={cn(
        'dsp-recessed-slot rounded-full p-1 inline-flex items-center gap-1',
        className
      )}
    >
      {options.map((opt) => {
        const isSelected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              'px-3 py-1 rounded-full font-display text-[10px] font-semibold tracking-[0.1em] uppercase whitespace-nowrap transition-all duration-150 cursor-pointer focus-visible:outline-none',
              isSelected
                ? 'dsp-button-cap'
                : 'text-[#6E7485] hover:text-[#AEB4C4]'
            )}
            style={
              isSelected
                ? {
                    color: palette.bright,
                    textShadow: `0 0 8px ${palette.primary}`,
                  }
                : undefined
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export interface TransportPillButtonProps {
  isPlaying: boolean;
  onToggle: () => void;
  disabled?: boolean;
  midiId?: string;
  className?: string;
}

export function TransportPillButton({
  isPlaying,
  onToggle,
  disabled = false,
  midiId,
  className,
}: TransportPillButtonProps) {
  const midi = useMidiLearnTarget(midiId, 'Play / Stop');

  return (
    <div className="relative inline-flex" onContextMenu={midi.handleContextMenu}>
      <MidiLearnOverlayTag
        midiId={midiId}
        binding={midi.binding}
        isArmed={midi.isArmed}
        midiLearnMode={midi.midiLearnMode}
        onUnbind={midi.unbind}
        compact
      />
      <button
        type="button"
        onClick={(e) => {
          if (midi.interceptLearnEvent(e)) return;
          onToggle();
        }}
        disabled={disabled && !midi.enabled}
        aria-pressed={isPlaying}
        className={cn(
          'rounded-full p-[3px] shadow-[inset_0_2px_4px_rgba(0,0,0,0.9),0_1px_0_rgba(255,255,255,0.08)] cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6E93FF] disabled:opacity-40 disabled:pointer-events-none transition-shadow',
          midi.isArmed && 'ring-2 ring-[#FFB35C] shadow-[0_0_12px_rgba(255,159,67,0.55)]',
          !midi.isArmed && midi.enabled && midi.binding && 'ring-2 ring-[#38BDF8]/85',
          !midi.isArmed && midi.enabled && !midi.binding && 'ring-1 ring-[#38BDF8]/40 hover:ring-[#38BDF8]',
          !midi.enabled && midi.isLiveModulating && 'ring-1 ring-[#38BDF8]/65',
          className
        )}
        style={{ backgroundColor: 'var(--knob-collar)' }}
      >
        <span
          className={cn(
            'px-4 py-1.5 rounded-full flex items-center gap-1.5 justify-center font-display text-[10px] font-semibold tracking-[0.12em] uppercase whitespace-nowrap transition-all duration-150',
            isPlaying ? 'dsp-button-cap-pressed' : 'dsp-button-cap group-hover:brightness-110'
          )}
          style={{
            color: isPlaying ? 'var(--accent-blue-bright)' : 'var(--hw-title)',
            textShadow: isPlaying ? '0 0 10px var(--accent-blue)' : undefined,
          }}
        >
          {isPlaying ? (
            <>
              <span
                className="w-[7px] h-[7px] rounded-[1.5px]"
                style={{
                  backgroundColor: 'var(--accent-blue-bright)',
                  boxShadow: '0 0 6px var(--accent-blue)',
                }}
              />
              <span>STOP</span>
            </>
          ) : (
            <>
              <span
                className="w-0 h-0 border-y-[4px] border-y-transparent border-l-[6.5px]"
                style={{
                  borderLeftColor: 'var(--accent-blue-bright)',
                  filter: 'drop-shadow(0 0 4px var(--accent-blue))',
                }}
              />
              <span>PLAY</span>
            </>
          )}
        </span>
      </button>
    </div>
  );
}

