import React, { useState } from 'react';
import { PluginChassis, PluginTopBar } from './PluginChassis';
import { SpectrumDisplay, SpectralBand } from './SpectrumDisplay';
import { ModuleCard } from './ModuleCard';
import { RotaryKnob, MicroKnob } from './RotaryKnob';
import { EdgeFader } from './EdgeFader';
import { TurntablePitchFader } from './TurntablePitchFader';
import { IconToggleButton, HardwarePillButton, SegmentedSwitch } from './HardwareButtons';
import {
  LcdFreqDisplay,
  HarmonicTubeDisplay,
  WaveformScopeDisplay,
  DualFilterBar,
} from './Displays';

interface PresetConfig {
  name: string;
  inGain: number;
  outGain: number;
  sub1: {
    gain: number;
    freq: number;
    attack: number;
    decay: number;
    phase: boolean;
    solo: boolean;
    power: boolean;
  };
  sub2: {
    gain: number;
    freq: number;
    width: number;
    smooth: number;
    phase: boolean;
    solo: boolean;
    power: boolean;
  };
  tone: {
    amount: number;
    mode: string;
    power: boolean;
  };
  stabilise: {
    amount: number;
    power: boolean;
  };
  hpFreq: number;
  lpFreq: number;
  dryWet: number;
  bypass: boolean;
}

const PRESETS: PresetConfig[] = [
  {
    name: 'Bass Under Attack',
    inGain: 0.0,
    outGain: 0.0,
    sub1: { gain: 1.5, freq: 32, attack: 50, decay: 50, phase: false, solo: false, power: true },
    sub2: { gain: -3.2, freq: 55, width: 52, smooth: 50, phase: false, solo: false, power: true },
    tone: { amount: 40, mode: 'TUBE', power: true },
    stabilise: { amount: 56, power: true },
    hpFreq: 40,
    lpFreq: 10000,
    dryWet: 52,
    bypass: false,
  },
  {
    name: 'Deep Sub Architecture',
    inGain: 1.5,
    outGain: -0.5,
    sub1: { gain: 5.4, freq: 28, attack: 32, decay: 68, phase: false, solo: false, power: true },
    sub2: { gain: -8.0, freq: 62, width: 65, smooth: 64, phase: false, solo: false, power: true },
    tone: { amount: 58, mode: 'WARM', power: true },
    stabilise: { amount: 74, power: true },
    hpFreq: 26,
    lpFreq: 6800,
    dryWet: 76,
    bypass: false,
  },
  {
    name: 'Warm Tape Harmonics',
    inGain: 0.0,
    outGain: 1.2,
    sub1: { gain: -2.0, freq: 36, attack: 45, decay: 42, phase: false, solo: false, power: true },
    sub2: { gain: 3.8, freq: 72, width: 70, smooth: 38, phase: true, solo: false, power: true },
    tone: { amount: 78, mode: 'TAPE', power: true },
    stabilise: { amount: 44, power: true },
    hpFreq: 48,
    lpFreq: 14000,
    dryWet: 68,
    bypass: false,
  },
  {
    name: 'Tight Transient Lock',
    inGain: -1.0,
    outGain: 0.8,
    sub1: { gain: 2.8, freq: 34, attack: 18, decay: 28, phase: false, solo: false, power: true },
    sub2: { gain: 0.5, freq: 50, width: 38, smooth: 72, phase: false, solo: false, power: true },
    tone: { amount: 65, mode: 'CLIP', power: true },
    stabilise: { amount: 88, power: true },
    hpFreq: 35,
    lpFreq: 8500,
    dryWet: 85,
    bypass: false,
  },
];

