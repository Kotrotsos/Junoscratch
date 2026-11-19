import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Upload, X, RotateCcw } from 'lucide-react';
import { audioEngine } from './audioEngine';
import {
  BUILTIN_PRESET_CATEGORIES,
  isBuiltInPresetCategory,
  PluginChassis,
  PluginTopBar,
  PresetCategory,
  PresetMenuItem,
  SynthMasterScreen,
  ModuleCard,
  RotaryKnob,
  MicroKnob,
  EdgeFader,
  ReferenceAssembly,
  IconToggleButton,
  HardwarePillButton,
  TransportPillButton,
  SegmentedSwitch,
  LcdFreqDisplay,
  HarmonicTubeDisplay,
  WaveformScopeDisplay,
  DualFilterBar,
  OscWaveDisplay,
  KickOscDisplay,
  KrachEqClipDisplay,
  KickAdsrDisplay,
  KickAdsrPatch,
  KickLfoDisplay,
  SynthAdsrDisplay,
  SynthAdsrPatch,
  SynthLfoDisplay,
  FormantTractDisplay,
  BitcrushScopeDisplay,
  DisperserPhaseDisplay,
  ReeseMirrorDisplay,
  VinylPlatterDisplay,
  PhaseScopeDisplay,
  SpectralGateDisplay,
  SubThumpDisplay,
  OttMultibandDisplay,
  HardwareKeyboard,
  ThemeCustomizerPanel,
  MidiLearnContext,
  MidiCCBinding,
  MidiLearnOverlayTag,
  useMidiLearnTarget,
  MidiLearnPanel,
  MidiButtonCcMode,
  FxChainPatchbay,
  DEFAULT_THEME_SETTINGS,
  ThemeSettings,
  applyThemeToDocument,
  midiToNoteLabel,
} from './components/dsp';
import {
  MAX_SYNTH_HISTORY,
  SynthHistorySnapshot,
  areFxChainsEqual,
  areSynthParamsEqual,
  cloneEnvelope,
  cloneSynthParams,
  isFxChainDiscreteChange,
  useSynthHistoryManager,
} from './historyManager';
import { midiEngine, MidiEngineStatus } from './midiEngine';
import { MIDI_TARGET_SPECS, mapMidiCcToRange } from './midiTargets';
import {
  BuiltInSampleId,
  EnvelopeData,
  FxSlotItem,
  KickClipMode,
  KickLfoShape,
  KickLfoTarget,
  KickPhaseMode,
  KickTailType,
  OscWaveType,
  OttFlavorMode,
  PhaseScopeMode,
  Point,
  RackTabId,
  SubThumpMode,
  SynthLfoTarget,
  SynthParams,
  TelemetryFrame,
  ToneMode,
} from './types';

type PresetSynthParams = Omit<SynthParams, 'curveMode' | 'curveSpeed'> &
  Partial<Pick<SynthParams, 'curveMode' | 'curveSpeed'>>;

interface SynthPreset {
  name: string;
  category: PresetCategory;
  subtitle: string;
  isInit?: boolean;
  isUser?: boolean;
  defaultSample: BuiltInSampleId;
  speedEnv: Point[];
  pitchEnv: Point[];
  params: PresetSynthParams;
}

const BUILT_IN_SAMPLES: { id: BuiltInSampleId; label: string }[] = [
  { id: '909-drum', label: 'Dry TR-909 Kick' },
  { id: 'sub-pulse', label: 'Analog Sub Pulse' },
  { id: 'reese-bass', label: 'Neuro Reese Bass' },
  { id: 'chord-stabs', label: 'Minor 9th Stabs' },
  { id: 'perc-loop', label: 'Breakbeat Groove' },
];

const OSC_INTERVAL_STEPS = [0, 7, 12, -12];
const OSC_WAVES: OscWaveType[] = ['SAW', 'PULSE', 'SUPER', 'SYNC', 'METAL', 'TRI'];
const TONE_MODES: ToneMode[] = ['TEAROUT', 'ROAR', 'YOI', 'SCREAM', 'TUBE', 'CLIP'];
const FM_RATIOS = [0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 6.0, 8.0];
const KICK_TAIL_TYPES: KickTailType[] = ['909', 'SUB', 'SAW', 'ZAAG', 'KRACH', 'PIEP'];
const KICK_PHASE_MODES: KickPhaseMode[] = ['RESET', 'HARD', 'FREE'];
const KICK_CLIP_MODES: KickClipMode[] = ['GABBER', 'GCLIP', 'FOLD', 'ZAAG', 'BOILER'];
const KICK_LFO_SHAPES: KickLfoShape[] = ['SINE', 'TRI', 'SAW', 'SQR'];
const KICK_LFO_TARGETS: KickLfoTarget[] = ['HUNT', 'FM', 'PITCH', 'AMP'];
const SYNTH_LFO_TARGETS: SynthLfoTarget[] = ['GROWL', 'VOWEL', 'FILTER', 'PITCH', 'AMP'];

const CODE_TO_SEMITONE_OFFSET: Record<string, number> = {
  KeyA: 0,
  KeyW: 1,
  KeyS: 2,
  KeyE: 3,
  KeyD: 4,
  KeyF: 5,
  KeyT: 6,
  KeyG: 7,
  KeyY: 8,
  KeyH: 9,
  KeyU: 10,
  KeyJ: 11,
  KeyK: 12,
  KeyO: 13,
  KeyL: 14,
  KeyP: 15,
  Semicolon: 16,
  Quote: 17,
};

const INIT_SYNTH_PARAMS: SynthParams = {
  inGainDb: 0.0,
  outGainDb: 0.0,
  oscPower: true,
  oscWave: 'SAW',
  oscLevel: 80,
  oscDetune: 0,
  oscShape: 50,
  oscNoise: 0,
  oscRingMod: false,
  oscInterval: 0,
  grainPower: false,
  grainReverse: false,
  grainFreeze: false,
  baseSpeed: 1.0,
  grainSizeMs: 100,
  grainOverlapMs: 50,
  fmPower: false,
  fmSubOctave: false,
  fmUnison: false,
  fmGrowl: 0,
  fmRatio: 1.0,
  fmWobbleRate: 2.0,
  fmInflect: 0,
  fmMetalAmt: 0,
  wahPower: false,
  wahAmount: 0,
  wahBaseHz: 240,
  wahResonance: 45,
  wahMorph: 50,
  formantPower: false,
  fmVowel: 50,
  formantTalk: 0,
  notchEnable: false,
  notchDepth: 0,
  combPower: false,
  combKeyTrack: true,
  fmMetal: 0,
  combHarmonic: 4.0,
  combFeedbackAmt: 50,
  combDamp: 60,
  crushPower: false,
  fmCrush: 0,
  xoverFreqHz: 115,
  subPunch: 50,
  subSolo: false,
  octave: 2,
  glideMs: 0,
  attackMs: 12,
  decayMs: 320,
  sustain: 82,
  releaseMs: 150,
  synthAdsrFilterMod: true,
  synthLfoPower: false,
  synthLfoShape: 'SINE',
  synthLfoTarget: 'GROWL',
  synthLfoRateHz: 2.8,
  synthLfoDepth: 56,
  synthLfoSync: true,
  basePitchSemitones: 0,
  latchMode: false,
  tonePower: false,
  toneDrive: 0,
  toneMode: 'TUBE',
  spacePower: false,
  spaceAmount: 0,
  hpFreq: 20,
  lpFreq: 20000,
  dryWet: 100,
  bypass: false,
  curveMode: 'continuous',
  curveSpeed: 1.0,
  disperserPower: false,
  disperserAmount: 0,
  disperserFreqHz: 280,
  disperserPinch: 60,
  disperserSweep: 55,
  freqShiftPower: false,
  freqShiftHz: 0,
  freqShiftMix: 0,
  freqShiftFeedback: 0,
  freqShiftBarber: false,
  reesePower: false,
  reeseDepth: 0,
  reeseSweep: 50,
  scratchPower: false,
  scratchAmount: 0,
  vinylBrake: false,
  phaseAlignDeg: 0,
  phaseInvertR: false,
  phaseScopeMode: 'goniometer',
  phaseScopeFreeze: false,
  spectralPower: false,
  spectralMix: 0,
  spectralThresh: 42,
  spectralReso: 58,
  haasPower: false,
  haasWidth: 0,
  haasDelayMs: 9.5,
  haasDetune: 35,
  haasMonoCheck: false,
  thumpPower: false,
  thumpAmount: 0,
  thumpMode: 'PUNCH',
  ottPower: false,
  ottAmount: 0,
  ottMode: 'UPWARD',
  kickMode: false,
  kickPower: true,
  kickTailType: '909',
  kickPhaseMode: 'RESET',
  kickPhaseDeg: 0,
  kickPunch: 78,
  kickFmRatio: 1.5,
  kickTok: 58,
  kickTokBoost: false,
  kickSweepMs: 42,
  kickAttackMs: 1.2,
  kickDecayMs: 280,
  kickSustain: 64,
  kickReleaseMs: 220,
  kickKrachPower: true,
  kickClipMode: 'GABBER',
  kickDrive: 54,
  kickEqFreqHz: 240,
  kickEqGain: 56,
  kickEqSweep: false,
  kickLfoPower: false,
  kickLfoShape: 'SAW',
  kickLfoTarget: 'HUNT',
  kickLfoRateHz: 4.0,
  kickLfoDepth: 58,
  kickLfoSync: true,
  kickRumblePower: false,
  kickLoop: true,
  kickBpm: 165,
  kickRumbleAmt: 72,
  kickDuck: 80,
  kickRumbleLpHz: 280,
  kickRumbleGroove: true,
  fxChain: [],
};

const FLAT_ENVELOPE_POINTS: Point[] = [
  { x: 0, y: 0.5 },
  { x: 1, y: 0.5 },
];

