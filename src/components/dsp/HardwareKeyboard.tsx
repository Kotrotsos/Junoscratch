import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { MicroKnob } from './RotaryKnob';
import { HardwarePillButton } from './HardwareButtons';
import { MidiLearnOverlayTag, useMidiLearnTarget } from './MidiLearnContext';
import { ACCENT_PALETTES, DspAccent } from './tokens';
import { cn } from '../../utils';

export interface KeyDescriptor {
  offset: number; // 0..24 semitones from base octave C
  noteName: string;
  isSharp: boolean;
  shortcut?: string;
}

export const KEYBOARD_MAP_25: KeyDescriptor[] = [
  { offset: 0, noteName: 'C', isSharp: false, shortcut: 'A' },
  { offset: 1, noteName: 'C#', isSharp: true, shortcut: 'W' },
  { offset: 2, noteName: 'D', isSharp: false, shortcut: 'S' },
  { offset: 3, noteName: 'D#', isSharp: true, shortcut: 'E' },
  { offset: 4, noteName: 'E', isSharp: false, shortcut: 'D' },
  { offset: 5, noteName: 'F', isSharp: false, shortcut: 'F' },
  { offset: 6, noteName: 'F#', isSharp: true, shortcut: 'T' },
  { offset: 7, noteName: 'G', isSharp: false, shortcut: 'G' },
  { offset: 8, noteName: 'G#', isSharp: true, shortcut: 'Y' },
  { offset: 9, noteName: 'A', isSharp: false, shortcut: 'H' },
  { offset: 10, noteName: 'A#', isSharp: true, shortcut: 'U' },
  { offset: 11, noteName: 'B', isSharp: false, shortcut: 'J' },
  { offset: 12, noteName: 'C', isSharp: false, shortcut: 'K' },
  { offset: 13, noteName: 'C#', isSharp: true, shortcut: 'O' },
  { offset: 14, noteName: 'D', isSharp: false, shortcut: 'L' },
  { offset: 15, noteName: 'D#', isSharp: true, shortcut: 'P' },
  { offset: 16, noteName: 'E', isSharp: false, shortcut: ';' },
  { offset: 17, noteName: 'F', isSharp: false, shortcut: "'" },
  { offset: 18, noteName: 'F#', isSharp: true },
  { offset: 19, noteName: 'G', isSharp: false },
  { offset: 20, noteName: 'G#', isSharp: true },
  { offset: 21, noteName: 'A', isSharp: false },
  { offset: 22, noteName: 'A#', isSharp: true },
  { offset: 23, noteName: 'B', isSharp: false },
  { offset: 24, noteName: 'C', isSharp: false },
];

export interface HardwareKeyboardProps {
  octave: number; // e.g. 1 => C1..C3
  onChangeOctave: (nextOct: number) => void;
  activeMidiNote: number | null;
  onNoteDown: (midi: number) => void;
  onNoteUp: (midi: number) => void;
  latch: boolean;
  onToggleLatch: () => void;
  glideMs: number;
  onChangeGlide: (ms: number) => void;
  attackMs?: number;
  onChangeAttack?: (ms: number) => void;
  releaseMs?: number;
  onChangeRelease?: (ms: number) => void;
  transposeSemitones: number;
  onChangeTranspose: (st: number) => void;
  accent?: DspAccent;
  className?: string;
}

export function midiToNoteLabel(midi: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const oct = Math.floor(midi / 12) - 1;
  return `${names[((midi % 12) + 12) % 12]}${oct}`;
}

