import React, { useState } from 'react';
import { ChevronDown, ChevronUp, RefreshCw, Trash2, X } from 'lucide-react';
import { MidiEngineStatus } from '../../midiEngine';
import { MidiCCBinding } from './MidiLearnContext';
import { MIDI_TARGET_SPECS } from '../../midiTargets';
import { cn } from '../../utils';

export type MidiButtonCcMode = 'latch' | 'gate';

export interface MidiLearnPanelProps {
  midiLearnMode: boolean;
  armedTargetId: string | null;
  onCancelArm: () => void;
  onExitMidiLearn: () => void;
  midiStatus: MidiEngineStatus;
  onRefreshMidi: () => void;
  selectedDeviceId: string; // 'all' or device id
  onSelectDevice: (id: string) => void;
  selectedChannel: number | null; // null = Omni, or 1..16
  onSelectChannel: (ch: number | null) => void;
  buttonCcMode: MidiButtonCcMode;
  onChangeButtonCcMode: (mode: MidiButtonCcMode) => void;
  lastActivityLabel: string | null;
  bindings: Record<string, MidiCCBinding>;
  onUnbindTarget: (targetId: string) => void;
  onClearAllBindings: () => void;
  onSendTestCC: (cc: number, value: number) => void;
}

export function MidiLearnPanel({
  midiLearnMode,
  armedTargetId,
  onCancelArm,
  onExitMidiLearn,
  midiStatus,
  onRefreshMidi,
  selectedDeviceId,
  onSelectDevice,
  selectedChannel,
  onSelectChannel,
  buttonCcMode,
  onChangeButtonCcMode,
  lastActivityLabel,
  bindings,
  onUnbindTarget,
  onClearAllBindings,
  onSendTestCC,
}: MidiLearnPanelProps) {
  const [showInspector, setShowInspector] = useState(false);
  const [testCcNum, setTestCcNum] = useState<number>(74);
  const [testCcVal, setTestCcVal] = useState<number>(96);

  if (!midiLearnMode) return null;

  const armedSpec = armedTargetId ? MIDI_TARGET_SPECS[armedTargetId] : undefined;
  const armedExistingBinding = armedTargetId ? bindings[armedTargetId] : undefined;
  const bindingList = Object.values(bindings).sort((a, b) => a.cc - b.cc);
  const connectedCount = midiStatus.inputs.length;

  const portSummary = !midiStatus.supported
    ? 'Web MIDI Not Supported'
    : midiStatus.permission === 'denied'
    ? 'MIDI Access Blocked'
    : connectedCount > 0
    ? `${connectedCount} MIDI ${connectedCount === 1 ? 'Controller' : 'Controllers'} Online`
    : 'Listening · Plug In USB MIDI';

  return (
    <div
      style={{ borderRadius: 'var(--module-radius)' }}
      className="mb-3.5 bg-[#141822]/96 border border-[#38BDF8]/35 text-[#E4E9F4] overflow-hidden"
    >
      {/* Primary MIDI Learn Action & Status Row */}
      <div className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <span className="font-display text-[11px] font-semibold tracking-[0.08em] uppercase text-[#7DD3FC] whitespace-nowrap shrink-0">
            MIDI Learn
          </span>
          <span aria-hidden="true" className="text-[#4B5468]">
            ·
          </span>

          {armedTargetId ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-[#FFD099] font-medium">
                Armed: {armedSpec?.label || armedTargetId}
              </span>
              <span className="text-[#949DB2]">
                — Move a hardware knob, slider, or pad now to bind CC
              </span>
              {armedExistingBinding && (
                <button
                  type="button"
                  onClick={() => onUnbindTarget(armedTargetId)}
                  className="px-2 py-0.5 rounded bg-[#2B1B22] hover:bg-[#38222B] text-[11px] font-medium text-[#FDA4AF] cursor-pointer transition-colors whitespace-nowrap shrink-0"
                >
                  Unbind CC {armedExistingBinding.cc}
                </button>
              )}
              <button
                type="button"
                onClick={onCancelArm}
                className="px-2 py-0.5 rounded bg-[#222736] hover:bg-[#2C3245] text-[11px] font-medium text-[#B8C0D4] hover:text-white cursor-pointer transition-colors whitespace-nowrap shrink-0"
              >
                Cancel
              </button>
            </div>
          ) : (
            <span className="text-xs text-[#B6BFD3]">
              Click any highlighted knob, fader, display, or button to arm it for MIDI CC binding.
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {/* Clean unboxed telemetry metadata */}
          <div className="hidden sm:flex items-center gap-2 text-[11px] font-mono tabular-nums text-[#8D96AB]">
            <span>{portSummary}</span>
            <span aria-hidden="true">·</span>
            <span>{bindingList.length} Mapped</span>
            {lastActivityLabel && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-[#BAE6FD]">{lastActivityLabel}</span>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowInspector((v) => !v)}
            className="h-7 px-2.5 rounded-lg bg-[#1F2534] hover:bg-[#283044] border border-white/12 text-[11px] font-medium text-[#D2DAE9] hover:text-white flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <span>Ports &amp; Mappings</span>
            {showInspector ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>

          <button
            type="button"
            onClick={onExitMidiLearn}
            aria-label="Exit MIDI Learn mode"
            className="h-7 px-2.5 rounded-lg bg-[#242A3B] hover:bg-[#2F374D] border border-white/15 text-[11px] font-medium text-white flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <span>Done</span>
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Expandable Hardware MIDI Port Setup, Active Mappings & Test CC Transmitter */}
      {showInspector && (
        <div className="px-4 py-3 border-t border-white/10 bg-[#10131C] flex flex-col gap-3">
          {/* Row 1: Hardware Input Device + MIDI Channel + Button Trigger Mode + Test CC */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              {/* MIDI Input Device Selector */}
              <label className="flex items-center gap-1.5 text-xs text-[#9AA3B8]">
                <span className="whitespace-nowrap">Input:</span>
                <select
                  value={selectedDeviceId}
                  onChange={(e) => onSelectDevice(e.target.value)}
                  className="h-7 px-2 rounded-md bg-[#191E2B] border border-white/14 text-xs text-white focus:outline-none focus:border-[#38BDF8]"
                >
                  <option value="all">
                    All MIDI Inputs ({connectedCount})
                  </option>
                  {midiStatus.inputs.map((inp) => (
                    <option key={inp.id} value={inp.id}>
                      {inp.name}
                    </option>
                  ))}
                </select>
              </label>

              {/* MIDI Channel Selector */}
              <label className="flex items-center gap-1.5 text-xs text-[#9AA3B8]">
                <span className="whitespace-nowrap">Channel:</span>
                <select
                  value={selectedChannel === null ? 'omni' : String(selectedChannel)}
                  onChange={(e) =>
                    onSelectChannel(e.target.value === 'omni' ? null : Number(e.target.value))
                  }
                  className="h-7 px-2 rounded-md bg-[#191E2B] border border-white/14 text-xs font-mono tabular-nums text-white focus:outline-none focus:border-[#38BDF8]"
                >
                  <option value="omni">Omni (1–16)</option>
                  {Array.from({ length: 16 }).map((_, idx) => (
                    <option key={idx + 1} value={idx + 1}>
                      Ch {idx + 1}
                    </option>
                  ))}
                </select>
              </label>

              {/* Button CC Behavior */}
              <label className="flex items-center gap-1.5 text-xs text-[#9AA3B8]">
                <span className="whitespace-nowrap">Buttons:</span>
                <select
                  value={buttonCcMode}
                  onChange={(e) => onChangeButtonCcMode(e.target.value as MidiButtonCcMode)}
                  className="h-7 px-2 rounded-md bg-[#191E2B] border border-white/14 text-xs text-white focus:outline-none focus:border-[#38BDF8]"
                >
                  <option value="latch">Pad Press Toggle</option>
                  <option value="gate">Switch Gate (64+)</option>
                </select>
              </label>

              <button
                type="button"
                onClick={onRefreshMidi}
                title="Rescan connected MIDI hardware ports"
                className="h-7 px-2.5 rounded-md bg-[#1C2230] hover:bg-[#252D40] border border-white/12 text-xs text-[#C6CFE2] hover:text-white flex items-center gap-1 cursor-pointer transition-colors whitespace-nowrap shrink-0"
              >
                <RefreshCw size={11} />
                <span>Rescan</span>
              </button>
            </div>

            {/* Built-In Test CC Transmitter (lets users test MIDI Learn even without USB controller attached) */}
            <div className="flex flex-wrap items-center gap-2 bg-[#161B26] border border-white/10 rounded-lg px-2.5 py-1">
              <span className="text-[11px] text-[#8E97AC] whitespace-nowrap">Test CC:</span>
              <select
                aria-label="Test MIDI CC number"
                value={testCcNum}
                onChange={(e) => setTestCcNum(Number(e.target.value))}
                className="h-6 px-1.5 rounded bg-[#0E1118] border border-white/14 text-[11px] font-mono tabular-nums text-white focus:outline-none"
              >
                {[1, 7, 10, 11, 16, 17, 18, 19, 71, 74, 75, 76].map((cc) => (
                  <option key={cc} value={cc}>
                    CC {cc}
                  </option>
                ))}
              </select>
              <input
                type="range"
                min={0}
                max={127}
                value={testCcVal}
                aria-label="Test MIDI CC value"
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setTestCcVal(v);
                  onSendTestCC(testCcNum, v);
                }}
                onPointerUp={(e) => e.currentTarget.blur()}
                className="w-20 accent-[#38BDF8] cursor-pointer"
              />
              <span className="font-mono text-[11px] tabular-nums text-[#BAE6FD] w-7 text-right">
                {testCcVal}
              </span>
              <button
                type="button"
                onClick={() => onSendTestCC(testCcNum, 127)}
                className="h-6 px-2 rounded bg-[#233148] hover:bg-[#2C3E5B] text-[11px] font-medium text-[#E0F2FE] cursor-pointer transition-colors whitespace-nowrap shrink-0"
              >
                Send Test CC
              </button>
            </div>
          </div>

          {/* Row 2: Active MIDI CC Bindings Table / List */}
          <div className="pt-1 border-t border-white/8 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-[#9AA3B8]">
                Active MIDI CC Assignments ({bindingList.length})
              </span>
              {bindingList.length > 0 && (
                <button
                  type="button"
                  onClick={onClearAllBindings}
                  className="text-[11px] text-[#FDA4AF] hover:text-white flex items-center gap-1 cursor-pointer transition-colors whitespace-nowrap"
                >
                  <Trash2 size={11} />
                  <span>Clear All</span>
                </button>
              )}
            </div>

            {bindingList.length === 0 ? (
              <div className="text-xs text-[#737C91] py-1">
                No MIDI CC bindings assigned yet. Click any knob or button on the synth, then turn a
                hardware MIDI controller knob (or drag the Test CC slider above).
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {bindingList.map((b) => {
                  const spec = MIDI_TARGET_SPECS[b.targetId];
                  const isCurrentlyArmed = armedTargetId === b.targetId;
                  return (
                    <div
                      key={b.targetId}
                      className={cn(
                        'px-2.5 py-1 rounded-md border text-xs flex items-center gap-2',
                        isCurrentlyArmed
                          ? 'bg-[#2C2012] border-[#FFB35C]/60 text-[#FFE2B8]'
                          : 'bg-[#171C28] border-white/10 text-[#D4DCEB]'
                      )}
                    >
                      <span className="font-mono text-[11px] tabular-nums text-[#7DD3FC]">
                        CC {b.cc}
                        {b.channel !== null ? ` · Ch ${b.channel}` : ''}
                      </span>
                      <span aria-hidden="true" className="text-[#555E72]">
                        →
                      </span>
                      <span className="font-medium">{spec?.label || b.label}</span>
                      <button
                        type="button"
                        onClick={() => onUnbindTarget(b.targetId)}
                        title={`Remove MIDI binding for ${spec?.label || b.label}`}
                        aria-label={`Remove MIDI binding for ${spec?.label || b.label}`}
                        className="text-[#7E879C] hover:text-[#FDA4AF] cursor-pointer p-0.5"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