const SYNTH_PRESETS: SynthPreset[] = [
  // =========================================================================
  // CLASSIC — Clean & Growl-Ready Foundations + Warm Basses
  // =========================================================================
  {
    name: 'Init Patch',
    category: 'Classic',
    subtitle: 'Flat OSC Only',
    isInit: true,
    defaultSample: 'sub-pulse',
    speedEnv: FLAT_ENVELOPE_POINTS,
    pitchEnv: FLAT_ENVELOPE_POINTS,
    params: INIT_SYNTH_PARAMS,
  },
  {
    name: 'Clean Reese Foundation',
    category: 'Classic',
    subtitle: 'Growl-Ready Clean',
    defaultSample: 'reese-bass',
    speedEnv: [
      { x: 0, y: 0.34 },
      { x: 0.24, y: 0.82 },
      { x: 0.54, y: 0.28 },
      { x: 0.8, y: 0.74 },
      { x: 1, y: 0.42 },
    ],
    pitchEnv: [
      { x: 0, y: 0.46 },
      { x: 0.32, y: 0.64 },
      { x: 0.68, y: 0.42 },
      { x: 1, y: 0.5 },
    ],
    params: {
      inGainDb: 0.0,
      outGainDb: 0.6,
      oscPower: true,
      oscWave: 'SUPER',
      oscLevel: 78,
      oscDetune: 26,
      oscShape: 52,
      oscNoise: 0,
      oscRingMod: false,
      oscInterval: 0,
      grainPower: false,
      grainReverse: false,
      grainFreeze: false,
      baseSpeed: 1.0,
      grainSizeMs: 95,
      grainOverlapMs: 45,
      fmPower: true,
      fmSubOctave: true,
      fmUnison: true,
      fmGrowl: 0,
      fmRatio: 2.0,
      fmWobbleRate: 3.0,
      fmInflect: 58,
      wahPower: true,
      wahAmount: 0,
      wahBaseHz: 230,
      wahResonance: 64,
      wahMorph: 76,
      formantPower: true,
      fmVowel: 42,
      formantTalk: 0,
      notchEnable: true,
      notchDepth: 66,
      combPower: false,
      combKeyTrack: true,
      fmMetal: 0,
      combHarmonic: 4.0,
      combFeedbackAmt: 58,
      combDamp: 64,
      crushPower: false,
      fmCrush: 0,
      xoverFreqHz: 115,
      subPunch: 68,
      subSolo: false,
      octave: 1,
      glideMs: 35,
      attackMs: 14,
      decayMs: 360,
      sustain: 85,
      releaseMs: 180,
      synthAdsrFilterMod: true,
      basePitchSemitones: 0,
      latchMode: false,
      tonePower: false,
      toneDrive: 0,
      toneMode: 'TEAROUT',
      spacePower: true,
      spaceAmount: 24,
      hpFreq: 24,
      lpFreq: 17500,
      dryWet: 92,
      bypass: false,
    },
  },
  {
    name: 'Pristine Sub & Pulse',
    category: 'Classic',
    subtitle: 'Growl-Ready Clean',
    defaultSample: 'sub-pulse',
    speedEnv: [
      { x: 0, y: 0.42 },
      { x: 0.3, y: 0.78 },
      { x: 0.64, y: 0.32 },
      { x: 1, y: 0.48 },
    ],
    pitchEnv: [
      { x: 0, y: 0.48 },
      { x: 0.28, y: 0.68 },
      { x: 0.62, y: 0.4 },
      { x: 1, y: 0.5 },
    ],
    params: {
      inGainDb: 0.0,
      outGainDb: 0.8,
      oscPower: true,
      oscWave: 'PULSE',
      oscLevel: 76,
      oscDetune: 10,
      oscShape: 46,
      oscNoise: 0,
      oscRingMod: false,
      oscInterval: 0,
      grainPower: false,
      grainReverse: false,
      grainFreeze: false,
      baseSpeed: 1.0,
      grainSizeMs: 105,
      grainOverlapMs: 50,
      fmPower: true,
      fmSubOctave: true,
      fmUnison: false,
      fmGrowl: 0,
      fmRatio: 1.5,
      fmWobbleRate: 3.8,
      fmInflect: 62,
      wahPower: true,
      wahAmount: 0,
      wahBaseHz: 250,
      wahResonance: 70,
      wahMorph: 82,
      formantPower: true,
      fmVowel: 52,
      formantTalk: 0,
      notchEnable: true,
      notchDepth: 60,
      combPower: false,
      combKeyTrack: true,
      fmMetal: 0,
      combHarmonic: 4.0,
      combFeedbackAmt: 56,
      combDamp: 62,
      crushPower: false,
      fmCrush: 0,
      xoverFreqHz: 115,
      subPunch: 70,
      subSolo: false,
      octave: 1,
      glideMs: 20,
      attackMs: 10,
      decayMs: 280,
      sustain: 82,
      releaseMs: 150,
      synthAdsrFilterMod: true,
      basePitchSemitones: 0,
      latchMode: false,
      tonePower: false,
      toneDrive: 0,
      toneMode: 'YOI',
      spacePower: false,
      spaceAmount: 18,
      hpFreq: 24,
      lpFreq: 18000,
      dryWet: 95,
      bypass: false,
    },
  },
  {
    name: 'Pure Sub & Warm Saw',
    category: 'Classic',
    subtitle: 'Growl-Ready Clean',
    defaultSample: 'sub-pulse',
    speedEnv: [
      { x: 0, y: 0.38 },
      { x: 0.35, y: 0.74 },
      { x: 0.72, y: 0.34 },
      { x: 1, y: 0.46 },
    ],
    pitchEnv: [
      { x: 0, y: 0.5 },
      { x: 0.45, y: 0.58 },
      { x: 1, y: 0.5 },
    ],
    params: {
      inGainDb: 0.0,
      outGainDb: 0.6,
      oscPower: true,
      oscWave: 'SAW',
      oscLevel: 76,
      oscDetune: 6,
      oscShape: 50,
      oscNoise: 0,
      oscRingMod: false,
      oscInterval: 0,
      grainPower: false,
      grainReverse: false,
      grainFreeze: false,
      baseSpeed: 1.0,
      grainSizeMs: 100,
      grainOverlapMs: 50,
      fmPower: true,
      fmSubOctave: true,
      fmUnison: true,
      fmGrowl: 0,
      fmRatio: 2.0,
      fmWobbleRate: 2.4,
      fmInflect: 50,
      wahPower: true,
      wahAmount: 0,
      wahBaseHz: 220,
      wahResonance: 58,
      wahMorph: 72,
      formantPower: true,
      fmVowel: 36,
      formantTalk: 0,
      notchEnable: true,
      notchDepth: 58,
      combPower: false,
      combKeyTrack: true,
      fmMetal: 0,
      combHarmonic: 3.0,
      combFeedbackAmt: 56,
      combDamp: 60,
      crushPower: false,
      fmCrush: 0,
      xoverFreqHz: 115,
      subPunch: 68,
      subSolo: false,
      octave: 1,
      glideMs: 15,
      attackMs: 12,
      decayMs: 310,
      sustain: 84,
      releaseMs: 165,
      synthAdsrFilterMod: true,
      basePitchSemitones: 0,
      latchMode: false,
      tonePower: false,
      toneDrive: 0,
      toneMode: 'ROAR',
      spacePower: false,
      spaceAmount: 16,
      hpFreq: 22,
      lpFreq: 18500,
      dryWet: 96,
      bypass: false,
    },
  },
  {
    name: 'Velvet Juno Brass',
    category: 'Classic',
    subtitle: 'Warm Analog Saw',
    defaultSample: 'chord-stabs',
    speedEnv: [
      { x: 0, y: 0.42 },
      { x: 0.4, y: 0.66 },
      { x: 1, y: 0.48 },
    ],
    pitchEnv: [
      { x: 0, y: 0.49 },
      { x: 0.2, y: 0.53 },
      { x: 1, y: 0.5 },
    ],
    params: {
      inGainDb: 0.0,
      outGainDb: 0.5,
      oscPower: true,
      oscWave: 'SAW',
      oscLevel: 82,
      oscDetune: 22,
      oscShape: 54,
      oscNoise: 4,
      oscRingMod: false,
      oscInterval: 0,
      grainPower: false,
      grainReverse: false,
      grainFreeze: false,
      baseSpeed: 1.0,
      grainSizeMs: 120,
      grainOverlapMs: 60,
      fmPower: true,
      fmSubOctave: true,
      fmUnison: true,
      fmGrowl: 0,
      fmRatio: 1.0,
      fmWobbleRate: 1.8,
      fmInflect: 36,
      wahPower: true,
      wahAmount: 0,
      wahBaseHz: 280,
      wahResonance: 50,
      wahMorph: 65,
      formantPower: true,
      fmVowel: 46,
      formantTalk: 0,
      notchEnable: false,
      notchDepth: 45,
      combPower: false,
      combKeyTrack: true,
      fmMetal: 0,
      combHarmonic: 4.0,
      combFeedbackAmt: 50,
      combDamp: 55,
      crushPower: false,
      fmCrush: 0,
      xoverFreqHz: 110,
      subPunch: 56,
      subSolo: false,
      octave: 2,
      glideMs: 25,
      attackMs: 35,
      releaseMs: 260,
      basePitchSemitones: 0,
      latchMode: false,
      tonePower: true,
      toneDrive: 16,
      toneMode: 'TUBE',
      spacePower: true,
      spaceAmount: 42,
      hpFreq: 30,
      lpFreq: 7200,
      dryWet: 85,
      bypass: false,
    },
  },
  {
    name: 'Deep Sub Wub Roller',
    category: 'Classic',
    subtitle: 'Liquid Sub Roller',
    defaultSample: 'sub-pulse',
    speedEnv: [
      { x: 0, y: 0.35 },
      { x: 0.48, y: 0.64 },
      { x: 1, y: 0.38 },
    ],
    pitchEnv: [
      { x: 0, y: 0.5 },
      { x: 0.4, y: 0.62 },
      { x: 0.8, y: 0.44 },
      { x: 1, y: 0.5 },
    ],
    params: {
      inGainDb: 0.5,
      outGainDb: 1.4,
      oscPower: true,
      oscWave: 'TRI',
      oscLevel: 76,
      oscDetune: 18,
      oscShape: 30,
      oscNoise: 8,
      oscRingMod: false,
      oscInterval: 0,
      grainPower: true,
      grainReverse: false,
      grainFreeze: false,
      baseSpeed: 0.85,
      grainSizeMs: 140,
      grainOverlapMs: 70,
      fmPower: true,
      fmSubOctave: true,
      fmUnison: true,
      fmGrowl: 56,
      fmRatio: 1.0,
      fmWobbleRate: 2.0,
      fmInflect: 32,
      wahPower: true,
      wahAmount: 54,
      wahBaseHz: 185,
      wahResonance: 48,
      wahMorph: 60,
      formantPower: true,
      fmVowel: 20,
      formantTalk: 48,
      notchEnable: false,
      notchDepth: 30,
      combPower: false,
      combKeyTrack: true,
      fmMetal: 16,
      combHarmonic: 2.0,
      combFeedbackAmt: 45,
      combDamp: 42,
      crushPower: false,
      fmCrush: 0,
      xoverFreqHz: 125,
      subPunch: 84,
      subSolo: false,
      octave: 1,
      glideMs: 85,
      attackMs: 25,
      decayMs: 340,
      sustain: 78,
      releaseMs: 240,
      synthAdsrFilterMod: true,
      synthLfoPower: true,
      synthLfoShape: 'SINE',
      synthLfoTarget: 'FILTER',
      synthLfoRateHz: 1.8,
      synthLfoDepth: 48,
      synthLfoSync: true,
      basePitchSemitones: 0,
      latchMode: false,
      tonePower: true,
      toneDrive: 48,
      toneMode: 'TUBE',
      spacePower: true,
      spaceAmount: 38,
      hpFreq: 24,
      lpFreq: 4800,
      dryWet: 76,
      bypass: false,
    },
  },

  // =========================================================================
  // GROWL — Multiband Tearout, Neuro, Formant Yoi & Metallic Riddim
  // =========================================================================
  {
    name: 'Lunacy Nova Tearout',
    category: 'Growl',
    subtitle: 'Flagship Tearout',
    defaultSample: 'reese-bass',
    speedEnv: [
      { x: 0, y: 0.36 },
      { x: 0.2, y: 0.84 },
      { x: 0.48, y: 0.24 },
      { x: 0.76, y: 0.72 },
      { x: 1, y: 0.42 },
    ],
    pitchEnv: [
      { x: 0, y: 0.34 },
      { x: 0.26, y: 0.88 },
      { x: 0.56, y: 0.32 },
      { x: 0.82, y: 0.76 },
      { x: 1, y: 0.46 },
    ],
    params: {
      inGainDb: 0.5,
      outGainDb: 1.2,
      oscPower: true,
      oscWave: 'SUPER',
      oscLevel: 74,
      oscDetune: 46,
      oscShape: 58,
      oscNoise: 20,
      oscRingMod: false,
      oscInterval: 0,
      grainPower: true,
      grainReverse: false,
      grainFreeze: false,
      baseSpeed: 1.0,
      grainSizeMs: 85,
      grainOverlapMs: 40,
      fmPower: true,
      fmSubOctave: true,
      fmUnison: true,
      fmGrowl: 90,
      fmRatio: 2.0,
      fmWobbleRate: 3.4,
      fmInflect: 72,
      wahPower: true,
      wahAmount: 82,
      wahBaseHz: 230,
      wahResonance: 68,
      wahMorph: 78,
      formantPower: true,
      fmVowel: 44,
      formantTalk: 80,
      notchEnable: true,
      notchDepth: 72,
      combPower: false,
      combKeyTrack: true,
      fmMetal: 0,
      combHarmonic: 4.0,
      combFeedbackAmt: 62,
      combDamp: 64,
      crushPower: false,
      fmCrush: 0,
      xoverFreqHz: 115,
      subPunch: 78,
      subSolo: false,
      octave: 1,
      glideMs: 40,
      attackMs: 12,
      decayMs: 290,
      sustain: 76,
      releaseMs: 175,
      synthAdsrFilterMod: true,
      synthLfoPower: true,
      synthLfoShape: 'SINE',
      synthLfoTarget: 'GROWL',
      synthLfoRateHz: 3.2,
      synthLfoDepth: 52,
      synthLfoSync: true,
      basePitchSemitones: 0,
      latchMode: false,
      tonePower: true,
      toneDrive: 82,
      toneMode: 'TEAROUT',
      spacePower: true,
      spaceAmount: 58,
      hpFreq: 26,
      lpFreq: 15500,
      dryWet: 88,
      bypass: false,
    },
  },
  {
    name: 'Abyssal Wah & Comb Growl',
    category: 'Growl',
    subtitle: 'Wah + 3x Comb',
    defaultSample: 'reese-bass',
    speedEnv: [
      { x: 0, y: 0.45 },
      { x: 0.32, y: 0.76 },
      { x: 0.65, y: 0.28 },
      { x: 1, y: 0.48 },
    ],
    pitchEnv: [
      { x: 0, y: 0.28 },
      { x: 0.38, y: 0.86 },
      { x: 0.72, y: 0.36 },
      { x: 1, y: 0.48 },
    ],
    params: {
      inGainDb: 0.5,
      outGainDb: 1.1,
      oscPower: true,
      oscWave: 'SYNC',
      oscLevel: 70,
      oscDetune: 36,
      oscShape: 62,
      oscNoise: 14,
      oscRingMod: false,
      oscInterval: -12,
      grainPower: false,
      grainReverse: false,
      grainFreeze: false,
      baseSpeed: 1.0,
      grainSizeMs: 95,
      grainOverlapMs: 45,
      fmPower: true,
      fmSubOctave: true,
      fmUnison: true,
      fmGrowl: 84,
      fmRatio: 1.5,
      fmWobbleRate: 2.6,
      fmInflect: 64,
      fmMetalAmt: 56,
      wahPower: true,
      wahAmount: 88,
      wahBaseHz: 210,
      wahResonance: 76,
      wahMorph: 84,
      formantPower: true,
      fmVowel: 34,
      formantTalk: 74,
      notchEnable: true,
      notchDepth: 64,
      combPower: true,
      combKeyTrack: true,
      fmMetal: 68,
      combHarmonic: 3.0,
      combFeedbackAmt: 78,
      combDamp: 58,
      crushPower: true,
      fmCrush: 32,
      xoverFreqHz: 120,
      subPunch: 72,
      subSolo: false,
      octave: 1,
      glideMs: 50,
      attackMs: 14,
      releaseMs: 180,
      basePitchSemitones: 0,
      latchMode: false,
      tonePower: true,
      toneDrive: 74,
      toneMode: 'ROAR',
      spacePower: true,
      spaceAmount: 54,
      hpFreq: 28,
      lpFreq: 14500,
      dryWet: 86,
      bypass: false,
    },
  },
  {
    name: 'Neuro Monster Growl',
    category: 'Growl',
    subtitle: 'Neuro Reese',
    defaultSample: 'reese-bass',
    speedEnv: [
      { x: 0, y: 0.42 },
      { x: 0.24, y: 0.78 },
      { x: 0.54, y: 0.3 },
      { x: 0.8, y: 0.66 },
      { x: 1, y: 0.44 },
    ],
    pitchEnv: [
      { x: 0, y: 0.38 },
      { x: 0.34, y: 0.78 },
      { x: 0.66, y: 0.44 },
      { x: 1, y: 0.5 },
    ],
    params: {
      inGainDb: 0.5,
      outGainDb: 1.0,
      oscPower: true,
      oscWave: 'SUPER',
      oscLevel: 72,
      oscDetune: 48,
      oscShape: 54,
      oscNoise: 18,
      oscRingMod: false,
      oscInterval: 0,
      grainPower: true,
      grainReverse: false,
      grainFreeze: false,
      baseSpeed: 1.0,
      grainSizeMs: 90,
      grainOverlapMs: 45,
      fmPower: true,
      fmSubOctave: true,
      fmUnison: true,
      fmGrowl: 78,
      fmRatio: 2.0,
      fmWobbleRate: 3.2,
      fmInflect: 58,
      wahPower: true,
      wahAmount: 72,
      wahBaseHz: 250,
      wahResonance: 60,
      wahMorph: 70,
      formantPower: true,
      fmVowel: 38,
      formantTalk: 70,
      notchEnable: true,
      notchDepth: 68,
      combPower: false,
      combKeyTrack: true,
      fmMetal: 0,
      combHarmonic: 4.0,
      combFeedbackAmt: 58,
      combDamp: 62,
      crushPower: false,
      fmCrush: 0,
      xoverFreqHz: 115,
      subPunch: 74,
      subSolo: false,
      octave: 1,
      glideMs: 45,
      attackMs: 14,
      decayMs: 340,
      sustain: 80,
      releaseMs: 175,
      synthAdsrFilterMod: true,
      synthLfoPower: true,
      synthLfoShape: 'TRI',
      synthLfoTarget: 'VOWEL',
      synthLfoRateHz: 2.2,
      synthLfoDepth: 46,
      synthLfoSync: false,
      basePitchSemitones: 0,
      latchMode: false,
      tonePower: true,
      toneDrive: 68,
      toneMode: 'ROAR',
      spacePower: true,
      spaceAmount: 52,
      hpFreq: 28,
      lpFreq: 13500,
      dryWet: 82,
      bypass: false,
    },
  },
  {
    name: 'Talking Yoi Bass',
    category: 'Growl',
    subtitle: 'Vocal Formant',
    defaultSample: 'sub-pulse',
    speedEnv: [
      { x: 0, y: 0.5 },
      { x: 0.35, y: 0.68 },
      { x: 0.7, y: 0.35 },
      { x: 1, y: 0.5 },
    ],
    pitchEnv: [
      { x: 0, y: 0.45 },
      { x: 0.25, y: 0.85 },
      { x: 0.55, y: 0.32 },
      { x: 0.82, y: 0.76 },
      { x: 1, y: 0.48 },
    ],
    params: {
      inGainDb: 0.0,
      outGainDb: 1.2,
      oscPower: true,
      oscWave: 'PULSE',
      oscLevel: 64,
      oscDetune: 26,
      oscShape: 42,
      oscNoise: 14,
      oscRingMod: false,
      oscInterval: -12,
      grainPower: false,
      grainReverse: false,
      grainFreeze: false,
      baseSpeed: 1.0,
      grainSizeMs: 110,
      grainOverlapMs: 50,
      fmPower: true,
      fmSubOctave: true,
      fmUnison: true,
      fmGrowl: 86,
      fmRatio: 1.5,
      fmWobbleRate: 4.5,
      fmInflect: 68,
      wahPower: true,
      wahAmount: 78,
      wahBaseHz: 260,
      wahResonance: 74,
      wahMorph: 86,
      formantPower: true,
      fmVowel: 52,
      formantTalk: 92,
      notchEnable: true,
      notchDepth: 62,
      combPower: false,
      combKeyTrack: true,
      fmMetal: 0,
      combHarmonic: 4.0,
      combFeedbackAmt: 58,
      combDamp: 64,
      crushPower: false,
      fmCrush: 0,
      xoverFreqHz: 110,
      subPunch: 74,
      subSolo: false,
      octave: 1,
      glideMs: 30,
      attackMs: 12,
      decayMs: 260,
      sustain: 74,
      releaseMs: 150,
      synthAdsrFilterMod: true,
      synthLfoPower: true,
      synthLfoShape: 'SINE',
      synthLfoTarget: 'VOWEL',
      synthLfoRateHz: 4.2,
      synthLfoDepth: 62,
      synthLfoSync: true,
      basePitchSemitones: 0,
      latchMode: false,
      tonePower: true,
      toneDrive: 64,
      toneMode: 'YOI',
      spacePower: true,
      spaceAmount: 46,
      hpFreq: 30,
      lpFreq: 15000,
      dryWet: 88,
      bypass: false,
    },
  },
  {
    name: 'Metallic Riddim Screech',
    category: 'Growl',
    subtitle: 'Metal Osc + 6x Comb',
    defaultSample: 'sub-pulse',
    speedEnv: [
      { x: 0, y: 0.22 },
      { x: 0.18, y: 0.9 },
      { x: 0.42, y: 0.2 },
      { x: 0.68, y: 0.86 },
      { x: 1, y: 0.28 },
    ],
    pitchEnv: [
      { x: 0, y: 0.36 },
      { x: 0.22, y: 0.84 },
      { x: 0.5, y: 0.38 },
      { x: 0.78, y: 0.8 },
      { x: 1, y: 0.44 },
    ],
    params: {
      inGainDb: 0.5,
      outGainDb: 1.0,
      oscPower: true,
      oscWave: 'METAL',
      oscLevel: 76,
      oscDetune: 24,
      oscShape: 68,
      oscNoise: 12,
      oscRingMod: false,
      oscInterval: 7,
      grainPower: false,
      grainReverse: false,
      grainFreeze: false,
      baseSpeed: 1.0,
      grainSizeMs: 80,
      grainOverlapMs: 35,
      fmPower: true,
      fmSubOctave: true,
      fmUnison: false,
      fmGrowl: 86,
      fmRatio: 4.0,
      fmWobbleRate: 2.2,
      fmInflect: 74,
      fmMetalAmt: 92,
      wahPower: true,
      wahAmount: 84,
      wahBaseHz: 290,
      wahResonance: 78,
      wahMorph: 82,
      formantPower: true,
      fmVowel: 68,
      formantTalk: 76,
      notchEnable: true,
      notchDepth: 70,
      combPower: true,
      combKeyTrack: true,
      fmMetal: 84,
      combHarmonic: 6.0,
      combFeedbackAmt: 82,
      combDamp: 78,
      crushPower: true,
      fmCrush: 34,
      xoverFreqHz: 120,
      subPunch: 75,
      subSolo: false,
      octave: 1,
      glideMs: 18,
      attackMs: 8,
      decayMs: 220,
      sustain: 64,
      releaseMs: 130,
      synthAdsrFilterMod: true,
      synthLfoPower: true,
      synthLfoShape: 'SQR',
      synthLfoTarget: 'GROWL',
      synthLfoRateHz: 3.6,
      synthLfoDepth: 56,
      synthLfoSync: true,
      basePitchSemitones: 0,
      latchMode: false,
      tonePower: true,
      toneDrive: 76,
      toneMode: 'SCREAM',
      spacePower: true,
      spaceAmount: 48,
      hpFreq: 28,
      lpFreq: 17500,
      dryWet: 88,
      bypass: false,
    },
  },
  {
    name: 'Chrome Riddim Clang',
    category: 'Growl',
    subtitle: 'Square-Chop Metal Bass',
    defaultSample: 'sub-pulse',
    speedEnv: [
      { x: 0, y: 0.18 },
      { x: 0.25, y: 0.92 },
      { x: 0.5, y: 0.16 },
      { x: 0.75, y: 0.9 },
      { x: 1, y: 0.22 },
    ],
    pitchEnv: [
      { x: 0, y: 0.44 },
      { x: 0.18, y: 0.78 },
      { x: 0.5, y: 0.46 },
      { x: 0.72, y: 0.74 },
      { x: 1, y: 0.48 },
    ],
    params: {
      ...INIT_SYNTH_PARAMS,
      inGainDb: 0.5,
      outGainDb: 0.9,
      oscPower: true,
      oscWave: 'METAL',
      oscLevel: 82,
      oscDetune: 18,
      oscShape: 76,
      oscNoise: 8,
      oscRingMod: true,
      oscInterval: 12,
      fmPower: true,
      fmSubOctave: true,
      fmUnison: false,
      fmGrowl: 82,
      fmRatio: 3.0,
      fmWobbleRate: 2.33,
      fmInflect: 62,
      fmMetalAmt: 88,
      wahPower: true,
      wahAmount: 78,
      wahBaseHz: 265,
      wahResonance: 82,
      wahMorph: 76,
      formantPower: true,
      fmVowel: 74,
      formantTalk: 68,
      notchEnable: true,
      notchDepth: 66,
      combPower: true,
      combKeyTrack: true,
      fmMetal: 78,
      combHarmonic: 4.0,
      combFeedbackAmt: 78,
      combDamp: 82,
      xoverFreqHz: 120,
      subPunch: 78,
      octave: 1,
      glideMs: 12,
      attackMs: 6,
      decayMs: 190,
      sustain: 54,
      releaseMs: 115,
      synthAdsrFilterMod: true,
      synthLfoPower: true,
      synthLfoShape: 'SAW',
      synthLfoTarget: 'FILTER',
      synthLfoRateHz: 4.66,
      synthLfoDepth: 62,
      synthLfoSync: true,
      tonePower: true,
      toneDrive: 74,
      toneMode: 'CLIP',
      ottPower: true,
      ottAmount: 64,
      ottMode: 'CRISP',
      spacePower: true,
      spaceAmount: 36,
      hpFreq: 28,
      lpFreq: 18000,
      dryWet: 90,
    },
  },
  {
    name: 'Guttural Throat Roar',
    category: 'Growl',
    subtitle: '0.5x Sub Roar',
    defaultSample: 'reese-bass',
    speedEnv: [
      { x: 0, y: 0.3 },
      { x: 0.36, y: 0.82 },
      { x: 0.72, y: 0.26 },
      { x: 1, y: 0.4 },
    ],
    pitchEnv: [
      { x: 0, y: 0.32 },
      { x: 0.4, y: 0.78 },
      { x: 0.78, y: 0.35 },
      { x: 1, y: 0.45 },
    ],
    params: {
      inGainDb: 0.5,
      outGainDb: 1.2,
      oscPower: true,
      oscWave: 'SUPER',
      oscLevel: 74,
      oscDetune: 38,
      oscShape: 56,
      oscNoise: 12,
      oscRingMod: false,
      oscInterval: -12,
      grainPower: true,
      grainReverse: false,
      grainFreeze: false,
      baseSpeed: 0.9,
      grainSizeMs: 105,
      grainOverlapMs: 50,
      fmPower: true,
      fmSubOctave: true,
      fmUnison: true,
      fmGrowl: 88,
      fmRatio: 0.5,
      fmWobbleRate: 1.9,
      fmInflect: 66,
      wahPower: true,
      wahAmount: 76,
      wahBaseHz: 195,
      wahResonance: 66,
      wahMorph: 72,
      formantPower: true,
      fmVowel: 26,
      formantTalk: 86,
      notchEnable: true,
      notchDepth: 74,
      combPower: false,
      combKeyTrack: true,
      fmMetal: 0,
      combHarmonic: 2.0,
      combFeedbackAmt: 62,
      combDamp: 52,
      crushPower: false,
      fmCrush: 0,
      xoverFreqHz: 125,
      subPunch: 84,
      subSolo: false,
      octave: 1,
      glideMs: 55,
      attackMs: 15,
      decayMs: 380,
      sustain: 82,
      releaseMs: 195,
      synthAdsrFilterMod: true,
      synthLfoPower: true,
      synthLfoShape: 'SAW',
      synthLfoTarget: 'GROWL',
      synthLfoRateHz: 1.6,
      synthLfoDepth: 44,
      synthLfoSync: true,
      basePitchSemitones: 0,
      latchMode: false,
      tonePower: true,
      toneDrive: 72,
      toneMode: 'ROAR',
      spacePower: true,
      spaceAmount: 50,
      hpFreq: 25,
      lpFreq: 13800,
      dryWet: 86,
      bypass: false,
    },
  },

  // =========================================================================
  // EXPERIMENTAL — Ring-Mod Sync, Granular Scratch & Bitcrushed Formants
  // =========================================================================
  {
    name: 'Hard-Sync Ring Screamer',
    category: 'Experimental',
    subtitle: 'RingMod + Sync',
    defaultSample: 'sub-pulse',
    speedEnv: [
      { x: 0, y: 0.52 },
      { x: 0.3, y: 0.84 },
      { x: 0.62, y: 0.24 },
      { x: 1, y: 0.55 },
    ],
    pitchEnv: [
      { x: 0, y: 0.44 },
      { x: 0.28, y: 0.88 },
      { x: 0.58, y: 0.36 },
      { x: 0.84, y: 0.78 },
      { x: 1, y: 0.48 },
    ],
    params: {
      inGainDb: 0.5,
      outGainDb: 0.8,
      oscPower: true,
      oscWave: 'SYNC',
      oscLevel: 88,
      oscDetune: 32,
      oscShape: 74,
      oscNoise: 28,
      oscRingMod: true,
      oscInterval: 7,
      grainPower: false,
      grainReverse: false,
      grainFreeze: false,
      baseSpeed: 1.1,
      grainSizeMs: 70,
      grainOverlapMs: 30,
      fmPower: true,
      fmSubOctave: true,
      fmUnison: false,
      fmGrowl: 84,
      fmRatio: 3.0,
      fmWobbleRate: 5.2,
      fmInflect: 78,
      fmMetalAmt: 78,
      wahPower: true,
      wahAmount: 76,
      wahBaseHz: 310,
      wahResonance: 72,
      wahMorph: 80,
      formantPower: true,
      fmVowel: 64,
      formantTalk: 82,
      notchEnable: true,
      notchDepth: 75,
      combPower: true,
      combKeyTrack: true,
      fmMetal: 62,
      combHarmonic: 6.0,
      combFeedbackAmt: 74,
      combDamp: 78,
      crushPower: true,
      fmCrush: 54,
      xoverFreqHz: 130,
      subPunch: 66,
      subSolo: false,
      octave: 1,
      glideMs: 25,
      attackMs: 10,
      releaseMs: 120,
      basePitchSemitones: 0,
      latchMode: false,
      tonePower: true,
      toneDrive: 78,
      toneMode: 'SCREAM',
      spacePower: true,
      spaceAmount: 56,
      hpFreq: 32,
      lpFreq: 16000,
      dryWet: 86,
      bypass: false,
    },
  },
  {
    name: 'Granular Scratch Hybrid',
    category: 'Experimental',
    subtitle: 'Reverse Breakbeat',
    defaultSample: 'perc-loop',
    speedEnv: [
      { x: 0, y: 0.58 },
      { x: 0.22, y: 0.88 },
      { x: 0.45, y: 0.14 },
      { x: 0.68, y: 0.74 },
      { x: 0.86, y: 0.22 },
      { x: 1, y: 0.52 },
    ],
    pitchEnv: [
      { x: 0, y: 0.5 },
      { x: 0.32, y: 0.72 },
      { x: 0.58, y: 0.34 },
      { x: 1, y: 0.5 },
    ],
    params: {
      inGainDb: 0.0,
      outGainDb: 1.0,
      oscPower: true,
      oscWave: 'SAW',
      oscLevel: 52,
      oscDetune: 40,
      oscShape: 50,
      oscNoise: 20,
      oscRingMod: false,
      oscInterval: 12,
      grainPower: true,
      grainReverse: true,
      grainFreeze: false,
      baseSpeed: 0.95,
      grainSizeMs: 75,
      grainOverlapMs: 35,
      fmPower: true,
      fmSubOctave: true,
      fmUnison: true,
      fmGrowl: 64,
      fmRatio: 0.5,
      fmWobbleRate: 3.6,
      fmInflect: 52,
      wahPower: true,
      wahAmount: 66,
      wahBaseHz: 240,
      wahResonance: 62,
      wahMorph: 74,
      formantPower: true,
      fmVowel: 44,
      formantTalk: 66,
      notchEnable: true,
      notchDepth: 55,
      combPower: true,
      combKeyTrack: true,
      fmMetal: 38,
      combHarmonic: 4.0,
      combFeedbackAmt: 60,
      combDamp: 65,
      crushPower: true,
      fmCrush: 36,
      xoverFreqHz: 115,
      subPunch: 68,
      subSolo: false,
      octave: 2,
      glideMs: 55,
      attackMs: 15,
      releaseMs: 180,
      basePitchSemitones: 0,
      latchMode: false,
      tonePower: true,
      toneDrive: 62,
      toneMode: 'CLIP',
      spacePower: true,
      spaceAmount: 65,
      hpFreq: 36,
      lpFreq: 12800,
      dryWet: 80,
      bypass: false,
    },
  },
  {
    name: 'Frozen Stabs Glitch',
    category: 'Experimental',
    subtitle: 'Chord Grain Glitch',
    defaultSample: 'chord-stabs',
    speedEnv: [
      { x: 0, y: 0.16 },
      { x: 0.25, y: 0.88 },
      { x: 0.5, y: 0.18 },
      { x: 0.75, y: 0.82 },
      { x: 1, y: 0.24 },
    ],
    pitchEnv: [
      { x: 0, y: 0.5 },
      { x: 0.25, y: 0.78 },
      { x: 0.5, y: 0.5 },
      { x: 0.75, y: 0.28 },
      { x: 1, y: 0.5 },
    ],
    params: {
      inGainDb: 0.0,
      outGainDb: 0.9,
      oscPower: true,
      oscWave: 'PULSE',
      oscLevel: 54,
      oscDetune: 34,
      oscShape: 28,
      oscNoise: 12,
      oscRingMod: true,
      oscInterval: 12,
      grainPower: true,
      grainReverse: false,
      grainFreeze: false,
      baseSpeed: 1.35,
      grainSizeMs: 45,
      grainOverlapMs: 20,
      fmPower: true,
      fmSubOctave: true,
      fmUnison: false,
      fmGrowl: 58,
      fmRatio: 3.0,
      fmWobbleRate: 6.4,
      fmInflect: 60,
      fmMetalAmt: 58,
      wahPower: true,
      wahAmount: 62,
      wahBaseHz: 320,
      wahResonance: 68,
      wahMorph: 76,
      formantPower: true,
      fmVowel: 70,
      formantTalk: 68,
      notchEnable: true,
      notchDepth: 58,
      combPower: true,
      combKeyTrack: true,
      fmMetal: 66,
      combHarmonic: 8.0,
      combFeedbackAmt: 76,
      combDamp: 72,
      crushPower: true,
      fmCrush: 62,
      xoverFreqHz: 110,
      subPunch: 62,
      subSolo: false,
      octave: 2,
      glideMs: 15,
      attackMs: 8,
      releaseMs: 210,
      basePitchSemitones: 0,
      latchMode: false,
      tonePower: true,
      toneDrive: 54,
      toneMode: 'TEAROUT',
      spacePower: true,
      spaceAmount: 72,
      hpFreq: 34,
      lpFreq: 16500,
      dryWet: 84,
      bypass: false,
    },
  },
  {
    name: '4-Bit Cybernetic Talker',
    category: 'Experimental',
    subtitle: 'Staircase Formant',
    defaultSample: 'sub-pulse',
    speedEnv: [
      { x: 0, y: 0.25 },
      { x: 0.34, y: 0.86 },
      { x: 0.66, y: 0.3 },
      { x: 1, y: 0.62 },
    ],
    pitchEnv: [
      { x: 0, y: 0.4 },
      { x: 0.2, y: 0.88 },
      { x: 0.48, y: 0.26 },
      { x: 0.76, y: 0.84 },
      { x: 1, y: 0.48 },
    ],
    params: {
      inGainDb: 0.5,
      outGainDb: 1.0,
      oscPower: true,
      oscWave: 'SAW',
      oscLevel: 72,
      oscDetune: 20,
      oscShape: 64,
      oscNoise: 16,
      oscRingMod: false,
      oscInterval: 0,
      grainPower: false,
      grainReverse: false,
      grainFreeze: false,
      baseSpeed: 1.0,
      grainSizeMs: 80,
      grainOverlapMs: 35,
      fmPower: true,
      fmSubOctave: true,
      fmUnison: false,
      fmGrowl: 78,
      fmRatio: 6.0,
      fmWobbleRate: 4.8,
      fmInflect: 82,
      fmMetalAmt: 66,
      wahPower: true,
      wahAmount: 74,
      wahBaseHz: 270,
      wahResonance: 74,
      wahMorph: 84,
      formantPower: true,
      fmVowel: 82,
      formantTalk: 88,
      notchEnable: true,
      notchDepth: 66,
      combPower: true,
      combKeyTrack: true,
      fmMetal: 54,
      combHarmonic: 4.0,
      combFeedbackAmt: 68,
      combDamp: 70,
      crushPower: true,
      fmCrush: 78,
      xoverFreqHz: 110,
      subPunch: 76,
      subSolo: false,
      octave: 1,
      glideMs: 20,
      attackMs: 10,
      releaseMs: 135,
      basePitchSemitones: 0,
      latchMode: false,
      tonePower: true,
      toneDrive: 66,
      toneMode: 'CLIP',
      spacePower: true,
      spaceAmount: 44,
      hpFreq: 28,
      lpFreq: 15200,
      dryWet: 88,
      bypass: false,
    },
  },
  {
    name: 'Dispersed Laser Tearout',
    category: 'Growl',
    subtitle: '16x All-Pass Zap',
    defaultSample: 'reese-bass',
    speedEnv: [
      { x: 0, y: 0.25 },
      { x: 0.22, y: 0.88 },
      { x: 0.5, y: 0.2 },
      { x: 0.78, y: 0.82 },
      { x: 1, y: 0.34 },
    ],
    pitchEnv: [
      { x: 0, y: 0.38 },
      { x: 0.24, y: 0.9 },
      { x: 0.54, y: 0.28 },
      { x: 0.82, y: 0.78 },
      { x: 1, y: 0.44 },
    ],
    params: {
      ...INIT_SYNTH_PARAMS,
      inGainDb: 0.5,
      outGainDb: 1.0,
      oscPower: true,
      oscWave: 'SUPER',
      oscLevel: 76,
      oscDetune: 34,
      oscShape: 60,
      oscNoise: 12,
      fmPower: true,
      fmSubOctave: true,
      fmUnison: true,
      fmGrowl: 86,
      fmRatio: 2.0,
      fmWobbleRate: 3.8,
      fmInflect: 74,
      wahPower: true,
      wahAmount: 76,
      wahBaseHz: 235,
      wahResonance: 72,
      wahMorph: 82,
      formantPower: true,
      fmVowel: 48,
      formantTalk: 78,
      notchEnable: true,
      notchDepth: 66,
      xoverFreqHz: 115,
      subPunch: 78,
      octave: 1,
      glideMs: 25,
      attackMs: 8,
      releaseMs: 150,
      tonePower: true,
      toneDrive: 76,
      toneMode: 'TEAROUT',
      spacePower: true,
      spaceAmount: 42,
      disperserPower: true,
      disperserAmount: 88,
      disperserFreqHz: 265,
      disperserPinch: 78,
      disperserSweep: 82,
      thumpPower: true,
      thumpAmount: 68,
      thumpMode: 'PUNCH',
      ottPower: true,
      ottAmount: 64,
      ottMode: 'SLAM',
      hpFreq: 24,
      lpFreq: 17000,
      dryWet: 90,
    },
  },
  {
    name: 'Alien Bode Barberpole',
    category: 'Growl',
    subtitle: 'SSB Shifter + Reese',
    defaultSample: 'reese-bass',
    speedEnv: [
      { x: 0, y: 0.36 },
      { x: 0.34, y: 0.78 },
      { x: 0.68, y: 0.28 },
      { x: 1, y: 0.46 },
    ],
    pitchEnv: [
      { x: 0, y: 0.42 },
      { x: 0.3, y: 0.76 },
      { x: 0.66, y: 0.36 },
      { x: 1, y: 0.5 },
    ],
    params: {
      ...INIT_SYNTH_PARAMS,
      inGainDb: 0.5,
      outGainDb: 1.0,
      oscPower: true,
      oscWave: 'SUPER',
      oscLevel: 78,
      oscDetune: 48,
      oscShape: 54,
      fmPower: true,
      fmSubOctave: true,
      fmUnison: true,
      fmGrowl: 78,
      fmRatio: 1.5,
      fmWobbleRate: 2.2,
      fmInflect: 56,
      formantPower: true,
      fmVowel: 38,
      formantTalk: 72,
      xoverFreqHz: 120,
      subPunch: 74,
      octave: 1,
      glideMs: 45,
      attackMs: 12,
      releaseMs: 185,
      tonePower: true,
      toneDrive: 68,
      toneMode: 'ROAR',
      freqShiftPower: true,
      freqShiftHz: 95,
      freqShiftMix: 72,
      freqShiftFeedback: 58,
      freqShiftBarber: true,
      reesePower: true,
      reeseDepth: 84,
      reeseSweep: 62,
      haasPower: true,
      haasWidth: 54,
      haasDelayMs: 9.0,
      haasDetune: 42,
      ottPower: true,
      ottAmount: 55,
      ottMode: 'UPWARD',
      hpFreq: 26,
      lpFreq: 16200,
      dryWet: 90,
    },
  },
  {
    name: 'Wide Haas OTT Monster',
    category: 'Growl',
    subtitle: 'Haas Width + 3-Band OTT',
    defaultSample: 'sub-pulse',
    speedEnv: [
      { x: 0, y: 0.3 },
      { x: 0.28, y: 0.86 },
      { x: 0.58, y: 0.24 },
      { x: 0.84, y: 0.78 },
      { x: 1, y: 0.4 },
    ],
    pitchEnv: [
      { x: 0, y: 0.34 },
      { x: 0.26, y: 0.84 },
      { x: 0.6, y: 0.34 },
      { x: 1, y: 0.48 },
    ],
    params: {
      ...INIT_SYNTH_PARAMS,
      inGainDb: 0.5,
      outGainDb: 0.8,
      oscPower: true,
      oscWave: 'SYNC',
      oscLevel: 76,
      oscDetune: 36,
      oscShape: 66,
      oscNoise: 14,
      fmPower: true,
      fmSubOctave: true,
      fmUnison: true,
      fmGrowl: 92,
      fmRatio: 2.0,
      fmWobbleRate: 3.5,
      fmInflect: 70,
      wahPower: true,
      wahAmount: 84,
      wahBaseHz: 245,
      wahResonance: 70,
      wahMorph: 80,
      formantPower: true,
      fmVowel: 46,
      formantTalk: 82,
      combPower: false,
      combKeyTrack: true,
      fmMetal: 0,
      combHarmonic: 4.0,
      combFeedbackAmt: 64,
      combDamp: 66,
      xoverFreqHz: 115,
      subPunch: 82,
      octave: 1,
      glideMs: 30,
      attackMs: 10,
      decayMs: 300,
      sustain: 78,
      releaseMs: 165,
      synthAdsrFilterMod: true,
      synthLfoPower: true,
      synthLfoShape: 'SINE',
      synthLfoTarget: 'GROWL',
      synthLfoRateHz: 2.8,
      synthLfoDepth: 50,
      synthLfoSync: true,
      tonePower: true,
      toneDrive: 80,
      toneMode: 'TEAROUT',
      haasPower: true,
      haasWidth: 78,
      haasDelayMs: 11.5,
      haasDetune: 48,
      haasMonoCheck: false,
      thumpPower: true,
      thumpAmount: 76,
      thumpMode: '808',
      ottPower: true,
      ottAmount: 82,
      ottMode: 'SLAM',
      hpFreq: 24,
      lpFreq: 17500,
      dryWet: 92,
    },
  },
  {
    name: 'Turntable Scratch & Vocode',
    category: 'Experimental',
    subtitle: 'Vinyl Scrub + 8-Band Gate',
    defaultSample: 'perc-loop',
    speedEnv: [
      { x: 0, y: 0.82 },
      { x: 0.18, y: 0.14 },
      { x: 0.38, y: 0.88 },
      { x: 0.56, y: 0.18 },
      { x: 0.78, y: 0.84 },
      { x: 1, y: 0.26 },
    ],
    pitchEnv: [
      { x: 0, y: 0.45 },
      { x: 0.25, y: 0.82 },
      { x: 0.52, y: 0.28 },
      { x: 0.8, y: 0.78 },
      { x: 1, y: 0.48 },
    ],
    params: {
      ...INIT_SYNTH_PARAMS,
      inGainDb: 0.5,
      outGainDb: 1.0,
      oscPower: true,
      oscWave: 'SAW',
      oscLevel: 72,
      oscDetune: 28,
      oscShape: 56,
      grainPower: true,
      baseSpeed: 1.05,
      grainSizeMs: 70,
      grainOverlapMs: 30,
      fmPower: true,
      fmSubOctave: true,
      fmUnison: false,
      fmGrowl: 74,
      fmRatio: 3.0,
      fmWobbleRate: 4.2,
      fmInflect: 68,
      xoverFreqHz: 115,
      subPunch: 72,
      octave: 1,
      glideMs: 20,
      attackMs: 10,
      releaseMs: 150,
      curveSpeed: 1.6,
      tonePower: true,
      toneDrive: 62,
      toneMode: 'YOI',
      scratchPower: true,
      scratchAmount: 76,
      vinylBrake: false,
      spectralPower: true,
      spectralMix: 78,
      spectralThresh: 44,
      spectralReso: 68,
      ottPower: true,
      ottAmount: 62,
      ottMode: 'CRISP',
      hpFreq: 26,
      lpFreq: 16800,
      dryWet: 90,
    },
  },
  // =========================================================================
  // KICK — Dry TR-909, Rotterdam Gabber, Industrial Techno, Uptempo & Krach
  // =========================================================================
  {
    name: 'Dry TR-909 Studio Kick',
    category: 'Kick',
    subtitle: 'Clean Analog 909 · Ready to Distort',
    defaultSample: '909-drum',
    speedEnv: [
      { x: 0, y: 0.5 },
      { x: 0.5, y: 0.5 },
      { x: 1, y: 0.5 },
    ],
    pitchEnv: [
      { x: 0, y: 0.5 },
      { x: 0.5, y: 0.5 },
      { x: 1, y: 0.5 },
    ],
    params: {
      ...INIT_SYNTH_PARAMS,
      inGainDb: 0.0,
      outGainDb: 0.8,
      kickMode: true,
      kickPower: true,
      kickTailType: '909',
      kickPunch: 74,
      kickFmRatio: 1.0,
      kickTok: 54,
      kickTokBoost: false,
      kickSweepMs: 40,
      kickAttackMs: 1.0,
      kickDecayMs: 270,
      kickSustain: 46,
      kickReleaseMs: 190,
      kickKrachPower: false,
      kickClipMode: 'GABBER',
      kickDrive: 48,
      kickEqFreqHz: 240,
      kickEqGain: 52,
      kickEqSweep: false,
      kickLfoPower: false,
      kickRumblePower: false,
      kickLoop: true,
      kickBpm: 168,
      xoverFreqHz: 110,
      subPunch: 72,
      octave: 1,
      tonePower: false,
      toneDrive: 0,
      toneMode: 'TUBE',
      hpFreq: 22,
      lpFreq: 19500,
      dryWet: 100,
    },
  },
  {
    name: 'Rotterdam 909 Gabber',
    category: 'Kick',
    subtitle: '909 -> Mackie CR-1604 Gabber',
    defaultSample: '909-drum',
    speedEnv: [
      { x: 0, y: 0.66 },
      { x: 0.3, y: 0.54 },
      { x: 0.72, y: 0.46 },
      { x: 1, y: 0.44 },
    ],
    pitchEnv: [
      { x: 0, y: 0.56 },
      { x: 0.35, y: 0.5 },
      { x: 1, y: 0.48 },
    ],
    params: {
      ...INIT_SYNTH_PARAMS,
      inGainDb: 0.0,
      outGainDb: 0.8,
      kickMode: true,
      kickPower: true,
      kickTailType: '909',
      kickPunch: 80,
      kickFmRatio: 1.5,
      kickTok: 62,
      kickTokBoost: false,
      kickSweepMs: 44,
      kickAttackMs: 1.2,
      kickDecayMs: 310,
      kickSustain: 72,
      kickReleaseMs: 230,
      kickKrachPower: true,
      kickClipMode: 'GABBER',
      kickDrive: 56,
      kickEqFreqHz: 240,
      kickEqGain: 58,
      kickEqSweep: false,
      kickLfoPower: false,
      kickRumblePower: false,
      kickLoop: true,
      kickBpm: 175,
      xoverFreqHz: 110,
      subPunch: 76,
      octave: 1,
      tonePower: false,
      toneDrive: 28,
      toneMode: 'TUBE',
      hpFreq: 24,
      lpFreq: 18200,
      dryWet: 100,
      fxChain: [
        {
          id: 'gabber-909-dist',
          type: 'distort',
          enabled: true,
          mix: 84,
          distMode: 'GABBER',
          distDrive: 44,
          distToneHz: 7800,
          distPunch: 64,
          distTightCut: false,
        },
        {
          id: 'gabber-909-sat',
          type: 'saturator',
          enabled: true,
          mix: 72,
          satMode: 'TAPE',
          satDrive: 32,
          satTone: 6,
          satPunch: 48,
        },
      ],
    },
  },
  {
    name: 'Berlin Bunker Rumble 142',
    category: 'Kick',
    subtitle: 'Industrial Techno SC',
    defaultSample: 'sub-pulse',
    speedEnv: [
      { x: 0, y: 0.72 },
      { x: 0.34, y: 0.38 },
      { x: 0.72, y: 0.54 },
      { x: 1, y: 0.44 },
    ],
    pitchEnv: [
      { x: 0, y: 0.64 },
      { x: 0.32, y: 0.42 },
      { x: 0.75, y: 0.52 },
      { x: 1, y: 0.48 },
    ],
    params: {
      ...INIT_SYNTH_PARAMS,
      inGainDb: 0.5,
      outGainDb: 1.2,
      kickMode: true,
      kickPower: true,
      kickTailType: 'SUB',
      kickPunch: 78,
      kickFmRatio: 1.5,
      kickTok: 62,
      kickTokBoost: false,
      kickSweepMs: 46,
      kickAttackMs: 1.5,
      kickDecayMs: 190,
      kickSustain: 34,
      kickReleaseMs: 160,
      kickKrachPower: true,
      kickClipMode: 'BOILER',
      kickDrive: 36,
      kickEqFreqHz: 280,
      kickEqGain: 38,
      kickEqSweep: false,
      kickLfoPower: false,
      kickRumblePower: true,
      kickLoop: true,
      kickBpm: 142,
      kickRumbleAmt: 86,
      kickDuck: 84,
      kickRumbleLpHz: 260,
      kickRumbleGroove: true,
      xoverFreqHz: 115,
      subPunch: 80,
      octave: 1,
      tonePower: true,
      toneDrive: 42,
      toneMode: 'TUBE',
      hpFreq: 24,
      lpFreq: 16500,
      dryWet: 96,
    },
  },
  {
    name: 'Deutscher Krach Microwave',
    category: 'Kick',
    subtitle: 'Noiseflow Boiler Wall',
    defaultSample: 'reese-bass',
    speedEnv: [
      { x: 0, y: 0.48 },
      { x: 0.28, y: 0.88 },
      { x: 0.62, y: 0.22 },
      { x: 0.86, y: 0.76 },
      { x: 1, y: 0.46 },
    ],
    pitchEnv: [
      { x: 0, y: 0.36 },
      { x: 0.26, y: 0.88 },
      { x: 0.58, y: 0.24 },
      { x: 0.84, y: 0.82 },
      { x: 1, y: 0.44 },
    ],
    params: {
      ...INIT_SYNTH_PARAMS,
      inGainDb: 0.5,
      outGainDb: 1.0,
      kickMode: true,
      kickPower: true,
      kickTailType: 'KRACH',
      kickPunch: 88,
      kickFmRatio: 2.75,
      kickTok: 50,
      kickTokBoost: false,
      kickSweepMs: 38,
      kickAttackMs: 1.8,
      kickDecayMs: 320,
      kickSustain: 86,
      kickReleaseMs: 290,
      kickKrachPower: true,
      kickClipMode: 'BOILER',
      kickDrive: 94,
      kickEqFreqHz: 1180,
      kickEqGain: 88,
      kickEqSweep: true,
      kickLfoPower: true,
      kickLfoShape: 'SINE',
      kickLfoTarget: 'HUNT',
      kickLfoRateHz: 2.8,
      kickLfoDepth: 62,
      kickLfoSync: false,
      kickRumblePower: false,
      kickLoop: true,
      kickBpm: 175,
      kickRumbleAmt: 42,
      kickDuck: 80,
      kickRumbleLpHz: 280,
      kickRumbleGroove: false,
      xoverFreqHz: 105,
      subPunch: 82,
      octave: 1,
      curveSpeed: 1.4,
      tonePower: true,
      toneDrive: 68,
      toneMode: 'TEAROUT',
      ottPower: true,
      ottAmount: 48,
      ottMode: 'SLAM',
      hpFreq: 26,
      lpFreq: 17800,
      dryWet: 96,
    },
  },
  {
    name: 'Uptempo Piep Squeaker 205',
    category: 'Kick',
    subtitle: '2.4kHz Hard-Clip Piep',
    defaultSample: 'sub-pulse',
    speedEnv: [
      { x: 0, y: 0.65 },
      { x: 0.45, y: 0.52 },
      { x: 1, y: 0.5 },
    ],
    pitchEnv: [
      { x: 0, y: 0.62 },
      { x: 0.35, y: 0.54 },
      { x: 1, y: 0.5 },
    ],
    params: {
      ...INIT_SYNTH_PARAMS,
      inGainDb: 0.5,
      outGainDb: 1.0,
      kickMode: true,
      kickPower: true,
      kickTailType: 'PIEP',
      kickPunch: 92,
      kickFmRatio: 3.5,
      kickTok: 86,
      kickTokBoost: true,
      kickSweepMs: 30,
      kickAttackMs: 1.0,
      kickDecayMs: 210,
      kickSustain: 76,
      kickReleaseMs: 165,
      kickKrachPower: true,
      kickClipMode: 'GCLIP',
      kickDrive: 96,
      kickEqFreqHz: 2380,
      kickEqGain: 92,
      kickEqSweep: false,
      kickLfoPower: false,
      kickRumblePower: false,
      kickLoop: true,
      kickBpm: 205,
      kickRumbleAmt: 35,
      kickDuck: 82,
      kickRumbleLpHz: 260,
      kickRumbleGroove: false,
      xoverFreqHz: 110,
      subPunch: 78,
      octave: 1,
      tonePower: true,
      toneDrive: 64,
      toneMode: 'CLIP',
      ottPower: true,
      ottAmount: 58,
      ottMode: 'CRISP',
      hpFreq: 28,
      lpFreq: 18500,
      dryWet: 96,
    },
  },
  {
    name: 'Raw Chainsaw Zaagkick',
    category: 'Kick',
    subtitle: 'Swept Pre-EQ Zaag',
    defaultSample: 'reese-bass',
    speedEnv: [
      { x: 0, y: 0.42 },
      { x: 0.32, y: 0.84 },
      { x: 0.68, y: 0.28 },
      { x: 1, y: 0.52 },
    ],
    pitchEnv: [
      { x: 0, y: 0.38 },
      { x: 0.3, y: 0.86 },
      { x: 0.66, y: 0.32 },
      { x: 1, y: 0.54 },
    ],
    params: {
      ...INIT_SYNTH_PARAMS,
      inGainDb: 0.5,
      outGainDb: 1.0,
      kickMode: true,
      kickPower: true,
      kickTailType: 'ZAAG',
      kickPhaseMode: 'HARD',
      kickPhaseDeg: 0,
      kickPunch: 85,
      kickFmRatio: 2.0,
      kickTok: 76,
      kickTokBoost: true,
      kickSweepMs: 40,
      kickAttackMs: 1.4,
      kickDecayMs: 260,
      kickSustain: 82,
      kickReleaseMs: 220,
      kickKrachPower: true,
      kickClipMode: 'ZAAG',
      kickDrive: 90,
      kickEqFreqHz: 960,
      kickEqGain: 82,
      kickEqSweep: true,
      kickLfoPower: true,
      kickLfoShape: 'SAW',
      kickLfoTarget: 'FM',
      kickLfoRateHz: 5.5,
      kickLfoDepth: 54,
      kickLfoSync: true,
      kickRumblePower: false,
      kickLoop: true,
      kickBpm: 198,
      kickRumbleAmt: 40,
      kickDuck: 80,
      kickRumbleLpHz: 290,
      kickRumbleGroove: false,
      xoverFreqHz: 110,
      subPunch: 82,
      octave: 1,
      disperserPower: true,
      disperserAmount: 54,
      disperserFreqHz: 310,
      disperserPinch: 68,
      disperserSweep: 58,
      tonePower: true,
      toneDrive: 70,
      toneMode: 'ROAR',
      hpFreq: 26,
      lpFreq: 18000,
      dryWet: 96,
    },
  },
  {
    name: 'Schranz & Hardtekk Slammer',
    category: 'Kick',
    subtitle: 'Overdriven Boxy Tok',
    defaultSample: 'perc-loop',
    speedEnv: [
      { x: 0, y: 0.76 },
      { x: 0.25, y: 0.36 },
      { x: 0.58, y: 0.72 },
      { x: 1, y: 0.42 },
    ],
    pitchEnv: [
      { x: 0, y: 0.68 },
      { x: 0.4, y: 0.44 },
      { x: 1, y: 0.5 },
    ],
    params: {
      ...INIT_SYNTH_PARAMS,
      inGainDb: 0.5,
      outGainDb: 1.2,
      kickMode: true,
      kickPower: true,
      kickTailType: 'SAW',
      kickPhaseMode: 'HARD',
      kickPhaseDeg: 0,
      kickPunch: 82,
      kickFmRatio: 1.75,
      kickTok: 82,
      kickTokBoost: true,
      kickSweepMs: 48,
      kickAttackMs: 1.2,
      kickDecayMs: 220,
      kickSustain: 52,
      kickReleaseMs: 180,
      kickKrachPower: true,
      kickClipMode: 'FOLD',
      kickDrive: 82,
      kickEqFreqHz: 460,
      kickEqGain: 74,
      kickEqSweep: false,
      kickLfoPower: true,
      kickLfoShape: 'SQR',
      kickLfoTarget: 'AMP',
      kickLfoRateHz: 10.8,
      kickLfoDepth: 36,
      kickLfoSync: true,
      kickRumblePower: true,
      kickLoop: true,
      kickBpm: 162,
      kickRumbleAmt: 60,
      kickDuck: 78,
      kickRumbleLpHz: 360,
      kickRumbleGroove: false,
      xoverFreqHz: 115,
      subPunch: 80,
      octave: 1,
      tonePower: true,
      toneDrive: 58,
      toneMode: 'SCREAM',
      hpFreq: 26,
      lpFreq: 17000,
      dryWet: 95,
    },
  },
];

