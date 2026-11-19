import React, { createContext, useContext } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../utils';

export interface MidiCCBinding {
  targetId: string;
  label: string;
  cc: number;
  channel: number | null; // null = Omni, or 1..16
}

export interface MidiLearnContextValue {
  midiLearnMode: boolean;
  armedTargetId: string | null;
  bindings: Record<string, MidiCCBinding>;
  activeCcTargetId: string | null;
  armTarget: (targetId: string, fallbackLabel?: string) => void;
  unbindTarget: (targetId: string) => void;
}

const DEFAULT_CONTEXT: MidiLearnContextValue = {
  midiLearnMode: false,
  armedTargetId: null,
  bindings: {},
  activeCcTargetId: null,
  armTarget: () => {},
  unbindTarget: () => {},
};

export const MidiLearnContext = createContext<MidiLearnContextValue>(DEFAULT_CONTEXT);

export function useMidiLearnTarget(midiId?: string, fallbackLabel?: string) {
  const ctx = useContext(MidiLearnContext);
  const enabled = Boolean(midiId) && ctx.midiLearnMode;
  const binding = midiId ? ctx.bindings[midiId] : undefined;
  const isArmed = Boolean(midiId) && ctx.midiLearnMode && ctx.armedTargetId === midiId;
  const isLiveModulating = Boolean(midiId) && ctx.activeCcTargetId === midiId;

  const interceptLearnEvent = (e: React.SyntheticEvent) => {
    if (!midiId || !ctx.midiLearnMode) return false;
    e.preventDefault();
    e.stopPropagation();
    ctx.armTarget(midiId, fallbackLabel);
    return true;
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!midiId || !ctx.midiLearnMode || !binding) return;
    e.preventDefault();
    e.stopPropagation();
    ctx.unbindTarget(midiId);
  };

  return {
    midiLearnMode: ctx.midiLearnMode,
    isLearnable: Boolean(midiId),
    enabled,
    binding,
    isArmed,
    isLiveModulating,
    interceptLearnEvent,
    handleContextMenu,
    unbind: () => midiId && ctx.unbindTarget(midiId),
  };
}

export function MidiLearnOverlayTag({
  midiId,
  binding,
  isArmed,
  midiLearnMode,
  onUnbind,
  compact = false,
}: {
  midiId?: string;
  binding?: MidiCCBinding;
  isArmed: boolean;
  midiLearnMode: boolean;
  onUnbind: () => void;
  compact?: boolean;
}) {
  if (!midiId || !midiLearnMode) return null;

  if (isArmed) {
    return (
      <span
        className={cn(
          'absolute -top-2.5 left-1/2 -translate-x-1/2 z-40 rounded px-1.5 py-[1px] bg-[#3A240E] border border-[#FFB35C] font-mono text-[8.5px] font-semibold tabular-nums text-[#FFD099] shadow-[0_4px_10px_rgba(0,0,0,0.85)] whitespace-nowrap pointer-events-none',
          compact && 'text-[8px] px-1 -top-2'
        )}
      >
        WAIT CC
      </span>
    );
  }

  if (binding) {
    return (
      <span
        className={cn(
          'absolute -top-2.5 left-1/2 -translate-x-1/2 z-40 rounded pl-1.5 pr-1 py-[1px] bg-[#102838] border border-[#38BDF8]/80 font-mono text-[8.5px] font-semibold tabular-nums text-[#BAE6FD] shadow-[0_4px_10px_rgba(0,0,0,0.85)] whitespace-nowrap inline-flex items-center gap-0.5',
          compact && 'text-[8px] pl-1 pr-0.5 -top-2'
        )}
      >
        <span>CC {binding.cc}</span>
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onUnbind();
          }}
          title={`Unbind CC ${binding.cc}`}
          aria-label={`Unbind CC ${binding.cc}`}
          className="hover:text-white text-[#7DD3FC] cursor-pointer p-[1px]"
        >
          <X size={8} strokeWidth={2.5} />
        </button>
      </span>
    );
  }

  return null;
}