export const HardwareKeyboard = React.memo(function HardwareKeyboard({
  octave,
  onChangeOctave,
  activeMidiNote,
  onNoteDown,
  onNoteUp,
  latch,
  onToggleLatch,
  glideMs,
  onChangeGlide,
  attackMs = 14,
  onChangeAttack,
  releaseMs = 140,
  onChangeRelease,
  transposeSemitones,
  onChangeTranspose,
  accent = 'amber',
  className,
}: HardwareKeyboardProps) {
  const [pointerHeldMidi, setPointerHeldMidi] = useState<number | null>(null);
  const palette = ACCENT_PALETTES[accent];
  const octDownMidi = useMidiLearnTarget('action.octaveDown', 'Octave Down');
  const octUpMidi = useMidiLearnTarget('action.octaveUp', 'Octave Up');

  // Base MIDI for C at `octave`: MIDI 24 = C1, MIDI 36 = C2
  const baseMidi = (octave + 1) * 12;

  useEffect(() => {
    if (pointerHeldMidi === null) return;
    const handleGlobalUp = () => {
      onNoteUp(pointerHeldMidi);
      setPointerHeldMidi(null);
    };
    window.addEventListener('pointerup', handleGlobalUp);
    return () => window.removeEventListener('pointerup', handleGlobalUp);
  }, [pointerHeldMidi, onNoteUp]);

  const whiteKeys = KEYBOARD_MAP_25.filter((k) => !k.isSharp);

  // Compute sharp key horizontal center percentages relative to the 15 white keys
  const sharpPositionPct = (offset: number): number => {
    // Map semitone offset to white-key index boundary
    const mapToWhiteBoundary: Record<number, number> = {
      1: 1,
      3: 2,
      6: 4,
      8: 5,
      10: 6,
      13: 8,
      15: 9,
      18: 11,
      20: 12,
      22: 13,
    };
    const boundary = mapToWhiteBoundary[offset] ?? 1;
    return (boundary / whiteKeys.length) * 100;
  };

  const handleKeyPointerDown = (e: React.PointerEvent, midi: number) => {
    e.preventDefault();
    e.stopPropagation();
    setPointerHeldMidi(midi);
    onNoteDown(midi);
  };

  const handleKeyPointerEnter = (midi: number) => {
    if (pointerHeldMidi !== null && pointerHeldMidi !== midi) {
      const prev = pointerHeldMidi;
      setPointerHeldMidi(midi);
      onNoteDown(midi);
      onNoteUp(prev);
    }
  };

  return (
    <div
      className={cn(
        'dsp-module p-3 flex flex-col lg:flex-row items-stretch gap-3 select-none',
        className
      )}
    >
      {/* Left Performance, Amp ADSR & Pitch Control Pod */}
      <div className="flex flex-row flex-wrap lg:flex-col justify-between items-center lg:items-stretch gap-2.5 lg:w-[272px] shrink-0 px-1 py-0.5">
        {/* Top Row: Octave Selector + Active Note Readout + Latch Switch */}
        <div className="flex items-center justify-between gap-2 w-full">
          <div className="dsp-well rounded-[10px] px-2.5 py-1.5 flex items-center justify-between gap-2 flex-1">
            <div className="flex flex-col">
              <span className="font-display text-[8px] font-semibold tracking-[0.1em] uppercase text-[#6D7486]">
                KEY RANGE
              </span>
              <span
                className="font-mono text-[12px] font-semibold tabular-nums leading-tight"
                style={{
                  color: activeMidiNote !== null ? palette.bright : '#B8C0D2',
                  textShadow:
                    activeMidiNote !== null ? `0 0 8px ${palette.primary}` : undefined,
                }}
              >
                {activeMidiNote !== null
                  ? `NOTE ${midiToNoteLabel(activeMidiNote)}`
                  : `C${octave} – C${octave + 2}`}
              </span>
            </div>

            <div className="flex items-center gap-1">
              <div className="relative" onContextMenu={octDownMidi.handleContextMenu}>
                <MidiLearnOverlayTag
                  midiId="action.octaveDown"
                  binding={octDownMidi.binding}
                  isArmed={octDownMidi.isArmed}
                  midiLearnMode={octDownMidi.midiLearnMode}
                  onUnbind={octDownMidi.unbind}
                  compact
                />
                <button
                  type="button"
                  onClick={(e) => {
                    if (octDownMidi.interceptLearnEvent(e)) return;
                    onChangeOctave(Math.max(0, octave - 1));
                  }}
                  disabled={octave <= 0 && !octDownMidi.enabled}
                  title="Octave Down (Z)"
                  aria-label="Octave down"
                  className={cn(
                    'w-5 h-5 rounded bg-[#1A1D26] hover:bg-[#262B38] disabled:opacity-30 flex items-center justify-center text-[#AEB5C7] hover:text-white cursor-pointer transition-all',
                    octDownMidi.isArmed && 'ring-2 ring-[#FFB35C]',
                    !octDownMidi.isArmed && octDownMidi.enabled && octDownMidi.binding && 'ring-1 ring-[#38BDF8]',
                    !octDownMidi.isArmed && octDownMidi.enabled && !octDownMidi.binding && 'ring-1 ring-[#38BDF8]/40'
                  )}
                >
                  <ChevronLeft size={12} />
                </button>
              </div>
              <div className="relative" onContextMenu={octUpMidi.handleContextMenu}>
                <MidiLearnOverlayTag
                  midiId="action.octaveUp"
                  binding={octUpMidi.binding}
                  isArmed={octUpMidi.isArmed}
                  midiLearnMode={octUpMidi.midiLearnMode}
                  onUnbind={octUpMidi.unbind}
                  compact
                />
                <button
                  type="button"
                  onClick={(e) => {
                    if (octUpMidi.interceptLearnEvent(e)) return;
                    onChangeOctave(Math.min(4, octave + 1));
                  }}
                  disabled={octave >= 4 && !octUpMidi.enabled}
                  title="Octave Up (X)"
                  aria-label="Octave up"
                  className={cn(
                    'w-5 h-5 rounded bg-[#1A1D26] hover:bg-[#262B38] disabled:opacity-30 flex items-center justify-center text-[#AEB5C7] hover:text-white cursor-pointer transition-all',
                    octUpMidi.isArmed && 'ring-2 ring-[#FFB35C]',
                    !octUpMidi.isArmed && octUpMidi.enabled && octUpMidi.binding && 'ring-1 ring-[#38BDF8]',
                    !octUpMidi.isArmed && octUpMidi.enabled && !octUpMidi.binding && 'ring-1 ring-[#38BDF8]/40'
                  )}
                >
                  <ChevronRight size={12} />
                </button>
              </div>
            </div>
          </div>

          <HardwarePillButton
            label="LATCH"
            midiId="latchMode"
            active={latch}
            accent="amber"
            onToggle={onToggleLatch}
          />
        </div>

        {/* Bottom Row: Amp ATK + REL + GLIDE + TUNE MicroKnobs */}
        <div className="flex items-center justify-between gap-2 w-full pt-0.5">
          {onChangeAttack && (
            <MicroKnob
              label="ATK"
              midiId="attackMs"
              accent="cyan"
              value={attackMs}
              min={5}
              max={600}
              step={5}
              defaultValue={12}
              formatValue={(v) => `${Math.round(v)} ms`}
              onChange={onChangeAttack}
            />
          )}
          {onChangeRelease && (
            <MicroKnob
              label="REL"
              midiId="releaseMs"
              accent="cyan"
              value={releaseMs}
              min={40}
              max={1500}
              step={10}
              defaultValue={150}
              formatValue={(v) => `${Math.round(v)} ms`}
              onChange={onChangeRelease}
            />
          )}
          <MicroKnob
            label="GLIDE"
            midiId="glideMs"
            accent="amber"
            value={glideMs}
            min={0}
            max={350}
            step={5}
            defaultValue={0}
            formatValue={(v) => `${Math.round(v)} ms`}
            onChange={onChangeGlide}
          />
          <MicroKnob
            label="TUNE"
            midiId="basePitchSemitones"
            accent="blue"
            value={transposeSemitones}
            min={-12}
            max={12}
            step={1}
            defaultValue={0}
            formatValue={(v) => `${v > 0 ? '+' : ''}${Math.round(v)} st`}
            onChange={onChangeTranspose}
          />
        </div>
      </div>

      {/* Recessed 25-Key Anodized Synth Keybed */}
      <div className="flex-1 dsp-well rounded-[14px] p-2 relative h-[96px] sm:h-[104px] touch-none overflow-hidden">
        <div className="relative w-full h-full flex gap-[3px]">
          {/* Natural (White) Keys */}
          {whiteKeys.map((k) => {
            const midi = baseMidi + k.offset;
            const isActive = activeMidiNote === midi;
            const octaveLabel =
              k.noteName === 'C' ? `C${octave + Math.floor(k.offset / 12)}` : null;

            return (
              <button
                key={k.offset}
                type="button"
                onPointerDown={(e) => handleKeyPointerDown(e, midi)}
                onPointerEnter={() => handleKeyPointerEnter(midi)}
                aria-label={`Play ${k.noteName}${octave + Math.floor(k.offset / 12)}`}
                className={cn(
                  'relative flex-1 h-full rounded-b-[7px] rounded-t-[3px] flex flex-col items-center justify-between py-1.5 cursor-pointer transition-transform duration-75 focus-visible:outline-none',
                  isActive
                    ? 'translate-y-[1.5px] bg-gradient-to-b from-[#333846] to-[#262B38]'
                    : 'bg-gradient-to-b from-[#2B2F3B] via-[#242833] to-[#1D2029] hover:from-[#323745] hover:to-[#222631]',
                  'shadow-[0_3px_6px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.16),0_0_0_1px_#111319]'
                )}
              >
                {/* Top Phosphor Active Bar */}
                <span
                  className="w-4 h-[2.5px] rounded-full transition-opacity duration-75"
                  style={{
                    backgroundColor: palette.bright,
                    boxShadow: isActive ? palette.glow : undefined,
                    opacity: isActive ? 1 : 0,
                  }}
                />

                <div className="flex flex-col items-center gap-0.5 pointer-events-none">
                  {k.shortcut && (
                    <span
                      className={cn(
                        'font-mono text-[9px] font-semibold leading-none',
                        isActive ? 'text-white' : 'text-[#737B8F]'
                      )}
                    >
                      {k.shortcut}
                    </span>
                  )}
                  {octaveLabel && (
                    <span className="font-mono text-[8px] text-[#525869] leading-none">
                      {octaveLabel}
                    </span>
                  )}
                </div>
              </button>
            );
          })}

          {/* Sharp (Black) Keys */}
          {KEYBOARD_MAP_25.filter((k) => k.isSharp).map((k) => {
            const midi = baseMidi + k.offset;
            const isActive = activeMidiNote === midi;
            const leftPct = sharpPositionPct(k.offset);

            return (
              <button
                key={k.offset}
                type="button"
                onPointerDown={(e) => handleKeyPointerDown(e, midi)}
                onPointerEnter={() => handleKeyPointerEnter(midi)}
                aria-label={`Play ${k.noteName}${octave + Math.floor(k.offset / 12)}`}
                style={{ left: `${leftPct}%` }}
                className={cn(
                  'absolute top-0 -translate-x-1/2 w-[4.4%] h-[58%] z-20 rounded-b-[6px] rounded-t-[2px] flex flex-col items-center justify-between py-1 cursor-pointer transition-transform duration-75 focus-visible:outline-none',
                  isActive
                    ? 'translate-y-[1.5px] bg-gradient-to-b from-[#252936] to-[#171A24]'
                    : 'bg-gradient-to-b from-[#171A22] to-[#0C0E13] hover:from-[#202430] hover:to-[#11141C]',
                  'shadow-[0_5px_10px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.14),0_0_0_1px_#07080B]'
                )}
              >
                <span
                  className="w-2.5 h-[2px] rounded-full transition-opacity duration-75"
                  style={{
                    backgroundColor: palette.bright,
                    boxShadow: isActive ? palette.glow : undefined,
                    opacity: isActive ? 1 : 0,
                  }}
                />
                {k.shortcut && (
                  <span
                    className={cn(
                      'font-mono text-[8.5px] font-semibold leading-none pointer-events-none',
                      isActive ? 'text-white' : 'text-[#687084]'
                    )}
                  >
                    {k.shortcut}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
});