const USER_PRESETS_STORAGE_KEY = 'junoscratch_user_presets_v1';
const CUSTOM_CATEGORIES_STORAGE_KEY = 'junoscratch_custom_categories_v1';
const MIDI_BINDINGS_STORAGE_KEY = 'junoscratch_midi_cc_map_v1';

const DEFAULT_CUSTOM_CATEGORIES: string[] = ['Industrial', 'Techno'];

function resolveCanonicalCategoryName(
  raw: string,
  existingCustom: string[]
): PresetCategory | null {
  const cleaned = raw.trim().replace(/\s+/g, ' ').slice(0, 24);
  if (!cleaned) return null;
  const lower = cleaned.toLowerCase();
  const builtInMatch = BUILTIN_PRESET_CATEGORIES.find((c) => c.toLowerCase() === lower);
  if (builtInMatch) return builtInMatch;
  const customMatch = existingCustom.find((c) => c.toLowerCase() === lower);
  if (customMatch) return customMatch;
  return cleaned;
}

const DEFAULT_USER_PRESETS: SynthPreset[] = [
  {
    name: 'Studio Clean Sub Template',
    category: 'User',
    subtitle: 'Growl-Ready Starter',
    isUser: true,
    defaultSample: 'reese-bass',
    speedEnv: [
      { x: 0, y: 0.36 },
      { x: 0.28, y: 0.82 },
      { x: 0.58, y: 0.26 },
      { x: 0.84, y: 0.74 },
      { x: 1, y: 0.44 },
    ],
    pitchEnv: [
      { x: 0, y: 0.46 },
      { x: 0.34, y: 0.68 },
      { x: 0.7, y: 0.4 },
      { x: 1, y: 0.5 },
    ],
    params: {
      ...INIT_SYNTH_PARAMS,
      outGainDb: 0.6,
      oscPower: true,
      oscWave: 'SUPER',
      oscLevel: 76,
      oscDetune: 20,
      oscShape: 50,
      fmPower: true,
      fmSubOctave: true,
      fmUnison: true,
      fmGrowl: 0,
      fmRatio: 2.0,
      fmWobbleRate: 3.2,
      fmInflect: 60,
      wahPower: true,
      wahAmount: 0,
      wahBaseHz: 235,
      wahResonance: 66,
      wahMorph: 78,
      formantPower: true,
      fmVowel: 45,
      formantTalk: 0,
      notchEnable: true,
      notchDepth: 64,
      combPower: false,
      combKeyTrack: true,
      fmMetal: 0,
      combHarmonic: 4.0,
      combFeedbackAmt: 58,
      combDamp: 64,
      crushPower: false,
      fmCrush: 0,
      xoverFreqHz: 115,
      subPunch: 68,
      octave: 1,
      glideMs: 30,
      attackMs: 12,
      decayMs: 320,
      sustain: 84,
      releaseMs: 165,
      synthAdsrFilterMod: true,
      tonePower: false,
      toneDrive: 0,
      toneMode: 'TEAROUT',
      spacePower: true,
      spaceAmount: 22,
      hpFreq: 24,
      lpFreq: 17500,
      dryWet: 92,
    },
  },
  {
    name: 'Warehouse Concrete Stomp',
    category: 'Industrial',
    subtitle: 'Kick · KRACH BOILER · 155 BPM',
    isUser: true,
    defaultSample: 'sub-pulse',
    speedEnv: [
      { x: 0, y: 0.5 },
      { x: 0.5, y: 0.5 },
      { x: 1, y: 0.5 },
    ],
    pitchEnv: [
      { x: 0, y: 0.5 },
      { x: 0.5, y: 0.5 },
      { x: 1, y: 0.5 },
    ],
    params: {
      ...INIT_SYNTH_PARAMS,
      inGainDb: 0.5,
      outGainDb: 1.0,
      kickMode: true,
      kickPower: true,
      kickTailType: 'KRACH',
      kickPunch: 88,
      kickFmRatio: 2.0,
      kickTok: 72,
      kickTokBoost: true,
      kickSweepMs: 42,
      kickAttackMs: 1.5,
      kickDecayMs: 390,
      kickSustain: 64,
      kickReleaseMs: 260,
      kickKrachPower: true,
      kickClipMode: 'BOILER',
      kickDrive: 82,
      kickEqFreqHz: 1180,
      kickEqGain: 78,
      kickEqSweep: true,
      kickRumblePower: true,
      kickLoop: true,
      kickBpm: 155,
      kickRumbleAmt: 76,
      kickDuck: 82,
      kickRumbleLpHz: 240,
      kickRumbleGroove: true,
      xoverFreqHz: 110,
      subPunch: 84,
      octave: 1,
      tonePower: true,
      toneDrive: 52,
      toneMode: 'TUBE',
      hpFreq: 24,
      lpFreq: 18500,
      dryWet: 98,
    },
  },
  {
    name: 'Berghain Hypnotic Polyrhythm',
    category: 'Techno',
    subtitle: 'SAW · ACID · Modular Drive',
    isUser: true,
    defaultSample: 'sub-pulse',
    speedEnv: [
      { x: 0, y: 0.28 },
      { x: 0.25, y: 0.78 },
      { x: 0.5, y: 0.34 },
      { x: 0.75, y: 0.86 },
      { x: 1, y: 0.32 },
    ],
    pitchEnv: [
      { x: 0, y: 0.5 },
      { x: 0.25, y: 0.62 },
      { x: 0.5, y: 0.5 },
      { x: 0.75, y: 0.38 },
      { x: 1, y: 0.5 },
    ],
    params: {
      ...INIT_SYNTH_PARAMS,
      outGainDb: 0.8,
      oscPower: true,
      oscWave: 'SAW',
      oscLevel: 84,
      oscDetune: 26,
      oscShape: 62,
      fmPower: true,
      fmSubOctave: true,
      fmUnison: true,
      fmGrowl: 54,
      fmRatio: 2.0,
      fmWobbleRate: 6.0,
      fmInflect: 68,
      wahPower: true,
      wahAmount: 64,
      wahBaseHz: 260,
      wahResonance: 74,
      wahMorph: 72,
      xoverFreqHz: 120,
      subPunch: 72,
      octave: 1,
      glideMs: 22,
      attackMs: 6,
      releaseMs: 180,
      tonePower: true,
      toneDrive: 48,
      toneMode: 'TUBE',
      spacePower: true,
      spaceAmount: 28,
      hpFreq: 26,
      lpFreq: 16800,
      dryWet: 94,
    },
  },
];

const INITIAL_FACTORY_PRESET_INDEX = Math.max(
  0,
  SYNTH_PRESETS.findIndex((p) => p.name === 'Lunacy Nova Tearout')
);