export function ReferenceAssembly() {
  const [presetIdx, setPresetIdx] = useState(0);
  const [state, setState] = useState<PresetConfig>(PRESETS[0]);
  const [turntableThrottle, setTurntableThrottle] = useState(58);
  const [demoSwitch, setDemoSwitch] = useState<'A' | 'B' | 'C'>('A');
  const [showInspector, setShowInspector] = useState(false);
  const [statusFeedback, setStatusFeedback] = useState<string | null>(null);

  const applyPreset = (index: number) => {
    const wrapped = (index + PRESETS.length) % PRESETS.length;
    setPresetIdx(wrapped);
    setState(PRESETS[wrapped]);
  };

  const triggerFeedback = (msg: string) => {
    setStatusFeedback(msg);
    window.setTimeout(() => setStatusFeedback(null), 2200);
  };

  const bands: SpectralBand[] = [
    {
      id: 'sub1',
      label: 'SUB 1',
      frequency: state.sub1.freq,
      gainDb: state.sub1.gain,
      width: 34,
      active: state.sub1.power && (!state.sub2.solo || state.sub1.solo),
      colorStart: '#5E6BFF',
      colorEnd: '#684DFF',
    },
    {
      id: 'sub2',
      label: 'SUB 2',
      frequency: state.sub2.freq,
      gainDb: state.sub2.gain,
      width: state.sub2.width,
      active: state.sub2.power && (!state.sub1.solo || state.sub2.solo),
      colorStart: '#FF9D64',
      colorEnd: '#FF5D9E',
    },
  ];

  const handleBandDrag = (id: string, patch: Partial<SpectralBand>) => {
    if (id === 'sub1') {
      setState((prev) => ({
        ...prev,
        sub1: {
          ...prev.sub1,
          freq: patch.frequency ?? prev.sub1.freq,
          gain: patch.gainDb ?? prev.sub1.gain,
        },
      }));
    } else if (id === 'sub2') {
      setState((prev) => ({
        ...prev,
        sub2: {
          ...prev.sub2,
          freq: patch.frequency ?? prev.sub2.freq,
          gain: patch.gainDb ?? prev.sub2.gain,
        },
      }));
    }
  };

  return (
    <div className="w-full relative">
      <PluginChassis
        topBar={
          <PluginTopBar
            brandLabel="IN THE MIX"
            presetName={state.name}
            presets={PRESETS.map((p) => p.name)}
            onSelectPreset={(name) => {
              const found = PRESETS.findIndex((p) => p.name === name);
              if (found !== -1) applyPreset(found);
            }}
            onPrevPreset={() => applyPreset(presetIdx - 1)}
            onNextPreset={() => applyPreset(presetIdx + 1)}
            onUploadAction={() => {
              applyPreset(0);
              triggerFeedback('Restored factory calibration preset');
            }}
            onSaveAction={() => {
              triggerFeedback(`Snapshot "${state.name}" copied to session state`);
            }}
            onSettingsAction={() => setShowInspector((s) => !s)}
            settingsActive={showInspector}
          />
        }
      >
        {/* Optional Calibration Overlay Bar */}
        {(showInspector || statusFeedback) && (
          <div className="mb-3 px-4 py-2 rounded-xl bg-[#141720] border border-white/10 flex flex-wrap items-center justify-between gap-3 text-xs text-[#AEB5C7]">
            <div className="flex items-center gap-3 font-mono tabular-nums">
              {statusFeedback ? (
                <span className="text-[#98B4FF]">{statusFeedback}</span>
              ) : (
                <>
                  <span>SUB 1: {state.sub1.freq} Hz ({state.sub1.gain > 0 ? '+' : ''}{state.sub1.gain.toFixed(1)} dB)</span>
                  <span aria-hidden="true">·</span>
                  <span>SUB 2: {state.sub2.freq} Hz ({state.sub2.gain > 0 ? '+' : ''}{state.sub2.gain.toFixed(1)} dB)</span>
                  <span aria-hidden="true">·</span>
                  <span>DRIVE: {state.tone.mode} {Math.round(state.tone.amount)}%</span>
                </>
              )}
            </div>
            <span className="text-[11px] text-[#7D8496]">
              Tip: Drag spectrum nodes, LCD frequencies, or hold Shift while turning knobs for fine control
            </span>
          </div>
        )}

        {/* Top Panoramic Spectral Visualizer */}
        <SpectrumDisplay
          title="BASSMAKER"
          bands={bands}
          onUpdateBand={handleBandDrag}
          bypassed={state.bypass}
          dryWet={state.dryWet}
        />

        {/* Lower Hardware Control Deck */}
        <div className="mt-4 flex flex-col lg:flex-row items-stretch gap-3.5">
          {/* Far Left Edge Input Fader */}
          <div className="hidden lg:flex items-center justify-center px-0.5">
            <EdgeFader
              label="IN"
              value={state.inGain}
              meterLevel={state.bypass ? 0.35 : 0.68}
              onChange={(v) => setState((s) => ({ ...s, inGain: v }))}
              height={186}
            />
          </div>

          {/* Center 4-Module Hardware Grid (3 : 3 : 5 proportional split matching reference) */}
          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-11 gap-3">
            {/* SUB 1 Module */}
            <ModuleCard
              title="SUB 1"
              active={state.sub1.power && !state.bypass}
              className="xl:col-span-3 p-3.5"
              headerActions={
                <>
                  <IconToggleButton
                    icon="phase"
                    label="Sub 1 Phase Invert"
                    active={state.sub1.phase}
                    accent="blue"
                    onToggle={() =>
                      setState((s) => ({ ...s, sub1: { ...s.sub1, phase: !s.sub1.phase } }))
                    }
                  />
                  <IconToggleButton
                    icon="solo"
                    label="Sub 1 Solo"
                    active={state.sub1.solo}
                    accent="blue"
                    onToggle={() =>
                      setState((s) => ({ ...s, sub1: { ...s.sub1, solo: !s.sub1.solo } }))
                    }
                  />
                  <IconToggleButton
                    icon="power"
                    label="Sub 1 Power"
                    active={state.sub1.power}
                    accent="blue"
                    onToggle={() =>
                      setState((s) => ({ ...s, sub1: { ...s.sub1, power: !s.sub1.power } }))
                    }
                  />
                </>
              }
            >
              <div className="flex items-start justify-between gap-2.5 pt-1">
                <RotaryKnob
                  size="lg"
                  accent="blue"
                  value={state.sub1.gain}
                  min={-60}
                  max={12}
                  step={0.2}
                  defaultValue={1.5}
                  minLabel="-60"
                  maxLabel="+12"
                  label="GAIN"
                  showZeroRingMarker
                  formatValue={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`}
                  onChange={(v) =>
                    setState((s) => ({ ...s, sub1: { ...s.sub1, gain: v } }))
                  }
                />

                <div className="flex flex-col items-center justify-between gap-3">
                  <LcdFreqDisplay
                    frequency={state.sub1.freq}
                    minFreq={18}
                    maxFreq={90}
                    accent="blue"
                    allowNoteMode
                    meterLevel={
                      state.sub1.power ? ((state.sub1.gain + 60) / 72) * 0.85 : 0.05
                    }
                    onChangeFrequency={(hz) =>
                      setState((s) => ({ ...s, sub1: { ...s.sub1, freq: hz } }))
                    }
                  />
                  <div className="w-full flex items-center justify-around px-0.5">
                    <MicroKnob
                      label="ATTACK"
                      accent="blue"
                      value={state.sub1.attack}
                      defaultValue={50}
                      formatValue={(v) => `${Math.round(v)} ms`}
                      onChange={(v) =>
                        setState((s) => ({ ...s, sub1: { ...s.sub1, attack: v } }))
                      }
                    />
                    <MicroKnob
                      label="DECAY"
                      accent="blue"
                      value={state.sub1.decay}
                      defaultValue={50}
                      formatValue={(v) => `${Math.round(v * 4)} ms`}
                      onChange={(v) =>
                        setState((s) => ({ ...s, sub1: { ...s.sub1, decay: v } }))
                      }
                    />
                  </div>
                </div>
              </div>
            </ModuleCard>

            {/* SUB 2 Module */}
            <ModuleCard
              title="SUB 2"
              active={state.sub2.power && !state.bypass}
              className="xl:col-span-3 p-3.5"
              headerActions={
                <>
                  <IconToggleButton
                    icon="phase"
                    label="Sub 2 Phase Invert"
                    active={state.sub2.phase}
                    accent="amber"
                    onToggle={() =>
                      setState((s) => ({ ...s, sub2: { ...s.sub2, phase: !s.sub2.phase } }))
                    }
                  />
                  <IconToggleButton
                    icon="solo"
                    label="Sub 2 Solo"
                    active={state.sub2.solo}
                    accent="amber"
                    onToggle={() =>
                      setState((s) => ({ ...s, sub2: { ...s.sub2, solo: !s.sub2.solo } }))
                    }
                  />
                  <IconToggleButton
                    icon="power"
                    label="Sub 2 Power"
                    active={state.sub2.power}
                    accent="amber"
                    onToggle={() =>
                      setState((s) => ({ ...s, sub2: { ...s.sub2, power: !s.sub2.power } }))
                    }
                  />
                </>
              }
            >
              <div className="flex items-start justify-between gap-2.5 pt-1">
                <RotaryKnob
                  size="lg"
                  accent="amber"
                  value={state.sub2.gain}
                  min={-60}
                  max={12}
                  step={0.2}
                  defaultValue={-3.2}
                  minLabel="-60"
                  maxLabel="+12"
                  label="GAIN"
                  showZeroRingMarker
                  formatValue={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`}
                  onChange={(v) =>
                    setState((s) => ({ ...s, sub2: { ...s.sub2, gain: v } }))
                  }
                />

                <div className="flex flex-col items-center justify-between gap-3">
                  <LcdFreqDisplay
                    frequency={state.sub2.freq}
                    minFreq={35}
                    maxFreq={180}
                    accent="amber"
                    allowNoteMode={false}
                    meterLevel={
                      state.sub2.power ? ((state.sub2.gain + 60) / 72) * 0.85 : 0.05
                    }
                    onChangeFrequency={(hz) =>
                      setState((s) => ({ ...s, sub2: { ...s.sub2, freq: hz } }))
                    }
                  />
                  <div className="w-full flex items-center justify-around px-0.5">
                    <MicroKnob
                      label="WIDTH"
                      accent="amber"
                      value={state.sub2.width}
                      defaultValue={52}
                      formatValue={(v) => `${Math.round(v)}%`}
                      onChange={(v) =>
                        setState((s) => ({ ...s, sub2: { ...s.sub2, width: v } }))
                      }
                    />
                    <MicroKnob
                      label="SMOOTH"
                      accent="amber"
                      value={state.sub2.smooth}
                      defaultValue={50}
                      formatValue={(v) => `${Math.round(v)}%`}
                      onChange={(v) =>
                        setState((s) => ({ ...s, sub2: { ...s.sub2, smooth: v } }))
                      }
                    />
                  </div>
                </div>
              </div>
            </ModuleCard>

            {/* Right Half: TONE + STABILISE Upper Cards & HP/LP + DRY/WET + BYPASS Lower Strip */}
            <div className="md:col-span-2 xl:col-span-5 flex flex-col justify-between gap-3">
              {/* Top Row: TONE & STABILISE */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1">
                <ModuleCard
                  title="TONE"
                  active={state.tone.power && !state.bypass}
                  className="p-3.5"
                  headerActions={
                    <IconToggleButton
                      icon="power"
                      label="Tone Power"
                      active={state.tone.power}
                      accent="amber"
                      onToggle={() =>
                        setState((s) => ({
                          ...s,
                          tone: { ...s.tone, power: !s.tone.power },
                        }))
                      }
                    />
                  }
                >
                  <div className="flex items-center justify-between gap-3 pt-1">
                    <RotaryKnob
                      size="md"
                      accent="amber"
                      value={state.tone.amount}
                      min={0}
                      max={100}
                      step={1}
                      defaultValue={40}
                      showPerimeterDots
                      formatValue={(v) => `${Math.round(v)}%`}
                      onChange={(v) =>
                        setState((s) => ({ ...s, tone: { ...s.tone, amount: v } }))
                      }
                    />
                    <HarmonicTubeDisplay
                      mode={state.tone.mode}
                      drive={state.tone.amount / 100}
                      accent="amber"
                      onChangeMode={(nextMode) =>
                        setState((s) => ({ ...s, tone: { ...s.tone, mode: nextMode } }))
                      }
                    />
                  </div>
                </ModuleCard>

                <ModuleCard
                  title="STABILISE"
                  active={state.stabilise.power && !state.bypass}
                  className="p-3.5"
                  headerActions={
                    <IconToggleButton
                      icon="power"
                      label="Stabilise Power"
                      active={state.stabilise.power}
                      accent="violet"
                      onToggle={() =>
                        setState((s) => ({
                          ...s,
                          stabilise: { ...s.stabilise, power: !s.stabilise.power },
                        }))
                      }
                    />
                  }
                >
                  <div className="flex items-center justify-between gap-3 pt-1">
                    <RotaryKnob
                      size="md"
                      accent="violet"
                      value={state.stabilise.amount}
                      min={0}
                      max={100}
                      step={1}
                      defaultValue={56}
                      showPerimeterDots
                      formatValue={(v) => `${Math.round(v)}%`}
                      onChange={(v) =>
                        setState((s) => ({
                          ...s,
                          stabilise: { ...s.stabilise, amount: v },
                        }))
                      }
                    />
                    <WaveformScopeDisplay
                      amount={state.stabilise.amount / 100}
                      accent="violet"
                    />
                  </div>
                </ModuleCard>
              </div>

              {/* Bottom Utility Strip: Bandpass Filter + Dry/Wet + Bypass */}
              <div className="px-2 pt-1 flex items-center justify-between gap-4">
                <div className="flex-1 min-w-[160px]">
                  <DualFilterBar
                    hpFreq={state.hpFreq}
                    lpFreq={state.lpFreq}
                    onChangeHp={(hz) => setState((s) => ({ ...s, hpFreq: hz }))}
                    onChangeLp={(hz) => setState((s) => ({ ...s, lpFreq: hz }))}
                  />
                </div>

                <MicroKnob
                  leftLabel="DRY"
                  rightLabel="WET"
                  accent="neutral"
                  value={state.dryWet}
                  defaultValue={52}
                  formatValue={(v) => `${Math.round(v)}% Wet`}
                  onChange={(v) => setState((s) => ({ ...s, dryWet: v }))}
                />

                <HardwarePillButton
                  label="BYPASS"
                  active={state.bypass}
                  accent="amber"
                  onToggle={() => setState((s) => ({ ...s, bypass: !s.bypass }))}
                />
              </div>
            </div>
          </div>

          {/* Far Right Edge Output Fader */}
          <div className="hidden lg:flex items-center justify-center px-0.5">
            <EdgeFader
              label="OUT"
              value={state.outGain}
              meterLevel={state.bypass ? 0.35 : 0.76}
              onChange={(v) => setState((s) => ({ ...s, outGain: v }))}
              height={186}
            />
          </div>
        </div>

        {/* Standalone Hardware Component Overview Shelf (Preserves TurntablePitchFader & Auxiliary Controls) */}
        <div className="mt-4 pt-3.5 border-t border-white/10 flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <span className="font-display text-[11px] font-semibold tracking-[0.11em] uppercase text-[#C8D0E2]">
              Hardware Component Overview · Auxiliary Controls
            </span>
            <span className="font-mono text-[10px] tabular-nums text-[#7E879B]">
              TurntablePitchFader · SegmentedSwitch · Double-Click Reset
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-center">
            <div className="lg:col-span-7">
              <TurntablePitchFader
                label="GROWL"
                value={turntableThrottle}
                min={0}
                max={100}
                defaultValue={58}
                active={!state.bypass}
                accent="amber"
                onChange={(nextVal) => {
                  setTurntableThrottle(nextVal);
                  setState((s) => ({
                    ...s,
                    tone: { ...s.tone, amount: nextVal },
                  }));
                }}
              />
            </div>

            <div className="lg:col-span-5 flex flex-wrap items-center justify-between gap-3 px-3 py-2 rounded-xl bg-[#141720]/85 border border-white/10">
              <span className="font-mono text-[10.5px] text-[#9BA3B8]">
                Stage Routing
              </span>
              <SegmentedSwitch
                accent="cyan"
                value={demoSwitch}
                onChange={setDemoSwitch}
                options={[
                  { value: 'A', label: 'Clean 909' },
                  { value: 'B', label: 'Tape Sat' },
                  { value: 'C', label: 'Gabber Rail' },
                ]}
              />
            </div>
          </div>
        </div>
      </PluginChassis>
    </div>
  );
}