function randBetween(min: number, max: number, step = 1): number {
  const raw = min + Math.random() * (max - min);
  const snapped = Math.round(raw / step) * step;
  const decimals = step < 0.05 ? 2 : step < 1 ? 1 : 0;
  return Number(Math.max(min, Math.min(max, snapped)).toFixed(decimals));
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateRandomEnvelope(minNodes = 3, maxNodes = 7): Point[] {
  const count = Math.floor(randBetween(minNodes, maxNodes, 1));
  const interiorCount = Math.max(1, count - 2);
  const xs: number[] = [];

  for (let i = 1; i <= interiorCount; i++) {
    const basePos = i / (interiorCount + 1);
    const jitter = (Math.random() - 0.5) * (0.55 / (interiorCount + 1));
    xs.push(Number(Math.max(0.06, Math.min(0.94, basePos + jitter)).toFixed(2)));
  }
  xs.sort((a, b) => a - b);

  const pts: Point[] = [{ x: 0, y: randBetween(0.18, 0.82, 0.02) }];
  for (const x of xs) {
    pts.push({ x, y: randBetween(0.1, 0.92, 0.02) });
  }
  pts.push({ x: 1, y: randBetween(0.2, 0.8, 0.02) });
  return pts;
}

/**
 * Dual-Function Hardware Rack Tab + Engine Rocker Switch:
 * - Navigates to Tab 1 ('voices') when clicked from another tab.
 * - Flips between 'Synth & Master' and 'Kick & Master' when clicked while on Tab 1
 *   OR when clicking the recessed SYN / KICK rocker badge directly from any tab.
 */
function VoicesKickTabSwitch({
  isActiveTab,
  kickMode,
  onSelectVoicesTab,
  onToggleKickMode,
}: {
  isActiveTab: boolean;
  kickMode: boolean;
  onSelectVoicesTab: () => void;
  onToggleKickMode: () => void;
}) {
  const midi = useMidiLearnTarget('kickMode', 'Synth / Kick Engine Switch');

  return (
    <div
      onContextMenu={midi.handleContextMenu}
      className={`relative inline-flex items-center rounded-lg transition-colors select-none shrink-0 ${
        isActiveTab
          ? 'dsp-button-cap text-white shadow-sm'
          : 'text-[#848C9E] hover:text-[#D5DBE8]'
      } ${
        midi.enabled
          ? 'ring-1 ring-[#FFB35C]/45 hover:ring-[#FFB35C] cursor-pointer'
          : ''
      } ${
        midi.isArmed ? 'ring-2 ring-[#FFB35C] shadow-[0_0_12px_rgba(255,179,92,0.45)]' : ''
      } ${midi.isLiveModulating ? 'ring-1 ring-[#38BDF8]' : ''}`}
    >
      <MidiLearnOverlayTag
        midiId="kickMode"
        binding={midi.binding}
        isArmed={midi.isArmed}
        midiLearnMode={midi.midiLearnMode}
        onUnbind={midi.unbind}
        compact
      />

      <button
        type="button"
        role="tab"
        aria-selected={isActiveTab}
        title={
          isActiveTab
            ? `Click to switch to ${kickMode ? 'Synth & Master' : 'Kick & Master'}`
            : `Open ${kickMode ? 'Kick & Master' : 'Synth & Master'} (click again to flip mode)`
        }
        onClick={(e) => {
          if (midi.interceptLearnEvent(e)) return;
          if (!isActiveTab) {
            onSelectVoicesTab();
          } else {
            onToggleKickMode();
          }
        }}
        className="pl-2.5 pr-1.5 py-1.5 font-display text-[10.5px] font-semibold tracking-[0.09em] uppercase whitespace-nowrap cursor-pointer focus-visible:outline-none"
      >
        {kickMode ? 'Kick & Master' : 'Synth & Master'}
      </button>

      {/* Tactile 2-State Hardware Rocker Pill (Flips Synth <-> Kick directly in 1 click) */}
      <button
        type="button"
        aria-label={kickMode ? 'Switch to Synth & Master' : 'Switch to Kick & Master'}
        title={kickMode ? 'Switch to Synth & Master' : 'Switch to Kick & Master'}
        onClick={(e) => {
          e.stopPropagation();
          if (midi.interceptLearnEvent(e)) return;
          onSelectVoicesTab();
          onToggleKickMode();
        }}
        className="mr-1.5 px-1.5 py-[2px] rounded bg-[#0C0E14]/90 border border-white/12 hover:border-white/30 inline-flex items-center gap-1 font-mono text-[8px] font-semibold tracking-[0.06em] uppercase whitespace-nowrap cursor-pointer transition-colors focus-visible:outline-none"
      >
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full transition-opacity ${
            kickMode
              ? 'bg-[#FFB35C] shadow-[0_0_6px_#FFB35C]'
              : 'bg-[#22D3EE] shadow-[0_0_6px_#22D3EE]'
          }`}
        />
        <span className={kickMode ? 'text-[#FFD099]' : 'text-[#A5F3FC]'}>
          {kickMode ? 'KICK' : 'SYN'}
        </span>
      </button>
    </div>
  );
}

export default function App() {
  const [userPresets, setUserPresets] = useState<SynthPreset[]>(() => {
    try {
      const raw = localStorage.getItem(USER_PRESETS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch {
      // ignore storage errors
    }
    return DEFAULT_USER_PRESETS;
  });

  const [customCategories, setCustomCategories] = useState<string[]>(() => {
    let baseCustom: string[] = DEFAULT_CUSTOM_CATEGORIES;
    try {
      const raw = localStorage.getItem(CUSTOM_CATEGORIES_STORAGE_KEY);
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          baseCustom = parsed.filter((c): c is string => typeof c === 'string');
        }
      }
    } catch {
      // ignore storage errors
    }

    const deduped: string[] = [];
    const pushUnique = (val: string) => {
      const cleaned = val.trim().replace(/\s+/g, ' ').slice(0, 24);
      if (!cleaned || isBuiltInPresetCategory(cleaned)) return;
      if (!deduped.some((existing) => existing.toLowerCase() === cleaned.toLowerCase())) {
        deduped.push(cleaned);
      }
    };

    baseCustom.forEach(pushUnique);
    userPresets.forEach((p) => {
      if (typeof p.category === 'string' && !isBuiltInPresetCategory(p.category)) {
        pushUnique(p.category);
      }
    });
    return deduped;
  });

  const [activeCategoryFilter, setActiveCategoryFilter] = useState<'All' | PresetCategory>('All');
  const [previewingPresetName, setPreviewingPresetName] = useState<string | null>(null);

  const allPresets = useMemo(
    () => [...SYNTH_PRESETS, ...userPresets],
    [userPresets]
  );

  const presetMenuItems = useMemo<PresetMenuItem[]>(
    () =>
      allPresets.map((p) => ({
        name: p.name,
        category: p.category,
        subtitle: p.subtitle,
        isUser: p.isUser,
      })),
    [allPresets]
  );

  const [presetIdx, setPresetIdx] = useState<number>(INITIAL_FACTORY_PRESET_INDEX);
  const [activePresetLabel, setActivePresetLabel] = useState<string>(
    SYNTH_PRESETS[INITIAL_FACTORY_PRESET_INDEX].name
  );
  const [randomSeedCount, setRandomSeedCount] = useState<number>(0);

  const [params, setParams] = useState<SynthParams>(() => ({
    ...INIT_SYNTH_PARAMS,
    ...SYNTH_PRESETS[INITIAL_FACTORY_PRESET_INDEX].params,
  }));
  const [speedEnv, setSpeedEnv] = useState<EnvelopeData>({
    points: SYNTH_PRESETS[INITIAL_FACTORY_PRESET_INDEX].speedEnv,
  });
  const [pitchEnv, setPitchEnv] = useState<EnvelopeData>({
    points: SYNTH_PRESETS[INITIAL_FACTORY_PRESET_INDEX].pitchEnv,
  });

  const [isDronePlaying, setIsDronePlaying] = useState<boolean>(false);
  const [activeMidiNote, setActiveMidiNote] = useState<number | null>(null);
  const [isKickTailRinging, setIsKickTailRinging] = useState<boolean>(false);
  const [isSynthTailRinging, setIsSynthTailRinging] = useState<boolean>(false);
  const [hasSample, setHasSample] = useState<boolean>(true);
  const [activeSampleId, setActiveSampleId] = useState<BuiltInSampleId>('reese-bass');
  const [customFileName, setCustomFileName] = useState<string | null>(null);
  const [durationSec, setDurationSec] = useState<number>(4.0);
  const [waveform, setWaveform] = useState<Float32Array | null>(() => {
    audioEngine.generateBuiltInSample('reese-bass');
    return audioEngine.getWaveformData(220);
  });
  const [showSourceDrawer, setShowSourceDrawer] = useState<boolean>(false);
  const [showThemePanel, setShowThemePanel] = useState<boolean>(false);
  const [showComponentOverview, setShowComponentOverview] = useState<boolean>(false);
  const [activeRackTab, setActiveRackTab] = useState<RackTabId>('voices');
  const [kickRightSubView, setKickRightSubView] = useState<'mod' | 'master'>('mod');
  const [synthRightSubView, setSynthRightSubView] = useState<'mod' | 'master'>('mod');

  // Hardware Web MIDI & MIDI Learn State
  const [midiLearnMode, setMidiLearnMode] = useState<boolean>(false);
  const [armedTargetId, setArmedTargetId] = useState<string | null>(null);
  const [midiBindings, setMidiBindings] = useState<Record<string, MidiCCBinding>>(() => {
    try {
      const raw = localStorage.getItem(MIDI_BINDINGS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return parsed;
        }
      }
    } catch {
      // ignore storage errors
    }
    return {};
  });
  const [midiStatus, setMidiStatus] = useState<MidiEngineStatus>(() => midiEngine.getStatus());
  const [selectedMidiDeviceId, setSelectedMidiDeviceId] = useState<string>('all');
  const [selectedMidiChannel, setSelectedMidiChannel] = useState<number | null>(null);
  const [midiButtonCcMode, setMidiButtonCcMode] = useState<MidiButtonCcMode>('latch');
  const [lastMidiActivity, setLastMidiActivity] = useState<string | null>(null);
  const [activeCcTargetId, setActiveCcTargetId] = useState<string | null>(null);

  const [theme, setTheme] = useState<ThemeSettings>(() => {
    try {
      const raw = localStorage.getItem('junoscratch_theme_v1');
      if (raw) {
        return { ...DEFAULT_THEME_SETTINGS, ...JSON.parse(raw) };
      }
    } catch {
      // ignore storage errors
    }
    return DEFAULT_THEME_SETTINGS;
  });
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const [telemetry, setTelemetry] = useState<TelemetryFrame>({
    phase: 0,
    inMeter: 0.04,
    outMeter: 0.04,
    grainMeter: 0.08,
    growlMeter: 0.08,
    activeMidiNote: null,
    fftBins: null,
    scopeSamples: [],
    masterWaveBars: [],
    wahFreqHz: 340,
    formantF1Hz: 450,
    formantF2Hz: 1150,
    combDelayMs: 3.8,
    fmModIndex: 0,
    crushBits: 16,
    spectralBands: [0.18, 0.28, 0.22, 0.35, 0.26, 0.32, 0.2, 0.14],
    ottBands: [0.22, 0.28, 0.24],
    disperserLiveHz: 280,
    kickEqLiveHz: 1180,
    kickPumpMeter: 0.14,
    kickEnvPhase: 0,
    kickLfoPhase: 0,
    synthEnvPhase: 0,
    synthLfoPhase: 0,
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const heldStackRef = useRef<number[]>([]);
  const codeToMidiRef = useRef<Map<string, number>>(new Map());
  const ccGateLatchRef = useRef<Map<string, boolean>>(new Map());
  const ccFlashTimerRef = useRef<number | null>(null);
  const kickTailTimerRef = useRef<number | null>(null);
  const synthTailTimerRef = useRef<number | null>(null);
  const paramsRef = useRef(params);
  const speedEnvRef = useRef(speedEnv);
  const pitchEnvRef = useRef(pitchEnv);
  const activePresetLabelRef = useRef(activePresetLabel);
  const hasSampleRef = useRef(hasSample);
  const midiLearnModeRef = useRef(midiLearnMode);
  const armedTargetIdRef = useRef(armedTargetId);
  const midiBindingsRef = useRef(midiBindings);
  const selectedMidiDeviceRef = useRef(selectedMidiDeviceId);
  const selectedMidiChannelRef = useRef(selectedMidiChannel);
  const midiButtonCcModeRef = useRef(midiButtonCcMode);

  paramsRef.current = params;
  speedEnvRef.current = speedEnv;
  pitchEnvRef.current = pitchEnv;
  activePresetLabelRef.current = activePresetLabel;
  hasSampleRef.current = hasSample;
  midiLearnModeRef.current = midiLearnMode;
  armedTargetIdRef.current = armedTargetId;
  midiBindingsRef.current = midiBindings;
  selectedMidiDeviceRef.current = selectedMidiDeviceId;
  selectedMidiChannelRef.current = selectedMidiChannel;
  midiButtonCcModeRef.current = midiButtonCcMode;

  const {
    canUndo,
    canRedo,
    undoCount,
    redoCount,
    maxHistory,
    recordDiscreteChange,
    recordParamGesture,
    undo: popUndoHistory,
    redo: popRedoHistory,
  } = useSynthHistoryManager(MAX_SYNTH_HISTORY);

  const captureCurrentSnapshot = useCallback((): SynthHistorySnapshot => {
    return {
      params: cloneSynthParams(paramsRef.current),
      speedEnv: cloneEnvelope(speedEnvRef.current),
      pitchEnv: cloneEnvelope(pitchEnvRef.current),
      presetLabel: activePresetLabelRef.current,
    };
  }, []);

  useEffect(() => {
    applyThemeToDocument(theme);
    try {
      localStorage.setItem('junoscratch_theme_v1', JSON.stringify(theme));
    } catch {
      // ignore storage errors
    }
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem(MIDI_BINDINGS_STORAGE_KEY, JSON.stringify(midiBindings));
    } catch {
      // ignore storage errors
    }
  }, [midiBindings]);

  useEffect(() => {
    return () => {
      if (ccFlashTimerRef.current !== null) {
        window.clearTimeout(ccFlashTimerRef.current);
      }
      if (kickTailTimerRef.current !== null) {
        window.clearTimeout(kickTailTimerRef.current);
      }
      if (synthTailTimerRef.current !== null) {
        window.clearTimeout(synthTailTimerRef.current);
      }
      audioEngine.stopAll();
    };
  }, []);

  const isSynthActive =
    isDronePlaying ||
    activeMidiNote !== null ||
    isKickTailRinging ||
    isSynthTailRinging ||
    previewingPresetName !== null;

  useEffect(() => {
    if (!isSynthActive) {
      setTelemetry((prev) => ({
        ...prev,
        phase: audioEngine.getCurrentPhase(),
        inMeter: 0.04,
        outMeter: 0.04,
        grainMeter: 0.08,
        growlMeter: 0.08,
        activeMidiNote: null,
      }));
      return;
    }

    // Throttle React tree telemetry updates to ~17 Hz (58ms) so UI stays 60 FPS responsive;
    // high-speed visualizations (like PhaseScopeDisplay) sample AudioEngine directly on canvas rAF.
    setTelemetry(audioEngine.getTelemetry());
    const timerId = window.setInterval(() => {
      setTelemetry(audioEngine.getTelemetry());
    }, 58);
    return () => window.clearInterval(timerId);
  }, [isSynthActive]);

  const armKickTailTelemetry = useCallback((p: SynthParams) => {
    if (!p.kickMode) return;
    if (kickTailTimerRef.current !== null) {
      window.clearTimeout(kickTailTimerRef.current);
    }
    setIsKickTailRinging(true);
    const ringMs = Math.round(
      (p.kickAttackMs ?? 1.8) +
        (p.kickDecayMs ?? 260) +
        (p.kickReleaseMs ?? 220) +
        (p.kickRumblePower ? 480 : 140)
    );
    kickTailTimerRef.current = window.setTimeout(() => {
      kickTailTimerRef.current = null;
      setIsKickTailRinging(false);
    }, ringMs);
  }, []);

  const armSynthTailTelemetry = useCallback((p: SynthParams) => {
    if (p.kickMode) return;
    if (synthTailTimerRef.current !== null) {
      window.clearTimeout(synthTailTimerRef.current);
    }
    setIsSynthTailRinging(true);
    const ringMs = Math.round(Math.max(80, p.releaseMs ?? 150) + 120);
    synthTailTimerRef.current = window.setTimeout(() => {
      synthTailTimerRef.current = null;
      setIsSynthTailRinging(false);
    }, ringMs);
  }, []);

  const handleNoteDown = useCallback(
    (midi: number) => {
      audioEngine.stopPatchPreview(true);
      setPreviewingPresetName(null);
      setErrorBanner(null);
      const stack = heldStackRef.current.filter((n) => n !== midi);
      stack.push(midi);
      heldStackRef.current = stack;

      setActiveMidiNote(midi);
      armKickTailTelemetry(paramsRef.current);
      audioEngine
        .triggerNoteOn(midi, speedEnvRef.current, pitchEnvRef.current, paramsRef.current, true)
        .catch((err) => {
          console.error('Note trigger error:', err);
        });
    },
    [armKickTailTelemetry]
  );

  const handleNoteUp = useCallback(
    (midi: number) => {
      const stack = heldStackRef.current.filter((n) => n !== midi);
      heldStackRef.current = stack;

      if (stack.length > 0) {
        const fallbackMidi = stack[stack.length - 1];
        setActiveMidiNote(fallbackMidi);
        audioEngine
          .triggerNoteOn(
            fallbackMidi,
            speedEnvRef.current,
            pitchEnvRef.current,
            paramsRef.current,
            false
          )
          .catch(() => {});
      } else {
        if (!paramsRef.current.latchMode) {
          setActiveMidiNote(null);
          armSynthTailTelemetry(paramsRef.current);
        }
        audioEngine.triggerNoteOff(midi);
      }
    },
    [armSynthTailTelemetry]
  );

  const toggleDronePlayback = useCallback(async () => {
    audioEngine.stopPatchPreview(true);
    setPreviewingPresetName(null);
    setErrorBanner(null);
    try {
      const nextState = !isDronePlaying;
      await audioEngine.setDronePlay(
        nextState,
        speedEnvRef.current,
        pitchEnvRef.current,
        paramsRef.current
      );
      setIsDronePlaying(nextState);
      if (!nextState && !paramsRef.current.latchMode && heldStackRef.current.length === 0) {
        setActiveMidiNote(null);
        armSynthTailTelemetry(paramsRef.current);
      }
    } catch (err) {
      console.error('Playback error:', err);
      setErrorBanner('Audio playback could not start. Click Play or press any key again.');
    }
  }, [armSynthTailTelemetry, isDronePlaying]);

  const applyHistorySnapshot = useCallback((restored: SynthHistorySnapshot) => {
    audioEngine.stopPatchPreview(false);
    setPreviewingPresetName(null);
    setErrorBanner(null);

    if (restored.params.grainPower && !hasSampleRef.current) {
      const sampleToRestore = activeSampleIdRef.current;
      const dur = audioEngine.generateBuiltInSample(sampleToRestore);
      hasSampleRef.current = true;
      setHasSample(true);
      setDurationSec(dur);
      setWaveform(audioEngine.getWaveformData(220));
    }

    paramsRef.current = restored.params;
    speedEnvRef.current = restored.speedEnv;
    pitchEnvRef.current = restored.pitchEnv;
    activePresetLabelRef.current = restored.presetLabel;

    setParams(restored.params);
    setSpeedEnv(restored.speedEnv);
    setPitchEnv(restored.pitchEnv);
    setActivePresetLabel(restored.presetLabel);

    if (!restored.params.latchMode && heldStackRef.current.length === 0) {
      setActiveMidiNote(null);
      audioEngine.releaseAllLatchedNotes();
    }

    audioEngine.updateLiveParams(restored.params);
    audioEngine.applyEnvelopes(restored.speedEnv, restored.pitchEnv);
  }, []);

  const handleUndo = useCallback(() => {
    const restored = popUndoHistory(captureCurrentSnapshot());
    if (restored) {
      applyHistorySnapshot(restored);
    }
  }, [applyHistorySnapshot, captureCurrentSnapshot, popUndoHistory]);

  const handleRedo = useCallback(() => {
    const restored = popRedoHistory(captureCurrentSnapshot());
    if (restored) {
      applyHistorySnapshot(restored);
    }
  }, [applyHistorySnapshot, captureCurrentSnapshot, popRedoHistory]);

  const updateParam = useCallback(
    <K extends keyof SynthParams>(key: K, value: SynthParams[K]) => {
      const cur = paramsRef.current;
      if (key === 'fxChain') {
        const nextChain = value as FxSlotItem[] | undefined;
        if (areFxChainsEqual(cur.fxChain, nextChain)) return;
        const discrete = isFxChainDiscreteChange(cur.fxChain, nextChain);
        recordParamGesture('fxChain', captureCurrentSnapshot(), discrete);
      } else {
        if (Object.is(cur[key], value)) return;
        const discrete =
          typeof value === 'boolean' || typeof value === 'string' || key === 'oscInterval';
        recordParamGesture(String(key), captureCurrentSnapshot(), discrete);
      }

      if (key === 'kickMode') {
        if (value === true) {
          setKickRightSubView('mod');
        } else {
          setSynthRightSubView('mod');
        }
      }

      const next: SynthParams = {
        ...cur,
        [key]:
          key === 'fxChain' && Array.isArray(value)
            ? ((value as FxSlotItem[]).map((s) => ({ ...s })) as SynthParams[K])
            : value,
      };
      paramsRef.current = next;
      setParams(next);
      audioEngine.updateLiveParams(next);
      if (key === 'latchMode' && value === false && heldStackRef.current.length === 0) {
        setActiveMidiNote(null);
        audioEngine.releaseAllLatchedNotes();
      }
    },
    [captureCurrentSnapshot, recordParamGesture]
  );

  const handleKickAdsrChange = useCallback(
    (patch: KickAdsrPatch) => {
      const cur = paramsRef.current;
      const next: SynthParams = { ...cur, ...patch };
      if (areSynthParamsEqual(cur, next)) return;
      recordParamGesture('kickAdsr', captureCurrentSnapshot(), false);
      paramsRef.current = next;
      setParams(next);
      audioEngine.updateLiveParams(next);
    },
    [captureCurrentSnapshot, recordParamGesture]
  );

  const handleSynthAdsrChange = useCallback(
    (patch: SynthAdsrPatch) => {
      const cur = paramsRef.current;
      const next: SynthParams = { ...cur, ...patch };
      if (areSynthParamsEqual(cur, next)) return;
      recordParamGesture('synthAdsr', captureCurrentSnapshot(), false);
      paramsRef.current = next;
      setParams(next);
      audioEngine.updateLiveParams(next);
    },
    [captureCurrentSnapshot, recordParamGesture]
  );

  const handleScopeStereoWidthChange = useCallback(
    (nextWidth: number) => {
      const cur = paramsRef.current;
      const next: SynthParams = {
        ...cur,
        haasWidth: nextWidth,
        haasPower: nextWidth > 0 ? true : cur.haasPower,
      };
      if (areSynthParamsEqual(cur, next)) return;
      recordParamGesture('scopeStereoWidth', captureCurrentSnapshot(), false);
      paramsRef.current = next;
      setParams(next);
      audioEngine.updateLiveParams(next);
    },
    [captureCurrentSnapshot, recordParamGesture]
  );

  const handleKickLfoDepthChange = useCallback(
    (nextDepth: number) => {
      const cur = paramsRef.current;
      const next: SynthParams = {
        ...cur,
        kickLfoDepth: nextDepth,
        kickLfoPower: nextDepth > 0 ? true : cur.kickLfoPower,
      };
      if (areSynthParamsEqual(cur, next)) return;
      recordParamGesture('kickLfoDepth', captureCurrentSnapshot(), false);
      paramsRef.current = next;
      setParams(next);
      audioEngine.updateLiveParams(next);
    },
    [captureCurrentSnapshot, recordParamGesture]
  );

  const handleSynthLfoDepthChange = useCallback(
    (nextDepth: number) => {
      const cur = paramsRef.current;
      const next: SynthParams = {
        ...cur,
        synthLfoDepth: nextDepth,
        synthLfoPower: nextDepth > 0 ? true : cur.synthLfoPower,
      };
      if (areSynthParamsEqual(cur, next)) return;
      recordParamGesture('synthLfoDepth', captureCurrentSnapshot(), false);
      paramsRef.current = next;
      setParams(next);
      audioEngine.updateLiveParams(next);
    },
    [captureCurrentSnapshot, recordParamGesture]
  );

  const handleOctaveChange = useCallback(
    (nextOct: number) => updateParam('octave', nextOct),
    [updateParam]
  );
  const handleToggleLatch = useCallback(
    () => updateParam('latchMode', !paramsRef.current.latchMode),
    [updateParam]
  );
  const handleAttackChange = useCallback(
    (ms: number) => updateParam('attackMs', ms),
    [updateParam]
  );
  const handleReleaseChange = useCallback(
    (ms: number) => updateParam('releaseMs', ms),
    [updateParam]
  );
  const handleGlideChange = useCallback(
    (ms: number) => updateParam('glideMs', ms),
    [updateParam]
  );
  const handleTransposeChange = useCallback(
    (st: number) => updateParam('basePitchSemitones', st),
    [updateParam]
  );

  // Global Computer QWERTY Keyboard Synth Controller + Undo/Redo Shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const targetEl = e.target as HTMLElement | null;
      const tag = targetEl?.tagName;
      const inputType =
        tag === 'INPUT' ? ((targetEl as HTMLInputElement).type || '').toLowerCase() : '';
      const isTextEntry =
        tag === 'TEXTAREA' ||
        Boolean(targetEl?.isContentEditable) ||
        (tag === 'INPUT' &&
          inputType !== 'range' &&
          inputType !== 'color' &&
          inputType !== 'checkbox' &&
          inputType !== 'radio' &&
          inputType !== 'button');
      if (isTextEntry) return;

      // Standard Undo (Ctrl/Cmd+Z) & Redo (Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y)
      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        if (e.code === 'KeyZ' && !e.shiftKey) {
          e.preventDefault();
          handleUndo();
          return;
        }
        if ((e.code === 'KeyZ' && e.shiftKey) || (e.code === 'KeyY' && !e.shiftKey)) {
          e.preventDefault();
          handleRedo();
          return;
        }
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.code === 'Escape') {
        if (armedTargetIdRef.current !== null) {
          e.preventDefault();
          setArmedTargetId(null);
          return;
        }
        if (midiLearnModeRef.current) {
          e.preventDefault();
          setMidiLearnMode(false);
          return;
        }
      }

      if (e.code === 'Space') {
        if (tag !== 'BUTTON') {
          e.preventDefault();
          toggleDronePlayback();
        }
        return;
      }

      if (e.repeat) return;

      if (e.code === 'KeyZ') {
        e.preventDefault();
        updateParam('octave', Math.max(0, paramsRef.current.octave - 1));
        return;
      }
      if (e.code === 'KeyX') {
        e.preventDefault();
        updateParam('octave', Math.min(4, paramsRef.current.octave + 1));
        return;
      }

      const semitoneOffset = CODE_TO_SEMITONE_OFFSET[e.code];
      if (semitoneOffset !== undefined) {
        e.preventDefault();
        const baseMidi = (paramsRef.current.octave + 1) * 12;
        const midi = baseMidi + semitoneOffset;
        codeToMidiRef.current.set(e.code, midi);
        handleNoteDown(midi);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const mappedMidi = codeToMidiRef.current.get(e.code);
      if (mappedMidi !== undefined) {
        codeToMidiRef.current.delete(e.code);
        handleNoteUp(mappedMidi);
      }
    };

    const onWindowBlur = () => {
      codeToMidiRef.current.clear();
      heldStackRef.current = [];
      if (!paramsRef.current.latchMode) {
        setActiveMidiNote(null);
        audioEngine.triggerNoteOff();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [handleNoteDown, handleNoteUp, handleRedo, handleUndo, toggleDronePlayback, updateParam]);

  const handleSpeedPoints = (pts: Point[]) => {
    const next = { points: pts };
    speedEnvRef.current = next;
    setSpeedEnv(next);
    audioEngine.applyEnvelopes(next, pitchEnv);
  };

  const handlePitchPoints = (pts: Point[]) => {
    const next = { points: pts };
    pitchEnvRef.current = next;
    setPitchEnv(next);
    audioEngine.applyEnvelopes(speedEnv, next);
  };

  const handleInitPatch = useCallback(() => {
    audioEngine.stopPatchPreview(false);
    setPreviewingPresetName(null);
    setErrorBanner(null);

    const beforeSnap = captureCurrentSnapshot();
    const nextParams: SynthParams = cloneSynthParams(INIT_SYNTH_PARAMS);
    const flatSpeed = { points: FLAT_ENVELOPE_POINTS.map((pt) => ({ ...pt })) };
    const flatPitch = { points: FLAT_ENVELOPE_POINTS.map((pt) => ({ ...pt })) };

    if (!areSynthParamsEqual(beforeSnap.params, nextParams)) {
      recordDiscreteChange(beforeSnap);
    }

    setPresetIdx(0);
    activePresetLabelRef.current = 'Init Patch';
    setActivePresetLabel('Init Patch');
    audioEngine.clearSample();
    audioEngine.resetPlayhead();
    audioEngine.clearMasterClip();
    hasSampleRef.current = false;
    setHasSample(false);
    setCustomFileName(null);
    setWaveform(null);
    setTelemetry((prev) => ({ ...prev, phase: 0 }));

    paramsRef.current = nextParams;
    speedEnvRef.current = flatSpeed;
    pitchEnvRef.current = flatPitch;

    setParams(nextParams);
    setSpeedEnv(flatSpeed);
    setPitchEnv(flatPitch);
    audioEngine.updateLiveParams(nextParams);
    audioEngine.applyEnvelopes(flatSpeed, flatPitch);
  }, [captureCurrentSnapshot, recordDiscreteChange]);

  const persistUserPresets = (nextList: SynthPreset[]) => {
    setUserPresets(nextList);
    try {
      localStorage.setItem(USER_PRESETS_STORAGE_KEY, JSON.stringify(nextList));
    } catch {
      // ignore storage errors
    }
  };

  const persistCustomCategories = (nextCategories: string[]) => {
    setCustomCategories(nextCategories);
    try {
      localStorage.setItem(CUSTOM_CATEGORIES_STORAGE_KEY, JSON.stringify(nextCategories));
    } catch {
      // ignore storage errors
    }
  };

  const handleAddCustomCategory = (rawCategory: string): string => {
    const resolved = resolveCanonicalCategoryName(rawCategory, customCategories);
    if (!resolved) return 'User';
    if (isBuiltInPresetCategory(resolved)) return resolved;
    const exists = customCategories.some((c) => c.toLowerCase() === resolved.toLowerCase());
    if (!exists) {
      persistCustomCategories([...customCategories, resolved]);
    }
    return resolved;
  };

  const handleRenameCustomCategory = (oldCategory: string, rawNextCategory: string): string => {
    if (isBuiltInPresetCategory(oldCategory)) return oldCategory;
    const otherCustom = customCategories.filter(
      (c) => c.toLowerCase() !== oldCategory.toLowerCase()
    );
    const resolved = resolveCanonicalCategoryName(rawNextCategory, otherCustom);
    if (!resolved) return oldCategory;

    const nextCategories = isBuiltInPresetCategory(resolved)
      ? otherCustom
      : otherCustom.some((c) => c.toLowerCase() === resolved.toLowerCase())
      ? otherCustom
      : customCategories.map((c) => (c === oldCategory ? resolved : c));

    persistCustomCategories(nextCategories);

    const hasAffectedPresets = userPresets.some((p) => p.category === oldCategory);
    if (hasAffectedPresets) {
      const updatedPresets = userPresets.map((p) =>
        p.category === oldCategory ? { ...p, category: resolved } : p
      );
      persistUserPresets(updatedPresets);
    }

    if (activeCategoryFilter === oldCategory) {
      setActiveCategoryFilter(resolved);
    }
    return resolved;
  };

  const handleDeleteCustomCategory = (categoryToDelete: string) => {
    if (isBuiltInPresetCategory(categoryToDelete)) return;
    const nextCategories = customCategories.filter((c) => c !== categoryToDelete);
    persistCustomCategories(nextCategories);

    const hasAffectedPresets = userPresets.some((p) => p.category === categoryToDelete);
    if (hasAffectedPresets) {
      const reassignedPresets = userPresets.map((p) =>
        p.category === categoryToDelete ? { ...p, category: 'User' } : p
      );
      persistUserPresets(reassignedPresets);
    }

    if (activeCategoryFilter === categoryToDelete) {
      setActiveCategoryFilter('All');
    }
  };

  const handleChangeUserPresetCategory = (
    presetNameToMove: string,
    rawNextCategory: PresetCategory
  ) => {
    const targetCategory = handleAddCustomCategory(rawNextCategory);
    const nextUserList = userPresets.map((p) =>
      p.name === presetNameToMove ? { ...p, category: targetCategory } : p
    );
    persistUserPresets(nextUserList);
  };

  const handleSaveUserPreset = (rawName: string, rawCategory: PresetCategory = 'User') => {
    const cleanName = rawName.trim();
    if (!cleanName) return;

    const targetCategory = handleAddCustomCategory(rawCategory);

    // Ensure unique name against factory presets
    const collidesFactory = SYNTH_PRESETS.some(
      (p) => p.name.toLowerCase() === cleanName.toLowerCase()
    );
    const finalName = collidesFactory ? `${cleanName} (User)` : cleanName;

    const newPreset: SynthPreset = {
      name: finalName,
      category: targetCategory,
      subtitle: params.kickMode
        ? `Kick · ${params.kickTailType ?? '909'} ${params.kickClipMode ?? 'GABBER'}`
        : params.fmGrowl === 0 && params.wahAmount === 0
        ? 'Clean Custom'
        : `${params.oscWave} · ${params.toneMode}`,
      isUser: true,
      defaultSample: activeSampleId,
      speedEnv: speedEnv.points.map((pt) => ({ ...pt })),
      pitchEnv: pitchEnv.points.map((pt) => ({ ...pt })),
      params: { ...params },
    };

    const existingIdx = userPresets.findIndex(
      (p) => p.name.toLowerCase() === finalName.toLowerCase()
    );
    const nextUserList =
      existingIdx >= 0
        ? userPresets.map((p, i) => (i === existingIdx ? newPreset : p))
        : [...userPresets, newPreset];

    persistUserPresets(nextUserList);
    const combinedIdx =
      SYNTH_PRESETS.length + (existingIdx >= 0 ? existingIdx : nextUserList.length - 1);
    setPresetIdx(combinedIdx);
    setActivePresetLabel(finalName);
  };

  const handleDeleteUserPreset = (nameToDelete: string) => {
    if (previewingPresetName === nameToDelete) {
      setPreviewingPresetName(null);
      audioEngine.stopPatchPreview(true);
    }
    const nextUserList = userPresets.filter((p) => p.name !== nameToDelete);
    persistUserPresets(nextUserList);
    if (activePresetLabel === nameToDelete) {
      setPresetIdx(INITIAL_FACTORY_PRESET_INDEX);
      setActivePresetLabel(SYNTH_PRESETS[INITIAL_FACTORY_PRESET_INDEX].name);
    }
  };

  const handleStopPreviewPreset = useCallback(() => {
    setPreviewingPresetName(null);
    audioEngine.stopPatchPreview(true);
  }, []);

  const handlePreviewPreset = useCallback(
    (name: string) => {
      const preset = allPresets.find((p) => p.name === name);
      if (!preset) return;

      const previewMerged: SynthParams = preset.isInit
        ? { ...INIT_SYNTH_PARAMS, grainPower: false, oscPower: true }
        : {
            ...INIT_SYNTH_PARAMS,
            curveMode: paramsRef.current.curveMode,
            curveSpeed: preset.params.curveSpeed ?? 1.0,
            ...preset.params,
          };

      const previewSpeed: EnvelopeData = preset.isInit
        ? { points: [...FLAT_ENVELOPE_POINTS] }
        : { points: preset.speedEnv.map((pt) => ({ ...pt })) };
      const previewPitch: EnvelopeData = preset.isInit
        ? { points: [...FLAT_ENVELOPE_POINTS] }
        : { points: preset.pitchEnv.map((pt) => ({ ...pt })) };

      setPreviewingPresetName(preset.name);
      audioEngine
        .startPatchPreview({
          previewParams: previewMerged,
          speedEnv: previewSpeed,
          pitchEnv: previewPitch,
          defaultSample: preset.defaultSample,
          fallbackLiveState: {
            params: paramsRef.current,
            speedEnv: speedEnvRef.current,
            pitchEnv: pitchEnvRef.current,
          },
          durationMs: 2000,
          onEnded: () => {
            setPreviewingPresetName((cur) => (cur === preset.name ? null : cur));
          },
        })
        .catch((err) => {
          console.error('Preset preview error:', err);
          setPreviewingPresetName(null);
        });
    },
    [allPresets]
  );

  const applyPreset = useCallback(
    (idx: number, presetSource: SynthPreset[] = allPresets) => {
      if (presetSource.length === 0) return;
      const wrapped = ((idx % presetSource.length) + presetSource.length) % presetSource.length;
      const preset = presetSource[wrapped];
      if (preset.isInit) {
        handleInitPatch();
        return;
      }

      audioEngine.stopPatchPreview(true);
      setPreviewingPresetName(null);

      const beforeSnap = captureCurrentSnapshot();

      const shouldLoadBuiltIn = preset.params.grainPower && !customFileName;
      if (shouldLoadBuiltIn) {
        const dur = audioEngine.generateBuiltInSample(preset.defaultSample);
        setActiveSampleId(preset.defaultSample);
        hasSampleRef.current = true;
        setHasSample(true);
        setDurationSec(dur);
        setWaveform(audioEngine.getWaveformData(220));
      }

      const effectiveHasSample = shouldLoadBuiltIn || hasSampleRef.current;
      const merged: SynthParams = cloneSynthParams({
        ...INIT_SYNTH_PARAMS,
        curveMode: paramsRef.current.curveMode,
        curveSpeed: preset.params.curveSpeed ?? 1.0,
        ...preset.params,
      });
      const nextParams: SynthParams = effectiveHasSample
        ? merged
        : { ...merged, grainPower: false, oscPower: true };

      if (!areSynthParamsEqual(beforeSnap.params, nextParams)) {
        recordDiscreteChange(beforeSnap);
      }

      setPresetIdx(wrapped);
      activePresetLabelRef.current = preset.name;
      setActivePresetLabel(preset.name);

      if (nextParams.kickMode) {
        setActiveRackTab('voices');
        setKickRightSubView('mod');
      }

      const nextSpeed = { points: preset.speedEnv.map((pt) => ({ ...pt })) };
      const nextPitch = { points: preset.pitchEnv.map((pt) => ({ ...pt })) };

      paramsRef.current = nextParams;
      speedEnvRef.current = nextSpeed;
      pitchEnvRef.current = nextPitch;

      setParams(nextParams);
      setSpeedEnv(nextSpeed);
      setPitchEnv(nextPitch);
      audioEngine.updateLiveParams(nextParams);
      audioEngine.applyEnvelopes(nextSpeed, nextPitch);
    },
    [allPresets, captureCurrentSnapshot, customFileName, handleInitPatch, recordDiscreteChange]
  );

  /**
   * Randomize Engine: Generates inspiring, playable experimental values across
   * OSC, GRAIN, FM GROWL, TONE, STABILISE, Filters, ADSR, and Envelope Curves.
   * Respects OSC-only mode when sample is removed!
   */
  const handleRandomizeAll = useCallback(() => {
    audioEngine.stopPatchPreview(true);
    setPreviewingPresetName(null);
    const beforeSnap = captureCurrentSnapshot();
    const curParams = paramsRef.current;
    const inKickMode = Boolean(curParams.kickMode);

    setRandomSeedCount((prevSeed) => {
      const nextSeed = prevSeed + 1;
      const nextLabel = inKickMode
        ? `Kick Lab Seed #${String(nextSeed).padStart(2, '0')}`
        : `Experimental Seed #${String(nextSeed).padStart(2, '0')}`;
      activePresetLabelRef.current = nextLabel;
      setActivePresetLabel(nextLabel);
      return nextSeed;
    });

    const curHasSample = hasSampleRef.current;

    let oscOn = curHasSample ? Math.random() > 0.18 : true;
    let fmOn = Math.random() > 0.18;
    let grainOn = curHasSample ? Math.random() > 0.28 : false;
    if (curHasSample && [oscOn, fmOn, grainOn].filter(Boolean).length < 2) {
      oscOn = true;
      fmOn = true;
    }

    const grainSize = randBetween(25, 360, 5);
    const maxOverlap = Math.min(180, Math.max(10, Math.floor(grainSize * 0.75)));
    const nextKickTail = pickRandom(KICK_TAIL_TYPES);
    const isRumbleStyle =
      nextKickTail === '909' || nextKickTail === 'SUB' || nextKickTail === 'SAW';

    const randomizedParams: SynthParams = {
      inGainDb: randBetween(-1.0, 2.0, 0.5),
      outGainDb: randBetween(0.0, 2.0, 0.5),

      oscPower: oscOn,
      oscWave:
        Math.random() > 0.22
          ? pickRandom(['SAW', 'PULSE', 'SUPER', 'SYNC', 'TRI'] as OscWaveType[])
          : 'METAL',
      oscLevel: randBetween(55, 95, 1),
      oscDetune: randBetween(12, 85, 1),
      oscShape: randBetween(15, 90, 1),
      oscNoise: Math.random() > 0.35 ? randBetween(5, 42, 1) : 0,
      oscRingMod: Math.random() > 0.65,
      oscInterval: pickRandom(OSC_INTERVAL_STEPS),

      grainPower: grainOn,
      grainReverse: Math.random() > 0.62,
      grainFreeze: false,
      baseSpeed: randBetween(0.45, 1.95, 0.05),
      grainSizeMs: grainSize,
      grainOverlapMs: randBetween(10, maxOverlap, 5),

      fmPower: fmOn,
      fmSubOctave: Math.random() > 0.15,
      fmUnison: Math.random() > 0.35,
      fmGrowl: randBetween(48, 98, 1),
      fmRatio: pickRandom(FM_RATIOS),
      fmWobbleRate: Math.random() > 0.14 ? randBetween(0.4, 11.5, 0.1) : 0,
      fmInflect: randBetween(25, 92, 1),
      fmMetalAmt: Math.random() > 0.68 ? randBetween(24, 92, 1) : 0,

      wahPower: inKickMode ? Math.random() > 0.68 : Math.random() > 0.15,
      wahAmount: randBetween(45, 95, 1),
      wahBaseHz: randBetween(180, 420, 10),
      wahResonance: randBetween(40, 88, 1),
      wahMorph: randBetween(45, 95, 1),

      formantPower: inKickMode ? Math.random() > 0.72 : Math.random() > 0.15,
      fmVowel: randBetween(10, 92, 1),
      formantTalk: randBetween(48, 95, 1),
      notchEnable: Math.random() > 0.25,
      notchDepth: randBetween(35, 88, 1),

      combPower: inKickMode ? Math.random() > 0.78 : Math.random() > 0.65,
      combKeyTrack: Math.random() > 0.2,
      fmMetal: Math.random() > 0.35 ? randBetween(22, 74, 1) : 0,
      combHarmonic: pickRandom([2.0, 3.0, 4.0, 6.0, 8.0]),
      combFeedbackAmt: randBetween(42, 78, 1),
      combDamp: randBetween(35, 82, 1),

      crushPower: inKickMode ? Math.random() > 0.72 : Math.random() > 0.68,
      fmCrush: Math.random() > 0.38 ? randBetween(14, 68, 1) : 0,

      xoverFreqHz: randBetween(95, 145, 5),
      subPunch: randBetween(62, 88, 1),
      subSolo: false,

      octave: inKickMode ? 1 : curParams.octave,
      glideMs: randBetween(10, 165, 5),
      attackMs: randBetween(6, 110, 2),
      decayMs: randBetween(120, 780, 10),
      sustain: randBetween(28, 94, 1),
      releaseMs: randBetween(80, 560, 10),
      synthAdsrFilterMod: Math.random() > 0.22,
      synthLfoPower: inKickMode ? false : Math.random() > 0.28,
      synthLfoShape: pickRandom(KICK_LFO_SHAPES),
      synthLfoTarget: pickRandom(SYNTH_LFO_TARGETS),
      synthLfoRateHz: randBetween(0.5, 12.0, 0.2),
      synthLfoDepth: randBetween(26, 82, 1),
      synthLfoSync: Math.random() > 0.3,
      basePitchSemitones: curParams.basePitchSemitones,
      latchMode: curParams.latchMode,

      tonePower: inKickMode ? Math.random() > 0.35 : true,
      toneDrive: randBetween(24, 68, 1),
      toneMode: pickRandom(TONE_MODES),

      spacePower: inKickMode ? Math.random() > 0.75 : Math.random() > 0.12,
      spaceAmount: randBetween(18, 68, 1),

      hpFreq: inKickMode ? randBetween(22, 34, 1) : randBetween(22, 95, 1),
      lpFreq: inKickMode ? randBetween(13500, 19500, 100) : randBetween(4800, 18500, 100),
      dryWet: inKickMode ? randBetween(88, 100, 1) : randBetween(62, 96, 1),
      bypass: false,
      curveMode: curParams.curveMode,
      curveSpeed: randBetween(0.5, 2.25, 0.05),

      disperserPower: Math.random() > 0.35,
      disperserAmount: randBetween(35, 92, 1),
      disperserFreqHz: randBetween(140, 620, 10),
      disperserPinch: randBetween(42, 88, 1),
      disperserSweep: randBetween(40, 90, 1),

      freqShiftPower: inKickMode ? false : Math.random() > 0.45,
      freqShiftHz: Math.random() > 0.45 ? randBetween(-65, 95, 1) : randBetween(-240, 260, 5),
      freqShiftMix: randBetween(28, 76, 1),
      freqShiftFeedback: randBetween(15, 68, 1),
      freqShiftBarber: Math.random() > 0.45,

      reesePower: inKickMode ? Math.random() > 0.72 : Math.random() > 0.35,
      reeseDepth: randBetween(40, 88, 1),
      reeseSweep: randBetween(20, 82, 1),

      scratchPower: inKickMode ? false : Math.random() > 0.55,
      scratchAmount: randBetween(25, 78, 1),
      vinylBrake: false,

      spectralPower: inKickMode ? false : Math.random() > 0.52,
      spectralMix: randBetween(35, 82, 1),
      spectralThresh: randBetween(28, 62, 1),
      spectralReso: randBetween(40, 82, 1),

      haasPower: inKickMode ? false : Math.random() > 0.28,
      haasWidth: randBetween(32, 82, 1),
      haasDelayMs: randBetween(4.5, 16.5, 0.5),
      haasDetune: randBetween(20, 68, 1),
      haasMonoCheck: false,

      thumpPower: Math.random() > 0.32,
      thumpAmount: randBetween(35, 85, 1),
      thumpMode: pickRandom(['FAST', 'PUNCH', '808'] as SubThumpMode[]),

      ottPower: Math.random() > 0.22,
      ottAmount: randBetween(38, 78, 1),
      ottMode: pickRandom(['UPWARD', 'SLAM', 'CRISP'] as OttFlavorMode[]),

      kickMode: inKickMode,
      kickPower: true,
      kickTailType: nextKickTail,
      kickPhaseMode:
        nextKickTail === 'ZAAG' || nextKickTail === 'SAW' || Math.random() > 0.65
          ? 'HARD'
          : 'RESET',
      kickPhaseDeg: Math.random() > 0.72 ? pickRandom([0, 15, 30, 45]) : 0,
      kickPunch: randBetween(70, 94, 1),
      kickFmRatio: randBetween(0.75, 4.5, 0.25),
      kickTok: randBetween(42, 86, 1),
      kickTokBoost: nextKickTail === 'PIEP' || nextKickTail === 'ZAAG' || Math.random() > 0.65,
      kickSweepMs: randBetween(26, 68, 2),
      kickAttackMs: randBetween(0.8, 10.0, 0.5),
      kickDecayMs: isRumbleStyle ? randBetween(170, 320, 10) : randBetween(210, 460, 10),
      kickSustain: isRumbleStyle ? randBetween(28, 68, 1) : randBetween(62, 88, 1),
      kickReleaseMs: isRumbleStyle ? randBetween(120, 240, 10) : randBetween(160, 360, 10),
      kickKrachPower: true,
      kickClipMode: pickRandom(KICK_CLIP_MODES),
      kickDrive:
        nextKickTail === '909'
          ? randBetween(38, 68, 1)
          : isRumbleStyle
          ? randBetween(30, 64, 1)
          : randBetween(54, 82, 1),
      kickEqFreqHz:
        nextKickTail === '909'
          ? randBetween(240, 460, 20)
          : nextKickTail === 'PIEP'
          ? randBetween(1700, 3400, 40)
          : isRumbleStyle
          ? randBetween(240, 680, 20)
          : randBetween(580, 1960, 20),
      kickEqGain:
        nextKickTail === '909'
          ? randBetween(36, 68, 1)
          : isRumbleStyle
          ? randBetween(28, 62, 1)
          : randBetween(48, 80, 1),
      kickEqSweep: nextKickTail === '909' ? Math.random() > 0.65 : Math.random() > 0.35,
      kickLfoPower: Math.random() > 0.32,
      kickLfoShape: pickRandom(KICK_LFO_SHAPES),
      kickLfoTarget: pickRandom(KICK_LFO_TARGETS),
      kickLfoRateHz: randBetween(0.8, 14.0, 0.2),
      kickLfoDepth: randBetween(28, 78, 1),
      kickLfoSync: Math.random() > 0.3,
      kickRumblePower: isRumbleStyle ? true : Math.random() > 0.65,
      kickLoop: curParams.kickLoop ?? true,
      kickBpm:
        nextKickTail === 'PIEP' || nextKickTail === 'ZAAG'
          ? randBetween(185, 225, 1)
          : isRumbleStyle
          ? randBetween(136, 162, 1)
          : randBetween(162, 195, 1),
      kickRumbleAmt: randBetween(54, 88, 1),
      kickDuck: randBetween(72, 92, 1),
      kickRumbleLpHz: randBetween(210, 420, 10),
      kickRumbleGroove: Math.random() > 0.4,
      fxChain: curParams.fxChain ?? [],
    };

    const nextSpeedEnv = { points: generateRandomEnvelope(3, 7) };
    const nextPitchEnv = { points: generateRandomEnvelope(3, 7) };

    if (!inKickMode && curHasSample && !customFileName && Math.random() > 0.4) {
      const nextSample = pickRandom(BUILT_IN_SAMPLES).id;
      const dur = audioEngine.generateBuiltInSample(nextSample);
      setActiveSampleId(nextSample);
      setDurationSec(dur);
      setWaveform(audioEngine.getWaveformData(220));
    }

    recordDiscreteChange(beforeSnap);

    const nextCloned = cloneSynthParams(randomizedParams);
    paramsRef.current = nextCloned;
    speedEnvRef.current = nextSpeedEnv;
    pitchEnvRef.current = nextPitchEnv;

    setParams(nextCloned);
    setSpeedEnv(nextSpeedEnv);
    setPitchEnv(nextPitchEnv);
    audioEngine.updateLiveParams(nextCloned);
    audioEngine.applyEnvelopes(nextSpeedEnv, nextPitchEnv);
  }, [captureCurrentSnapshot, customFileName, recordDiscreteChange]);

  /**
   * Per-Module Macro Randomize Engine:
   * Randomizes ONLY the parameters belonging to the targeted hardware module,
   * preserving every other module, envelope curve, filter, and patch setting
   * for incremental, non-destructive sound design experimentation.
   */
  type ModuleRandomizeId =
    | 'kickBody'
    | 'krachPreEq'
    | 'rumbleStomp'
    | 'kickAdsr'
    | 'kickLfo'
    | 'synthAdsr'
    | 'synthLfo'
    | 'osc'
    | 'grain'
    | 'fmGrowl'
    | 'tone'
    | 'stabilise'
    | 'wahPedal'
    | 'vowelTract'
    | 'throatComb'
    | 'bitcrush'
    | 'xoverSub'
    | 'disperser'
    | 'freqShift'
    | 'phaseScope'
    | 'reeseNotch'
    | 'vinylScratch'
    | 'spectralGate'
    | 'stereoHaas'
    | 'subThump'
    | 'ottMultiband';

  const handleRandomizeModule = useCallback(
    (moduleId: ModuleRandomizeId) => {
      audioEngine.stopPatchPreview(true);
      setPreviewingPresetName(null);

      const beforeSnap = captureCurrentSnapshot();

      if (moduleId === 'grain' && !hasSampleRef.current) {
        const dur = audioEngine.generateBuiltInSample(activeSampleId);
        setCustomFileName(null);
        hasSampleRef.current = true;
        setHasSample(true);
        setDurationSec(dur);
        setWaveform(audioEngine.getWaveformData(220));
      }

      const prev = paramsRef.current;
      let patch: Partial<SynthParams> = {};

        switch (moduleId) {
          case 'kickBody': {
            const nextTail = pickRandom(KICK_TAIL_TYPES);
            patch = {
              kickPower: true,
              kickTailType: nextTail,
              kickPhaseMode:
                nextTail === 'ZAAG' || nextTail === 'SAW' || Math.random() > 0.6
                  ? 'HARD'
                  : 'RESET',
              kickPhaseDeg: Math.random() > 0.7 ? pickRandom([0, 15, 30, 45]) : 0,
              kickPunch: randBetween(68, 98, 1),
              kickFmRatio: randBetween(0.5, 6.5, 0.25),
              kickTok: randBetween(38, 95, 1),
              kickTokBoost:
                nextTail === 'PIEP' || nextTail === 'ZAAG'
                  ? Math.random() > 0.25
                  : Math.random() > 0.55,
              kickSweepMs: randBetween(22, 96, 2),
            };
            break;
          }
          case 'krachPreEq': {
            const nextClip = pickRandom(KICK_CLIP_MODES);
            patch = {
              kickKrachPower: true,
              kickClipMode: nextClip,
              kickDrive: nextClip === 'GABBER' ? randBetween(36, 72, 1) : randBetween(34, 82, 1),
              kickEqFreqHz:
                nextClip === 'GABBER' ? randBetween(240, 620, 20) : randBetween(260, 3200, 20),
              kickEqGain: randBetween(32, 78, 1),
              kickEqSweep: nextClip === 'GABBER' ? Math.random() > 0.6 : Math.random() > 0.35,
            };
            break;
          }
          case 'rumbleStomp':
            patch = {
              kickRumblePower: true,
              kickRumbleAmt: randBetween(44, 92, 1),
              kickBpm: randBetween(138, 215, 1),
              kickDuck: randBetween(58, 95, 1),
              kickRumbleLpHz: randBetween(150, 560, 10),
              kickRumbleGroove: Math.random() > 0.4,
            };
            break;
          case 'kickAdsr':
            patch = {
              kickAttackMs: randBetween(0.5, 16.0, 0.5),
              kickDecayMs: randBetween(130, 560, 10),
              kickSustain: randBetween(20, 92, 1),
              kickReleaseMs: randBetween(90, 460, 10),
            };
            break;
          case 'kickLfo':
            patch = {
              kickLfoPower: true,
              kickLfoShape: pickRandom(KICK_LFO_SHAPES),
              kickLfoTarget: pickRandom(KICK_LFO_TARGETS),
              kickLfoRateHz: randBetween(0.6, 16.0, 0.2),
              kickLfoDepth: randBetween(24, 86, 1),
              kickLfoSync: Math.random() > 0.28,
            };
            break;
          case 'synthAdsr':
            patch = {
              attackMs: randBetween(5, 160, 1),
              decayMs: randBetween(90, 920, 10),
              sustain: randBetween(18, 94, 1),
              releaseMs: randBetween(70, 680, 10),
              synthAdsrFilterMod: Math.random() > 0.2,
            };
            break;
          case 'synthLfo':
            patch = {
              synthLfoPower: true,
              synthLfoShape: pickRandom(KICK_LFO_SHAPES),
              synthLfoTarget: pickRandom(SYNTH_LFO_TARGETS),
              synthLfoRateHz: randBetween(0.4, 14.0, 0.2),
              synthLfoDepth: randBetween(24, 86, 1),
              synthLfoSync: Math.random() > 0.28,
            };
            break;
          case 'osc':
            patch = {
              oscPower: true,
              oscWave: pickRandom(OSC_WAVES),
              oscLevel: randBetween(58, 96, 1),
              oscShape: randBetween(12, 92, 1),
              oscDetune: randBetween(8, 88, 1),
              oscNoise: Math.random() > 0.3 ? randBetween(6, 48, 1) : 0,
              oscRingMod: Math.random() > 0.62,
              oscInterval: pickRandom(OSC_INTERVAL_STEPS),
            };
            break;
          case 'grain': {
            const grainSize = randBetween(20, 380, 5);
            const maxOverlap = Math.min(185, Math.max(10, Math.floor(grainSize * 0.78)));
            patch = {
              grainPower: true,
              grainReverse: Math.random() > 0.58,
              grainFreeze: false,
              baseSpeed: randBetween(0.35, 2.15, 0.05),
              grainSizeMs: grainSize,
              grainOverlapMs: randBetween(10, maxOverlap, 5),
            };
            break;
          }
          case 'fmGrowl':
            patch = {
              fmPower: true,
              fmGrowl: randBetween(42, 98, 1),
              fmRatio: pickRandom(FM_RATIOS),
              fmWobbleRate: Math.random() > 0.15 ? randBetween(0.4, 12.5, 0.1) : 0,
              fmInflect: randBetween(20, 94, 1),
              fmMetalAmt: Math.random() > 0.48 ? randBetween(22, 94, 1) : 0,
              fmSubOctave: Math.random() > 0.25,
              fmUnison: Math.random() > 0.38,
            };
            break;
          case 'tone':
            patch = {
              tonePower: true,
              toneDrive: randBetween(20, 74, 1),
              toneMode: pickRandom(TONE_MODES),
            };
            break;
          case 'stabilise':
            patch = {
              spacePower: true,
              spaceAmount: randBetween(22, 84, 1),
            };
            break;
          case 'wahPedal':
            patch = {
              wahPower: true,
              subSolo: false,
              wahAmount: randBetween(42, 96, 1),
              wahBaseHz: randBetween(170, 560, 10),
              wahResonance: randBetween(36, 90, 1),
              wahMorph: randBetween(38, 96, 1),
            };
            break;
          case 'vowelTract':
            patch = {
              formantPower: true,
              fmVowel: randBetween(8, 94, 1),
              formantTalk: randBetween(44, 96, 1),
              notchEnable: Math.random() > 0.28,
              notchDepth: randBetween(32, 90, 1),
            };
            break;
          case 'throatComb':
            patch = {
              combPower: true,
              combKeyTrack: Math.random() > 0.22,
              fmMetal: randBetween(28, 88, 1),
              combHarmonic: pickRandom([1.5, 2.0, 3.0, 4.0, 6.0, 8.0]),
              combFeedbackAmt: randBetween(42, 86, 1),
              combDamp: randBetween(28, 88, 1),
            };
            break;
          case 'bitcrush':
            patch = {
              crushPower: true,
              fmCrush: randBetween(18, 84, 1),
            };
            break;
          case 'xoverSub':
            patch = {
              xoverFreqHz: randBetween(75, 175, 5),
              subPunch: randBetween(48, 92, 1),
              fmSubOctave: Math.random() > 0.25,
            };
            break;
          case 'disperser':
            patch = {
              disperserPower: true,
              disperserAmount: randBetween(34, 95, 1),
              disperserFreqHz: randBetween(120, 720, 10),
              disperserPinch: randBetween(38, 90, 1),
              disperserSweep: randBetween(35, 94, 1),
            };
            break;
          case 'freqShift': {
            const barber = Math.random() > 0.45;
            patch = {
              freqShiftPower: true,
              freqShiftBarber: barber,
              freqShiftHz: barber ? randBetween(-320, 320, 5) : randBetween(-220, 240, 5),
              freqShiftFeedback: randBetween(14, 72, 1),
              freqShiftMix: randBetween(28, 80, 1),
            };
            break;
          }
          case 'phaseScope':
            patch = {
              phaseAlignDeg: randBetween(-180, 180, 4),
              phaseInvertR: Math.random() > 0.72,
              haasPower: true,
              haasWidth: randBetween(24, 88, 1),
              haasMonoCheck: false,
              phaseScopeFreeze: false,
            };
            break;
          case 'reeseNotch':
            patch = {
              reesePower: true,
              reeseDepth: randBetween(38, 92, 1),
              reeseSweep: randBetween(16, 86, 1),
            };
            break;
          case 'vinylScratch':
            patch = {
              scratchPower: true,
              scratchAmount: randBetween(24, 88, 1),
              vinylBrake: false,
            };
            break;
          case 'spectralGate':
            patch = {
              spectralPower: true,
              spectralMix: randBetween(34, 88, 1),
              spectralThresh: randBetween(24, 66, 1),
              spectralReso: randBetween(38, 86, 1),
            };
            break;
          case 'stereoHaas':
            patch = {
              haasPower: true,
              haasWidth: randBetween(30, 88, 1),
              haasDelayMs: randBetween(3.5, 18.5, 0.5),
              haasDetune: randBetween(18, 76, 1),
              haasMonoCheck: false,
            };
            break;
          case 'subThump':
            patch = {
              thumpPower: true,
              thumpAmount: randBetween(32, 88, 1),
              thumpMode: pickRandom(['FAST', 'PUNCH', '808'] as SubThumpMode[]),
            };
            break;
          case 'ottMultiband':
            patch = {
              ottPower: true,
              ottAmount: randBetween(34, 84, 1),
              ottMode: pickRandom(['UPWARD', 'SLAM', 'CRISP'] as OttFlavorMode[]),
            };
            break;
        }

      const next: SynthParams = { ...prev, ...patch };
      if (!areSynthParamsEqual(beforeSnap.params, next)) {
        recordDiscreteChange(beforeSnap);
      }
      paramsRef.current = next;
      setParams(next);
      audioEngine.updateLiveParams(next);
    },
    [activeSampleId, captureCurrentSnapshot, recordDiscreteChange]
  );

  const cycleOscInterval = () => {
    const idx = OSC_INTERVAL_STEPS.indexOf(params.oscInterval);
    const next = OSC_INTERVAL_STEPS[(idx + 1) % OSC_INTERVAL_STEPS.length];
    updateParam('oscInterval', next);
  };

  const cycleKickPhaseMode = () => {
    const curMode: KickPhaseMode = params.kickPhaseMode ?? 'RESET';
    const idx = KICK_PHASE_MODES.indexOf(curMode);
    const next = KICK_PHASE_MODES[(idx + 1) % KICK_PHASE_MODES.length];
    updateParam('kickPhaseMode', next);
  };

  const handleRemoveSample = () => {
    setErrorBanner(null);
    const beforeSnap = captureCurrentSnapshot();
    audioEngine.clearSample();
    hasSampleRef.current = false;
    setHasSample(false);
    setCustomFileName(null);
    setWaveform(null);
    const next: SynthParams = {
      ...paramsRef.current,
      grainPower: false,
      oscPower: true,
    };
    if (!areSynthParamsEqual(beforeSnap.params, next)) {
      recordDiscreteChange(beforeSnap);
    }
    paramsRef.current = next;
    setParams(next);
    audioEngine.updateLiveParams(next);
  };

  const selectBuiltInSample = useCallback(
    (id: BuiltInSampleId) => {
      setErrorBanner(null);
      const beforeSnap = captureCurrentSnapshot();
      setCustomFileName(null);
      setActiveSampleId(id);
      hasSampleRef.current = true;
      setHasSample(true);
      const dur = audioEngine.generateBuiltInSample(id);
      setDurationSec(dur);
      setWaveform(audioEngine.getWaveformData(220));
      const next: SynthParams = { ...paramsRef.current, grainPower: true };
      if (!areSynthParamsEqual(beforeSnap.params, next)) {
        recordDiscreteChange(beforeSnap);
      }
      paramsRef.current = next;
      setParams(next);
      audioEngine.updateLiveParams(next);
    },
    [captureCurrentSnapshot, recordDiscreteChange]
  );

  const loadCustomAudioFile = async (file: File) => {
    setErrorBanner(null);
    try {
      const beforeSnap = captureCurrentSnapshot();
      const dur = await audioEngine.loadAudioFile(file);
      setCustomFileName(file.name);
      hasSampleRef.current = true;
      setHasSample(true);
      setDurationSec(dur);
      setWaveform(audioEngine.getWaveformData(220));
      const next: SynthParams = { ...paramsRef.current, grainPower: true };
      if (!areSynthParamsEqual(beforeSnap.params, next)) {
        recordDiscreteChange(beforeSnap);
      }
      paramsRef.current = next;
      setParams(next);
      audioEngine.updateLiveParams(next);
    } catch (err) {
      console.error('Failed to decode audio file:', err);
      setErrorBanner('Could not decode that audio format. Try a standard WAV, MP3, OGG, or M4A file.');
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await loadCustomAudioFile(file);
    e.target.value = '';
  };

  const cycleBuiltInSource = () => {
    if (!hasSample) {
      selectBuiltInSample(activeSampleId);
      return;
    }
    const curIdx = BUILT_IN_SAMPLES.findIndex((s) => s.id === activeSampleId);
    const next = BUILT_IN_SAMPLES[(curIdx + 1) % BUILT_IN_SAMPLES.length];
    selectBuiltInSample(next.id);
  };

  const presetIdxRef = useRef(presetIdx);
  const activeSampleIdRef = useRef(activeSampleId);
  const activeCategoryFilterRef = useRef(activeCategoryFilter);
  presetIdxRef.current = presetIdx;
  activeSampleIdRef.current = activeSampleId;
  activeCategoryFilterRef.current = activeCategoryFilter;

  const stepPreset = useCallback(
    (delta: number) => {
      const catFilter = activeCategoryFilterRef.current;
      if (catFilter !== 'All') {
        const matchingIndices: number[] = [];
        allPresets.forEach((p, idx) => {
          if (p.category === catFilter) {
            matchingIndices.push(idx);
          }
        });
        if (matchingIndices.length > 0) {
          const currentPos = matchingIndices.indexOf(presetIdxRef.current);
          const nextPos =
            currentPos === -1
              ? delta >= 0
                ? 0
                : matchingIndices.length - 1
              : ((currentPos + delta) % matchingIndices.length + matchingIndices.length) %
                matchingIndices.length;
          applyPreset(matchingIndices[nextPos]);
          return;
        }
      }
      applyPreset(presetIdxRef.current + delta);
    },
    [allPresets, applyPreset]
  );

  // Web MIDI Hardware Controller Engine + MIDI CC Learn & Live Modulation
  useEffect(() => {
    if (midiEngine.isSupported()) {
      midiEngine.init().catch(() => {});
    }
    const unsubStatus = midiEngine.subscribeStatus(setMidiStatus);

    const flashModulatedTarget = (targetId: string) => {
      setActiveCcTargetId(targetId);
      if (ccFlashTimerRef.current !== null) {
        window.clearTimeout(ccFlashTimerRef.current);
      }
      ccFlashTimerRef.current = window.setTimeout(() => {
        setActiveCcTargetId(null);
      }, 260);
    };

    const applyCcValueToTarget = (
      targetId: string,
      ccVal: number,
      isRisingEdge: boolean
    ) => {
      const spec = MIDI_TARGET_SPECS[targetId];
      if (!spec) return;
      flashModulatedTarget(targetId);

      if (spec.kind === 'range' && spec.paramKey && spec.min !== undefined && spec.max !== undefined) {
        const mapped = mapMidiCcToRange(ccVal, spec.min, spec.max, spec.step ?? 1);
        updateParam(spec.paramKey, mapped as never);
        return;
      }

      if (spec.kind === 'choice' && spec.paramKey && spec.choices && spec.choices.length > 0) {
        const choiceIdx = Math.min(
          spec.choices.length - 1,
          Math.max(0, Math.floor((ccVal / 128) * spec.choices.length))
        );
        updateParam(spec.paramKey, spec.choices[choiceIdx] as never);
        return;
      }

      if (spec.kind === 'toggle' && spec.paramKey) {
        if (midiButtonCcModeRef.current === 'gate') {
          const nextBool = ccVal >= 64;
          if (spec.paramKey === 'grainPower' && nextBool && !hasSampleRef.current) {
            selectBuiltInSample(activeSampleIdRef.current);
          } else {
            updateParam(spec.paramKey, nextBool as never);
          }
        } else if (isRisingEdge) {
          const curBool = Boolean(paramsRef.current[spec.paramKey]);
          const nextBool = !curBool;
          if (spec.paramKey === 'grainPower' && nextBool && !hasSampleRef.current) {
            selectBuiltInSample(activeSampleIdRef.current);
          } else {
            updateParam(spec.paramKey, nextBool as never);
          }
        }
        return;
      }

      if (spec.kind === 'action' && isRisingEdge) {
        if (targetId.startsWith('action.rand.')) {
          const modId = targetId.slice('action.rand.'.length) as ModuleRandomizeId;
          handleRandomizeModule(modId);
          return;
        }
        switch (targetId) {
          case 'action.prevPreset':
            stepPreset(-1);
            break;
          case 'action.nextPreset':
            stepPreset(1);
            break;
          case 'action.init':
            handleInitPatch();
            break;
          case 'action.undo':
            handleUndo();
            break;
          case 'action.redo':
            handleRedo();
            break;
          case 'action.randomize':
            handleRandomizeAll();
            break;
          case 'action.play':
            toggleDronePlayback();
            break;
          case 'action.octaveDown':
            updateParam('octave', Math.max(0, paramsRef.current.octave - 1));
            break;
          case 'action.octaveUp':
            updateParam('octave', Math.min(4, paramsRef.current.octave + 1));
            break;
        }
      }
    };

    const unsubEvents = midiEngine.subscribeEvents((ev) => {
      if (
        selectedMidiDeviceRef.current !== 'all' &&
        ev.deviceId !== 'virtual-test-port' &&
        ev.deviceId !== selectedMidiDeviceRef.current
      ) {
        return;
      }
      if (
        selectedMidiChannelRef.current !== null &&
        ev.channel !== selectedMidiChannelRef.current
      ) {
        return;
      }

      if (ev.type === 'noteon') {
        setLastMidiActivity(`Note ${midiToNoteLabel(ev.note)} · Vel ${ev.velocity}`);
        handleNoteDown(ev.note);
        return;
      }

      if (ev.type === 'noteoff') {
        handleNoteUp(ev.note);
        return;
      }

      if (ev.type === 'pitchbend') {
        const st = ev.norm * 2;
        audioEngine.setPitchBendSemitones(st);
        setLastMidiActivity(`Pitch Bend ${st >= 0 ? '+' : ''}${st.toFixed(1)} st`);
        return;
      }

      if (ev.type === 'cc') {
        setLastMidiActivity(`CC ${ev.cc} = ${ev.value} · Ch ${ev.channel}`);
        const latchKey = `${ev.channel}:${ev.cc}`;
        const wasHigh = ccGateLatchRef.current.get(latchKey) ?? false;
        const isHigh = ev.value >= 64;
        const isRisingEdge = !wasHigh && isHigh;
        ccGateLatchRef.current.set(latchKey, isHigh);

        // 1. Capture incoming CC for armed control in MIDI Learn Mode
        const armedId = armedTargetIdRef.current;
        if (midiLearnModeRef.current && armedId) {
          const spec = MIDI_TARGET_SPECS[armedId];
          const learnedChannel = selectedMidiChannelRef.current;
          const nextBinding: MidiCCBinding = {
            targetId: armedId,
            label: spec?.label || armedId,
            cc: ev.cc,
            channel: learnedChannel,
          };

          setMidiBindings((prev) => {
            const cleaned: Record<string, MidiCCBinding> = {};
            for (const [k, b] of Object.entries(prev) as [string, MidiCCBinding][]) {
              const sameCcAndChan =
                b.cc === ev.cc &&
                (b.channel === null || learnedChannel === null || b.channel === learnedChannel);
              if (!sameCcAndChan && k !== armedId) {
                cleaned[k] = b;
              }
            }
            cleaned[armedId] = nextBinding;
            return cleaned;
          });
          setArmedTargetId(null);
          applyCcValueToTarget(armedId, ev.value, isHigh);
          return;
        }

        // 2. Route CC to bound synth targets
        const currentMap = midiBindingsRef.current;
        for (const binding of Object.values(currentMap) as MidiCCBinding[]) {
          if (
            binding.cc === ev.cc &&
            (binding.channel === null || binding.channel === ev.channel)
          ) {
            applyCcValueToTarget(binding.targetId, ev.value, isRisingEdge);
          }
        }
      }
    });

    return () => {
      unsubStatus();
      unsubEvents();
    };
  }, [
    handleInitPatch,
    handleNoteDown,
    handleNoteUp,
    handleRandomizeAll,
    handleRandomizeModule,
    handleRedo,
    handleUndo,
    selectBuiltInSample,
    stepPreset,
    toggleDronePlayback,
    updateParam,
  ]);

  const handleToggleMidiLearn = useCallback(() => {
    setMidiLearnMode((prev) => {
      const next = !prev;
      if (next) {
        midiEngine.init().catch(() => {});
      } else {
        setArmedTargetId(null);
      }
      return next;
    });
  }, []);

  const handleArmMidiTarget = useCallback((targetId: string) => {
    setArmedTargetId((prev) => (prev === targetId ? null : targetId));
  }, []);

  const handleUnbindMidiTarget = useCallback((targetId: string) => {
    setMidiBindings((prev) => {
      const next = { ...prev };
      delete next[targetId];
      return next;
    });
    setArmedTargetId((prev) => (prev === targetId ? null : prev));
  }, []);

  const handleClearAllMidiBindings = useCallback(() => {
    setMidiBindings({});
    setArmedTargetId(null);
  }, []);

  const handleSendTestCC = useCallback(
    (cc: number, val: number) => {
      const ch = selectedMidiChannel ?? 1;
      if (val === 127) {
        // Ensure momentary button press always triggers rising-edge latch toggles/actions
        ccGateLatchRef.current.set(`${ch}:${cc}`, false);
      }
      midiEngine.injectTestCC(cc, val, ch);
    },
    [selectedMidiChannel]
  );

  const midiContextValue = useMemo(
    () => ({
      midiLearnMode,
      armedTargetId,
      bindings: midiBindings,
      activeCcTargetId,
      armTarget: handleArmMidiTarget,
      unbindTarget: handleUnbindMidiTarget,
    }),
    [
      midiLearnMode,
      armedTargetId,
      midiBindings,
      activeCcTargetId,
      handleArmMidiTarget,
      handleUnbindMidiTarget,
    ]
  );

  const activeAudioLabel = params.kickMode
    ? `KICK · ${params.kickTailType ?? 'KRACH'} + ${params.kickClipMode ?? 'BOILER'} · ${
        params.kickLoop ? `${Math.round(params.kickBpm ?? 165)} BPM` : '1-SHOT'
      }`
    : !hasSample
    ? 'No Sample (OSC Only)'
    : customFileName
    ? customFileName
    : BUILT_IN_SAMPLES.find((s) => s.id === activeSampleId)?.label || 'Neuro Reese Bass';

  const displayedMidi = activeMidiNote ?? telemetry.activeMidiNote;

  return (
    <MidiLearnContext.Provider value={midiContextValue}>
      <div className="min-h-screen w-full flex flex-col items-center justify-center p-3 sm:p-5 lg:p-6">
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          onChange={handleFileInputChange}
          className="hidden"
        />

        {showComponentOverview ? (
          <div className="w-full flex flex-col items-center">
            <ReferenceAssembly />
          </div>
        ) : (
        <PluginChassis
          topBar={
            <PluginTopBar
              brandLabel="IN THE MIX"
              presetName={activePresetLabel}
              presets={allPresets.map((p) => p.name)}
              presetItems={presetMenuItems}
              customCategories={customCategories}
              activeCategoryFilter={activeCategoryFilter}
              onChangeCategoryFilter={setActiveCategoryFilter}
              onAddCustomCategory={handleAddCustomCategory}
              onRenameCustomCategory={handleRenameCustomCategory}
              onDeleteCustomCategory={handleDeleteCustomCategory}
              onSelectPreset={(name) => {
                const found = allPresets.findIndex((p) => p.name === name);
                if (found !== -1) applyPreset(found);
              }}
              onPreviewPreset={handlePreviewPreset}
              onStopPreviewPreset={handleStopPreviewPreset}
              previewingPresetName={previewingPresetName}
              onSaveUserPreset={handleSaveUserPreset}
              onChangeUserPresetCategory={handleChangeUserPresetCategory}
              onDeleteUserPreset={handleDeleteUserPreset}
              onPrevPreset={() => stepPreset(-1)}
              onNextPreset={() => stepPreset(1)}
              onUndo={handleUndo}
              onRedo={handleRedo}
              canUndo={canUndo}
              canRedo={canRedo}
              undoCount={undoCount}
              redoCount={redoCount}
              maxHistory={maxHistory}
              onInit={handleInitPatch}
              onRandomize={handleRandomizeAll}
              onUploadAction={() => {
                audioEngine.unMute().catch(() => {});
                fileInputRef.current?.click();
              }}
              uploadTooltip="Load Custom Audio File (WAV, MP3, OGG, M4A)"
              onSaveAction={cycleBuiltInSource}
              saveTooltip="Cycle Built-In Granular Loops"
              onMidiLearnAction={handleToggleMidiLearn}
              midiLearnActive={midiLearnMode}
              midiMappedCount={Object.keys(midiBindings).length}
              onThemeAction={() => setShowThemePanel((v) => !v)}
              themeActive={showThemePanel}
              onSettingsAction={() => setShowSourceDrawer((v) => !v)}
              settingsActive={showSourceDrawer}
            />
          }
        >
          {/* Non-blocking Error Notification */}
          {errorBanner && (
            <div className="mb-3 px-4 py-2 rounded-xl bg-[#2B181E] border border-[#FB7185]/30 text-xs text-[#FDA4AF] flex items-center justify-between">
              <span>{errorBanner}</span>
              <button
                type="button"
                onClick={() => setErrorBanner(null)}
                className="text-[11px] font-mono uppercase text-white/70 hover:text-white cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* MIDI Learn & Hardware Controller Inspector Drawer */}
          <MidiLearnPanel
            midiLearnMode={midiLearnMode}
            armedTargetId={armedTargetId}
            onCancelArm={() => setArmedTargetId(null)}
            onExitMidiLearn={() => {
              setMidiLearnMode(false);
              setArmedTargetId(null);
            }}
            midiStatus={midiStatus}
            onRefreshMidi={() => {
              midiEngine.init().catch(() => {});
            }}
            selectedDeviceId={selectedMidiDeviceId}
            onSelectDevice={setSelectedMidiDeviceId}
            selectedChannel={selectedMidiChannel}
            onSelectChannel={setSelectedMidiChannel}
            buttonCcMode={midiButtonCcMode}
            onChangeButtonCcMode={setMidiButtonCcMode}
            lastActivityLabel={lastMidiActivity}
            bindings={midiBindings}
            onUnbindTarget={handleUnbindMidiTarget}
            onClearAllBindings={handleClearAllMidiBindings}
            onSendTestCC={handleSendTestCC}
          />

          {/* Theme Colours, Surface Finishes & Shadow Customizer Drawer */}
          {showThemePanel && (
            <ThemeCustomizerPanel
              theme={theme}
              onChangeTheme={setTheme}
              onClose={() => setShowThemePanel(false)}
            />
          )}

          {/* Optional Audio Buffer Drawer (Gear Icon) */}
          {showSourceDrawer && (
            <div
              style={{ borderRadius: 'var(--module-radius)' }}
              className="mb-3.5 px-4 py-3 bg-[#141720]/95 border border-white/10 flex flex-wrap items-center justify-between gap-4 text-[#E4E7F0]"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-[11px] font-semibold tracking-[0.09em] uppercase text-[#8A91A4] mr-1">
                  Sample Source:
                </span>
                <SegmentedSwitch
                  accent="blue"
                  value={
                    !hasSample
                      ? ('none' as BuiltInSampleId)
                      : customFileName
                      ? ('custom' as BuiltInSampleId)
                      : activeSampleId
                  }
                  onChange={(val) => {
                    if (val === ('none' as BuiltInSampleId)) {
                      handleRemoveSample();
                    } else if (val !== ('custom' as BuiltInSampleId)) {
                      selectBuiltInSample(val);
                    }
                  }}
                  options={[
                    { value: 'none' as BuiltInSampleId, label: 'Off (OSC Only)' },
                    ...BUILT_IN_SAMPLES.map((s) => ({ value: s.id, label: s.label })),
                  ]}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    audioEngine.unMute().catch(() => {});
                    fileInputRef.current?.click();
                  }}
                  className="px-3.5 py-1.5 rounded-full bg-[#222633] border border-white/15 hover:border-white/35 text-[10.5px] font-display font-semibold tracking-[0.09em] uppercase text-[#E4E7F0] hover:text-white flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors"
                >
                  <Upload size={12} />
                  <span>Load Audio File</span>
                </button>

                {hasSample ? (
                  <button
                    type="button"
                    onClick={handleRemoveSample}
                    className="px-3 py-1.5 rounded-full bg-[#291820] border border-[#FB7185]/35 hover:border-[#FB7185]/65 text-[10.5px] font-display font-semibold tracking-[0.09em] uppercase text-[#FDA4AF] hover:text-white flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors"
                  >
                    <X size={12} />
                    <span>Remove Sample</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => selectBuiltInSample(activeSampleId)}
                    className="px-3 py-1.5 rounded-full bg-[#1C2434] border border-white/15 hover:border-white/35 text-[10.5px] font-display font-semibold tracking-[0.09em] uppercase text-[#98B4FF] hover:text-white flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors"
                  >
                    <RotateCcw size={12} />
                    <span>Restore Loop</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Top Panoramic Granular + FM Growl Envelope & Live FFT Screen */}
          <SynthMasterScreen
            title="JUNOSCRATCH"
            audioLabel={activeAudioLabel}
            hasSample={hasSample}
            oscWave={params.oscWave}
            onClearSample={handleRemoveSample}
            onRestoreSample={() => selectBuiltInSample(activeSampleId)}
            durationSec={durationSec}
            isPlaying={isSynthActive}
            bypassed={params.bypass}
            speedActive={!params.kickMode && hasSample && params.grainPower}
            pitchActive={
              Boolean(params.kickMode) ||
              params.fmPower ||
              params.oscPower ||
              (hasSample && params.grainPower)
            }
            speedPoints={speedEnv.points}
            pitchPoints={pitchEnv.points}
            onChangeSpeedPoints={handleSpeedPoints}
            onChangePitchPoints={handlePitchPoints}
            curveMode={params.curveMode}
            onChangeCurveMode={(m) => updateParam('curveMode', m)}
            curveSpeed={params.curveSpeed}
            onChangeCurveSpeed={(s) => updateParam('curveSpeed', s)}
            playhead={telemetry.phase}
            waveform={waveform}
            fftBins={telemetry.fftBins}
            liveWaveBars={telemetry.masterWaveBars}
            screenColor={theme.screenColor}
            waveformColor={theme.waveformColor}
            speedColor={theme.speedCurveColor}
            pitchColor={theme.growlCurveColor}
            onDropAudioFile={loadCustomAudioFile}
            onClickLoadAudio={() => {
              audioEngine.unMute().catch(() => {});
              fileInputRef.current?.click();
            }}
          />

          {/* Hardware Rack Tab Bar (Tab 1 Doubles as Synth & Master <-> Kick & Master Switch) */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 px-1">
            <div
              role="tablist"
              aria-label="Synthesizer hardware rack pages"
              className="dsp-recessed-slot p-1 rounded-xl inline-flex flex-wrap items-center gap-1 shrink-0"
            >
              <VoicesKickTabSwitch
                isActiveTab={activeRackTab === 'voices'}
                kickMode={Boolean(params.kickMode)}
                onSelectVoicesTab={() => setActiveRackTab('voices')}
                onToggleKickMode={() => updateParam('kickMode', !params.kickMode)}
              />
              <button
                type="button"
                role="tab"
                aria-selected={activeRackTab === 'growlLab'}
                onClick={() => setActiveRackTab('growlLab')}
                className={`px-3 py-1.5 rounded-lg font-display text-[10.5px] font-semibold tracking-[0.09em] uppercase whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  activeRackTab === 'growlLab'
                    ? 'dsp-button-cap text-white shadow-sm'
                    : 'text-[#848C9E] hover:text-[#D5DBE8]'
                }`}
              >
                Growl FX Lab
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeRackTab === 'phaseWarp'}
                onClick={() => setActiveRackTab('phaseWarp')}
                className={`px-3 py-1.5 rounded-lg font-display text-[10.5px] font-semibold tracking-[0.09em] uppercase whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  activeRackTab === 'phaseWarp'
                    ? 'dsp-button-cap text-white shadow-sm'
                    : 'text-[#848C9E] hover:text-[#D5DBE8]'
                }`}
              >
                Phase &amp; Warp
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeRackTab === 'spaceOtt'}
                onClick={() => setActiveRackTab('spaceOtt')}
                className={`px-3 py-1.5 rounded-lg font-display text-[10.5px] font-semibold tracking-[0.09em] uppercase whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  activeRackTab === 'spaceOtt'
                    ? 'dsp-button-cap text-white shadow-sm'
                    : 'text-[#848C9E] hover:text-[#D5DBE8]'
                }`}
              >
                Space &amp; OTT
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeRackTab === 'fxChain'}
                onClick={() => setActiveRackTab('fxChain')}
                className={`px-3 py-1.5 rounded-lg font-display text-[10.5px] font-semibold tracking-[0.09em] uppercase whitespace-nowrap shrink-0 cursor-pointer transition-colors inline-flex items-center gap-1.5 ${
                  activeRackTab === 'fxChain'
                    ? 'dsp-button-cap text-white shadow-sm'
                    : 'text-[#848C9E] hover:text-[#D5DBE8]'
                }`}
              >
                <span>FX Chain</span>
                {(params.fxChain?.length ?? 0) > 0 && (
                  <span className="font-mono text-[9px] tabular-nums text-[var(--accent-cyan-bright)]">
                    {params.fxChain!.length}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Middle Hardware Control Deck + Flanking IN / OUT Edge Faders */}
          <div className="mt-2.5 flex flex-col lg:flex-row items-stretch gap-2.5 min-w-0">
            {/* Far Left Edge Input Gain Fader */}
            <div className="hidden lg:flex items-center justify-center shrink-0">
              <EdgeFader
                label="IN"
                midiId="inGainDb"
                value={params.inGainDb}
                meterLevel={isSynthActive ? telemetry.inMeter : 0.05}
                onChange={(v) => updateParam('inGainDb', v)}
                height={188}
              />
            </div>

            {/* Center Hardware Rack: Modular FX Chain Patchbay on Tab 5, or 4/3-Column Hardware Deck on Tabs 1-4 */}
            {activeRackTab === 'fxChain' ? (
              <div className="flex-1 min-w-0 flex flex-col justify-between gap-2.5">
                <FxChainPatchbay
                  slots={params.fxChain ?? []}
                  onChangeSlots={(nextSlots) => updateParam('fxChain', nextSlots)}
                  isPlaying={isSynthActive}
                  bypassed={params.bypass}
                  meterLevel={isSynthActive ? telemetry.outMeter : 0.05}
                />

                {/* Persistent Bottom Utility Strip on FX Chain Tab */}
                <div className="px-1 flex flex-wrap sm:flex-nowrap items-end justify-between gap-3">
                  <div className="flex-1 min-w-[140px] max-w-[420px]">
                    <DualFilterBar
                      hpMidiId="hpFreq"
                      lpMidiId="lpFreq"
                      hpFreq={params.hpFreq}
                      lpFreq={params.lpFreq}
                      onChangeHp={(hz) => updateParam('hpFreq', hz)}
                      onChangeLp={(hz) => updateParam('lpFreq', hz)}
                    />
                  </div>

                  <div className="flex items-end gap-3 ml-auto">
                    <MicroKnob
                      midiId="dryWet"
                      leftLabel="DRY"
                      rightLabel="WET"
                      accent="neutral"
                      value={params.dryWet}
                      defaultValue={INIT_SYNTH_PARAMS.dryWet}
                      formatValue={(v) => `${Math.round(v)}% Wet`}
                      onChange={(v) => updateParam('dryWet', v)}
                    />

                    <div className="flex items-center gap-1.5 shrink-0 pb-2">
                      <HardwarePillButton
                        label="BYPASS"
                        midiId="bypass"
                        active={params.bypass}
                        accent="amber"
                        onToggle={() => updateParam('bypass', !params.bypass)}
                      />
                      <TransportPillButton
                        midiId="action.play"
                        isPlaying={isDronePlaying}
                        onToggle={toggleDronePlayback}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
            <div
              className={`flex-1 min-w-0 grid grid-cols-1 md:grid-cols-2 ${
                activeRackTab === 'voices' ||
                activeRackTab === 'growlLab' ||
                activeRackTab === 'phaseWarp'
                  ? 'xl:grid-cols-[minmax(0,1.04fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.58fr)]'
                  : 'xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1.15fr)_minmax(0,1.58fr)]'
              } gap-2.5`}
            >
              {activeRackTab === 'voices' && params.kickMode ? (
                <>
                  {/* KICK & MASTER — MODULE 0: KICK BODY (Tok + Exponential Pitch-Drop + 5 Tail Topologies) */}
                  <ModuleCard
                    title="KICK BODY"
                    active={(params.kickPower ?? true) && !params.bypass}
                    className="p-3.5"
                    onRandomize={() => handleRandomizeModule('kickBody')}
                    randomizeAccent="cyan"
                    randomizeMidiId="action.rand.kickBody"
                    headerActions={
                      <>
                        <IconToggleButton
                          icon="spark"
                          midiId="kickTokBoost"
                          label="High-Voltage Piep / Zaag Tok Transient Boost"
                          active={Boolean(params.kickTokBoost)}
                          accent="cyan"
                          onToggle={() => updateParam('kickTokBoost', !params.kickTokBoost)}
                        />
                        <IconToggleButton
                          icon="phase"
                          midiId="kickPhaseMode"
                          label={
                            (params.kickPhaseMode ?? 'RESET') === 'RESET'
                              ? `Phase Reset (${Math.round(params.kickPhaseDeg ?? 0)}°) — Zero Drift on Every Trigger`
                              : (params.kickPhaseMode ?? 'RESET') === 'HARD'
                              ? `Master-to-Slave Hard Sync (${Math.round(params.kickPhaseDeg ?? 0)}°) — Locked Harmonics`
                              : 'Free-Running Oscillator Phase (Analog Drift)'
                          }
                          active={(params.kickPhaseMode ?? 'RESET') !== 'FREE'}
                          accent="cyan"
                          onToggle={cycleKickPhaseMode}
                        />
                        <IconToggleButton
                          icon="power"
                          midiId="kickPower"
                          label="Kick Drum Body & Tail Oscillator Power"
                          active={params.kickPower ?? true}
                          accent="cyan"
                          onToggle={() => updateParam('kickPower', !(params.kickPower ?? true))}
                        />
                      </>
                    }
                  >
                    <div className="flex flex-col justify-between h-full gap-2.5 pt-0.5">
                      <div className="grid grid-cols-[66px_minmax(0,1fr)] items-center gap-x-2">
                        <RotaryKnob
                          size="md"
                          midiId="kickPunch"
                          accent="cyan"
                          value={params.kickPunch ?? 78}
                          min={0}
                          max={100}
                          step={1}
                          defaultValue={INIT_SYNTH_PARAMS.kickPunch}
                          label="PUNCH"
                          showPerimeterDots
                          formatValue={(v) => `+${Math.round(18 + (v / 100) * 44)} st Drop`}
                          onChange={(v) => updateParam('kickPunch', v)}
                          className="justify-self-center"
                        />

                        <KickOscDisplay
                          midiId="kickTailType"
                          tailType={params.kickTailType ?? '909'}
                          phaseMode={params.kickPhaseMode ?? 'RESET'}
                          phaseDeg={params.kickPhaseDeg ?? 0}
                          onCyclePhaseMode={cycleKickPhaseMode}
                          punch={params.kickPunch ?? 78}
                          fmRatio={params.kickFmRatio ?? 1.5}
                          tok={params.kickTok ?? 58}
                          sweepMs={params.kickSweepMs ?? 42}
                          decayMs={params.kickDecayMs ?? 280}
                          sustain={params.kickSustain ?? 64}
                          loopActive={Boolean(params.kickLoop)}
                          onToggleLoop={() => updateParam('kickLoop', !params.kickLoop)}
                          accent="cyan"
                          onChangeTailType={(t) => updateParam('kickTailType', t)}
                        />
                      </div>

                      <div className="grid grid-cols-4 gap-x-1 w-full justify-items-center items-end">
                        <MicroKnob
                          label="RATIO"
                          midiId="kickFmRatio"
                          accent="cyan"
                          value={params.kickFmRatio ?? 1.5}
                          min={0.5}
                          max={8.0}
                          step={0.25}
                          defaultValue={INIT_SYNTH_PARAMS.kickFmRatio}
                          formatValue={(v) => `${v.toFixed(2)}x Harm`}
                          onChange={(v) => updateParam('kickFmRatio', v)}
                        />
                        <MicroKnob
                          label="TOK"
                          midiId="kickTok"
                          accent="cyan"
                          value={params.kickTok ?? 58}
                          min={0}
                          max={100}
                          step={1}
                          defaultValue={INIT_SYNTH_PARAMS.kickTok}
                          formatValue={(v) => `${Math.round(v)}% Click`}
                          onChange={(v) => updateParam('kickTok', v)}
                        />
                        <MicroKnob
                          label="SWEEP"
                          midiId="kickSweepMs"
                          accent="cyan"
                          value={params.kickSweepMs ?? 42}
                          min={10}
                          max={180}
                          step={2}
                          defaultValue={INIT_SYNTH_PARAMS.kickSweepMs}
                          formatValue={(v) => `${Math.round(v)} ms`}
                          onChange={(v) => updateParam('kickSweepMs', v)}
                        />
                        <MicroKnob
                          label="PHASE"
                          midiId="kickPhaseDeg"
                          accent="cyan"
                          value={params.kickPhaseDeg ?? 0}
                          min={0}
                          max={360}
                          step={5}
                          defaultValue={0}
                          disabled={(params.kickPhaseMode ?? 'RESET') === 'FREE'}
                          formatValue={(v) => `${Math.round(v)}° Start`}
                          onChange={(v) => updateParam('kickPhaseDeg', v)}
                        />
                      </div>
                    </div>
                  </ModuleCard>

                  {/* KICK & MASTER — MODULE 1: KRACH & PRE-EQ (Frequency Hunt Resonant EQ + Multi-Stage Clipper/Wavefolder) */}
                  <ModuleCard
                    title="KRACH & PRE-EQ"
                    active={(params.kickKrachPower ?? true) && !params.bypass}
                    className="p-3.5"
                    onRandomize={() => handleRandomizeModule('krachPreEq')}
                    randomizeAccent="amber"
                    randomizeMidiId="action.rand.krachPreEq"
                    headerActions={
                      <>
                        <IconToggleButton
                          icon="spark"
                          midiId="kickEqSweep"
                          label="Modulate Pre-EQ Frequency Hunt with Envelope Curve"
                          active={params.kickEqSweep ?? false}
                          accent="amber"
                          onToggle={() =>
                            updateParam('kickEqSweep', !(params.kickEqSweep ?? false))
                          }
                        />
                        <IconToggleButton
                          icon="power"
                          midiId="kickKrachPower"
                          label="Pre-Distortion Frequency Hunt & Multi-Stage Clipper Power"
                          active={params.kickKrachPower ?? true}
                          accent="amber"
                          onToggle={() =>
                            updateParam('kickKrachPower', !(params.kickKrachPower ?? true))
                          }
                        />
                      </>
                    }
                  >
                    <div className="grid grid-cols-[82px_minmax(0,1fr)] items-end gap-x-2.5 h-full pt-0.5">
                      <RotaryKnob
                        size="lg"
                        midiId="kickDrive"
                        accent="amber"
                        value={params.kickDrive ?? 54}
                        min={0}
                        max={100}
                        step={1}
                        defaultValue={54}
                        minLabel="0"
                        maxLabel="100"
                        label="KRACH"
                        showZeroRingMarker
                        formatValue={(v) => `${Math.round(v)}% Slam`}
                        onChange={(v) => updateParam('kickDrive', v)}
                        className="self-end justify-self-center"
                      />

                      <div className="h-full flex flex-col justify-between items-stretch gap-2.5">
                        <KrachEqClipDisplay
                          midiId="kickClipMode"
                          clipMode={params.kickClipMode ?? 'GABBER'}
                          drive={params.kickKrachPower ?? true ? params.kickDrive ?? 54 : 0}
                          eqFreqHz={
                            isSynthActive && (params.kickEqSweep ?? false)
                              ? telemetry.kickEqLiveHz
                              : params.kickEqFreqHz ?? 240
                          }
                          eqGain={params.kickKrachPower ?? true ? params.kickEqGain ?? 56 : 0}
                          accent="amber"
                          onChangeClipMode={(m) => updateParam('kickClipMode', m)}
                        />
                        <div className="grid grid-cols-2 gap-x-2 w-full justify-items-center items-end">
                          <MicroKnob
                            label="HUNT HZ"
                            midiId="kickEqFreqHz"
                            accent="amber"
                            value={params.kickEqFreqHz ?? 240}
                            min={240}
                            max={4200}
                            step={20}
                            defaultValue={240}
                            formatValue={(v) =>
                              v >= 1000 ? `${(v / 1000).toFixed(2)} kHz` : `${Math.round(v)} Hz`
                            }
                            onChange={(v) => updateParam('kickEqFreqHz', v)}
                          />
                          <MicroKnob
                            label="PEAK Q"
                            midiId="kickEqGain"
                            accent="amber"
                            value={params.kickEqGain ?? 56}
                            min={0}
                            max={100}
                            step={1}
                            defaultValue={56}
                            formatValue={(v) => `+${((v / 100) * 13.5).toFixed(1)} dB`}
                            onChange={(v) => updateParam('kickEqGain', v)}
                          />
                        </div>
                      </div>
                    </div>
                  </ModuleCard>

                  {/* KICK & MASTER — MODULE 2: RUMBLE & STOMP (Industrial Sub-Rumble Bus + Sidechain Duck + 4/4 BPM Clock) */}
                  <ModuleCard
                    title="RUMBLE & STOMP"
                    active={(Boolean(params.kickRumblePower) || Boolean(params.kickLoop)) && !params.bypass}
                    className="p-3.5"
                    onRandomize={() => handleRandomizeModule('rumbleStomp')}
                    randomizeAccent="blue"
                    randomizeMidiId="action.rand.rumbleStomp"
                    headerActions={
                      <>
                        <IconToggleButton
                          icon="phase"
                          midiId="kickRumbleGroove"
                          label={
                            params.kickRumbleGroove
                              ? 'Dotted 3/32 Warehouse Rolling Groove'
                              : 'Straight 1/16 Industrial Grid'
                          }
                          active={Boolean(params.kickRumbleGroove)}
                          accent="blue"
                          onToggle={() =>
                            updateParam('kickRumbleGroove', !params.kickRumbleGroove)
                          }
                        />
                        <IconToggleButton
                          icon="loop"
                          midiId="kickLoop"
                          label={
                            params.kickLoop
                              ? '4/4 Stomper Clock Enabled'
                              : '1-Shot Key Trigger Only'
                          }
                          active={Boolean(params.kickLoop)}
                          accent="blue"
                          onToggle={() => updateParam('kickLoop', !params.kickLoop)}
                        />
                        <IconToggleButton
                          icon="power"
                          midiId="kickRumblePower"
                          label="Industrial Techno Sub-Rumble Bus Power"
                          active={Boolean(params.kickRumblePower)}
                          accent="blue"
                          onToggle={() => updateParam('kickRumblePower', !params.kickRumblePower)}
                        />
                      </>
                    }
                  >
                    <div className="grid grid-cols-[88px_minmax(112px,1fr)] items-end gap-x-3 h-full pt-0.5">
                      <RotaryKnob
                        size="lg"
                        midiId="kickRumbleAmt"
                        accent="blue"
                        value={params.kickRumbleAmt ?? 72}
                        min={0}
                        max={100}
                        step={1}
                        defaultValue={72}
                        minLabel="0"
                        maxLabel="100"
                        label="RUMBLE"
                        showZeroRingMarker
                        formatValue={(v) => `${Math.round(v)}% Cavern`}
                        onChange={(v) => {
                          setParams((prev) => {
                            const next: SynthParams = {
                              ...prev,
                              kickRumbleAmt: v,
                              kickRumblePower: v > 0 ? true : prev.kickRumblePower,
                            };
                            audioEngine.updateLiveParams(next);
                            return next;
                          });
                        }}
                        className="self-end justify-self-center"
                      />

                      <div className="h-full flex flex-col justify-between items-stretch gap-2.5">
                        <LcdFreqDisplay
                          midiId="kickBpm"
                          frequency={params.kickBpm ?? 165}
                          minFreq={115}
                          maxFreq={240}
                          step={1}
                          accent="blue"
                          labelPrimary="TEMPO"
                          labelSecondary="ROOT"
                          unit="BPM"
                          allowNoteMode
                          formatSecondaryValue={() => ({
                            main:
                              displayedMidi !== null
                                ? midiToNoteLabel(displayedMidi)
                                : `C${params.octave + 1}`,
                            unit: params.kickLoop ? '4/4' : '1x',
                          })}
                          meterLevel={isSynthActive ? telemetry.kickPumpMeter : 0.16}
                          onChangeFrequency={(bpm) => updateParam('kickBpm', bpm)}
                        />
                        <div className="grid grid-cols-2 gap-x-2 w-full justify-items-center items-end">
                          <MicroKnob
                            label="SC PUMP"
                            midiId="kickDuck"
                            accent="blue"
                            value={params.kickDuck ?? 80}
                            min={0}
                            max={100}
                            step={1}
                            defaultValue={80}
                            formatValue={(v) => `${Math.round(v)}% Duck`}
                            onChange={(v) => updateParam('kickDuck', v)}
                          />
                          <MicroKnob
                            label="DARK LP"
                            midiId="kickRumbleLpHz"
                            accent="blue"
                            value={params.kickRumbleLpHz ?? 280}
                            min={110}
                            max={1200}
                            step={10}
                            defaultValue={280}
                            formatValue={(v) => `${Math.round(v)} Hz`}
                            onChange={(v) => updateParam('kickRumbleLpHz', v)}
                          />
                        </div>
                      </div>
                    </div>
                  </ModuleCard>
                </>
              ) : activeRackTab === 'voices' ? (
                <>
                  {/* TAB 1 — MODULE 0: OSC SYNTHESIZER PANEL (Laser Cyan Phosphor) */}
                  <ModuleCard
                    title="OSC"
                    active={params.oscPower}
                    className="p-3.5"
                    onRandomize={() => handleRandomizeModule('osc')}
                    randomizeAccent="cyan"
                    randomizeMidiId="action.rand.osc"
                    headerActions={
                      <>
                        <IconToggleButton
                          icon="phase"
                          midiId="oscRingMod"
                          label="Audio-Rate Ring Modulator (OSC1 × OSC2)"
                          active={params.oscRingMod}
                          accent="cyan"
                          onToggle={() => updateParam('oscRingMod', !params.oscRingMod)}
                        />
                        <IconToggleButton
                          icon="loop"
                          midiId="oscInterval"
                          label={`Cycle OSC 2 Interval (${params.oscInterval > 0 ? '+' : ''}${params.oscInterval} st)`}
                          active={params.oscInterval !== 0}
                          accent="cyan"
                          onToggle={cycleOscInterval}
                        />
                        <IconToggleButton
                          icon="power"
                          midiId="oscPower"
                          label="Oscillator Synthesizer Power"
                          active={params.oscPower}
                          accent="cyan"
                          onToggle={() => updateParam('oscPower', !params.oscPower)}
                        />
                      </>
                    }
                  >
                    <div className="flex flex-col justify-between h-full gap-2.5 pt-0.5">
                      <div className="grid grid-cols-[68px_minmax(104px,1fr)] items-center gap-x-2.5">
                        <RotaryKnob
                          size="md"
                          midiId="oscLevel"
                          accent="cyan"
                          value={params.oscLevel}
                          min={0}
                          max={100}
                          step={1}
                          defaultValue={INIT_SYNTH_PARAMS.oscLevel}
                          label="LEVEL"
                          showPerimeterDots
                          formatValue={(v) => `${Math.round(v)}% Mix`}
                          onChange={(v) => updateParam('oscLevel', v)}
                          className="justify-self-center"
                        />

                        <OscWaveDisplay
                          midiId="oscWave"
                          waves={OSC_WAVES}
                          wave={params.oscWave}
                          shape={params.oscShape}
                          detune={params.oscDetune}
                          ringMod={params.oscRingMod}
                          intervalSemitones={params.oscInterval}
                          onCycleInterval={cycleOscInterval}
                          accent="cyan"
                          onChangeWave={(w) => updateParam('oscWave', w as OscWaveType)}
                        />
                      </div>

                      <div className="grid grid-cols-3 gap-x-2 w-full justify-items-center items-end">
                        <MicroKnob
                          label="SHAPE"
                          midiId="oscShape"
                          accent="cyan"
                          value={params.oscShape}
                          min={0}
                          max={100}
                          step={1}
                          defaultValue={INIT_SYNTH_PARAMS.oscShape}
                          formatValue={(v) =>
                            params.oscWave === 'PULSE'
                              ? `${Math.round(v)}% PWM`
                              : params.oscWave === 'SYNC'
                              ? `${(1 + (v / 100) * 4.5).toFixed(1)}x Sync`
                              : params.oscWave === 'METAL'
                              ? `${(1.41 + (v / 100) * 5.95).toFixed(2)}x Clang`
                              : `${Math.round(v)}% Contour`
                          }
                          onChange={(v) => updateParam('oscShape', v)}
                        />
                        <MicroKnob
                          label="DETUNE"
                          midiId="oscDetune"
                          accent="cyan"
                          value={params.oscDetune}
                          min={0}
                          max={100}
                          step={1}
                          defaultValue={INIT_SYNTH_PARAMS.oscDetune}
                          formatValue={(v) => `${Math.round(v)}% Spread`}
                          onChange={(v) => updateParam('oscDetune', v)}
                        />
                        <MicroKnob
                          label="NOISE"
                          midiId="oscNoise"
                          accent="cyan"
                          value={params.oscNoise}
                          min={0}
                          max={100}
                          step={1}
                          defaultValue={INIT_SYNTH_PARAMS.oscNoise}
                          formatValue={(v) => `${Math.round(v)}% Fizz`}
                          onChange={(v) => updateParam('oscNoise', v)}
                        />
                      </div>
                    </div>
                  </ModuleCard>

                  {/* TAB 1 — MODULE 1: GRAIN (Cobalt Blue Phosphor) */}
                  <ModuleCard
                    title={hasSample ? 'GRAIN' : 'GRAIN (OFF)'}
                    active={hasSample && params.grainPower}
                    className="p-3.5"
                    onRandomize={() => handleRandomizeModule('grain')}
                    randomizeAccent="blue"
                    randomizeLabel="Macro Randomize GRAIN"
                    randomizeMidiId="action.rand.grain"
                    headerActions={
                      <>
                        <IconToggleButton
                          icon="phase"
                          midiId="grainReverse"
                          label="Reverse Playback"
                          active={params.grainReverse}
                          accent="blue"
                          onToggle={() => updateParam('grainReverse', !params.grainReverse)}
                        />
                        <IconToggleButton
                          icon="solo"
                          midiId="grainFreeze"
                          label="Freeze Grain Position"
                          active={params.grainFreeze}
                          accent="blue"
                          onToggle={() => updateParam('grainFreeze', !params.grainFreeze)}
                        />
                        <IconToggleButton
                          icon="power"
                          midiId="grainPower"
                          label={
                            hasSample
                              ? 'Granular Sampler Layer Power'
                              : 'Restore Sample & Enable Granular Layer'
                          }
                          active={hasSample && params.grainPower}
                          accent="blue"
                          onToggle={() => {
                            if (!hasSample) {
                              selectBuiltInSample(activeSampleId);
                            } else {
                              updateParam('grainPower', !params.grainPower);
                            }
                          }}
                        />
                      </>
                    }
                  >
                    <div className="grid grid-cols-[88px_minmax(112px,1fr)] items-end gap-x-3 h-full pt-0.5">
                      <RotaryKnob
                        size="lg"
                        midiId="baseSpeed"
                        accent="blue"
                        value={params.baseSpeed}
                        min={0.2}
                        max={2.5}
                        step={0.05}
                        defaultValue={1.0}
                        minLabel="0.2x"
                        maxLabel="2.5x"
                        label="SPEED"
                        showZeroRingMarker
                        formatValue={(v) => `${v.toFixed(2)}x`}
                        onChange={(v) => updateParam('baseSpeed', v)}
                        className="self-end justify-self-center"
                      />

                      <div className="h-full flex flex-col justify-between items-stretch gap-2.5">
                        <LcdFreqDisplay
                          midiId="grainSizeMs"
                          frequency={params.grainSizeMs}
                          minFreq={15}
                          maxFreq={450}
                          step={5}
                          accent="blue"
                          labelPrimary="SIZE"
                          labelSecondary="DENS"
                          unit="ms"
                          allowNoteMode
                          formatSecondaryValue={(ms) => ({
                            main: `${Math.round(1000 / Math.max(15, ms))}`,
                            unit: 'Hz',
                          })}
                          meterLevel={isSynthActive ? telemetry.grainMeter : 0.16}
                          onChangeFrequency={(ms) => updateParam('grainSizeMs', ms)}
                        />
                        <div className="grid grid-cols-2 gap-x-2 w-full justify-items-center items-end">
                          <MicroKnob
                            label="GRAIN"
                            midiId="grainSizeMs"
                            accent="blue"
                            value={params.grainSizeMs}
                            min={15}
                            max={450}
                            step={5}
                            defaultValue={INIT_SYNTH_PARAMS.grainSizeMs}
                            formatValue={(v) => `${Math.round(v)} ms`}
                            onChange={(v) => updateParam('grainSizeMs', v)}
                          />
                          <MicroKnob
                            label="OVERLAP"
                            midiId="grainOverlapMs"
                            accent="blue"
                            value={params.grainOverlapMs}
                            min={5}
                            max={200}
                            step={5}
                            defaultValue={INIT_SYNTH_PARAMS.grainOverlapMs}
                            formatValue={(v) => `${Math.round(v)} ms`}
                            onChange={(v) => updateParam('grainOverlapMs', v)}
                          />
                        </div>
                      </div>
                    </div>
                  </ModuleCard>

                  {/* TAB 1 — MODULE 2: FM GROWL (Grid-Aligned Spacious Layout) */}
                  <ModuleCard
                    title="FM GROWL"
                    active={params.fmPower}
                    className="p-3.5"
                    onRandomize={() => handleRandomizeModule('fmGrowl')}
                    randomizeAccent="amber"
                    randomizeMidiId="action.rand.fmGrowl"
                    headerActions={
                      <>
                        <IconToggleButton
                          icon="phase"
                          midiId="fmSubOctave"
                          label="-1 Octave Clean Sub Anchor"
                          active={params.fmSubOctave}
                          accent="amber"
                          onToggle={() => updateParam('fmSubOctave', !params.fmSubOctave)}
                        />
                        <IconToggleButton
                          icon="spark"
                          midiId="fmUnison"
                          label="Wide Neuro Unison Saws"
                          active={params.fmUnison}
                          accent="amber"
                          onToggle={() => updateParam('fmUnison', !params.fmUnison)}
                        />
                        <IconToggleButton
                          icon="power"
                          midiId="fmPower"
                          label="Dual-Operator FM Growl Voice Power"
                          active={params.fmPower}
                          accent="amber"
                          onToggle={() => updateParam('fmPower', !params.fmPower)}
                        />
                      </>
                    }
                  >
                    <div className="flex flex-col justify-between h-full gap-2.5 pt-0.5">
                      <div className="grid grid-cols-[68px_minmax(104px,1fr)] items-center gap-x-2.5">
                        <RotaryKnob
                          size="md"
                          midiId="fmGrowl"
                          accent="amber"
                          value={params.fmGrowl}
                          min={0}
                          max={100}
                          step={1}
                          defaultValue={INIT_SYNTH_PARAMS.fmGrowl}
                          label="GROWL"
                          showPerimeterDots
                          formatValue={(v) => `${Math.round(v)}% Macro`}
                          onChange={(v) => updateParam('fmGrowl', v)}
                          className="justify-self-center"
                        />

                        <LcdFreqDisplay
                          midiId="fmRatio"
                          frequency={params.fmRatio}
                          minFreq={0.5}
                          maxFreq={8.0}
                          step={0.5}
                          accent="amber"
                          labelPrimary="RATIO"
                          labelSecondary={isSynthActive && params.fmPower ? 'IDX' : 'NOTE'}
                          unit="x"
                          allowNoteMode
                          formatSecondaryValue={() =>
                            isSynthActive && params.fmPower && telemetry.fmModIndex > 0.05
                              ? {
                                  main: telemetry.fmModIndex.toFixed(1),
                                  unit: 'β',
                                }
                              : {
                                  main:
                                    displayedMidi !== null
                                      ? midiToNoteLabel(displayedMidi)
                                      : `C${params.octave + 1}`,
                                  unit: '',
                                }
                          }
                          meterLevel={isSynthActive ? telemetry.growlMeter : 0.24}
                          onChangeFrequency={(r) => updateParam('fmRatio', r)}
                        />
                      </div>

                      <div className="grid grid-cols-3 gap-x-2 w-full justify-items-center items-end">
                        <MicroKnob
                          label="WOBBLE"
                          midiId="fmWobbleRate"
                          accent="amber"
                          value={params.fmWobbleRate}
                          min={0}
                          max={16}
                          step={0.1}
                          defaultValue={INIT_SYNTH_PARAMS.fmWobbleRate}
                          formatValue={(v) => (v <= 0.01 ? '0.0 Hz (Off)' : `${v.toFixed(1)} Hz`)}
                          onChange={(v) => updateParam('fmWobbleRate', v)}
                        />
                        <MicroKnob
                          label="INFLECT"
                          midiId="fmInflect"
                          accent="amber"
                          value={params.fmInflect}
                          min={0}
                          max={100}
                          step={1}
                          defaultValue={INIT_SYNTH_PARAMS.fmInflect}
                          formatValue={(v) => `+${((v / 100) * 2.6).toFixed(1)} st`}
                          onChange={(v) => updateParam('fmInflect', v)}
                        />
                        <MicroKnob
                          label="METAL"
                          midiId="fmMetalAmt"
                          accent="amber"
                          value={params.fmMetalAmt ?? 0}
                          min={0}
                          max={100}
                          step={1}
                          defaultValue={INIT_SYNTH_PARAMS.fmMetalAmt ?? 0}
                          formatValue={(v) =>
                            v <= 0 ? '0% Organic' : `${Math.round(v)}% Riddim`
                          }
                          onChange={(v) => updateParam('fmMetalAmt', v)}
                        />
                      </div>
                    </div>
                  </ModuleCard>
                </>
              ) : activeRackTab === 'growlLab' ? (
                <>
                  {/* TAB 2 — MODULE 0: WAH PEDAL (> Xover Resonant Sweep) */}
                  <ModuleCard
                    title="WAH PEDAL"
                    active={params.wahPower && !params.bypass && !params.subSolo}
                    className="p-3.5"
                    onRandomize={() => handleRandomizeModule('wahPedal')}
                    randomizeAccent="cyan"
                    randomizeMidiId="action.rand.wahPedal"
                    headerActions={
                      <>
                        <IconToggleButton
                          icon="solo"
                          midiId="subSolo"
                          label="Solo Clean Sub Band (< Xover Only)"
                          active={params.subSolo}
                          accent="cyan"
                          onToggle={() => updateParam('subSolo', !params.subSolo)}
                        />
                        <IconToggleButton
                          icon="power"
                          midiId="wahPower"
                          label="Resonant Wah Pedal Sweep Power"
                          active={params.wahPower}
                          accent="cyan"
                          onToggle={() => updateParam('wahPower', !params.wahPower)}
                        />
                      </>
                    }
                  >
                    <div className="grid grid-cols-[88px_minmax(112px,1fr)] items-end gap-x-3 h-full pt-0.5">
                      <RotaryKnob
                        size="lg"
                        midiId="wahAmount"
                        accent="cyan"
                        value={params.wahAmount}
                        min={0}
                        max={100}
                        step={1}
                        defaultValue={INIT_SYNTH_PARAMS.wahAmount}
                        minLabel="0"
                        maxLabel="100"
                        label="WAH"
                        showZeroRingMarker
                        formatValue={(v) => `${Math.round(v)}% Bite`}
                        onChange={(v) => updateParam('wahAmount', v)}
                        className="self-end justify-self-center"
                      />

                      <div className="h-full flex flex-col justify-between items-stretch gap-2.5">
                        <LcdFreqDisplay
                          midiId="wahBaseHz"
                          frequency={params.wahBaseHz}
                          minFreq={160}
                          maxFreq={900}
                          step={10}
                          accent="cyan"
                          labelPrimary="BASE"
                          labelSecondary="LIVE"
                          unit="Hz"
                          allowNoteMode
                          formatSecondaryValue={() => ({
                            main: `${isSynthActive ? telemetry.wahFreqHz : params.wahBaseHz}`,
                            unit: 'Hz',
                          })}
                          meterLevel={
                            params.wahPower
                              ? Math.min(1, 0.2 + (telemetry.wahFreqHz - 160) / 2600)
                              : 0.1
                          }
                          onChangeFrequency={(hz) => updateParam('wahBaseHz', hz)}
                        />
                        <div className="grid grid-cols-2 gap-x-2 w-full justify-items-center items-end">
                          <MicroKnob
                            label="RES Q"
                            midiId="wahResonance"
                            accent="cyan"
                            value={params.wahResonance}
                            min={0}
                            max={100}
                            step={1}
                            defaultValue={INIT_SYNTH_PARAMS.wahResonance}
                            formatValue={(v) =>
                              `Q ${(
                                1.15 +
                                (v / 100) * (3.1 + ((params.fmMetalAmt ?? 0) / 100) * 6.4)
                              ).toFixed(1)}`
                            }
                            onChange={(v) => updateParam('wahResonance', v)}
                          />
                          <MicroKnob
                            label="SWEEP"
                            midiId="wahMorph"
                            accent="cyan"
                            value={params.wahMorph}
                            min={0}
                            max={100}
                            step={1}
                            defaultValue={INIT_SYNTH_PARAMS.wahMorph}
                            formatValue={(v) => `${Math.round(v)}% Span`}
                            onChange={(v) => updateParam('wahMorph', v)}
                          />
                        </div>
                      </div>
                    </div>
                  </ModuleCard>

                  {/* TAB 2 — MODULE 1: VOWEL TRACT (Human Formant F1/F2 + Counter-Notch) */}
                  <ModuleCard
                    title="VOWEL TRACT"
                    active={params.formantPower && !params.bypass && !params.subSolo}
                    className="p-3.5"
                    onRandomize={() => handleRandomizeModule('vowelTract')}
                    randomizeAccent="amber"
                    randomizeMidiId="action.rand.vowelTract"
                    headerActions={
                      <>
                        <IconToggleButton
                          icon="phase"
                          midiId="notchEnable"
                          label="Counter-Swept Surgical Neuro Notch"
                          active={params.notchEnable}
                          accent="amber"
                          onToggle={() => updateParam('notchEnable', !params.notchEnable)}
                        />
                        <IconToggleButton
                          icon="power"
                          midiId="formantPower"
                          label="Human Vocal Formant Filter Power"
                          active={params.formantPower}
                          accent="amber"
                          onToggle={() => updateParam('formantPower', !params.formantPower)}
                        />
                      </>
                    }
                  >
                    <div className="grid grid-cols-[88px_minmax(112px,1fr)] items-end gap-x-3 h-full pt-0.5">
                      <RotaryKnob
                        size="lg"
                        midiId="fmVowel"
                        accent="amber"
                        value={params.fmVowel}
                        min={0}
                        max={100}
                        step={1}
                        defaultValue={INIT_SYNTH_PARAMS.fmVowel}
                        minLabel="U"
                        maxLabel="I"
                        label="VOWEL"
                        showZeroRingMarker
                        formatValue={(v) => `${Math.round(v)}% Morph`}
                        onChange={(v) => updateParam('fmVowel', v)}
                        className="self-end justify-self-center"
                      />

                      <div className="h-full flex flex-col justify-between items-stretch gap-2.5">
                        <FormantTractDisplay
                          midiId="fmVowel"
                          vowel={params.fmVowel}
                          talk={params.formantTalk}
                          notchActive={params.notchEnable}
                          notchDepth={params.notchDepth}
                          f1Hz={telemetry.formantF1Hz}
                          f2Hz={telemetry.formantF2Hz}
                          accent="amber"
                          onChangeVowel={(v) => updateParam('fmVowel', v)}
                        />
                        <div className="grid grid-cols-2 gap-x-2 w-full justify-items-center items-end">
                          <MicroKnob
                            label="TALK"
                            midiId="formantTalk"
                            accent="amber"
                            value={params.formantTalk}
                            min={0}
                            max={100}
                            step={1}
                            defaultValue={INIT_SYNTH_PARAMS.formantTalk}
                            formatValue={(v) => `${Math.round(v)}% Peak`}
                            onChange={(v) => updateParam('formantTalk', v)}
                          />
                          <MicroKnob
                            label="NOTCH"
                            midiId="notchDepth"
                            accent="amber"
                            value={params.notchDepth}
                            min={0}
                            max={100}
                            step={1}
                            defaultValue={INIT_SYNTH_PARAMS.notchDepth}
                            formatValue={(v) => `${Math.round(v)}% Cut`}
                            onChange={(v) => updateParam('notchDepth', v)}
                          />
                        </div>
                      </div>
                    </div>
                  </ModuleCard>

                  {/* TAB 2 — MODULE 2: THROAT COMB (Key-Tracked Metallic Pipe Resonator) */}
                  <ModuleCard
                    title="THROAT COMB"
                    active={params.combPower && !params.bypass && !params.subSolo}
                    className="p-3.5"
                    onRandomize={() => handleRandomizeModule('throatComb')}
                    randomizeAccent="violet"
                    randomizeMidiId="action.rand.throatComb"
                    headerActions={
                      <>
                        <IconToggleButton
                          icon="loop"
                          midiId="combKeyTrack"
                          label="Key-Track Comb Delay to Played Note"
                          active={params.combKeyTrack}
                          accent="violet"
                          onToggle={() => updateParam('combKeyTrack', !params.combKeyTrack)}
                        />
                        <IconToggleButton
                          icon="power"
                          midiId="combPower"
                          label="Metallic Throat Comb Resonator Power"
                          active={params.combPower}
                          accent="violet"
                          onToggle={() => updateParam('combPower', !params.combPower)}
                        />
                      </>
                    }
                  >
                    <div className="grid grid-cols-[88px_minmax(112px,1fr)] items-end gap-x-3 h-full pt-0.5">
                      <RotaryKnob
                        size="lg"
                        midiId="fmMetal"
                        accent="violet"
                        value={params.fmMetal}
                        min={0}
                        max={100}
                        step={1}
                        defaultValue={INIT_SYNTH_PARAMS.fmMetal}
                        minLabel="0"
                        maxLabel="100"
                        label="METAL"
                        showZeroRingMarker
                        formatValue={(v) => `${Math.round(v)}% Wet`}
                        onChange={(v) => updateParam('fmMetal', v)}
                        className="self-end justify-self-center"
                      />

                      <div className="h-full flex flex-col justify-between items-stretch gap-2.5">
                        <LcdFreqDisplay
                          midiId="combHarmonic"
                          frequency={params.combHarmonic}
                          minFreq={1.0}
                          maxFreq={8.0}
                          step={0.5}
                          accent="violet"
                          labelPrimary="HARM"
                          labelSecondary="DELAY"
                          unit="x"
                          allowNoteMode
                          formatSecondaryValue={() => ({
                            main: telemetry.combDelayMs.toFixed(1),
                            unit: 'ms',
                          })}
                          meterLevel={params.combPower ? Math.max(0.18, params.fmMetal / 100) : 0.08}
                          onChangeFrequency={(h) => updateParam('combHarmonic', h)}
                        />
                        <div className="grid grid-cols-2 gap-x-2 w-full justify-items-center items-end">
                          <MicroKnob
                            label="FEEDBK"
                            midiId="combFeedbackAmt"
                            accent="violet"
                            value={params.combFeedbackAmt}
                            min={0}
                            max={100}
                            step={1}
                            defaultValue={INIT_SYNTH_PARAMS.combFeedbackAmt}
                            formatValue={(v) => `${Math.round(v)}% Regen`}
                            onChange={(v) => updateParam('combFeedbackAmt', v)}
                          />
                          <MicroKnob
                            label="DAMP"
                            midiId="combDamp"
                            accent="violet"
                            value={params.combDamp}
                            min={0}
                            max={100}
                            step={1}
                            defaultValue={INIT_SYNTH_PARAMS.combDamp}
                            formatValue={(v) => {
                              const metalBoost = Math.max(
                                ((params.fmMetal ?? 0) / 100) * 0.55,
                                (params.fmMetalAmt ?? 0) / 100
                              );
                              return `${((850 + (v / 100) * (4800 + metalBoost * 5550)) / 1000).toFixed(1)} kHz`;
                            }}
                            onChange={(v) => updateParam('combDamp', v)}
                          />
                        </div>
                      </div>
                    </div>
                  </ModuleCard>
                </>
              ) : activeRackTab === 'phaseWarp' ? (
                <>
                  {/* TAB 3 — MODULE 0: DISPERSER (16-Stage All-Pass Laser Gravity) */}
                  <ModuleCard
                    title="DISPERSER"
                    active={Boolean(params.disperserPower) && !params.bypass && !params.subSolo}
                    className="p-3.5"
                    onRandomize={() => handleRandomizeModule('disperser')}
                    randomizeAccent="cyan"
                    randomizeMidiId="action.rand.disperser"
                    headerActions={
                      <IconToggleButton
                        icon="power"
                        midiId="disperserPower"
                        label="16-Stage All-Pass Phase Disperser Power (> Xover)"
                        active={Boolean(params.disperserPower)}
                        accent="cyan"
                        onToggle={() => updateParam('disperserPower', !params.disperserPower)}
                      />
                    }
                  >
                    <div className="grid grid-cols-[88px_minmax(112px,1fr)] items-end gap-x-3 h-full pt-0.5">
                      <RotaryKnob
                        size="lg"
                        midiId="disperserAmount"
                        accent="cyan"
                        value={params.disperserAmount ?? 0}
                        min={0}
                        max={100}
                        step={1}
                        defaultValue={INIT_SYNTH_PARAMS.disperserAmount ?? 0}
                        minLabel="0"
                        maxLabel="100"
                        label="LASER"
                        showZeroRingMarker
                        formatValue={(v) => `${Math.round(v)}% Smear`}
                        onChange={(v) => updateParam('disperserAmount', v)}
                        className="self-end justify-self-center"
                      />

                      <div className="h-full flex flex-col justify-between items-stretch gap-2.5">
                        <DisperserPhaseDisplay
                          midiId="disperserFreqHz"
                          freqHz={params.disperserFreqHz ?? 280}
                          liveFreqHz={
                            isSynthActive && params.disperserPower
                              ? telemetry.disperserLiveHz
                              : params.disperserFreqHz ?? 280
                          }
                          amount={params.disperserPower ? params.disperserAmount ?? 0 : 0}
                          pinch={params.disperserPinch ?? 60}
                          accent="cyan"
                          onChangeFreqHz={(hz) => updateParam('disperserFreqHz', hz)}
                        />
                        <div className="grid grid-cols-2 gap-x-2 w-full justify-items-center items-end">
                          <MicroKnob
                            label="PINCH Q"
                            midiId="disperserPinch"
                            accent="cyan"
                            value={params.disperserPinch ?? 60}
                            min={0}
                            max={100}
                            step={1}
                            defaultValue={60}
                            formatValue={(v) => `Q ${(0.65 + (v / 100) * 4.8).toFixed(1)}`}
                            onChange={(v) => updateParam('disperserPinch', v)}
                          />
                          <MicroKnob
                            label="SWEEP"
                            midiId="disperserSweep"
                            accent="cyan"
                            value={params.disperserSweep ?? 55}
                            min={0}
                            max={100}
                            step={1}
                            defaultValue={55}
                            formatValue={(v) => `${Math.round(v)}% Mod`}
                            onChange={(v) => updateParam('disperserSweep', v)}
                          />
                        </div>
                      </div>
                    </div>
                  </ModuleCard>

                  {/* TAB 3 — MODULE 1: FREQ SHIFT (Quadrature Hilbert Bode SSB Shifter) */}
                  <ModuleCard
                    title="FREQ SHIFT"
                    active={Boolean(params.freqShiftPower) && !params.bypass && !params.subSolo}
                    className="p-3.5"
                    onRandomize={() => handleRandomizeModule('freqShift')}
                    randomizeAccent="amber"
                    randomizeMidiId="action.rand.freqShift"
                    headerActions={
                      <>
                        <IconToggleButton
                          icon="loop"
                          midiId="freqShiftBarber"
                          label="Fine BarberpolePhasing Mode (±12 Hz Endless Reese)"
                          active={Boolean(params.freqShiftBarber)}
                          accent="amber"
                          onToggle={() => updateParam('freqShiftBarber', !params.freqShiftBarber)}
                        />
                        <IconToggleButton
                          icon="power"
                          midiId="freqShiftPower"
                          label="Bode Single-Sideband Frequency Shifter Power (> Xover)"
                          active={Boolean(params.freqShiftPower)}
                          accent="amber"
                          onToggle={() => updateParam('freqShiftPower', !params.freqShiftPower)}
                        />
                      </>
                    }
                  >
                    <div className="grid grid-cols-[88px_minmax(112px,1fr)] items-end gap-x-3 h-full pt-0.5">
                      <RotaryKnob
                        size="lg"
                        midiId="freqShiftHz"
                        accent="amber"
                        value={params.freqShiftHz ?? 0}
                        min={-400}
                        max={400}
                        step={1}
                        defaultValue={0}
                        minLabel="-"
                        maxLabel="+"
                        label="SHIFT"
                        showZeroRingMarker
                        formatValue={(v) => {
                          const disp = params.freqShiftBarber ? v * 0.03 : v;
                          return `${disp >= 0 ? '+' : ''}${
                            params.freqShiftBarber ? disp.toFixed(1) : Math.round(disp)
                          } Hz`;
                        }}
                        onChange={(v) => updateParam('freqShiftHz', v)}
                        className="self-end justify-self-center"
                      />

                      <div className="h-full flex flex-col justify-between items-stretch gap-2.5">
                        <LcdFreqDisplay
                          midiId="freqShiftHz"
                          frequency={params.freqShiftHz ?? 0}
                          minFreq={-400}
                          maxFreq={400}
                          step={5}
                          accent="amber"
                          labelPrimary={params.freqShiftBarber ? 'BARBER' : 'SHIFT'}
                          labelSecondary="SIDE"
                          unit="Hz"
                          allowNoteMode
                          formatCustomValue={(val) => {
                            const eff = params.freqShiftBarber ? val * 0.03 : val;
                            return `${eff >= 0 ? '+' : ''}${
                              params.freqShiftBarber ? eff.toFixed(1) : Math.round(eff)
                            }`;
                          }}
                          formatSecondaryValue={(val) => ({
                            main: val >= 0 ? 'USB' : 'LSB',
                            unit: '',
                          })}
                          meterLevel={
                            params.freqShiftPower
                              ? Math.max(0.18, (params.freqShiftMix ?? 0) / 100)
                              : 0.08
                          }
                          onChangeFrequency={(hz) => updateParam('freqShiftHz', hz)}
                        />
                        <div className="grid grid-cols-2 gap-x-2 w-full justify-items-center items-end">
                          <MicroKnob
                            label="FEEDBK"
                            midiId="freqShiftFeedback"
                            accent="amber"
                            value={params.freqShiftFeedback ?? 0}
                            min={0}
                            max={100}
                            step={1}
                            defaultValue={INIT_SYNTH_PARAMS.freqShiftFeedback ?? 0}
                            formatValue={(v) => `${Math.round(v)}% Regen`}
                            onChange={(v) => updateParam('freqShiftFeedback', v)}
                          />
                          <MicroKnob
                            label="MIX"
                            midiId="freqShiftMix"
                            accent="amber"
                            value={params.freqShiftMix ?? 0}
                            min={0}
                            max={100}
                            step={1}
                            defaultValue={INIT_SYNTH_PARAMS.freqShiftMix ?? 0}
                            formatValue={(v) => `${Math.round(v)}% Wet`}
                            onChange={(v) => updateParam('freqShiftMix', v)}
                          />
                        </div>
                      </div>
                    </div>
                  </ModuleCard>

                  {/* TAB 3 — MODULE 2: PHASE SCOPE (60 FPS Real-Time Goniometer / Lissajous & Stereo Alignment) */}
                  <ModuleCard
                    title="PHASE SCOPE"
                    active={!params.bypass}
                    className="p-3.5"
                    onRandomize={() => handleRandomizeModule('phaseScope')}
                    randomizeAccent="emerald"
                    randomizeMidiId="action.rand.phaseScope"
                    headerActions={
                      <>
                        <IconToggleButton
                          icon="phase"
                          midiId="phaseInvertR"
                          label="Invert Right Channel Polarity (> Xover, 180°)"
                          active={Boolean(params.phaseInvertR)}
                          accent="emerald"
                          onToggle={() => updateParam('phaseInvertR', !params.phaseInvertR)}
                        />
                        <IconToggleButton
                          icon="solo"
                          midiId="haasMonoCheck"
                          label="Mono Compatibility Sum Check (L+R)"
                          active={Boolean(params.haasMonoCheck)}
                          accent="emerald"
                          onToggle={() => updateParam('haasMonoCheck', !params.haasMonoCheck)}
                        />
                        <IconToggleButton
                          icon="lock"
                          midiId="phaseScopeFreeze"
                          label="Freeze Oscilloscope Trace"
                          active={Boolean(params.phaseScopeFreeze)}
                          accent="emerald"
                          onToggle={() => updateParam('phaseScopeFreeze', !params.phaseScopeFreeze)}
                        />
                      </>
                    }
                  >
                    <PhaseScopeDisplay
                      mode={(params.phaseScopeMode ?? 'goniometer') as PhaseScopeMode}
                      onChangeMode={(m) => updateParam('phaseScopeMode', m)}
                      frozen={Boolean(params.phaseScopeFreeze)}
                      phaseAlignDeg={params.phaseAlignDeg ?? 0}
                      onChangePhaseAlignDeg={(deg) => updateParam('phaseAlignDeg', deg)}
                      haasWidth={params.haasPower ? params.haasWidth ?? 0 : 0}
                      onChangeHaasWidth={handleScopeStereoWidthChange}
                      invertR={Boolean(params.phaseInvertR)}
                      monoCheck={Boolean(params.haasMonoCheck)}
                      accent="emerald"
                    />
                  </ModuleCard>
                </>
              ) : (
                <>
                  {/* TAB 4 — MODULE 0: SPECTRAL GATE (8-Band Vocoder Filterbank Quantizer) */}
                  <ModuleCard
                    title="SPECTRAL GATE"
                    active={Boolean(params.spectralPower) && !params.bypass && !params.subSolo}
                    className="p-3.5"
                    onRandomize={() => handleRandomizeModule('spectralGate')}
                    randomizeAccent="emerald"
                    randomizeMidiId="action.rand.spectralGate"
                    headerActions={
                      <IconToggleButton
                        icon="power"
                        midiId="spectralPower"
                        label="8-Band Dynamic Spectral Gate Filterbank Power (> Xover)"
                        active={Boolean(params.spectralPower)}
                        accent="emerald"
                        onToggle={() => updateParam('spectralPower', !params.spectralPower)}
                      />
                    }
                  >
                    <div className="grid grid-cols-[88px_minmax(112px,1fr)] items-end gap-x-3 h-full pt-0.5">
                      <RotaryKnob
                        size="lg"
                        midiId="spectralMix"
                        accent="emerald"
                        value={params.spectralMix ?? 0}
                        min={0}
                        max={100}
                        step={1}
                        defaultValue={INIT_SYNTH_PARAMS.spectralMix ?? 0}
                        minLabel="0"
                        maxLabel="100"
                        label="SPECTRAL"
                        showZeroRingMarker
                        formatValue={(v) => `${Math.round(v)}% Vocode`}
                        onChange={(v) => updateParam('spectralMix', v)}
                        className="self-end justify-self-center"
                      />

                      <div className="h-full flex flex-col justify-between items-stretch gap-2.5">
                        <SpectralGateDisplay
                          midiId="spectralThresh"
                          bands={telemetry.spectralBands}
                          threshold={params.spectralThresh ?? 42}
                          accent="emerald"
                          onChangeThreshold={(t) => updateParam('spectralThresh', t)}
                        />
                        <div className="grid grid-cols-2 gap-x-2 w-full justify-items-center items-end">
                          <MicroKnob
                            label="THRESH"
                            midiId="spectralThresh"
                            accent="emerald"
                            value={params.spectralThresh ?? 42}
                            min={0}
                            max={100}
                            step={1}
                            defaultValue={42}
                            formatValue={(v) => `${Math.round(v)}% Gate`}
                            onChange={(v) => updateParam('spectralThresh', v)}
                          />
                          <MicroKnob
                            label="RESO Q"
                            midiId="spectralReso"
                            accent="emerald"
                            value={params.spectralReso ?? 58}
                            min={0}
                            max={100}
                            step={1}
                            defaultValue={58}
                            formatValue={(v) => `Q ${(2.0 + (v / 100) * 6.5).toFixed(1)}`}
                            onChange={(v) => updateParam('spectralReso', v)}
                          />
                        </div>
                      </div>
                    </div>
                  </ModuleCard>

                  {/* TAB 4 — MODULE 1: STEREO HAAS (> Xover Dimension Expander, Mono Sub) */}
                  <ModuleCard
                    title="STEREO HAAS"
                    active={Boolean(params.haasPower) && !params.bypass && !params.subSolo}
                    className="p-3.5"
                    onRandomize={() => handleRandomizeModule('stereoHaas')}
                    randomizeAccent="blue"
                    randomizeMidiId="action.rand.stereoHaas"
                    headerActions={
                      <>
                        <IconToggleButton
                          icon="phase"
                          midiId="haasMonoCheck"
                          label="Mono Phase Compatibility Check (Sum Haas L+R)"
                          active={Boolean(params.haasMonoCheck)}
                          accent="blue"
                          onToggle={() => updateParam('haasMonoCheck', !params.haasMonoCheck)}
                        />
                        <IconToggleButton
                          icon="power"
                          midiId="haasPower"
                          label="Stereo Haas & Chorus Dimension Expander Power (> Xover)"
                          active={Boolean(params.haasPower)}
                          accent="blue"
                          onToggle={() => updateParam('haasPower', !params.haasPower)}
                        />
                      </>
                    }
                  >
                    <div className="grid grid-cols-[88px_minmax(112px,1fr)] items-end gap-x-3 h-full pt-0.5">
                      <RotaryKnob
                        size="lg"
                        midiId="haasWidth"
                        accent="blue"
                        value={params.haasWidth ?? 0}
                        min={0}
                        max={100}
                        step={1}
                        defaultValue={INIT_SYNTH_PARAMS.haasWidth ?? 0}
                        minLabel="0"
                        maxLabel="100"
                        label="WIDTH"
                        showZeroRingMarker
                        formatValue={(v) =>
                          params.haasMonoCheck ? `${Math.round(v)}% (Mono)` : `${Math.round(v)}% Wide`
                        }
                        onChange={(v) => updateParam('haasWidth', v)}
                        className="self-end justify-self-center"
                      />

                      <div className="h-full flex flex-col justify-between items-stretch gap-2.5">
                        <LcdFreqDisplay
                          midiId="haasDelayMs"
                          frequency={params.haasDelayMs ?? 9.5}
                          minFreq={2.0}
                          maxFreq={22.0}
                          step={0.5}
                          accent="blue"
                          labelPrimary="HAAS"
                          labelSecondary="SUB"
                          unit="ms"
                          allowNoteMode
                          formatSecondaryValue={() => ({
                            main: params.haasMonoCheck ? 'SUM' : 'MONO',
                            unit: '',
                          })}
                          meterLevel={
                            params.haasPower ? Math.max(0.2, (params.haasWidth ?? 0) / 100) : 0.08
                          }
                          onChangeFrequency={(ms) => updateParam('haasDelayMs', ms)}
                        />
                        <div className="grid grid-cols-2 gap-x-2 w-full justify-items-center items-end">
                          <MicroKnob
                            label="DELAY"
                            midiId="haasDelayMs"
                            accent="blue"
                            value={params.haasDelayMs ?? 9.5}
                            min={2.0}
                            max={22.0}
                            step={0.5}
                            defaultValue={9.5}
                            formatValue={(v) => `${v.toFixed(1)} ms`}
                            onChange={(v) => updateParam('haasDelayMs', v)}
                          />
                          <MicroKnob
                            label="DETUNE"
                            midiId="haasDetune"
                            accent="blue"
                            value={params.haasDetune ?? 35}
                            min={0}
                            max={100}
                            step={1}
                            defaultValue={35}
                            formatValue={(v) => `${Math.round(v)}% Chorus`}
                            onChange={(v) => updateParam('haasDetune', v)}
                          />
                        </div>
                      </div>
                    </div>
                  </ModuleCard>
                </>
              )}

              {/* RIGHT STACK: Upper Compact Pair per Tab + Persistent Utility Strip */}
              <div className="md:col-span-2 xl:col-span-1 min-w-0 flex flex-col justify-between gap-2.5">
                {activeRackTab === 'voices' ? (
                  params.kickMode && kickRightSubView === 'mod' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 flex-1 min-w-0">
                      {/* KICK & MASTER — MODULE 3: KICK ADSR (Interactive Glowing Envelope Graph with Draggable Handles) */}
                      <ModuleCard
                        title="KICK ADSR"
                        active={(params.kickPower ?? true) && !params.bypass}
                        className="p-3"
                        onRandomize={() => handleRandomizeModule('kickAdsr')}
                        randomizeAccent="cyan"
                        randomizeMidiId="action.rand.kickAdsr"
                        headerActions={
                          <button
                            type="button"
                            onClick={() => setKickRightSubView('master')}
                            title="Switch Right Pair to TONE & STABILISE Master Bus"
                            className="px-1.5 py-[2px] rounded bg-[#0C0E14]/90 border border-white/12 hover:border-white/30 font-mono text-[8px] font-semibold tracking-[0.06em] uppercase text-[#9AA3B8] hover:text-white whitespace-nowrap cursor-pointer transition-colors focus-visible:outline-none"
                          >
                            TONE
                          </button>
                        }
                      >
                        <div className="flex items-center justify-between h-full pt-0.5">
                          <KickAdsrDisplay
                            midiId="kickSustain"
                            attackMs={params.kickAttackMs ?? 1.8}
                            decayMs={params.kickDecayMs ?? 260}
                            sustain={params.kickSustain ?? 68}
                            releaseMs={params.kickReleaseMs ?? 220}
                            envPhase={telemetry.kickEnvPhase}
                            isPlaying={isSynthActive}
                            accent="cyan"
                            onChangeAdsr={handleKickAdsrChange}
                          />
                        </div>
                      </ModuleCard>

                      {/* KICK & MASTER — MODULE 4: KICK LFO (Dedicated Kick Harmonic / Hunt / Pitch / Amp LFO) */}
                      <ModuleCard
                        title="KICK LFO"
                        active={Boolean(params.kickLfoPower) && !params.bypass}
                        className="p-3"
                        onRandomize={() => handleRandomizeModule('kickLfo')}
                        randomizeAccent="violet"
                        randomizeMidiId="action.rand.kickLfo"
                        headerActions={
                          <>
                            <IconToggleButton
                              icon="loop"
                              midiId="kickLfoSync"
                              label={
                                params.kickLfoSync ?? true
                                  ? 'Retrigger LFO Phase on Kick Hit'
                                  : 'Free-Running Kick LFO'
                              }
                              active={params.kickLfoSync ?? true}
                              accent="violet"
                              onToggle={() =>
                                updateParam('kickLfoSync', !(params.kickLfoSync ?? true))
                              }
                            />
                            <IconToggleButton
                              icon="power"
                              midiId="kickLfoPower"
                              label="Kick LFO Modulator Power"
                              active={Boolean(params.kickLfoPower)}
                              accent="violet"
                              onToggle={() => updateParam('kickLfoPower', !params.kickLfoPower)}
                            />
                          </>
                        }
                      >
                        <div className="flex items-center justify-between gap-2 h-full pt-0.5">
                          <RotaryKnob
                            size="md"
                            midiId="kickLfoDepth"
                            accent="violet"
                            value={params.kickLfoDepth ?? 58}
                            min={0}
                            max={100}
                            step={1}
                            defaultValue={58}
                            showPerimeterDots
                            formatValue={(v) => `${Math.round(v)}% Depth`}
                            onChange={handleKickLfoDepthChange}
                          />
                          <KickLfoDisplay
                            midiId="kickLfoRateHz"
                            shape={params.kickLfoShape ?? 'SAW'}
                            target={params.kickLfoTarget ?? 'HUNT'}
                            rateHz={params.kickLfoRateHz ?? 4.0}
                            depth={params.kickLfoPower ? params.kickLfoDepth ?? 58 : 18}
                            lfoPhase={telemetry.kickLfoPhase}
                            active={Boolean(params.kickLfoPower) && !params.bypass}
                            accent="violet"
                            onChangeShape={(s) => updateParam('kickLfoShape', s)}
                            onChangeTarget={(t) => updateParam('kickLfoTarget', t)}
                            onChangeRateHz={(hz) => updateParam('kickLfoRateHz', hz)}
                          />
                        </div>
                      </ModuleCard>
                    </div>
                  ) : !params.kickMode && synthRightSubView === 'mod' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 flex-1 min-w-0">
                      {/* SYNTH & MASTER — MODULE 3: SYNTH ADSR (Interactive Glowing Envelope Graph + Filter/Drive Contour) */}
                      <ModuleCard
                        title="SYNTH ADSR"
                        active={!params.bypass}
                        className="p-3"
                        onRandomize={() => handleRandomizeModule('synthAdsr')}
                        randomizeAccent="cyan"
                        randomizeMidiId="action.rand.synthAdsr"
                        headerActions={
                          <>
                            <IconToggleButton
                              icon="spark"
                              midiId="synthAdsrFilterMod"
                              label={
                                params.synthAdsrFilterMod ?? true
                                  ? 'ADSR Coupled to Filter, Vowel & Growl Bite'
                                  : 'Amp-Only ADSR Envelope (Click to Couple Filter & Growl)'
                              }
                              active={params.synthAdsrFilterMod ?? true}
                              accent="cyan"
                              onToggle={() =>
                                updateParam(
                                  'synthAdsrFilterMod',
                                  !(params.synthAdsrFilterMod ?? true)
                                )
                              }
                            />
                            <button
                              type="button"
                              onClick={() => setSynthRightSubView('master')}
                              title="Switch Right Pair to TONE & STABILISE Master Bus"
                              className="px-1.5 py-[2px] rounded bg-[#0C0E14]/90 border border-white/12 hover:border-white/30 font-mono text-[8px] font-semibold tracking-[0.06em] uppercase text-[#9AA3B8] hover:text-white whitespace-nowrap cursor-pointer transition-colors focus-visible:outline-none"
                            >
                              TONE
                            </button>
                          </>
                        }
                      >
                        <div className="flex items-center justify-between h-full pt-0.5">
                          <SynthAdsrDisplay
                            midiId="sustain"
                            attackMs={params.attackMs}
                            decayMs={params.decayMs ?? 320}
                            sustain={params.sustain ?? 82}
                            releaseMs={params.releaseMs}
                            envPhase={telemetry.synthEnvPhase}
                            isPlaying={isSynthActive}
                            accent="cyan"
                            onChangeAdsr={handleSynthAdsrChange}
                          />
                        </div>
                      </ModuleCard>

                      {/* SYNTH & MASTER — MODULE 4: SYNTH LFO (Dedicated Growl / Vowel / Filter / Pitch / Amp LFO) */}
                      <ModuleCard
                        title="SYNTH LFO"
                        active={Boolean(params.synthLfoPower) && !params.bypass}
                        className="p-3"
                        onRandomize={() => handleRandomizeModule('synthLfo')}
                        randomizeAccent="violet"
                        randomizeMidiId="action.rand.synthLfo"
                        headerActions={
                          <>
                            <IconToggleButton
                              icon="loop"
                              midiId="synthLfoSync"
                              label={
                                params.synthLfoSync ?? true
                                  ? 'Retrigger LFO Phase on Note On'
                                  : 'Free-Running Synth LFO'
                              }
                              active={params.synthLfoSync ?? true}
                              accent="violet"
                              onToggle={() =>
                                updateParam('synthLfoSync', !(params.synthLfoSync ?? true))
                              }
                            />
                            <IconToggleButton
                              icon="power"
                              midiId="synthLfoPower"
                              label="Synth LFO Modulator Power"
                              active={Boolean(params.synthLfoPower)}
                              accent="violet"
                              onToggle={() => updateParam('synthLfoPower', !params.synthLfoPower)}
                            />
                          </>
                        }
                      >
                        <div className="flex items-center justify-between gap-2 h-full pt-0.5">
                          <RotaryKnob
                            size="md"
                            midiId="synthLfoDepth"
                            accent="violet"
                            value={params.synthLfoDepth ?? 56}
                            min={0}
                            max={100}
                            step={1}
                            defaultValue={56}
                            showPerimeterDots
                            formatValue={(v) => `${Math.round(v)}% Depth`}
                            onChange={handleSynthLfoDepthChange}
                          />
                          <SynthLfoDisplay
                            midiId="synthLfoRateHz"
                            shape={params.synthLfoShape ?? 'SINE'}
                            target={params.synthLfoTarget ?? 'GROWL'}
                            rateHz={params.synthLfoRateHz ?? 2.8}
                            depth={params.synthLfoPower ? params.synthLfoDepth ?? 56 : 18}
                            lfoPhase={telemetry.synthLfoPhase}
                            active={Boolean(params.synthLfoPower) && !params.bypass}
                            accent="violet"
                            onChangeShape={(s) => updateParam('synthLfoShape', s)}
                            onChangeTarget={(t) => updateParam('synthLfoTarget', t)}
                            onChangeRateHz={(hz) => updateParam('synthLfoRateHz', hz)}
                          />
                        </div>
                      </ModuleCard>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1">
                      <ModuleCard
                        title="TONE"
                        active={params.tonePower && !params.bypass}
                        className="p-3"
                        onRandomize={() => handleRandomizeModule('tone')}
                        randomizeAccent="amber"
                        randomizeMidiId="action.rand.tone"
                        headerActions={
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                params.kickMode
                                  ? setKickRightSubView('mod')
                                  : setSynthRightSubView('mod')
                              }
                              title={
                                params.kickMode
                                  ? 'Return to KICK ADSR & KICK LFO Modulators'
                                  : 'Return to SYNTH ADSR & SYNTH LFO Modulators'
                              }
                              className="px-1.5 py-[2px] rounded bg-[#0C0E14]/90 border border-white/12 hover:border-white/30 font-mono text-[8px] font-semibold tracking-[0.06em] uppercase text-[#A5F3FC] hover:text-white whitespace-nowrap cursor-pointer transition-colors focus-visible:outline-none"
                            >
                              ADSR·LFO
                            </button>
                            <IconToggleButton
                              icon="power"
                              midiId="tonePower"
                              label="Wavefolder & Formant Drive Power"
                              active={params.tonePower}
                              accent="amber"
                              onToggle={() => updateParam('tonePower', !params.tonePower)}
                            />
                          </>
                        }
                      >
                        <div className="flex items-center justify-between gap-2 h-full pt-0.5">
                          <RotaryKnob
                            size="md"
                            midiId="toneDrive"
                            accent="amber"
                            value={params.toneDrive}
                            min={0}
                            max={100}
                            step={1}
                            defaultValue={INIT_SYNTH_PARAMS.toneDrive}
                            showPerimeterDots
                            formatValue={(v) => `${Math.round(v)}% Drive`}
                            onChange={(v) => updateParam('toneDrive', v)}
                          />
                          <HarmonicTubeDisplay
                            midiId="toneMode"
                            modes={TONE_MODES}
                            mode={params.toneMode}
                            drive={params.toneDrive / 100}
                            accent="amber"
                            onChangeMode={(m) => updateParam('toneMode', m as ToneMode)}
                          />
                        </div>
                      </ModuleCard>

                      <ModuleCard
                        title="STABILISE"
                        active={params.spacePower && !params.bypass}
                        className="p-3"
                        onRandomize={() => handleRandomizeModule('stabilise')}
                        randomizeAccent="violet"
                        randomizeMidiId="action.rand.stabilise"
                        headerActions={
                          <IconToggleButton
                            icon="power"
                            midiId="spacePower"
                            label="OTT Punch & Stereo Space Power"
                            active={params.spacePower}
                            accent="violet"
                            onToggle={() => updateParam('spacePower', !params.spacePower)}
                          />
                        }
                      >
                        <div className="flex items-center justify-between gap-2 h-full pt-0.5">
                          <RotaryKnob
                            size="md"
                            midiId="spaceAmount"
                            accent="violet"
                            value={params.spaceAmount}
                            min={0}
                            max={100}
                            step={1}
                            defaultValue={INIT_SYNTH_PARAMS.spaceAmount}
                            showPerimeterDots
                            formatValue={(v) => `${Math.round(v)}% Punch`}
                            onChange={(v) => updateParam('spaceAmount', v)}
                          />
                          <WaveformScopeDisplay
                            amount={params.spaceAmount / 100}
                            samples={
                              isSynthActive && telemetry.scopeSamples.length > 0
                                ? telemetry.scopeSamples
                                : undefined
                            }
                            accent="violet"
                          />
                        </div>
                      </ModuleCard>
                    </div>
                  )
                ) : activeRackTab === 'growlLab' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1">
                    {/* TAB 2 — MODULE 3: BITCRUSH (> Xover Staircase Quantizer) */}
                    <ModuleCard
                      title="BITCRUSH"
                      active={params.crushPower && !params.bypass && !params.subSolo}
                      className="p-3"
                      onRandomize={() => handleRandomizeModule('bitcrush')}
                      randomizeAccent="amber"
                      randomizeMidiId="action.rand.bitcrush"
                      headerActions={
                        <IconToggleButton
                          icon="power"
                          midiId="crushPower"
                          label="Mid/High Staircase Bitcrusher Power (> Xover)"
                          active={params.crushPower}
                          accent="amber"
                          onToggle={() => updateParam('crushPower', !params.crushPower)}
                        />
                      }
                    >
                      <div className="flex items-center justify-between gap-2 h-full pt-0.5">
                        <RotaryKnob
                          size="md"
                          midiId="fmCrush"
                          accent="amber"
                          value={params.fmCrush}
                          min={0}
                          max={100}
                          step={1}
                          defaultValue={INIT_SYNTH_PARAMS.fmCrush}
                          showPerimeterDots
                          formatValue={(v) =>
                            v <= 0
                              ? '16.0-bit Linear'
                              : `${(16 - (v / 100) * 12).toFixed(1)}-bit (${Math.round(v)}%)`
                          }
                          onChange={(v) => updateParam('fmCrush', v)}
                        />
                        <BitcrushScopeDisplay
                          midiId="fmCrush"
                          crush={params.crushPower ? params.fmCrush : 0}
                          bits={
                            isSynthActive && params.crushPower
                              ? telemetry.crushBits
                              : Number(
                                  (
                                    16 -
                                    ((params.crushPower ? params.fmCrush : 0) / 100) * 12
                                  ).toFixed(1)
                                )
                          }
                          accent="amber"
                        />
                      </div>
                    </ModuleCard>

                    {/* TAB 2 — MODULE 4: XOVER SUB (< Xover Clean LR4 Low-Band Anchor) */}
                    <ModuleCard
                      title="XOVER SUB"
                      active={!params.bypass}
                      className="p-3"
                      onRandomize={() => handleRandomizeModule('xoverSub')}
                      randomizeAccent="cyan"
                      randomizeMidiId="action.rand.xoverSub"
                      headerActions={
                        <IconToggleButton
                          icon="power"
                          midiId="fmSubOctave"
                          label="-1 Octave Pure Sine Sub Anchor"
                          active={params.fmSubOctave}
                          accent="cyan"
                          onToggle={() => updateParam('fmSubOctave', !params.fmSubOctave)}
                        />
                      }
                    >
                      <div className="flex items-center justify-between gap-2 h-full pt-0.5">
                        <RotaryKnob
                          size="md"
                          midiId="subPunch"
                          accent="cyan"
                          value={params.subPunch}
                          min={0}
                          max={100}
                          step={1}
                          defaultValue={INIT_SYNTH_PARAMS.subPunch}
                          showPerimeterDots
                          formatValue={(v) => `${Math.round(v)}% Sub Weight`}
                          onChange={(v) => updateParam('subPunch', v)}
                        />
                        <LcdFreqDisplay
                          midiId="xoverFreqHz"
                          frequency={params.xoverFreqHz}
                          minFreq={60}
                          maxFreq={240}
                          step={5}
                          accent="cyan"
                          labelPrimary="SPLIT"
                          labelSecondary="SLOPE"
                          unit="Hz"
                          allowNoteMode
                          formatSecondaryValue={() => ({
                            main: '24',
                            unit: 'dB',
                          })}
                          meterLevel={params.subPunch / 100}
                          onChangeFrequency={(hz) => updateParam('xoverFreqHz', hz)}
                          className="h-[66px]"
                        />
                      </div>
                    </ModuleCard>
                  </div>
                ) : activeRackTab === 'phaseWarp' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1">
                    {/* TAB 3 — MODULE 2: REESE NOTCH (Opposing Twin Mirror Notches) */}
                    <ModuleCard
                      title="REESE NOTCH"
                      active={Boolean(params.reesePower) && !params.bypass && !params.subSolo}
                      className="p-3"
                      onRandomize={() => handleRandomizeModule('reeseNotch')}
                      randomizeAccent="violet"
                      randomizeMidiId="action.rand.reeseNotch"
                      headerActions={
                        <IconToggleButton
                          icon="power"
                          midiId="reesePower"
                          label="Opposing Twin Mirror Reese Notch Power (> Xover)"
                          active={Boolean(params.reesePower)}
                          accent="violet"
                          onToggle={() => updateParam('reesePower', !params.reesePower)}
                        />
                      }
                    >
                      <div className="flex items-center justify-between gap-2 h-full pt-0.5">
                        <RotaryKnob
                          size="md"
                          midiId="reeseDepth"
                          accent="violet"
                          value={params.reeseDepth ?? 0}
                          min={0}
                          max={100}
                          step={1}
                          defaultValue={INIT_SYNTH_PARAMS.reeseDepth ?? 0}
                          showPerimeterDots
                          formatValue={(v) => `${Math.round(v)}% Carve`}
                          onChange={(v) => updateParam('reeseDepth', v)}
                        />
                        <ReeseMirrorDisplay
                          midiId="reeseSweep"
                          depth={params.reesePower ? params.reeseDepth ?? 0 : 0}
                          sweep={params.reeseSweep ?? 50}
                          accent="violet"
                          onChangeSweep={(s) => updateParam('reeseSweep', s)}
                        />
                      </div>
                    </ModuleCard>

                    {/* TAB 3 — MODULE 3: VINYL SCRATCH (Varispeed Scrub & Motorized Tape-Stop Brake) */}
                    <ModuleCard
                      title="VINYL SCRATCH"
                      active={
                        (Boolean(params.scratchPower) || Boolean(params.vinylBrake)) &&
                        !params.bypass
                      }
                      className="p-3"
                      onRandomize={() => handleRandomizeModule('vinylScratch')}
                      randomizeAccent="amber"
                      randomizeMidiId="action.rand.vinylScratch"
                      headerActions={
                        <IconToggleButton
                          icon="power"
                          midiId="scratchPower"
                          label="Turntable Varispeed Scratch & Stylus Grit Power"
                          active={Boolean(params.scratchPower)}
                          accent="amber"
                          onToggle={() => updateParam('scratchPower', !params.scratchPower)}
                        />
                      }
                    >
                      <div className="flex items-center justify-between gap-2 h-full pt-0.5">
                        <RotaryKnob
                          size="md"
                          midiId="scratchAmount"
                          accent="amber"
                          value={params.scratchAmount ?? 0}
                          min={0}
                          max={100}
                          step={1}
                          defaultValue={INIT_SYNTH_PARAMS.scratchAmount ?? 0}
                          showPerimeterDots
                          formatValue={(v) => `${Math.round(v)}% Scrub`}
                          onChange={(v) => updateParam('scratchAmount', v)}
                        />
                        <VinylPlatterDisplay
                          midiId="vinylBrake"
                          scratchAmount={params.scratchPower ? params.scratchAmount ?? 0 : 0}
                          brakeActive={Boolean(params.vinylBrake)}
                          playheadPhase={telemetry.phase}
                          accent="amber"
                          onToggleBrake={() => updateParam('vinylBrake', !params.vinylBrake)}
                        />
                      </div>
                    </ModuleCard>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1">
                    {/* TAB 4 — MODULE 2: SUB THUMP (Sub-Harmonic Note-Attack Pitch Spike) */}
                    <ModuleCard
                      title="SUB THUMP"
                      active={Boolean(params.thumpPower) && !params.bypass}
                      className="p-3"
                      onRandomize={() => handleRandomizeModule('subThump')}
                      randomizeAccent="amber"
                      randomizeMidiId="action.rand.subThump"
                      headerActions={
                        <IconToggleButton
                          icon="power"
                          midiId="thumpPower"
                          label="Sub-Harmonic Attack Transient Pitch Spike Power"
                          active={Boolean(params.thumpPower)}
                          accent="amber"
                          onToggle={() => updateParam('thumpPower', !params.thumpPower)}
                        />
                      }
                    >
                      <div className="flex items-center justify-between gap-2 h-full pt-0.5">
                        <RotaryKnob
                          size="md"
                          midiId="thumpAmount"
                          accent="amber"
                          value={params.thumpAmount ?? 0}
                          min={0}
                          max={100}
                          step={1}
                          defaultValue={INIT_SYNTH_PARAMS.thumpAmount ?? 0}
                          showPerimeterDots
                          formatValue={(v) => `+${((v / 100) * 28).toFixed(0)} st Knock`}
                          onChange={(v) => updateParam('thumpAmount', v)}
                        />
                        <SubThumpDisplay
                          midiId="thumpMode"
                          amount={params.thumpPower ? params.thumpAmount ?? 0 : 0}
                          mode={params.thumpMode ?? 'PUNCH'}
                          accent="amber"
                          onChangeMode={(m) => updateParam('thumpMode', m)}
                        />
                      </div>
                    </ModuleCard>

                    {/* TAB 4 — MODULE 3: OTT MULTIBAND (3-Band Upward/Downward Dynamics) */}
                    <ModuleCard
                      title="OTT MULTIBAND"
                      active={Boolean(params.ottPower) && !params.bypass}
                      className="p-3"
                      onRandomize={() => handleRandomizeModule('ottMultiband')}
                      randomizeAccent="emerald"
                      randomizeMidiId="action.rand.ottMultiband"
                      headerActions={
                        <IconToggleButton
                          icon="power"
                          midiId="ottPower"
                          label="True 3-Band Upward/Downward OTT Dynamics Power"
                          active={Boolean(params.ottPower)}
                          accent="emerald"
                          onToggle={() => updateParam('ottPower', !params.ottPower)}
                        />
                      }
                    >
                      <div className="flex items-center justify-between gap-2 h-full pt-0.5">
                        <RotaryKnob
                          size="md"
                          midiId="ottAmount"
                          accent="emerald"
                          value={params.ottAmount ?? 0}
                          min={0}
                          max={100}
                          step={1}
                          defaultValue={INIT_SYNTH_PARAMS.ottAmount ?? 0}
                          showPerimeterDots
                          formatValue={(v) => `${Math.round(v)}% OTT`}
                          onChange={(v) => updateParam('ottAmount', v)}
                        />
                        <OttMultibandDisplay
                          midiId="ottMode"
                          amount={params.ottPower ? params.ottAmount ?? 0 : 0}
                          mode={params.ottMode ?? 'UPWARD'}
                          bands={
                            isSynthActive && params.ottPower
                              ? telemetry.ottBands
                              : [0.42, 0.56, 0.64]
                          }
                          accent="emerald"
                          onChangeMode={(m) => updateParam('ottMode', m)}
                        />
                      </div>
                    </ModuleCard>
                  </div>
                )}

                {/* Persistent Bottom Utility Strip: Bandpass Filter + Dry/Wet + Bypass + Drone Play */}
                <div className="px-0.5 pt-1 flex flex-wrap sm:flex-nowrap items-end justify-between gap-2.5">
                  <div className="flex-1 min-w-[130px]">
                    <DualFilterBar
                      hpMidiId="hpFreq"
                      lpMidiId="lpFreq"
                      hpFreq={params.hpFreq}
                      lpFreq={params.lpFreq}
                      onChangeHp={(hz) => updateParam('hpFreq', hz)}
                      onChangeLp={(hz) => updateParam('lpFreq', hz)}
                    />
                  </div>

                  <MicroKnob
                    midiId="dryWet"
                    leftLabel="DRY"
                    rightLabel="WET"
                    accent="neutral"
                    value={params.dryWet}
                    defaultValue={INIT_SYNTH_PARAMS.dryWet}
                    formatValue={(v) => `${Math.round(v)}% Wet`}
                    onChange={(v) => updateParam('dryWet', v)}
                  />

                  <div className="flex items-center gap-1.5 shrink-0 pb-2">
                    <HardwarePillButton
                      label="BYPASS"
                      midiId="bypass"
                      active={params.bypass}
                      accent="amber"
                      onToggle={() => updateParam('bypass', !params.bypass)}
                    />
                    <TransportPillButton
                      midiId="action.play"
                      isPlaying={isDronePlaying}
                      onToggle={toggleDronePlayback}
                    />
                  </div>
                </div>
              </div>
            </div>
            )}

            {/* Far Right Edge Master Output Fader */}
            <div className="hidden lg:flex items-center justify-center shrink-0">
              <EdgeFader
                label="OUT"
                midiId="outGainDb"
                value={params.outGainDb}
                meterLevel={isSynthActive ? telemetry.outMeter : 0.05}
                onChange={(v) => updateParam('outGainDb', v)}
                height={188}
              />
            </div>
          </div>

          {/* Playable 25-Key Hardware Synth Keybed with Amp ADSR (ATK/REL) + Glide + Transpose */}
          <div className="mt-3.5">
            <HardwareKeyboard
              octave={params.octave}
              onChangeOctave={handleOctaveChange}
              activeMidiNote={displayedMidi}
              onNoteDown={handleNoteDown}
              onNoteUp={handleNoteUp}
              latch={params.latchMode}
              onToggleLatch={handleToggleLatch}
              attackMs={params.attackMs}
              onChangeAttack={handleAttackChange}
              releaseMs={params.releaseMs}
              onChangeRelease={handleReleaseChange}
              glideMs={params.glideMs}
              onChangeGlide={handleGlideChange}
              transposeSemitones={params.basePitchSemitones}
              onChangeTranspose={handleTransposeChange}
              accent="amber"
            />
          </div>
        </PluginChassis>
        )}

        <div className="mt-3 flex items-center justify-center gap-3 text-xs text-white/45 select-none">
          <button
            type="button"
            onClick={() => setShowComponentOverview(false)}
            className={`cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
              !showComponentOverview
                ? 'text-white/85 font-medium underline underline-offset-4'
                : 'hover:text-white/75'
            }`}
          >
            Synth Rack
          </button>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={() => setShowComponentOverview(true)}
            className={`cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
              showComponentOverview
                ? 'text-white/85 font-medium underline underline-offset-4'
                : 'hover:text-white/75'
            }`}
          >
            Component Overview
          </button>
        </div>
      </div>
    </MidiLearnContext.Provider>
  );
}
