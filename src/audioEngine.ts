import * as Tone from 'tone';
import {
  BuiltInSampleId,
  EnvelopeData,
  FxDelayMode,
  FxDeviceType,
  FxDistortMode,
  FxReverbMode,
  FxSaturatorMode,
  FxSlotItem,
  KickClipMode,
  KickLfoShape,
  KickLfoTarget,
  KickTailType,
  Point,
  SynthLfoTarget,
  SynthParams,
  TelemetryFrame,
  ToneMode,
} from './types';

export interface PhaseScopeSnapshot {
  l: Float32Array;
  r: Float32Array;
  correlation: number; // -1.0 to +1.0 stereo Pearson correlation
  widthPct: number; // 0 to 100 stereo side energy %
  rms: number; // 0 to 1 signal RMS
  isActive: boolean;
}

export interface MasterVuSnapshot {
  rmsDbL: number; // -60 to +6 dBFS ballistic RMS Left
  rmsDbR: number; // -60 to +6 dBFS ballistic RMS Right
  peakDbL: number; // -60 to +6 dBFS fast peak Left
  peakDbR: number; // -60 to +6 dBFS fast peak Right
  holdDbL: number; // -60 to +6 dBFS peak-hold marker Left
  holdDbR: number; // -60 to +6 dBFS peak-hold marker Right
  maxPeakDb: number; // highest held or latched peak in dBFS
  clipNow: boolean; // instantaneous >= 0 dBFS clip on current block
  clipLatchedL: boolean; // sticky clip latch Left
  clipLatchedR: boolean; // sticky clip latch Right
  limiterGrDb: number; // 0 to -24 dB safety limiter gain reduction
  isActive: boolean;
}

function dbToGain(db: number): number {
  if (db <= -59.5) return 0;
  return Math.pow(10, db / 20);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Zero-timeline-allocation parameter updater.
 * Direct `.value` assignment with one-pole JS smoothing is O(1), allocates
 * zero AudioParamTimeline events, and is natively de-zippered per 128-sample quantum.
 */
function setParamSmooth(
  param: { value: number | string } | null | undefined,
  target: number,
  alpha = 0.45,
  eps = 1e-4
): void {
  if (!param || !Number.isFinite(target)) return;
  const cur = typeof param.value === 'number' ? param.value : Number(param.value);
  if (!Number.isFinite(cur)) {
    param.value = target;
    return;
  }
  const diff = target - cur;
  if (Math.abs(diff) <= eps) {
    if (cur !== target && (target === 0 || target === 1 || Math.abs(diff) > 1e-6)) {
      param.value = target;
    }
    return;
  }
  param.value = cur + diff * alpha;
}

function setParamDirect(
  param: { value: number | string } | null | undefined,
  target: number,
  eps = 1e-4
): void {
  if (!param || !Number.isFinite(target)) return;
  const cur = typeof param.value === 'number' ? param.value : Number(param.value);
  if (!Number.isFinite(cur) || Math.abs(cur - target) > eps) {
    param.value = target;
  }
}

/**
 * Safe exponential ADSR gate transition that cancels prior scheduled events
 * so `AudioParamTimeline` never accumulates more than 1 event.
 */
function rampAudioGate(
  param: AudioParam | Tone.Param<any> | null | undefined,
  target: number,
  now: number,
  tau: number
): void {
  if (!param) return;
  const safeTau = Math.max(0.003, tau);
  try {
    const raw = param as unknown as AudioParam & {
      cancelAndHoldAtTime?: (t: number) => AudioParam;
    };
    if (typeof raw.cancelAndHoldAtTime === 'function') {
      raw.cancelAndHoldAtTime(now);
    } else if (typeof param.cancelScheduledValues === 'function') {
      param.cancelScheduledValues(now);
    }
    param.setTargetAtTime(target, now, safeTau);
  } catch {
    param.value = target;
  }
}

function connectSafe(
  src: AudioNode | null | undefined,
  dst: AudioNode | AudioParam | null | undefined
): void {
  if (!src || !dst) return;
  try {
    if (dst instanceof AudioNode) {
      src.connect(dst);
    } else {
      src.connect(dst);
    }
  } catch {
    // ignore redundant connection edge cases
  }
}

function disconnectSafe(
  src: AudioNode | null | undefined,
  dst: AudioNode | AudioParam | null | undefined
): void {
  if (!src || !dst) return;
  try {
    if (dst instanceof AudioNode) {
      src.disconnect(dst);
    } else {
      src.disconnect(dst);
    }
  } catch {
    // ignore already disconnected edge cases
  }
}

// Human vocal tract F1 / F2 formant table (U -> O -> A -> E -> I) voiced for chesty, organic throat growls
const VOWEL_FORMANTS: [number, number][] = [
  [250, 710], // U ("Ooo") — deep chest resonance
  [410, 880], // O ("Ohh") — warm guttural throat
  [660, 1140], // A ("Ahh") — open vocal roar
  [490, 1680], // E ("Ehh") — articulated mid growl
  [280, 2080], // I ("Eee") — upper vocal edge without piercing whistle
];

// 90-degree Quadrature Hilbert All-Pass pole frequencies (80 Hz - 12 kHz wide-band SSB)
const HILBERT_I_POLES = [126, 610, 2490, 9850];
const HILBERT_Q_POLES = [36, 272, 1140, 4680];

// 8-Band Vocoder / Spectral Gate resonant filterbank center frequencies (> Xover)
const SPECTRAL_BAND_FREQS = [190, 310, 480, 740, 1150, 1780, 2750, 4200];

const DISPERSER_STAGE_COUNT = 8;
const PHASE_SCOPE_SAMPLES = 256;
const SCOPE_BAR_COUNT = 27;
const MASTER_BAR_COUNT = 64;

function interpolateFormants(pos: number): [number, number] {
  const scaled = clamp(pos, 0, 1) * (VOWEL_FORMANTS.length - 1);
  const idx = Math.min(VOWEL_FORMANTS.length - 2, Math.floor(scaled));
  const frac = scaled - idx;
  const [f1a, f2a] = VOWEL_FORMANTS[idx];
  const [f1b, f2b] = VOWEL_FORMANTS[idx + 1];
  return [f1a + (f1b - f1a) * frac, f2a + (f2b - f2a) * frac];
}

// Odd sample count (1025) guarantees exact zero at midpoint index 512 (zero DC offset!)
const SHAPER_SAMPLES = 1025;

// Subtle Low-Band (< Xover) Analog Tape Warmth Curve so sub harmonics fuse seamlessly into low-mids
const LOW_BAND_WARM_CURVE: Float32Array<ArrayBuffer> = (() => {
  const buf = new ArrayBuffer(SHAPER_SAMPLES * 4);
  const curve = new Float32Array(buf);
  const normScale = 1 / Math.tanh(1.36);
  for (let i = 0; i < SHAPER_SAMPLES; i++) {
    const x = (i * 2) / (SHAPER_SAMPLES - 1) - 1;
    curve[i] = i === 512 ? 0 : Math.tanh(x * 1.36) * normScale * 0.97;
  }
  curve[512] = 0;
  return curve;
})();

// Precomputed zero-DC staircase bitcrusher WaveShaper transfer curves (levels 0..10)
const CRUSH_CURVE_BANK: Float32Array<ArrayBuffer>[] = Array.from({ length: 11 }, (_, tier) => {
  const buf = new ArrayBuffer(SHAPER_SAMPLES * 4);
  const curve = new Float32Array(buf);
  const norm = tier / 10;
  const steps = Math.max(4.0, 64 * Math.pow(0.065, norm));
  const drive = 1 + norm * 1.75;

  for (let i = 0; i < SHAPER_SAMPLES; i++) {
    const x = (i * 2) / (SHAPER_SAMPLES - 1) - 1;
    if (tier === 0 || i === 512) {
      curve[i] = tier === 0 ? x : 0;
    } else {
      const boosted = x * drive;
      const quantized = Math.round(boosted * steps) / steps;
      const asym = quantized + 0.05 * norm * quantized * Math.abs(quantized);
      curve[i] = Math.tanh(asym * 1.12);
    }
  }
  curve[512] = 0;
  return curve;
});

const TONE_MODE_LIST: ToneMode[] = ['TEAROUT', 'ROAR', 'YOI', 'SCREAM', 'TUBE', 'CLIP'];

// Precomputed Organic Multi-Stage Saturation & Smooth Analog Wavefolding Curves (4x Oversampled, Unity Small-Signal Slope)
const TONE_CURVE_BANK: Record<ToneMode, Float32Array<ArrayBuffer>[]> = TONE_MODE_LIST.reduce(
  (acc, mode) => {
    acc[mode] = Array.from({ length: 11 }, (_, tier) => {
      const buf = new ArrayBuffer(SHAPER_SAMPLES * 4);
      const curve = new Float32Array(buf);
      const norm = tier / 10;

      for (let i = 0; i < SHAPER_SAMPLES; i++) {
        const x = (i * 2) / (SHAPER_SAMPLES - 1) - 1;
        if (i === 512) {
          curve[i] = 0;
          continue;
        }
        if (tier === 0) {
          curve[i] = x;
          continue;
        }

        let y = x;
        switch (mode) {
          case 'TEAROUT': {
            // Controlled dual-stage analog saturation + gentle wavefold (preserves transient punch)
            const k = 1.0 + norm * 1.15;
            const stage1 = Math.tanh(x * k) / Math.tanh(Math.max(0.85, k * 0.78));
            const fold = Math.sin(stage1 * (1.05 + norm * 0.72)) * 0.22 * norm;
            y = clamp(Math.tanh(stage1 * 0.92 + fold), -0.95, 0.95);
            break;
          }
          case 'ROAR': {
            // Warm asymmetric triode + gentle 3rd-harmonic chest growl
            const k = 1.0 + norm * 1.05;
            const u = clamp(x * k, -1.14, 1.14);
            const cheb3 = 4 * u * u * u - 3 * u;
            const asym = u >= 0 ? Math.tanh(u * 1.12) : Math.tanh(u * 0.96);
            y = clamp(asym * 0.88 + Math.tanh(cheb3 * 0.16 * norm) * 0.18, -0.95, 0.95);
            break;
          }
          case 'YOI': {
            // Liquid vocal asymmetric saturation (emphasizes even harmonics for vowel warmth)
            const k = 1.0 + norm * 0.98;
            const asym = x >= 0 ? Math.tanh(x * k * 1.18) : Math.tanh(x * k * 0.92);
            const softFold = Math.sin(asym * Math.PI * (0.64 + norm * 0.48)) * 0.12 * norm;
            y = clamp(asym * 0.9 + softFold, -0.94, 0.94);
            break;
          }
          case 'SCREAM': {
            // Focused harmonic saturation + smooth arctan knee
            const k = 1.0 + norm * 1.25;
            const core = Math.atan(x * k * 1.45) * (2 / Math.PI);
            const fold = Math.sin(x * k * 1.15) * 0.18 * norm;
            y = clamp(core * 0.88 + fold, -0.95, 0.95);
            break;
          }
          case 'TUBE': {
            // Lush analog vacuum-tube soft-knee saturation (never buzzy or overdriven)
            const k = 0.9 + norm * 1.05;
            const normScale = 0.93 / Math.tanh(Math.max(0.85, k));
            y =
              x >= 0
                ? Math.tanh(x * k * 1.08) * normScale * 0.96
                : Math.tanh(x * k * 0.92) * normScale;
            y = clamp(y, -0.94, 0.94);
            break;
          }
          case 'CLIP':
          default: {
            // Analog console soft-to-firm ceiling clipper
            const k = 1.0 + norm * 1.18;
            const hard = clamp(x * k, -0.9, 0.9);
            const soft = Math.tanh(x * k);
            y = soft * (1 - norm * 0.5) + hard * (norm * 0.5);
            break;
          }
        }
        curve[i] = y;
      }
      curve[512] = 0;
      return curve;
    });
    return acc;
  },
  {} as Record<ToneMode, Float32Array<ArrayBuffer>[]>
);

const KICK_CLIP_MODE_LIST: KickClipMode[] = ['GABBER', 'GCLIP', 'FOLD', 'ZAAG', 'BOILER'];

// Precomputed 1025-sample Zero-DC Gabber / Hardcore / Krach Kick Clipper Curves (Normalized Headroom, 4x Oversampled)
const KICK_CLIP_CURVE_BANK: Record<KickClipMode, Float32Array<ArrayBuffer>[]> =
  KICK_CLIP_MODE_LIST.reduce(
    (acc, mode) => {
      acc[mode] = Array.from({ length: 11 }, (_, tier) => {
        const buf = new ArrayBuffer(SHAPER_SAMPLES * 4);
        const curve = new Float32Array(buf);
        const norm = tier / 10;

        for (let i = 0; i < SHAPER_SAMPLES; i++) {
          const x = (i * 2) / (SHAPER_SAMPLES - 1) - 1;
          if (i === 512) {
            curve[i] = 0;
            continue;
          }
          if (tier === 0) {
            curve[i] = x;
            continue;
          }

          let y = x;
          switch (mode) {
            case 'GABBER': {
              // Authentic Rotterdam Mackie CR-1604 Asymmetric Op-Amp Rail Clipper:
              // Firm positive rail (+0.89) for crisp tok/throat bark + warm negative rail (-0.80) for fat 909 sub chest!
              const k = 1.0 + norm * 0.85;
              if (x >= 0) {
                const softPos = Math.tanh(x * k * 1.24);
                const railPos = clamp(x * k * 1.12, 0, 0.89);
                y = softPos * (1 - norm * 0.62) + railPos * (norm * 0.62);
              } else {
                const softNeg = Math.tanh(x * k * 0.98) * 0.86;
                const railNeg = clamp(x * k * 0.94, -0.8, 0);
                y = softNeg * (1 - norm * 0.45) + railNeg * (norm * 0.45);
              }
              y = clamp(y, -0.84, 0.9);
              break;
            }
            case 'GCLIP': {
              // Controlled Mastering Clipper (clean slope until ceiling so punch stays intact)
              const k = 1.0 + norm * 1.15;
              const hard = clamp(x * k, -0.9, 0.9);
              const soft = Math.tanh(x * k);
              y = soft * (1 - norm * 0.72) + hard * (norm * 0.72);
              break;
            }
            case 'FOLD': {
              // Controlled Harmonic Wavefolder + Firm Ceiling
              const k = 1.0 + norm * 1.25;
              const folded =
                Math.sin(x * k * 1.38) * 0.54 + clamp(x * k * 1.08, -0.9, 0.9) * 0.52;
              y = clamp(folded, -0.93, 0.93);
              break;
            }
            case 'ZAAG': {
              // Asymmetric Chainsaw Rectifier-Clipper (DC-blocked post-shaper for 2nd+3rd saw bite)
              const k = 1.0 + norm * 1.2;
              if (x >= 0) {
                y = clamp(x * k * 1.14, 0, 0.92);
              } else {
                y = clamp(Math.tanh(x * k * 0.86) * 0.84, -0.84, 0);
              }
              break;
            }
            case 'BOILER':
            default: {
              // Deutsche Krach Chebyshev 3rd + 5th Harmonic Saturator (controlled, non-crushed)
              const k = 1.0 + norm * 1.05;
              const u = clamp(x * k, -1.18, 1.18);
              const cheb3 = 4 * u * u * u - 3 * u;
              const cheb5 = 16 * Math.pow(u, 5) - 20 * u * u * u + 5 * u;
              y = clamp(
                Math.tanh(u * 1.15 + cheb3 * 0.22 * norm + cheb5 * 0.09 * norm),
                -0.93,
                0.93
              );
              break;
            }
          }
          curve[i] = y;
        }
        curve[512] = 0;
        return curve;
      });
      return acc;
    },
    {} as Record<KickClipMode, Float32Array<ArrayBuffer>[]>
  );

// Precomputed Dark Industrial Cavern Rumble Overdrive Curve
const RUMBLE_DRIVE_CURVE: Float32Array<ArrayBuffer> = (() => {
  const buf = new ArrayBuffer(SHAPER_SAMPLES * 4);
  const curve = new Float32Array(buf);
  for (let i = 0; i < SHAPER_SAMPLES; i++) {
    const x = (i * 2) / (SHAPER_SAMPLES - 1) - 1;
    curve[i] = i === 512 ? 0 : Math.tanh(x * 2.15) * 0.94;
  }
  return curve;
})();

const FX_SAT_MODES: FxSaturatorMode[] = ['TAPE', 'TRIODE', 'IRON'];
// Unity-Slope Analog Tape / Triode / Transformer Saturation Curves (headroom-preserving, never harsh fuzz)
const FX_SAT_CURVE_BANK: Record<FxSaturatorMode, Float32Array<ArrayBuffer>[]> = FX_SAT_MODES.reduce(
  (acc, mode) => {
    acc[mode] = Array.from({ length: 11 }, (_, tier) => {
      const buf = new ArrayBuffer(SHAPER_SAMPLES * 4);
      const curve = new Float32Array(buf);
      const norm = tier / 10;
      for (let i = 0; i < SHAPER_SAMPLES; i++) {
        const x = (i * 2) / (SHAPER_SAMPLES - 1) - 1;
        if (i === 512) {
          curve[i] = 0;
          continue;
        }
        if (tier === 0) {
          curve[i] = x;
          continue;
        }
        let y = x;
        switch (mode) {
          case 'TAPE': {
            // Studer A800 style soft magnetic hysteresis knee (unity slope around 0, smooth ceiling)
            const k = 0.75 + norm * 1.15;
            const scale = Math.min(1.05, 0.92 / Math.tanh(k));
            y = clamp(Math.tanh(x * k) * scale, -0.95, 0.95);
            break;
          }
          case 'TRIODE': {
            // Warm 12AX7 asymmetric tube curvature (gentle even-order 2nd harmonic warmth)
            const k = 0.8 + norm * 1.1;
            const pos = Math.tanh(x * k * 1.14) * 0.92;
            const neg = Math.tanh(x * k * 0.88) * 0.96;
            y = clamp(x >= 0 ? pos : neg, -0.95, 0.95);
            break;
          }
          case 'IRON':
          default: {
            // Neve-style output transformer iron core (fat low-order 3rd harmonic density)
            const k = 0.78 + norm * 1.05;
            const u = clamp(x * k, -1.12, 1.12);
            const third = u + 0.24 * norm * u * u * u;
            y = clamp(Math.tanh(third * 1.02) * 0.95, -0.95, 0.95);
            break;
          }
        }
        curve[i] = y;
      }
      curve[512] = 0;
      return curve;
    });
    return acc;
  },
  {} as Record<FxSaturatorMode, Float32Array<ArrayBuffer>[]>
);

const FX_DIST_MODES: FxDistortMode[] = ['GABBER', 'HARD', 'FUZZ', 'FOLD', 'RECT'];
// Normalized-Slope 4x-Oversampled Distortion Curves (preGain controls exact drive headroom!)
const FX_DIST_CURVE_BANK: Record<FxDistortMode, Float32Array<ArrayBuffer>[]> = FX_DIST_MODES.reduce(
  (acc, mode) => {
    acc[mode] = Array.from({ length: 11 }, (_, tier) => {
      const buf = new ArrayBuffer(SHAPER_SAMPLES * 4);
      const curve = new Float32Array(buf);
      const norm = tier / 10;
      for (let i = 0; i < SHAPER_SAMPLES; i++) {
        const x = (i * 2) / (SHAPER_SAMPLES - 1) - 1;
        if (i === 512) {
          curve[i] = 0;
          continue;
        }
        if (tier === 0) {
          curve[i] = x;
          continue;
        }
        let y = x;
        switch (mode) {
          case 'GABBER': {
            // Classic 90s Rotterdam Mixer Desk (Mackie CR-1604) Op-Amp Rail Clipper:
            // Linear unity core through mid-levels so transient snap punches cleanly,
            // hitting asymmetric +0.89 / -0.79 op-amp supply rails for hollow 909 Gabber roar!
            const k = 1.0 + norm * 0.65;
            if (x >= 0) {
              const soft = Math.tanh(x * k * 1.22);
              const rail = clamp(x * k * 1.08, 0, 0.89);
              y = soft * (1 - norm * 0.68) + rail * (norm * 0.68);
            } else {
              const soft = Math.tanh(x * k * 0.96) * 0.84;
              const rail = clamp(x * k * 0.92, -0.79, 0);
              y = soft * (1 - norm * 0.48) + rail * (norm * 0.48);
            }
            y = clamp(y, -0.82, 0.9);
            break;
          }
          case 'HARD': {
            // Precision Symmetrical Silicon Diode / Mastering Hard Clipper
            const k = 1.0 + norm * 0.85;
            const hard = clamp(x * k, -0.9, 0.9);
            const soft = Math.tanh(x * k);
            y = soft * (1 - norm * 0.78) + hard * (norm * 0.78);
            break;
          }
          case 'FUZZ': {
            // Controlled Transistor Fuzz (normalized slope so it doesn't turn into white noise)
            const k = 1.0 + norm * 1.15;
            const sign = x >= 0 ? 1 : -1;
            y = sign * (1 - Math.exp(-Math.abs(x * k * 1.45))) * (x >= 0 ? 0.92 : 0.84);
            break;
          }
          case 'FOLD': {
            // West-Coast Serge / Buchla Wavefolder
            const k = 1.0 + norm * 1.1;
            y = clamp(
              Math.sin(x * k * 1.42) * 0.58 + clamp(x * k * 1.05, -0.9, 0.9) * 0.44,
              -0.93,
              0.93
            );
            break;
          }
          case 'RECT':
          default: {
            // Half/Full-Wave Octave Rectifier Distortion (zeroed at x = 0)
            const k = 1.0 + norm * 0.95;
            const rect = Math.abs(x * k) * 1.12;
            const asym =
              x >= 0 ? clamp(x * k * 1.12, 0, 0.93) : clamp(-Math.abs(x * k) * 0.34, -0.58, 0);
            y = clamp(asym * (1 - norm * 0.52) + rect * (norm * 0.52), -0.92, 0.93);
            break;
          }
        }
        curve[i] = y;
      }
      curve[512] = 0;
      return curve;
    });
    return acc;
  },
  {} as Record<FxDistortMode, Float32Array<ArrayBuffer>[]>
);

interface FxUnitRuntime {
  id: string;
  type: FxDeviceType;
  input: GainNode;
  output: GainNode;
  update: (slot: FxSlotItem) => void;
  destroy: () => void;
}

export class AudioEngine {
  // Module 0: Dual-Oscillator + PWM + Supersaw + Hard-Sync + RingMod + Noise Synth Engine
  private oscPrimary: Tone.FatOscillator | null = null;
  private oscPulse: Tone.PulseOscillator | null = null;
  private oscSync: Tone.FMOscillator | null = null;
  private oscSecondary: Tone.Oscillator | null = null;
  private primaryWaveGain: GainNode | null = null;
  private pulseWaveGain: GainNode | null = null;
  private syncWaveGain: GainNode | null = null;
  private secondaryWaveGain: GainNode | null = null;
  private ringModNode: GainNode | null = null;
  private ringMixGain: GainNode | null = null;
  private noiseGen: Tone.Noise | null = null;
  private noiseGain: GainNode | null = null;
  private oscVoiceGate: GainNode | null = null;

  // Module 1: Granular Sampler Layer
  private player: Tone.GrainPlayer | null = null;
  private grainGate: GainNode | null = null;
  private buffer: Tone.ToneAudioBuffer | null = null;

  // Module 2: Dual-Operator FM Growl Synth Bank
  private fmCarrier: Tone.FMOscillator | null = null;
  private fmMetallicOsc: Tone.FMOscillator | null = null;
  private fmMetallicGain: GainNode | null = null;
  private unisonOsc: Tone.FatOscillator | null = null;
  private unisonGain: GainNode | null = null;
  private subOsc: Tone.Oscillator | null = null;
  private subGain: GainNode | null = null;
  private fmVoiceGate: GainNode | null = null;
  private subDirectGate: GainNode | null = null;
  private synthAmpEnvGain: GainNode | null = null;
  private synthLfoAmpGain: GainNode | null = null;
  private synthSubEnvGain: GainNode | null = null;

  // Kick & Master Chain (100% Phase-Locked Per-Hit Native Web Audio C++ Voices + Deterministic Tok + Krach + Rumble)
  private activeKickVoices: {
    chokeGain: GainNode;
    fmGain: GainNode | null;
    stopAt: number;
    sources: AudioScheduledSourceNode[];
    nodes: AudioNode[];
  }[] = [];
  private kickBodyDetuneSource: ConstantSourceNode | null = null;
  private kickHarmDetuneSource: ConstantSourceNode | null = null;
  private kickTokBuffer: AudioBuffer | null = null;
  private kickLfoAmpGain: GainNode | null = null;
  private kickTokBpFilter: BiquadFilterNode | null = null;
  private kickRawSum: GainNode | null = null;
  private kickSubLp: BiquadFilterNode | null = null;
  private kickSubReinforce: GainNode | null = null;
  private kickPreHp: BiquadFilterNode | null = null;
  private kickDryKrachGain: GainNode | null = null;
  private kickPreEq: BiquadFilterNode | null = null;
  private kickPreDrive: GainNode | null = null;
  private kickShaper: WaveShaperNode | null = null;
  private kickPostHp: BiquadFilterNode | null = null;
  private kickPostDip: BiquadFilterNode | null = null;
  private kickPostLp: BiquadFilterNode | null = null;
  private kickWetKrachGain: GainNode | null = null;
  private kickDryPunchSum: GainNode | null = null;
  private rumbleIn: GainNode | null = null;
  private rumbleDelay: DelayNode | null = null;
  private rumbleAp1: BiquadFilterNode | null = null;
  private rumbleAp2: BiquadFilterNode | null = null;
  private rumbleFbGain: GainNode | null = null;
  private rumbleHp: BiquadFilterNode | null = null;
  private rumbleLp: BiquadFilterNode | null = null;
  private rumbleShaper: WaveShaperNode | null = null;
  private rumbleDuckGain: GainNode | null = null;
  private kickVoiceGate: GainNode | null = null;
  private currentKickClipMode: KickClipMode = 'GABBER';
  private currentKickClipTier = -1;

  // 115 Hz Linkwitz-Riley (LR4) Multiband Crossover + Direct Full-Bandwidth Kick Bypass
  private inputGain: GainNode | null = null;
  private dryBranch: GainNode | null = null;
  private wetBranch: GainNode | null = null;
  private hpFilter: BiquadFilterNode | null = null;
  private lpFilter: BiquadFilterNode | null = null;
  private kickFullBandDirect: GainNode | null = null;

  // LR4 Low Band (< 115 Hz Warm Phase-Coherent Mono Sub Path)
  private xoverLow1: BiquadFilterNode | null = null;
  private xoverLow2: BiquadFilterNode | null = null;
  private lowBandShaper: WaveShaperNode | null = null;
  private lowBandGain: GainNode | null = null;

  // LR4 Mid/High Band (> 115 Hz Growl Mangler Path)
  private xoverHigh1: BiquadFilterNode | null = null;
  private xoverHigh2: BiquadFilterNode | null = null;
  private wahFilter: BiquadFilterNode | null = null;
  private combDelay: DelayNode | null = null;
  private combDamping: BiquadFilterNode | null = null;
  private combFeedback: GainNode | null = null;
  private combWet: GainNode | null = null;
  private combSum: GainNode | null = null;
  private formant1: BiquadFilterNode | null = null;
  private formant2: BiquadFilterNode | null = null;
  private notchFilter: BiquadFilterNode | null = null;
  private crushShaper: WaveShaperNode | null = null;
  private crushDry: GainNode | null = null;
  private crushWet: GainNode | null = null;
  private crushSum: GainNode | null = null;
  private currentCrushTier = -1;

  // Sonic Shaper 1: 8-Stage High-Q Cascaded All-Pass Phase Disperser ("Laser / Zap" Gravity)
  private disperserStages: BiquadFilterNode[] = [];
  private disperserDry: GainNode | null = null;
  private disperserWet: GainNode | null = null;
  private disperserSum: GainNode | null = null;

  // Sonic Shaper 2: Quadrature Hilbert Bode SSB Frequency Shifter (-400..+400 Hz & Stereo Barberpole)
  private freqShiftDry: GainNode | null = null;
  private freqShiftIn: GainNode | null = null;
  private hilbertI: BiquadFilterNode[] = [];
  private hilbertQ: BiquadFilterNode[] = [];
  private bodeCosOsc: OscillatorNode | null = null;
  private bodeSinOsc: OscillatorNode | null = null;
  private bodeRingI: GainNode | null = null;
  private bodeRingQ: GainNode | null = null;
  private bodeSignL: GainNode | null = null;
  private bodeSignR: GainNode | null = null;
  private bodeSumL: GainNode | null = null;
  private bodeSumR: GainNode | null = null;
  private bodeStereoMerger: ChannelMergerNode | null = null;
  private bodeWetGain: GainNode | null = null;
  private bodeFbLp: BiquadFilterNode | null = null;
  private bodeFbGain: GainNode | null = null;
  private freqShiftSum: GainNode | null = null;

  // Sonic Shaper 5: Dual-Peak "Reese Notch" & Mirror Phaser Matrix
  private reeseNotchLow: BiquadFilterNode | null = null;
  private reeseNotchHigh: BiquadFilterNode | null = null;
  private reesePeakLow: BiquadFilterNode | null = null;
  private reesePeakHigh: BiquadFilterNode | null = null;

  // Sonic Shaper 8: Open-Loop Pre-Sidechain 8-Band Dynamic Spectral Gate Filterbank
  private spectralAnalyser: AnalyserNode | null = null;
  private readonly spectralByteBuf = new Uint8Array(32);
  private readonly spectralGateEnv = new Float32Array(8);
  private spectralIn: GainNode | null = null;
  private spectralDry: GainNode | null = null;
  private spectralBandFilters: BiquadFilterNode[] = [];
  private spectralBandGains: GainNode[] = [];
  private spectralWet: GainNode | null = null;
  private spectralSum: GainNode | null = null;

  // Native Zero-Allocation Mid-Band Warmth + 2x-Oversampled Saturation + Analog Cabinet Contour
  private bodyWarmthFilter: BiquadFilterNode | null = null;
  private toneDry: GainNode | null = null;
  private tonePreGain: GainNode | null = null;
  private toneShaper: WaveShaperNode | null = null;
  private toneWet: GainNode | null = null;
  private postToneCabinetLp: BiquadFilterNode | null = null;
  private currentToneMode: ToneMode = 'TEAROUT';
  private currentToneTier = -1;
  private midBandGate: GainNode | null = null;

  // Natural Unison Stereo Spread (> Xover only)
  private unisonWidthDry: GainNode | null = null;
  private unisonSpreadL: DelayNode | null = null;
  private unisonSpreadR: DelayNode | null = null;
  private unisonLfo: OscillatorNode | null = null;
  private unisonLfoGainL: GainNode | null = null;
  private unisonLfoGainR: GainNode | null = null;
  private unisonWidthMerger: ChannelMergerNode | null = null;
  private unisonWidthWet: GainNode | null = null;
  private unisonWidthSum: GainNode | null = null;

  // Sonic Shaper 3: Stereo Haas / Mid-Side Dimension Expander (> Xover only, Sub stays Mono!)
  private haasIn: GainNode | null = null;
  private haasDry: GainNode | null = null;
  private haasDelayL: DelayNode | null = null;
  private haasDelayR: DelayNode | null = null;
  private haasChorusLfo: OscillatorNode | null = null;
  private haasLfoGainL: GainNode | null = null;
  private haasLfoGainR: GainNode | null = null;
  private haasMerger: ChannelMergerNode | null = null;
  private haasStereoGate: GainNode | null = null;
  private haasStageSum: GainNode | null = null;

  // Phase Scope Stereo Alignment Rotator (-180°..+180° Differential All-Pass + R Polarity Invert, > Xover only)
  private phaseBypassGain: GainNode | null = null;
  private phaseSplitter: ChannelSplitterNode | null = null;
  private phaseApL1: BiquadFilterNode | null = null;
  private phaseApL2: BiquadFilterNode | null = null;
  private phaseApR1: BiquadFilterNode | null = null;
  private phaseApR2: BiquadFilterNode | null = null;
  private phaseRightPolarity: GainNode | null = null;
  private phaseMerger: ChannelMergerNode | null = null;

  private multibandSum: GainNode | null = null;

  // Sonic Shaper 4: Native C++ Web Audio 3-Band Upward/Downward Multiband OTT
  private ottIn: GainNode | null = null;
  private ottDry: GainNode | null = null;
  private ottWet: GainNode | null = null;
  private ottSum: GainNode | null = null;
  private ottLpFilter: BiquadFilterNode | null = null;
  private ottBpFilter: BiquadFilterNode | null = null;
  private ottHpFilter: BiquadFilterNode | null = null;
  private ottPreLow: GainNode | null = null;
  private ottPreMid: GainNode | null = null;
  private ottPreHigh: GainNode | null = null;
  private ottCompLow: DynamicsCompressorNode | null = null;
  private ottCompMid: DynamicsCompressorNode | null = null;
  private ottCompHigh: DynamicsCompressorNode | null = null;
  private ottMakeupLow: GainNode | null = null;
  private ottMakeupMid: GainNode | null = null;
  private ottMakeupHigh: GainNode | null = null;

  // Native 3-Band Tone EQ + Band-Limited Stereo Air-Stabiliser (replaces unstable Tone.Freeverb) + Compensated Glue Compressor
  private eqLow: BiquadFilterNode | null = null;
  private eqMid: BiquadFilterNode | null = null;
  private eqHigh: BiquadFilterNode | null = null;
  private spaceIn: GainNode | null = null;
  private spaceHpFilter: BiquadFilterNode | null = null;
  private spaceLpFilter: BiquadFilterNode | null = null;
  private spaceDelayL: DelayNode | null = null;
  private spaceDelayR: DelayNode | null = null;
  private spaceApL: BiquadFilterNode | null = null;
  private spaceApR: BiquadFilterNode | null = null;
  private spaceFbL: GainNode | null = null;
  private spaceFbR: GainNode | null = null;
  private spaceMerger: ChannelMergerNode | null = null;
  private spaceDry: GainNode | null = null;
  private spaceWet: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private compressorMakeup: GainNode | null = null;

  // Sonic Shaper 6: Turntable Vinyl Scratch, Motorized Tape-Stop Brake & Stylus Grit
  private vinylBypassGain: GainNode | null = null;
  private vinylSplitter: ChannelSplitterNode | null = null;
  private vinylDelayL: DelayNode | null = null;
  private vinylDelayR: DelayNode | null = null;
  private vinylMerger: ChannelMergerNode | null = null;
  private vinylLpFilter: BiquadFilterNode | null = null;
  private vinylDuckGain: GainNode | null = null;
  private vinylDustBp: BiquadFilterNode | null = null;
  private vinylDustGain: GainNode | null = null;
  private vinylOutSum: GainNode | null = null;

  // Modular Master FX Patchbay Chain (0% CPU direct-thru by default when empty)
  private fxChainIn: GainNode | null = null;
  private fxChainOut: GainNode | null = null;
  private fxRuntimeMap = new Map<string, FxUnitRuntime>();
  private currentFxOrderSignature = 'DIRECT';
  private activePatchedUnits: FxUnitRuntime[] = [];

  // Global Master Mono-Compatibility Sum Check
  private masterStereoPass: GainNode | null = null;
  private masterMonoSum: GainNode | null = null;
  private outputGain: GainNode | null = null;
  private safetyLimiter: DynamicsCompressorNode | null = null;

  // Lightweight Zero-Allocation Native Analysers
  private inAnalyser: AnalyserNode | null = null;
  private outAnalyser: AnalyserNode | null = null;
  private fftAnalyserNode: AnalyserNode | null = null;
  private stereoScopeSplitter: ChannelSplitterNode | null = null;
  private analyserL: AnalyserNode | null = null;
  private analyserR: AnalyserNode | null = null;
  private vuSplitter: ChannelSplitterNode | null = null;
  private vuAnalyserL: AnalyserNode | null = null;
  private vuAnalyserR: AnalyserNode | null = null;

  private readonly inWaveBuf = new Float32Array(128);
  private readonly outWaveBuf = new Float32Array(256);
  private readonly fftByteBuf = new Uint8Array(64);
  private readonly scopeBufL = new Float32Array(PHASE_SCOPE_SAMPLES);
  private readonly scopeBufR = new Float32Array(PHASE_SCOPE_SAMPLES);
  private readonly vuBufL = new Float32Array(256);
  private readonly vuBufR = new Float32Array(256);
  private readonly smoothedScopeBars = new Float32Array(SCOPE_BAR_COUNT);
  private readonly smoothedMasterBars = new Float32Array(MASTER_BAR_COUNT);

  private smoothedCorrelation = 1.0;
  private smoothedWidthPct = 0.0;
  private smoothedRms = 0.0;
  private readonly phaseSnapshot: PhaseScopeSnapshot = {
    l: this.scopeBufL,
    r: this.scopeBufR,
    correlation: 1.0,
    widthPct: 0,
    rms: 0,
    isActive: false,
  };

  private vuRmsLinL = 0;
  private vuRmsLinR = 0;
  private vuPeakLinL = 0;
  private vuPeakLinR = 0;
  private vuHoldDbL = -60;
  private vuHoldDbR = -60;
  private vuHoldUntilMsL = 0;
  private vuHoldUntilMsR = 0;
  private vuMaxPeakDb = -60;
  private vuClipLatchedL = false;
  private vuClipLatchedR = false;
  private vuLastSampleMs = 0;
  private readonly masterVuSnapshot: MasterVuSnapshot = {
    rmsDbL: -60,
    rmsDbR: -60,
    peakDbL: -60,
    peakDbR: -60,
    holdDbL: -60,
    holdDbR: -60,
    maxPeakDb: -60,
    clipNow: false,
    clipLatchedL: false,
    clipLatchedR: false,
    limiterGrDb: 0,
    isActive: false,
  };

  // Dynamic Voice & Subgraph Connection Flags (disconnected branches consume 0% Web Audio CPU)
  private isVoicesAwake = false;
  private isPrimaryWaveWired = false;
  private isPulseWaveWired = false;
  private isSyncWaveWired = false;
  private isSecondaryWaveWired = false;
  private isRingModWired = false;
  private isNoiseWired = false;
  private isFmUnisonWired = false;
  private isFmMetallicWired = false;
  private isKickVoiceWired = false;
  private isKickKrachWired = false;
  private isKickRumbleWired = false;
  private isKickFullBandDirectWired = false;

  private isCombWired = false;
  private isCrushWired = false;
  private isDisperserWired = false;
  private isFreqShiftWired = false;
  private isSpectralWired = false;
  private isToneWired = false;
  private isUnisonStereoWired = false;
  private isHaasWired = false;
  private isPhaseRotatorWired = false;
  private isOttWired = false;
  private isSpaceWired = false;
  private isVinylWired = false;
  private isVinylDustWired = false;

  private isGraphBuilt = false;
  private isDronePlaying = false;
  private activeMidiNote: number | null = null;
  private lastPlayedMidi = 36; // Default C2 (65.4 Hz)
  private currentFreqHz = 65.41;
  private pitchBendSemitones = 0;
  private silentElapsedMs = 0;
  private nextKickHitTime = 0;
  private lastKickHitAudioTime = 0;
  private kickRingUntilMs = 0;
  private kickLfoPhase = 0;
  private liveKickEnvPhase = 0;
  private baseKickFmGain = 48;

  // Dedicated Synth 4-Stage ADSR + 5-Target Synth LFO Runtime State
  private synthNoteOnAudioTime = 0;
  private synthNoteOffAudioTime = 0;
  private synthIsGateOpen = false;
  private synthRingUntilMs = 0;
  private synthLfoPhase = 0;
  private liveSynthEnvPhase = 0;
  private liveSynthEnvLevel = 0;

  // Sonic Shaper 7 & 6 Dynamic Envelopes
  private thumpEnv = 0;
  private brakeProgress = 0;

  private trackingInterval: ReturnType<typeof setInterval> | null = null;
  private lastFftReadMs = 0;
  private lastSpectralReadMs = 0;
  private currentSpeedEnv: EnvelopeData = {
    points: [
      { x: 0, y: 0.5 },
      { x: 1, y: 0.5 },
    ],
  };
  private currentPitchEnv: EnvelopeData = {
    points: [
      { x: 0, y: 0.5 },
      { x: 1, y: 0.5 },
    ],
  };
  private currentParams: SynthParams | null = null;
  private envPhase = 0;
  private liveGrowlLevel = 0;
  private liveSpeedMultiplier = 1;

  // Non-destructive 2-second patch audition state
  private previewSnapshot: {
    params: SynthParams | null;
    speedEnv: EnvelopeData;
    pitchEnv: EnvelopeData;
    buffer: Tone.ToneAudioBuffer | null;
    wasDronePlaying: boolean;
    activeMidiNote: number | null;
    lastPlayedMidi: number;
  } | null = null;
  private previewTimerId: ReturnType<typeof setTimeout> | null = null;
  private previewRunToken = 0;

  // Live DSP telemetry state
  private liveWahHz = 340;
  private liveF1Hz = 450;
  private liveF2Hz = 1150;
  private liveCombMs = 3.8;
  private liveFmIndex = 0;
  private liveCrushBits = 16;
  private liveDisperserHz = 280;
  private liveKickEqHz = 1180;
  private liveKickPump = 0.18;
  private liveSpectralBands: number[] = [0.18, 0.28, 0.22, 0.35, 0.26, 0.32, 0.2, 0.14];
  private liveOttBands: [number, number, number] = [0.22, 0.28, 0.24];

  constructor() {
    try {
      this.generateBuiltInSample('sub-pulse');
    } catch (e) {
      console.warn('Deferred initial buffer creation:', e);
    }
  }

  async unMute(): Promise<void> {
    if (Tone.getContext().state !== 'running') {
      await Tone.start();
    }
  }

  private setCrushTier(tier: number): void {
    if (!this.crushShaper) return;
    const clamped = clamp(Math.round(tier), 0, 10);
    if (clamped !== this.currentCrushTier) {
      this.crushShaper.curve = CRUSH_CURVE_BANK[clamped];
      this.currentCrushTier = clamped;
    }
  }

  private setToneCurve(mode: ToneMode, tier: number): void {
    if (!this.toneShaper) return;
    const safeMode: ToneMode = TONE_CURVE_BANK[mode] ? mode : 'TEAROUT';
    const clampedTier = clamp(Math.round(tier), 0, 10);
    if (safeMode !== this.currentToneMode || clampedTier !== this.currentToneTier) {
      this.toneShaper.curve = TONE_CURVE_BANK[safeMode][clampedTier];
      this.currentToneMode = safeMode;
      this.currentToneTier = clampedTier;
    }
  }

  private setKickClipCurve(mode: KickClipMode, tier: number): void {
    if (!this.kickShaper) return;
    const safeMode: KickClipMode = KICK_CLIP_CURVE_BANK[mode] ? mode : 'GCLIP';
    const clampedTier = clamp(Math.round(tier), 0, 10);
    if (safeMode !== this.currentKickClipMode || clampedTier !== this.currentKickClipTier) {
      this.kickShaper.curve = KICK_CLIP_CURVE_BANK[safeMode][clampedTier];
      this.currentKickClipMode = safeMode;
      this.currentKickClipTier = clampedTier;
    }
  }

  /**
   * Connects voice gates immediately prior to note-on/play so idle oscillators
   * consume 0% Web Audio CPU when silent and reconnect click-free at 0 amplitude.
   */
  private wakeVoicesIfNeeded(): void {
    if (!this.isGraphBuilt || this.isVoicesAwake) return;
    const inKickMode = Boolean(this.currentParams?.kickMode);
    if (inKickMode) {
      connectSafe(this.kickVoiceGate, this.inputGain);
      this.isKickVoiceWired = true;
    } else {
      connectSafe(this.synthLfoAmpGain, this.inputGain);
      connectSafe(this.synthSubEnvGain, this.compressor);
    }
    this.isVoicesAwake = true;
    this.silentElapsedMs = 0;
  }

  private stopAllKickVoices(): void {
    if (this.activeKickVoices.length === 0) return;
    const rawNow = Tone.getContext().rawContext.currentTime;
    for (const v of this.activeKickVoices) {
      try {
        v.chokeGain.gain.cancelScheduledValues(rawNow);
        v.chokeGain.gain.setValueAtTime(0, rawNow);
      } catch {
        // ignore
      }
      for (const s of v.sources) {
        try {
          s.stop(rawNow + 0.001);
        } catch {
          // ignore
        }
      }
      for (const n of v.nodes) {
        try {
          n.disconnect();
        } catch {
          // ignore
        }
      }
    }
    this.activeKickVoices = [];
  }

  private suspendVoicesWhenSilent(): void {
    if (!this.isGraphBuilt || !this.isVoicesAwake) return;
    if (this.oscVoiceGate) this.oscVoiceGate.gain.value = 0;
    if (this.fmVoiceGate) this.fmVoiceGate.gain.value = 0;
    if (this.subDirectGate) this.subDirectGate.gain.value = 0;
    if (this.grainGate) this.grainGate.gain.value = 0;
    if (this.synthAmpEnvGain) this.synthAmpEnvGain.gain.value = 0;
    if (this.synthSubEnvGain) this.synthSubEnvGain.gain.value = 0;
    if (this.synthLfoAmpGain) this.synthLfoAmpGain.gain.value = 1;
    if (this.kickVoiceGate) this.kickVoiceGate.gain.value = 0;
    this.stopAllKickVoices();
    if (this.rumbleDuckGain) this.rumbleDuckGain.gain.value = 0;

    disconnectSafe(this.synthLfoAmpGain, this.inputGain);
    disconnectSafe(this.synthSubEnvGain, this.compressor);
    disconnectSafe(this.kickVoiceGate, this.inputGain);
    this.isKickVoiceWired = false;
    this.isVoicesAwake = false;
  }

  /**
   * Dynamically connects/disconnects inactive oscillators and FX subgraphs so
   * turned-off modules consume 0% CPU on Chromium's Web Audio rendering thread.
   */
  private syncSubgraphRouting(p: SynthParams): void {
    if (!this.isGraphBuilt) return;
    const inKickMode = Boolean(p.kickMode);

    // Ensure active voice mode (Synth vs Kick) is cleanly routed when awake
    if (this.isVoicesAwake) {
      if (inKickMode && !this.isKickVoiceWired) {
        connectSafe(this.kickVoiceGate, this.inputGain);
        disconnectSafe(this.synthLfoAmpGain, this.inputGain);
        disconnectSafe(this.synthSubEnvGain, this.compressor);
        this.isKickVoiceWired = true;
      } else if (!inKickMode && this.isKickVoiceWired) {
        disconnectSafe(this.kickVoiceGate, this.inputGain);
        connectSafe(this.synthLfoAmpGain, this.inputGain);
        connectSafe(this.synthSubEnvGain, this.compressor);
        this.isKickVoiceWired = false;
      }
    }

    // Kick Stage 2 & 3 Dynamic Subgraph Gating (0% CPU when Kick mode is off!)
    const wantKickKrach =
      inKickMode &&
      Boolean(p.kickPower ?? true) &&
      Boolean(p.kickKrachPower ?? true) &&
      ((p.kickDrive ?? 0) > 0.5 || (p.kickEqGain ?? 0) > 0.5);
    if (wantKickKrach !== this.isKickKrachWired) {
      if (wantKickKrach) {
        connectSafe(this.kickPreHp, this.kickPreEq);
      } else {
        disconnectSafe(this.kickPreHp, this.kickPreEq);
        if (this.kickDryKrachGain) this.kickDryKrachGain.gain.value = 1;
        if (this.kickWetKrachGain) this.kickWetKrachGain.gain.value = 0;
      }
      this.isKickKrachWired = wantKickKrach;
    }

    const wantKickRumble =
      inKickMode &&
      Boolean(p.kickPower ?? true) &&
      Boolean(p.kickRumblePower) &&
      (p.kickRumbleAmt ?? 0) > 0.5;
    if (wantKickRumble !== this.isKickRumbleWired) {
      if (wantKickRumble) {
        connectSafe(this.kickDryPunchSum, this.rumbleIn);
      } else {
        disconnectSafe(this.kickDryPunchSum, this.rumbleIn);
        if (this.rumbleDuckGain) this.rumbleDuckGain.gain.value = 0;
        if (this.rumbleFbGain) this.rumbleFbGain.gain.value = 0;
      }
      this.isKickRumbleWired = wantKickRumble;
    }

    // Direct Full-Bandwidth Phase-Linear Kick Bypass when no mid-band Synth FX are active
    const anyMidShaperActiveInKick =
      Boolean(p.wahPower && p.wahAmount > 0.5) ||
      Boolean(p.combPower && (p.fmMetal ?? 0) > 0.5) ||
      Boolean(p.formantPower && (p.formantTalk ?? 0) > 0.5) ||
      Boolean(p.crushPower && (p.fmCrush ?? 0) > 0.5) ||
      Boolean(p.disperserPower && (p.disperserAmount ?? 0) > 0.5) ||
      Boolean(
        p.freqShiftPower &&
          (p.freqShiftMix ?? 0) > 0.5 &&
          Math.abs(p.freqShiftHz ?? 0) > 0.05
      ) ||
      Boolean(p.reesePower && (p.reeseDepth ?? 0) > 0.5) ||
      Boolean(p.spectralPower && (p.spectralMix ?? 0) > 0.5) ||
      Boolean(p.tonePower && p.toneDrive > 0.5) ||
      Boolean(p.haasPower && (p.haasWidth ?? 0) > 0.5) ||
      Math.abs(p.phaseAlignDeg ?? 0) > 0.5 ||
      Boolean(p.phaseInvertR) ||
      Boolean(p.subSolo);
    const wantKickFullBandDirect = !p.bypass && inKickMode && !anyMidShaperActiveInKick;
    if (wantKickFullBandDirect !== this.isKickFullBandDirectWired) {
      if (wantKickFullBandDirect) {
        connectSafe(this.lpFilter, this.kickFullBandDirect);
        disconnectSafe(this.lpFilter, this.xoverLow1);
        disconnectSafe(this.lpFilter, this.xoverHigh1);
      } else {
        connectSafe(this.lpFilter, this.xoverLow1);
        connectSafe(this.lpFilter, this.xoverHigh1);
        disconnectSafe(this.lpFilter, this.kickFullBandDirect);
      }
      this.isKickFullBandDirectWired = wantKickFullBandDirect;
    }

    // 0. Selective Oscillator Sub-Branch Gating (unused Tone oscillators aren't pulled!)
    const synthOscActive = !inKickMode && Boolean(p.oscPower);
    const hasOsc2Layer = p.oscDetune > 0 || p.oscInterval !== 0;
    const wantPrimaryWave =
      synthOscActive && (p.oscWave === 'SAW' || p.oscWave === 'SUPER' || p.oscWave === 'TRI');
    if (wantPrimaryWave !== this.isPrimaryWaveWired) {
      if (wantPrimaryWave) connectSafe(this.primaryWaveGain, this.oscVoiceGate);
      else disconnectSafe(this.primaryWaveGain, this.oscVoiceGate);
      this.isPrimaryWaveWired = wantPrimaryWave;
    }

    const wantPulseWave = synthOscActive && p.oscWave === 'PULSE';
    if (wantPulseWave !== this.isPulseWaveWired) {
      if (wantPulseWave) connectSafe(this.pulseWaveGain, this.oscVoiceGate);
      else disconnectSafe(this.pulseWaveGain, this.oscVoiceGate);
      this.isPulseWaveWired = wantPulseWave;
    }

    const wantSyncWave = synthOscActive && (p.oscWave === 'SYNC' || p.oscWave === 'METAL');
    if (wantSyncWave !== this.isSyncWaveWired) {
      if (wantSyncWave) connectSafe(this.syncWaveGain, this.oscVoiceGate);
      else disconnectSafe(this.syncWaveGain, this.oscVoiceGate);
      this.isSyncWaveWired = wantSyncWave;
    }

    const wantSecondaryWave = synthOscActive && (hasOsc2Layer || Boolean(p.oscRingMod));
    if (wantSecondaryWave !== this.isSecondaryWaveWired) {
      if (wantSecondaryWave) connectSafe(this.secondaryWaveGain, this.oscVoiceGate);
      else disconnectSafe(this.secondaryWaveGain, this.oscVoiceGate);
      this.isSecondaryWaveWired = wantSecondaryWave;
    }

    const wantRingMod = synthOscActive && Boolean(p.oscRingMod);
    if (wantRingMod !== this.isRingModWired) {
      if (wantRingMod) connectSafe(this.ringMixGain, this.oscVoiceGate);
      else disconnectSafe(this.ringMixGain, this.oscVoiceGate);
      this.isRingModWired = wantRingMod;
    }

    const wantNoise = synthOscActive && (p.oscNoise ?? 0) > 0.5;
    if (wantNoise !== this.isNoiseWired) {
      if (wantNoise) connectSafe(this.noiseGain, this.oscVoiceGate);
      else disconnectSafe(this.noiseGain, this.oscVoiceGate);
      this.isNoiseWired = wantNoise;
    }

    const wantFmUnison = !inKickMode && Boolean(p.fmPower) && Boolean(p.fmUnison);
    if (wantFmUnison !== this.isFmUnisonWired) {
      if (wantFmUnison) connectSafe(this.unisonGain, this.fmVoiceGate);
      else disconnectSafe(this.unisonGain, this.fmVoiceGate);
      this.isFmUnisonWired = wantFmUnison;
    }

    // Secondary Metallic Overtone Operator connects when FM Metal Bite > 1% OR Throat Comb + Metal > 1% is active!
    const wantFmMetallic =
      !inKickMode &&
      Boolean(p.fmPower) &&
      ((p.fmMetalAmt ?? 0) > 1 || (Boolean(p.combPower) && (p.fmMetal ?? 0) > 1));
    if (wantFmMetallic !== this.isFmMetallicWired) {
      if (wantFmMetallic) {
        connectSafe(this.fmMetallicGain, this.fmVoiceGate);
      } else {
        disconnectSafe(this.fmMetallicGain, this.fmVoiceGate);
        if (this.fmMetallicGain) this.fmMetallicGain.gain.value = 0;
      }
      this.isFmMetallicWired = wantFmMetallic;
    }

    // 1. Throat Comb Resonator (wired ONLY when Comb Power is on AND Metal > 0.5%)
    const wantComb = !p.bypass && Boolean(p.combPower) && (p.fmMetal ?? 0) > 0.5;
    if (wantComb !== this.isCombWired) {
      if (wantComb) {
        connectSafe(this.wahFilter, this.combDelay);
      } else {
        disconnectSafe(this.wahFilter, this.combDelay);
        if (this.combWet) this.combWet.gain.value = 0;
        if (this.combFeedback) this.combFeedback.gain.value = 0;
      }
      this.isCombWired = wantComb;
    }

    // 2. Staircase Bitcrusher (wired ONLY when Bitcrush Power is on AND Crush > 0.5%)
    const wantCrush = !p.bypass && Boolean(p.crushPower) && (p.fmCrush ?? 0) > 0.5;
    if (wantCrush !== this.isCrushWired) {
      if (wantCrush) {
        connectSafe(this.notchFilter, this.crushShaper);
      } else {
        disconnectSafe(this.notchFilter, this.crushShaper);
        if (this.crushDry) this.crushDry.gain.value = 1;
        if (this.crushWet) this.crushWet.gain.value = 0;
      }
      this.isCrushWired = wantCrush;
    }

    // 3. 8-Stage All-Pass Phase Disperser
    const wantDisperser =
      !p.bypass && Boolean(p.disperserPower) && (p.disperserAmount ?? 0) > 0.5;
    if (wantDisperser !== this.isDisperserWired && this.disperserStages.length > 0) {
      if (wantDisperser) {
        connectSafe(this.crushSum, this.disperserStages[0]);
      } else {
        disconnectSafe(this.crushSum, this.disperserStages[0]);
        if (this.disperserDry) this.disperserDry.gain.value = 1;
        if (this.disperserWet) this.disperserWet.gain.value = 0;
      }
      this.isDisperserWired = wantDisperser;
    }

    // 4. Quadrature Hilbert Bode SSB Frequency Shifter
    const wantFreqShift =
      !p.bypass &&
      Boolean(p.freqShiftPower) &&
      (p.freqShiftMix ?? 0) > 0.5 &&
      Math.abs(p.freqShiftHz ?? 0) > 0.05;
    if (wantFreqShift !== this.isFreqShiftWired) {
      if (wantFreqShift) {
        connectSafe(this.disperserSum, this.freqShiftIn);
      } else {
        disconnectSafe(this.disperserSum, this.freqShiftIn);
        if (this.freqShiftDry) this.freqShiftDry.gain.value = 1;
        if (this.bodeWetGain) this.bodeWetGain.gain.value = 0;
        if (this.bodeFbGain) this.bodeFbGain.gain.value = 0;
      }
      this.isFreqShiftWired = wantFreqShift;
    }

    // 5. Open-Loop 8-Band Dynamic Spectral Gate
    const wantSpectral =
      !p.bypass && Boolean(p.spectralPower) && (p.spectralMix ?? 0) > 0.5;
    if (wantSpectral !== this.isSpectralWired) {
      if (wantSpectral) {
        connectSafe(this.reesePeakHigh, this.spectralIn);
        connectSafe(this.reesePeakHigh, this.spectralAnalyser);
      } else {
        disconnectSafe(this.reesePeakHigh, this.spectralIn);
        disconnectSafe(this.reesePeakHigh, this.spectralAnalyser);
        this.spectralGateEnv.fill(0);
        if (this.spectralDry) this.spectralDry.gain.value = 1;
        if (this.spectralWet) this.spectralWet.gain.value = 0;
      }
      this.isSpectralWired = wantSpectral;
    }

    // 6. Native Mid-Band Harmonic Wavefolder & Saturation (TONE)
    const wantTone = !p.bypass && Boolean(p.tonePower) && p.toneDrive > 0.5;
    if (wantTone !== this.isToneWired) {
      if (wantTone) {
        connectSafe(this.bodyWarmthFilter, this.tonePreGain);
      } else {
        disconnectSafe(this.bodyWarmthFilter, this.tonePreGain);
        if (this.toneDry) this.toneDry.gain.value = 1;
        if (this.toneWet) this.toneWet.gain.value = 0;
      }
      this.isToneWired = wantTone;
    }

    // 7. Natural Unison Stereo Spread (> Xover, strictly Synth Mode only so Kick transients never chorus-smear!)
    const wantUnisonStereo =
      !inKickMode &&
      !p.bypass &&
      ((p.oscPower && p.oscDetune > 1) || (p.fmPower && p.fmUnison));
    if (wantUnisonStereo !== this.isUnisonStereoWired) {
      if (wantUnisonStereo) {
        connectSafe(this.midBandGate, this.unisonSpreadL);
        connectSafe(this.midBandGate, this.unisonSpreadR);
      } else {
        disconnectSafe(this.midBandGate, this.unisonSpreadL);
        disconnectSafe(this.midBandGate, this.unisonSpreadR);
        if (this.unisonWidthDry) this.unisonWidthDry.gain.value = 1;
        if (this.unisonWidthWet) this.unisonWidthWet.gain.value = 0;
      }
      this.isUnisonStereoWired = wantUnisonStereo;
    }

    // 8. Stereo Haas Dimension Expander (> Xover)
    const wantHaas = !p.bypass && Boolean(p.haasPower) && (p.haasWidth ?? 0) > 0.5;
    if (wantHaas !== this.isHaasWired) {
      if (wantHaas) {
        connectSafe(this.unisonWidthSum, this.haasIn);
      } else {
        disconnectSafe(this.unisonWidthSum, this.haasIn);
        if (this.haasDry) this.haasDry.gain.value = 1;
        if (this.haasStereoGate) this.haasStereoGate.gain.value = 0;
      }
      this.isHaasWired = wantHaas;
    }

    // 9. Differential Stereo Phase Rotator (bypassed cleanly at 0° align & normal polarity)
    const wantPhaseRotator =
      !p.bypass && (Math.abs(p.phaseAlignDeg ?? 0) > 0.5 || Boolean(p.phaseInvertR));
    if (wantPhaseRotator !== this.isPhaseRotatorWired) {
      if (wantPhaseRotator) {
        connectSafe(this.haasStageSum, this.phaseSplitter);
        connectSafe(this.phaseMerger, this.multibandSum);
        if (this.phaseBypassGain) this.phaseBypassGain.gain.value = 0;
      } else {
        disconnectSafe(this.haasStageSum, this.phaseSplitter);
        disconnectSafe(this.phaseMerger, this.multibandSum);
        if (this.phaseBypassGain) this.phaseBypassGain.gain.value = 1;
      }
      this.isPhaseRotatorWired = wantPhaseRotator;
    }

    // 10. 3-Band Upward/Downward Multiband OTT
    const wantOtt = !p.bypass && Boolean(p.ottPower) && (p.ottAmount ?? 0) > 0.5;
    if (wantOtt !== this.isOttWired) {
      if (wantOtt) {
        connectSafe(this.multibandSum, this.ottIn);
      } else {
        disconnectSafe(this.multibandSum, this.ottIn);
        if (this.ottDry) this.ottDry.gain.value = 1;
        if (this.ottWet) this.ottWet.gain.value = 0;
      }
      this.isOttWired = wantOtt;
    }

    // 11. Band-Limited Stereo Air-Stabiliser (STABILISE)
    const wantSpace = !p.bypass && Boolean(p.spacePower) && p.spaceAmount > 0.5;
    if (wantSpace !== this.isSpaceWired) {
      if (wantSpace) {
        connectSafe(this.eqHigh, this.spaceIn);
      } else {
        disconnectSafe(this.eqHigh, this.spaceIn);
        if (this.spaceWet) this.spaceWet.gain.value = 0;
        if (this.spaceFbL) this.spaceFbL.gain.value = 0;
        if (this.spaceFbR) this.spaceFbR.gain.value = 0;
      }
      this.isSpaceWired = wantSpace;
    }

    // 12. Turntable Vinyl Scratch & Tape-Stop Brake
    const wantVinyl =
      (!p.bypass &&
        ((Boolean(p.scratchPower) && (p.scratchAmount ?? 0) > 0.5) || Boolean(p.vinylBrake))) ||
      this.brakeProgress > 0.001;
    if (wantVinyl !== this.isVinylWired) {
      if (wantVinyl) {
        connectSafe(this.compressorMakeup, this.vinylSplitter);
        connectSafe(this.vinylDuckGain, this.vinylOutSum);
        if (this.vinylBypassGain) this.vinylBypassGain.gain.value = 0;
      } else {
        disconnectSafe(this.compressorMakeup, this.vinylSplitter);
        disconnectSafe(this.vinylDuckGain, this.vinylOutSum);
        if (this.vinylBypassGain) this.vinylBypassGain.gain.value = 1;
      }
      this.isVinylWired = wantVinyl;
    }

    const wantVinylDust = !p.bypass && Boolean(p.scratchPower) && (p.scratchAmount ?? 0) > 1;
    if (wantVinylDust !== this.isVinylDustWired) {
      if (wantVinylDust) {
        connectSafe(this.vinylDustGain, this.vinylOutSum);
      } else {
        disconnectSafe(this.vinylDustGain, this.vinylOutSum);
        if (this.vinylDustGain) this.vinylDustGain.gain.value = 0;
      }
      this.isVinylDustWired = wantVinylDust;
    }

    // 13. Modular Master FX Patchbay Chain (Serial Hook-In Units)
    this.syncModularFxChain(p);
  }

  private createFxUnitRuntime(rawCtx: BaseAudioContext, slot: FxSlotItem): FxUnitRuntime {
    const input = rawCtx.createGain();
    const output = rawCtx.createGain();
    const dryGain = rawCtx.createGain();
    const wetGain = rawCtx.createGain();
    input.connect(dryGain);
    dryGain.connect(output);
    wetGain.connect(output);

    if (slot.type === 'saturator') {
      const headBumpEq = rawCtx.createBiquadFilter();
      headBumpEq.type = 'peaking';
      headBumpEq.frequency.value = 62;
      headBumpEq.Q.value = 1.05;
      headBumpEq.gain.value = 1.8;

      const preGain = rawCtx.createGain();
      const shaper = rawCtx.createWaveShaper();
      shaper.oversample = '4x';

      const dcBlock = rawCtx.createBiquadFilter();
      dcBlock.type = 'highpass';
      dcBlock.frequency.value = 22;
      dcBlock.Q.value = Math.SQRT1_2;

      const mudTrimEq = rawCtx.createBiquadFilter();
      mudTrimEq.type = 'peaking';
      mudTrimEq.frequency.value = 285;
      mudTrimEq.Q.value = 1.25;
      mudTrimEq.gain.value = -0.8;

      const lowTilt = rawCtx.createBiquadFilter();
      lowTilt.type = 'lowshelf';
      lowTilt.frequency.value = 190;
      const highTilt = rawCtx.createBiquadFilter();
      highTilt.type = 'highshelf';
      highTilt.frequency.value = 2800;
      const makeup = rawCtx.createGain();

      input.connect(headBumpEq);
      headBumpEq.connect(preGain);
      preGain.connect(shaper);
      shaper.connect(dcBlock);
      dcBlock.connect(mudTrimEq);
      mudTrimEq.connect(lowTilt);
      lowTilt.connect(highTilt);
      highTilt.connect(makeup);
      makeup.connect(wetGain);

      let curMode: FxSaturatorMode | '' = '';
      let curTier = -1;

      return {
        id: slot.id,
        type: 'saturator',
        input,
        output,
        update: (s) => {
          const driveNorm = clamp((s.satDrive ?? 36) / 100, 0, 1);
          const punchNorm = clamp((s.satPunch ?? 45) / 100, 0, 1);
          const driveCurve = driveNorm * (0.45 + 0.55 * driveNorm);
          const mode: FxSaturatorMode = s.satMode ?? 'TAPE';
          const tier = driveNorm <= 0.01 ? 0 : Math.max(1, Math.round(driveNorm * 10));
          if (mode !== curMode || tier !== curTier) {
            shaper.curve = FX_SAT_CURVE_BANK[mode][tier];
            curMode = mode;
            curTier = tier;
          }
          const toneNorm = clamp((s.satTone ?? 8) / 50, -1, 1);
          // Analog tape/iron 62 Hz head-bump + subtle 285 Hz mud clarity
          setParamDirect(headBumpEq.gain, punchNorm * 4.2);
          setParamDirect(mudTrimEq.gain, -punchNorm * 1.8);
          // Smooth 0 dB -> +8.1 dB analog drive (never harsh overdrive!) + RMS auto-gain compensation
          setParamDirect(preGain.gain, 1.0 + driveCurve * 1.55);
          setParamDirect(lowTilt.gain, -toneNorm * 3.8 + driveCurve * 0.9);
          setParamDirect(highTilt.gain, toneNorm * 4.4 - driveCurve * 0.6);
          setParamDirect(makeup.gain, 1.0 / (1.0 + driveCurve * 0.52 + punchNorm * 0.12));

          const mix = s.enabled ? clamp((s.mix ?? 80) / 100, 0, 1) : 0;
          setParamDirect(dryGain.gain, 1 - mix);
          setParamDirect(wetGain.gain, mix);
        },
        destroy: () => {
          try {
            input.disconnect();
            headBumpEq.disconnect();
            preGain.disconnect();
            shaper.disconnect();
            dcBlock.disconnect();
            mudTrimEq.disconnect();
            lowTilt.disconnect();
            highTilt.disconnect();
            makeup.disconnect();
            dryGain.disconnect();
            wetGain.disconnect();
            output.disconnect();
          } catch {
            // ignore
          }
        },
      };
    }

    if (slot.type === 'peq') {
      const eqLow = rawCtx.createBiquadFilter();
      eqLow.type = 'lowshelf';
      eqLow.frequency.value = 95;
      const eqMid = rawCtx.createBiquadFilter();
      eqMid.type = 'peaking';
      eqMid.frequency.value = 1150;
      eqMid.Q.value = 1.8;
      const eqHigh = rawCtx.createBiquadFilter();
      eqHigh.type = 'highshelf';
      eqHigh.frequency.value = 6500;

      input.connect(eqLow);
      eqLow.connect(eqMid);
      eqMid.connect(eqHigh);
      eqHigh.connect(wetGain);

      return {
        id: slot.id,
        type: 'peq',
        input,
        output,
        update: (s) => {
          setParamDirect(eqLow.frequency, clamp(s.eqLowHz ?? 95, 30, 450), 0.5);
          setParamDirect(eqLow.gain, clamp(s.eqLowGainDb ?? 2.5, -15, 15));
          setParamDirect(eqMid.frequency, clamp(s.eqMidHz ?? 1180, 180, 6500), 0.5);
          setParamDirect(eqMid.gain, clamp(s.eqMidGainDb ?? 3.5, -15, 15));
          setParamDirect(eqMid.Q, clamp(s.eqMidQ ?? 1.8, 0.4, 10));
          setParamDirect(eqHigh.frequency, clamp(s.eqHighHz ?? 6500, 1500, 16000), 1);
          setParamDirect(eqHigh.gain, clamp(s.eqHighGainDb ?? 2.0, -15, 15));

          const mix = s.enabled ? clamp((s.mix ?? 100) / 100, 0, 1) : 0;
          setParamDirect(dryGain.gain, 1 - mix);
          setParamDirect(wetGain.gain, mix);
        },
        destroy: () => {
          try {
            input.disconnect();
            eqLow.disconnect();
            eqMid.disconnect();
            eqHigh.disconnect();
            dryGain.disconnect();
            wetGain.disconnect();
            output.disconnect();
          } catch {
            // ignore
          }
        },
      };
    }

    if (slot.type === 'distort') {
      // Authentic Rotterdam 909 -> Gabber Console Distortion Architecture:
      // 1. Full-bandwidth sub-pass by default (28 Hz) so the 909 fundamental intermodulates with the mid peak!
      const preHp = rawCtx.createBiquadFilter();
      preHp.type = 'highpass';
      preHp.frequency.value = 28;
      preHp.Q.value = Math.SQRT1_2;

      // 2. Pre-Clip Resonant Kick Bark Bell (sweeps 909 pitch-drop through op-amp rail clipper)
      const prePunchBell = rawCtx.createBiquadFilter();
      prePunchBell.type = 'peaking';
      prePunchBell.frequency.value = 215;
      prePunchBell.Q.value = 1.48;
      prePunchBell.gain.value = 5.5;

      const preGain = rawCtx.createGain();
      const shaper = rawCtx.createWaveShaper();
      shaper.oversample = '4x';

      const dcBlock = rawCtx.createBiquadFilter();
      dcBlock.type = 'highpass';
      dcBlock.frequency.value = 26;
      dcBlock.Q.value = Math.SQRT1_2;

      // 3. Post-Clip 335 Hz Box-Mud Scoop + 78 Hz Sub Chest Weight Restoration
      const postBoxDip = rawCtx.createBiquadFilter();
      postBoxDip.type = 'peaking';
      postBoxDip.frequency.value = 335;
      postBoxDip.Q.value = 1.35;
      postBoxDip.gain.value = -2.4;

      const postSubShelf = rawCtx.createBiquadFilter();
      postSubShelf.type = 'lowshelf';
      postSubShelf.frequency.value = 78;
      postSubShelf.gain.value = 1.4;

      const postLp = rawCtx.createBiquadFilter();
      postLp.type = 'lowpass';
      postLp.frequency.value = 7600;
      postLp.Q.value = 0.82;
      const makeup = rawCtx.createGain();

      input.connect(preHp);
      preHp.connect(prePunchBell);
      prePunchBell.connect(preGain);
      preGain.connect(shaper);
      shaper.connect(dcBlock);
      dcBlock.connect(postBoxDip);
      postBoxDip.connect(postSubShelf);
      postSubShelf.connect(postLp);
      postLp.connect(makeup);
      makeup.connect(wetGain);

      let curMode: FxDistortMode | '' = '';
      let curTier = -1;

      return {
        id: slot.id,
        type: 'distort',
        input,
        output,
        update: (s) => {
          const driveNorm = clamp((s.distDrive ?? 46) / 100, 0, 1);
          const punchNorm = clamp((s.distPunch ?? 62) / 100, 0, 1);
          const tightCut = s.distTightCut ?? false;
          const mode: FxDistortMode = s.distMode ?? 'GABBER';
          const tier = driveNorm <= 0.01 ? 0 : Math.max(1, Math.round(driveNorm * 10));
          if (mode !== curMode || tier !== curTier) {
            shaper.curve = FX_DIST_CURVE_BANK[mode][tier];
            curMode = mode;
            curTier = tier;
          }

          // Full 28 Hz sub-pass by default (so dry 909 kicks keep full sub intermodulation); 92 Hz when CUT enabled
          setParamDirect(preHp.frequency, tightCut ? 92 : 28, 0.5);

          // Tuned Mackie CR-1604 pre-clip resonant punch bell + post-clip hollow box scoop
          const bellHz = mode === 'GABBER' ? 215 : 255;
          setParamDirect(prePunchBell.frequency, bellHz, 1);
          setParamDirect(prePunchBell.Q, mode === 'GABBER' ? 1.52 : 1.25);
          setParamDirect(
            prePunchBell.gain,
            punchNorm * (mode === 'GABBER' ? 9.6 : 6.2) * (0.25 + driveNorm * 0.75)
          );

          // Musical console gain taper: 1.0x (0 dB clean) -> 2.8x (50% Gabber sweet spot) -> 7.6x (100% hardcore slam)
          const consoleGain = 1.0 + driveNorm * 1.05 + driveNorm * driveNorm * 5.55;
          setParamDirect(preGain.gain, consoleGain);

          setParamDirect(postBoxDip.gain, -punchNorm * (mode === 'GABBER' ? 4.2 : 2.6) * driveNorm);
          setParamDirect(postSubShelf.gain, tightCut ? 0 : punchNorm * 2.4 * driveNorm);
          setParamDirect(postLp.frequency, clamp(s.distToneHz ?? 7600, 700, 16000), 2);
          setParamDirect(
            makeup.gain,
            0.94 / (1.0 + driveNorm * 0.58 + punchNorm * driveNorm * 0.18)
          );

          const mix = s.enabled ? clamp((s.mix ?? 100) / 100, 0, 1) : 0;
          setParamDirect(dryGain.gain, 1 - mix);
          setParamDirect(wetGain.gain, mix);
        },
        destroy: () => {
          try {
            input.disconnect();
            preHp.disconnect();
            prePunchBell.disconnect();
            preGain.disconnect();
            shaper.disconnect();
            dcBlock.disconnect();
            postBoxDip.disconnect();
            postSubShelf.disconnect();
            postLp.disconnect();
            makeup.disconnect();
            dryGain.disconnect();
            wetGain.disconnect();
            output.disconnect();
          } catch {
            // ignore
          }
        },
      };
    }

    if (slot.type === 'delay') {
      const preHp = rawCtx.createBiquadFilter();
      preHp.type = 'highpass';
      preHp.frequency.value = 140;
      preHp.Q.value = Math.SQRT1_2;

      const inGainL = rawCtx.createGain();
      const inGainR = rawCtx.createGain();
      const delayL = rawCtx.createDelay(1.6);
      const delayR = rawCtx.createDelay(1.6);
      const lpL = rawCtx.createBiquadFilter();
      lpL.type = 'lowpass';
      lpL.frequency.value = 4200;
      const lpR = rawCtx.createBiquadFilter();
      lpR.type = 'lowpass';
      lpR.frequency.value = 4200;

      const selfFbL = rawCtx.createGain();
      const selfFbR = rawCtx.createGain();
      const crossFbLR = rawCtx.createGain();
      const crossFbRL = rawCtx.createGain();
      selfFbL.gain.value = 0;
      selfFbR.gain.value = 0;
      crossFbLR.gain.value = 0;
      crossFbRL.gain.value = 0;

      const merger = rawCtx.createChannelMerger(2);

      input.connect(preHp);
      preHp.connect(inGainL);
      preHp.connect(inGainR);
      inGainL.connect(delayL);
      inGainR.connect(delayR);

      delayL.connect(lpL);
      delayR.connect(lpR);

      lpL.connect(selfFbL);
      selfFbL.connect(delayL);
      lpR.connect(selfFbR);
      selfFbR.connect(delayR);

      lpL.connect(crossFbLR);
      crossFbLR.connect(delayR);
      lpR.connect(crossFbRL);
      crossFbRL.connect(delayL);

      lpL.connect(merger, 0, 0);
      lpR.connect(merger, 0, 1);
      merger.connect(wetGain);

      return {
        id: slot.id,
        type: 'delay',
        input,
        output,
        update: (s) => {
          const mode: FxDelayMode = s.delayMode ?? 'PING';
          const baseSec = clamp((s.delayTimeMs ?? 280) / 1000, 0.02, 1.2);
          const fb = clamp((s.delayFeedback ?? 46) / 100, 0, 0.84);
          const toneNorm = clamp((s.delayTone ?? 62) / 100, 0, 1);
          const lpHz = 900 * Math.pow(13500 / 900, toneNorm);

          setParamDirect(lpL.frequency, lpHz, 2);
          setParamDirect(lpR.frequency, lpHz, 2);

          if (mode === 'PING') {
            setParamDirect(inGainL.gain, 1.0);
            setParamDirect(inGainR.gain, 0.0);
            setParamDirect(delayL.delayTime, baseSec, 0.0005);
            setParamDirect(delayR.delayTime, baseSec, 0.0005);
            setParamDirect(selfFbL.gain, 0);
            setParamDirect(selfFbR.gain, 0);
            setParamDirect(crossFbLR.gain, fb);
            setParamDirect(crossFbRL.gain, fb);
          } else if (mode === 'SLAP') {
            const slapSec = clamp(baseSec * 0.36, 0.018, 0.145);
            setParamDirect(inGainL.gain, 0.95);
            setParamDirect(inGainR.gain, 0.95);
            setParamDirect(delayL.delayTime, slapSec, 0.0005);
            setParamDirect(delayR.delayTime, clamp(slapSec * 1.26, 0.022, 0.18), 0.0005);
            setParamDirect(selfFbL.gain, fb * 0.56);
            setParamDirect(selfFbR.gain, fb * 0.56);
            setParamDirect(crossFbLR.gain, 0);
            setParamDirect(crossFbRL.gain, 0);
          } else {
            setParamDirect(inGainL.gain, 0.95);
            setParamDirect(inGainR.gain, 0.95);
            setParamDirect(delayL.delayTime, clamp(baseSec * 0.985, 0.02, 1.25), 0.0005);
            setParamDirect(delayR.delayTime, clamp(baseSec * 1.03, 0.02, 1.28), 0.0005);
            setParamDirect(selfFbL.gain, fb);
            setParamDirect(selfFbR.gain, fb);
            setParamDirect(crossFbLR.gain, 0);
            setParamDirect(crossFbRL.gain, 0);
          }

          const mix = s.enabled ? clamp((s.mix ?? 34) / 100, 0, 1) : 0;
          setParamDirect(dryGain.gain, 1 - mix * 0.38);
          setParamDirect(wetGain.gain, mix * 1.05);
        },
        destroy: () => {
          try {
            selfFbL.gain.value = 0;
            selfFbR.gain.value = 0;
            crossFbLR.gain.value = 0;
            crossFbRL.gain.value = 0;
            selfFbL.disconnect();
            selfFbR.disconnect();
            crossFbLR.disconnect();
            crossFbRL.disconnect();
            delayL.disconnect();
            delayR.disconnect();
            lpL.disconnect();
            lpR.disconnect();
            inGainL.disconnect();
            inGainR.disconnect();
            preHp.disconnect();
            merger.disconnect();
            input.disconnect();
            dryGain.disconnect();
            wetGain.disconnect();
            output.disconnect();
          } catch {
            // ignore
          }
        },
      };
    }

    // Default: 'reverb' — 100% Native Web Audio Schroeder-Moorer 4-Comb + 2-Allpass Stereo Tank
    const revHp = rawCtx.createBiquadFilter();
    revHp.type = 'highpass';
    revHp.frequency.value = 155;
    revHp.Q.value = Math.SQRT1_2;

    const preDelay = rawCtx.createDelay(0.2);
    preDelay.delayTime.value = 0.018;

    const ap1 = rawCtx.createBiquadFilter();
    ap1.type = 'allpass';
    ap1.frequency.value = 240;
    ap1.Q.value = 0.85;

    const ap2 = rawCtx.createBiquadFilter();
    ap2.type = 'allpass';
    ap2.frequency.value = 610;
    ap2.Q.value = 0.85;

    const baseCombTimes = [0.0297, 0.0371, 0.0411, 0.0437];
    const combDelays: DelayNode[] = [];
    const combLps: BiquadFilterNode[] = [];
    const combFbs: GainNode[] = [];

    const sumL = rawCtx.createGain();
    const sumR = rawCtx.createGain();
    sumL.gain.value = 0.42;
    sumR.gain.value = 0.42;
    const revMerger = rawCtx.createChannelMerger(2);

    input.connect(revHp);
    revHp.connect(preDelay);
    preDelay.connect(ap1);
    ap1.connect(ap2);

    for (let i = 0; i < 4; i++) {
      const cd = rawCtx.createDelay(0.18);
      cd.delayTime.value = baseCombTimes[i];
      const clp = rawCtx.createBiquadFilter();
      clp.type = 'lowpass';
      clp.frequency.value = 4800;
      const cfb = rawCtx.createGain();
      cfb.gain.value = 0;

      ap2.connect(cd);
      cd.connect(clp);
      clp.connect(cfb);
      cfb.connect(cd);

      const panPrimary = rawCtx.createGain();
      panPrimary.gain.value = 0.85;
      const panCross = rawCtx.createGain();
      panCross.gain.value = 0.32;

      clp.connect(panPrimary);
      clp.connect(panCross);
      if (i % 2 === 0) {
        panPrimary.connect(sumL);
        panCross.connect(sumR);
      } else {
        panPrimary.connect(sumR);
        panCross.connect(sumL);
      }

      combDelays.push(cd);
      combLps.push(clp);
      combFbs.push(cfb);
    }

    sumL.connect(revMerger, 0, 0);
    sumR.connect(revMerger, 0, 1);
    revMerger.connect(wetGain);

    return {
      id: slot.id,
      type: 'reverb',
      input,
      output,
      update: (s) => {
        const mode: FxReverbMode = s.revMode ?? 'HALL';
        const sizeNorm = clamp((s.revSize ?? 58) / 100, 0, 1);
        const dampNorm = clamp((s.revDamp ?? 56) / 100, 0, 1);
        const preSec = clamp((s.revPreDelayMs ?? 18) / 1000, 0, 0.14);

        const modeScale = mode === 'PLATE' ? 0.76 : mode === 'BUNKER' ? 1.38 : 1.06;
        const sizeScale = (0.72 + sizeNorm * 0.65) * modeScale;
        const fbBase =
          mode === 'BUNKER'
            ? 0.56 + sizeNorm * 0.27
            : mode === 'PLATE'
            ? 0.48 + sizeNorm * 0.32
            : 0.52 + sizeNorm * 0.3;
        const safeFb = clamp(fbBase, 0.25, 0.84);

        const maxDampHz = mode === 'BUNKER' ? 4200 : mode === 'PLATE' ? 11500 : 8600;
        const dampHz = maxDampHz * Math.pow(950 / maxDampHz, dampNorm);

        setParamDirect(revHp.frequency, mode === 'BUNKER' ? 115 : 165, 1);
        setParamDirect(preDelay.delayTime, preSec, 0.0005);

        for (let i = 0; i < 4; i++) {
          setParamDirect(
            combDelays[i].delayTime,
            clamp(baseCombTimes[i] * sizeScale, 0.012, 0.15),
            0.0005
          );
          setParamDirect(combLps[i].frequency, dampHz, 2);
          setParamDirect(combFbs[i].gain, safeFb - i * 0.012);
        }

        const mix = s.enabled ? clamp((s.mix ?? 32) / 100, 0, 1) : 0;
        setParamDirect(dryGain.gain, 1 - mix * 0.42);
        setParamDirect(wetGain.gain, mix * 1.12);
      },
      destroy: () => {
        try {
          for (let i = 0; i < 4; i++) {
            combFbs[i].gain.value = 0;
            combFbs[i].disconnect();
            combLps[i].disconnect();
            combDelays[i].disconnect();
          }
          revHp.disconnect();
          preDelay.disconnect();
          ap1.disconnect();
          ap2.disconnect();
          sumL.disconnect();
          sumR.disconnect();
          revMerger.disconnect();
          input.disconnect();
          dryGain.disconnect();
          wetGain.disconnect();
          output.disconnect();
        } catch {
          // ignore
        }
      },
    };
  }

  private syncModularFxChain(p: SynthParams): void {
    if (!this.isGraphBuilt || !this.fxChainIn || !this.fxChainOut) return;

    const rawCtx = Tone.getContext().rawContext;
    const slots = p.fxChain ?? [];
    const presentIds = new Set(slots.map((s) => s.id));

    // 1. Destroy & GC any unhooked FX units immediately
    let removedAny = false;
    for (const [id, unit] of this.fxRuntimeMap.entries()) {
      if (!presentIds.has(id)) {
        unit.destroy();
        this.fxRuntimeMap.delete(id);
        removedAny = true;
      }
    }

    // 2. Ensure runtime nodes exist & update live parameters for all hooked units
    for (const slot of slots) {
      let unit = this.fxRuntimeMap.get(slot.id);
      if (!unit || unit.type !== slot.type) {
        if (unit) unit.destroy();
        unit = this.createFxUnitRuntime(rawCtx, slot);
        this.fxRuntimeMap.set(slot.id, unit);
        removedAny = true;
      }
      unit.update(slot);
    }

    // 3. Patch serial hardware topology (0% CPU direct-thru when empty or bypassed!)
    const activeSlots = p.bypass ? [] : slots.filter((s) => s.enabled);
    const nextSig = activeSlots.length === 0 ? 'DIRECT' : activeSlots.map((s) => s.id).join('>');

    if (nextSig !== this.currentFxOrderSignature || removedAny) {
      try {
        this.fxChainIn.disconnect();
      } catch {
        // ignore
      }
      for (const prevUnit of this.activePatchedUnits) {
        try {
          prevUnit.output.disconnect();
        } catch {
          // ignore
        }
      }

      if (activeSlots.length === 0) {
        this.fxChainIn.connect(this.fxChainOut);
        this.activePatchedUnits = [];
      } else {
        const nextUnits: FxUnitRuntime[] = [];
        for (const s of activeSlots) {
          const u = this.fxRuntimeMap.get(s.id);
          if (u) nextUnits.push(u);
        }
        if (nextUnits.length === 0) {
          this.fxChainIn.connect(this.fxChainOut);
          this.activePatchedUnits = [];
        } else {
          this.fxChainIn.connect(nextUnits[0].input);
          for (let i = 0; i < nextUnits.length - 1; i++) {
            nextUnits[i].output.connect(nextUnits[i + 1].input);
          }
          nextUnits[nextUnits.length - 1].output.connect(this.fxChainOut);
          this.activePatchedUnits = nextUnits;
        }
      }
      this.currentFxOrderSignature = nextSig;
    }
  }

  private ensureGraph(): void {
    if (this.isGraphBuilt) return;

    const rawCtx = Tone.getContext().rawContext;
    const startAt = rawCtx.currentTime;

    this.inputGain = rawCtx.createGain();
    this.inputGain.gain.value = 1.0;

    this.inAnalyser = rawCtx.createAnalyser();
    this.inAnalyser.fftSize = 256;

    this.dryBranch = rawCtx.createGain();
    this.dryBranch.gain.value = 0.15;

    this.wetBranch = rawCtx.createGain();
    this.wetBranch.gain.value = 0.95;

    this.hpFilter = rawCtx.createBiquadFilter();
    this.hpFilter.type = 'highpass';
    this.hpFilter.frequency.value = 28;
    this.hpFilter.Q.value = Math.SQRT1_2;

    this.lpFilter = rawCtx.createBiquadFilter();
    this.lpFilter.type = 'lowpass';
    this.lpFilter.frequency.value = 14000;
    this.lpFilter.Q.value = Math.SQRT1_2;

    this.kickFullBandDirect = rawCtx.createGain();
    this.kickFullBandDirect.gain.value = 1.0;

    // =========================================================================
    // 115 Hz 4th-Order Linkwitz-Riley (LR4) Multiband Crossover
    // =========================================================================
    const XOVER_HZ = 115;
    const BUTTERWORTH_Q = Math.SQRT1_2;

    this.xoverLow1 = rawCtx.createBiquadFilter();
    this.xoverLow1.type = 'lowpass';
    this.xoverLow1.frequency.value = XOVER_HZ;
    this.xoverLow1.Q.value = BUTTERWORTH_Q;

    this.xoverLow2 = rawCtx.createBiquadFilter();
    this.xoverLow2.type = 'lowpass';
    this.xoverLow2.frequency.value = XOVER_HZ;
    this.xoverLow2.Q.value = BUTTERWORTH_Q;

    // Subtle Warm Analog Tape Shaper on < Xover Mono Sub Band (bridges sub harmonics into low-mids!)
    this.lowBandShaper = rawCtx.createWaveShaper();
    this.lowBandShaper.oversample = '2x';
    this.lowBandShaper.curve = LOW_BAND_WARM_CURVE;

    // Force < Xover Low Band strictly Mono so Sub is 100% phase-locked (+1.00)
    this.lowBandGain = rawCtx.createGain();
    this.lowBandGain.channelCount = 1;
    this.lowBandGain.channelCountMode = 'explicit';
    this.lowBandGain.gain.value = 1.0;

    this.xoverHigh1 = rawCtx.createBiquadFilter();
    this.xoverHigh1.type = 'highpass';
    this.xoverHigh1.frequency.value = XOVER_HZ;
    this.xoverHigh1.Q.value = BUTTERWORTH_Q;

    this.xoverHigh2 = rawCtx.createBiquadFilter();
    this.xoverHigh2.type = 'highpass';
    this.xoverHigh2.frequency.value = XOVER_HZ;
    this.xoverHigh2.Q.value = BUTTERWORTH_Q;

    // Stage A: Broad Analog Wah Pedal Filter (150 Hz -> 2150 Hz)
    this.wahFilter = rawCtx.createBiquadFilter();
    this.wahFilter.type = 'peaking';
    this.wahFilter.frequency.value = 380;
    this.wahFilter.Q.value = 2.2;
    this.wahFilter.gain.value = 0;

    // Stage B: Key-Tracked Throat Comb Resonator (1.2ms - 8.0ms)
    this.combDelay = rawCtx.createDelay(0.05);
    this.combDelay.delayTime.value = 0.0038;

    this.combDamping = rawCtx.createBiquadFilter();
    this.combDamping.type = 'lowpass';
    this.combDamping.frequency.value = 3400;
    this.combDamping.Q.value = 0.7;

    this.combFeedback = rawCtx.createGain();
    this.combFeedback.gain.value = 0;

    this.combWet = rawCtx.createGain();
    this.combWet.gain.value = 0;

    this.combSum = rawCtx.createGain();
    this.combSum.gain.value = 1.0;

    // Stage C: Warm Vocal Tract Formants (F1 / F2) + Counter-Swept Neuro Notch
    this.formant1 = rawCtx.createBiquadFilter();
    this.formant1.type = 'peaking';
    this.formant1.frequency.value = 410;
    this.formant1.Q.value = 2.15;
    this.formant1.gain.value = 0;

    this.formant2 = rawCtx.createBiquadFilter();
    this.formant2.type = 'peaking';
    this.formant2.frequency.value = 980;
    this.formant2.Q.value = 2.55;
    this.formant2.gain.value = 0;

    this.notchFilter = rawCtx.createBiquadFilter();
    this.notchFilter.type = 'peaking';
    this.notchFilter.frequency.value = 720;
    this.notchFilter.Q.value = 2.6;
    this.notchFilter.gain.value = 0;

    // Stage D: 2x-Oversampled Staircase Bitcrusher / Quantizer Shaper (> 115 Hz Mid/High Only)
    this.crushShaper = rawCtx.createWaveShaper();
    this.crushShaper.oversample = '2x';
    this.setCrushTier(0);

    this.crushDry = rawCtx.createGain();
    this.crushDry.gain.value = 1.0;

    this.crushWet = rawCtx.createGain();
    this.crushWet.gain.value = 0.0;

    this.crushSum = rawCtx.createGain();
    this.crushSum.gain.value = 1.0;

    // =========================================================================
    // Sonic Shaper 1: 8-Stage High-Q All-Pass Phase Disperser (> Xover)
    // =========================================================================
    this.disperserDry = rawCtx.createGain();
    this.disperserDry.gain.value = 1.0;
    this.disperserWet = rawCtx.createGain();
    this.disperserWet.gain.value = 0.0;
    this.disperserSum = rawCtx.createGain();
    this.disperserSum.gain.value = 1.0;
    this.disperserStages = Array.from({ length: DISPERSER_STAGE_COUNT }, () => {
      const ap = rawCtx.createBiquadFilter();
      ap.type = 'allpass';
      ap.frequency.value = 280;
      ap.Q.value = 2.2;
      return ap;
    });
    for (let i = 0; i < this.disperserStages.length - 1; i++) {
      this.disperserStages[i].connect(this.disperserStages[i + 1]);
    }

    // =========================================================================
    // Sonic Shaper 2: Quadrature Hilbert Bode SSB Shifter (with Stereo Barberpole USB/LSB)
    // =========================================================================
    this.freqShiftDry = rawCtx.createGain();
    this.freqShiftDry.gain.value = 1.0;
    this.freqShiftIn = rawCtx.createGain();
    this.freqShiftIn.gain.value = 1.0;
    this.freqShiftSum = rawCtx.createGain();
    this.freqShiftSum.gain.value = 1.0;

    this.hilbertI = HILBERT_I_POLES.map((hz) => {
      const ap = rawCtx.createBiquadFilter();
      ap.type = 'allpass';
      ap.frequency.value = hz;
      ap.Q.value = Math.SQRT1_2;
      return ap;
    });
    this.hilbertQ = HILBERT_Q_POLES.map((hz) => {
      const ap = rawCtx.createBiquadFilter();
      ap.type = 'allpass';
      ap.frequency.value = hz;
      ap.Q.value = Math.SQRT1_2;
      return ap;
    });
    for (let i = 0; i < 3; i++) {
      this.hilbertI[i].connect(this.hilbertI[i + 1]);
      this.hilbertQ[i].connect(this.hilbertQ[i + 1]);
    }

    const cosWave = rawCtx.createPeriodicWave(
      new Float32Array([0, 1]),
      new Float32Array([0, 0]),
      { disableNormalization: true }
    );
    this.bodeCosOsc = rawCtx.createOscillator();
    this.bodeCosOsc.setPeriodicWave(cosWave);
    this.bodeCosOsc.frequency.value = 1.5;

    this.bodeSinOsc = rawCtx.createOscillator();
    this.bodeSinOsc.type = 'sine';
    this.bodeSinOsc.frequency.value = 1.5;

    this.bodeRingI = rawCtx.createGain();
    this.bodeRingI.gain.value = 0;
    this.bodeRingQ = rawCtx.createGain();
    this.bodeRingQ.gain.value = 0;

    this.bodeSignL = rawCtx.createGain();
    this.bodeSignL.gain.value = -1;
    this.bodeSignR = rawCtx.createGain();
    this.bodeSignR.gain.value = -1;
    this.bodeSumL = rawCtx.createGain();
    this.bodeSumL.gain.value = 1.0;
    this.bodeSumR = rawCtx.createGain();
    this.bodeSumR.gain.value = 1.0;
    this.bodeStereoMerger = rawCtx.createChannelMerger(2);

    this.bodeWetGain = rawCtx.createGain();
    this.bodeWetGain.gain.value = 0;

    this.bodeFbLp = rawCtx.createBiquadFilter();
    this.bodeFbLp.type = 'lowpass';
    this.bodeFbLp.frequency.value = 3600;
    this.bodeFbLp.Q.value = 0.7;

    this.bodeFbGain = rawCtx.createGain();
    this.bodeFbGain.gain.value = 0;

    this.bodeCosOsc.connect(this.bodeRingI.gain);
    this.bodeSinOsc.connect(this.bodeRingQ.gain);
    this.bodeCosOsc.start(startAt);
    this.bodeSinOsc.start(startAt);

    // =========================================================================
    // Sonic Shaper 5: Dual-Peak "Reese Notch" & Mirror Phaser Matrix (> Xover)
    // =========================================================================
    this.reeseNotchLow = rawCtx.createBiquadFilter();
    this.reeseNotchLow.type = 'peaking';
    this.reeseNotchLow.frequency.value = 260;
    this.reeseNotchLow.Q.value = 3.0;
    this.reeseNotchLow.gain.value = 0;

    this.reeseNotchHigh = rawCtx.createBiquadFilter();
    this.reeseNotchHigh.type = 'peaking';
    this.reeseNotchHigh.frequency.value = 1850;
    this.reeseNotchHigh.Q.value = 3.0;
    this.reeseNotchHigh.gain.value = 0;

    this.reesePeakLow = rawCtx.createBiquadFilter();
    this.reesePeakLow.type = 'peaking';
    this.reesePeakLow.frequency.value = 340;
    this.reesePeakLow.Q.value = 3.2;
    this.reesePeakLow.gain.value = 0;

    this.reesePeakHigh = rawCtx.createBiquadFilter();
    this.reesePeakHigh.type = 'peaking';
    this.reesePeakHigh.frequency.value = 1420;
    this.reesePeakHigh.Q.value = 3.2;
    this.reesePeakHigh.gain.value = 0;

    // =========================================================================
    // Sonic Shaper 8: Open-Loop Pre-Sidechain 8-Band Spectral Gate Filterbank
    // =========================================================================
    this.spectralAnalyser = rawCtx.createAnalyser();
    this.spectralAnalyser.fftSize = 64;
    this.spectralAnalyser.minDecibels = -82;
    this.spectralAnalyser.maxDecibels = -10;
    this.spectralAnalyser.smoothingTimeConstant = 0.78;

    this.spectralIn = rawCtx.createGain();
    this.spectralIn.gain.value = 1.0;
    this.spectralDry = rawCtx.createGain();
    this.spectralDry.gain.value = 1.0;
    this.spectralWet = rawCtx.createGain();
    this.spectralWet.gain.value = 0.0;
    this.spectralSum = rawCtx.createGain();
    this.spectralSum.gain.value = 1.0;

    this.spectralBandFilters = [];
    this.spectralBandGains = [];
    for (const freq of SPECTRAL_BAND_FREQS) {
      const bp = rawCtx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq;
      bp.Q.value = 4.5;
      const g = rawCtx.createGain();
      g.gain.value = 0.25;
      this.spectralIn.connect(bp);
      bp.connect(g);
      g.connect(this.spectralWet);
      this.spectralBandFilters.push(bp);
      this.spectralBandGains.push(g);
    }

    // =========================================================================
    // Stage E: Pre-Drive Chest Body + 2x-Oversampled Saturation + Analog Cabinet LPF
    // =========================================================================
    this.bodyWarmthFilter = rawCtx.createBiquadFilter();
    this.bodyWarmthFilter.type = 'peaking';
    this.bodyWarmthFilter.frequency.value = 185;
    this.bodyWarmthFilter.Q.value = 0.75;
    this.bodyWarmthFilter.gain.value = 2.0;

    this.toneDry = rawCtx.createGain();
    this.toneDry.gain.value = 1.0;
    this.tonePreGain = rawCtx.createGain();
    this.tonePreGain.gain.value = 1.0;
    this.toneShaper = rawCtx.createWaveShaper();
    this.toneShaper.oversample = '4x';
    this.setToneCurve('TEAROUT', 0);
    this.toneWet = rawCtx.createGain();
    this.toneWet.gain.value = 0.0;

    this.postToneCabinetLp = rawCtx.createBiquadFilter();
    this.postToneCabinetLp.type = 'lowpass';
    this.postToneCabinetLp.frequency.value = 8400;
    this.postToneCabinetLp.Q.value = 0.82;

    this.midBandGate = rawCtx.createGain();
    this.midBandGate.gain.value = 1.0;

    // =========================================================================
    // Natural Stereo Unison Micro-Spread (> Xover Only)
    // =========================================================================
    this.unisonWidthDry = rawCtx.createGain();
    this.unisonWidthDry.gain.value = 1.0;
    this.unisonSpreadL = rawCtx.createDelay(0.025);
    this.unisonSpreadL.delayTime.value = 0.0024;
    this.unisonSpreadR = rawCtx.createDelay(0.025);
    this.unisonSpreadR.delayTime.value = 0.0046;

    this.unisonLfo = rawCtx.createOscillator();
    this.unisonLfo.type = 'sine';
    this.unisonLfo.frequency.value = 0.43;
    this.unisonLfoGainL = rawCtx.createGain();
    this.unisonLfoGainL.gain.value = 0;
    this.unisonLfoGainR = rawCtx.createGain();
    this.unisonLfoGainR.gain.value = 0;
    this.unisonLfo.connect(this.unisonLfoGainL);
    this.unisonLfo.connect(this.unisonLfoGainR);
    this.unisonLfoGainL.connect(this.unisonSpreadL.delayTime);
    this.unisonLfoGainR.connect(this.unisonSpreadR.delayTime);
    this.unisonLfo.start(startAt);

    this.unisonWidthMerger = rawCtx.createChannelMerger(2);
    this.unisonWidthWet = rawCtx.createGain();
    this.unisonWidthWet.gain.value = 0;
    this.unisonWidthSum = rawCtx.createGain();
    this.unisonWidthSum.gain.value = 1.0;

    // =========================================================================
    // Sonic Shaper 3: Stereo Haas / Mid-Side Dimension Expander (> Xover Only)
    // =========================================================================
    this.haasIn = rawCtx.createGain();
    this.haasIn.gain.value = 1.0;
    this.haasDry = rawCtx.createGain();
    this.haasDry.gain.value = 1.0;
    this.haasDelayL = rawCtx.createDelay(0.05);
    this.haasDelayL.delayTime.value = 0.0012;
    this.haasDelayR = rawCtx.createDelay(0.05);
    this.haasDelayR.delayTime.value = 0.0095;

    this.haasChorusLfo = rawCtx.createOscillator();
    this.haasChorusLfo.type = 'sine';
    this.haasChorusLfo.frequency.value = 0.68;
    this.haasLfoGainL = rawCtx.createGain();
    this.haasLfoGainL.gain.value = 0;
    this.haasLfoGainR = rawCtx.createGain();
    this.haasLfoGainR.gain.value = 0;

    this.haasChorusLfo.connect(this.haasLfoGainL);
    this.haasChorusLfo.connect(this.haasLfoGainR);
    this.haasLfoGainL.connect(this.haasDelayL.delayTime);
    this.haasLfoGainR.connect(this.haasDelayR.delayTime);
    this.haasChorusLfo.start(startAt);

    this.haasMerger = rawCtx.createChannelMerger(2);
    this.haasStereoGate = rawCtx.createGain();
    this.haasStereoGate.gain.value = 0;
    this.haasStageSum = rawCtx.createGain();
    this.haasStageSum.gain.value = 1.0;

    // =========================================================================
    // Phase Scope Differential Stereo Phase Rotator (-180°..+180° + R Polarity, > Xover)
    // =========================================================================
    this.phaseBypassGain = rawCtx.createGain();
    this.phaseBypassGain.gain.value = 1.0;

    this.phaseSplitter = rawCtx.createChannelSplitter(2);
    this.phaseApL1 = rawCtx.createBiquadFilter();
    this.phaseApL1.type = 'allpass';
    this.phaseApL1.frequency.value = 520;
    this.phaseApL1.Q.value = 0.65;

    this.phaseApL2 = rawCtx.createBiquadFilter();
    this.phaseApL2.type = 'allpass';
    this.phaseApL2.frequency.value = 1450;
    this.phaseApL2.Q.value = 0.65;

    this.phaseApR1 = rawCtx.createBiquadFilter();
    this.phaseApR1.type = 'allpass';
    this.phaseApR1.frequency.value = 520;
    this.phaseApR1.Q.value = 0.65;

    this.phaseApR2 = rawCtx.createBiquadFilter();
    this.phaseApR2.type = 'allpass';
    this.phaseApR2.frequency.value = 1450;
    this.phaseApR2.Q.value = 0.65;

    this.phaseRightPolarity = rawCtx.createGain();
    this.phaseRightPolarity.gain.value = 1.0;
    this.phaseMerger = rawCtx.createChannelMerger(2);

    this.multibandSum = rawCtx.createGain();
    this.multibandSum.gain.value = 1.0;

    // =========================================================================
    // Sonic Shaper 4: Native C++ 3-Band Upward/Downward Multiband OTT Dynamics
    // =========================================================================
    this.ottIn = rawCtx.createGain();
    this.ottIn.gain.value = 1.0;
    this.ottDry = rawCtx.createGain();
    this.ottDry.gain.value = 1.0;
    this.ottWet = rawCtx.createGain();
    this.ottWet.gain.value = 0.0;
    this.ottSum = rawCtx.createGain();
    this.ottSum.gain.value = 1.0;

    this.ottLpFilter = rawCtx.createBiquadFilter();
    this.ottLpFilter.type = 'lowpass';
    this.ottLpFilter.frequency.value = 135;
    this.ottLpFilter.Q.value = Math.SQRT1_2;

    this.ottBpFilter = rawCtx.createBiquadFilter();
    this.ottBpFilter.type = 'bandpass';
    this.ottBpFilter.frequency.value = 620;
    this.ottBpFilter.Q.value = 0.55;

    this.ottHpFilter = rawCtx.createBiquadFilter();
    this.ottHpFilter.type = 'highpass';
    this.ottHpFilter.frequency.value = 2500;
    this.ottHpFilter.Q.value = Math.SQRT1_2;

    this.ottPreLow = rawCtx.createGain();
    this.ottPreLow.gain.value = 1.5;
    this.ottPreMid = rawCtx.createGain();
    this.ottPreMid.gain.value = 1.65;
    this.ottPreHigh = rawCtx.createGain();
    this.ottPreHigh.gain.value = 2.0;

    this.ottCompLow = rawCtx.createDynamicsCompressor();
    this.ottCompLow.threshold.value = -28;
    this.ottCompLow.knee.value = 6;
    this.ottCompLow.ratio.value = 7;
    this.ottCompLow.attack.value = 0.006;
    this.ottCompLow.release.value = 0.085;

    this.ottCompMid = rawCtx.createDynamicsCompressor();
    this.ottCompMid.threshold.value = -30;
    this.ottCompMid.knee.value = 6;
    this.ottCompMid.ratio.value = 8;
    this.ottCompMid.attack.value = 0.004;
    this.ottCompMid.release.value = 0.075;

    this.ottCompHigh = rawCtx.createDynamicsCompressor();
    this.ottCompHigh.threshold.value = -32;
    this.ottCompHigh.knee.value = 6;
    this.ottCompHigh.ratio.value = 9;
    this.ottCompHigh.attack.value = 0.002;
    this.ottCompHigh.release.value = 0.06;

    this.ottMakeupLow = rawCtx.createGain();
    this.ottMakeupLow.gain.value = 1.32;
    this.ottMakeupMid = rawCtx.createGain();
    this.ottMakeupMid.gain.value = 1.4;
    this.ottMakeupHigh = rawCtx.createGain();
    this.ottMakeupHigh.gain.value = 1.68;

    // =========================================================================
    // Native 3-Band Tone EQ + Band-Limited Stereo Air-Stabiliser (STABILISE)
    // =========================================================================
    this.eqLow = rawCtx.createBiquadFilter();
    this.eqLow.type = 'lowshelf';
    this.eqLow.frequency.value = 135;
    this.eqLow.gain.value = 0;

    this.eqMid = rawCtx.createBiquadFilter();
    this.eqMid.type = 'peaking';
    this.eqMid.frequency.value = 360;
    this.eqMid.Q.value = 0.78;
    this.eqMid.gain.value = 0;

    this.eqHigh = rawCtx.createBiquadFilter();
    this.eqHigh.type = 'highshelf';
    this.eqHigh.frequency.value = 4600;
    this.eqHigh.gain.value = 0;

    // Band-limited (> 300 Hz, < 5600 Hz) decorrelated figure-8 stereo diffuser (100% unconditionally stable!)
    this.spaceIn = rawCtx.createGain();
    this.spaceIn.gain.value = 1.0;

    this.spaceHpFilter = rawCtx.createBiquadFilter();
    this.spaceHpFilter.type = 'highpass';
    this.spaceHpFilter.frequency.value = 300;
    this.spaceHpFilter.Q.value = Math.SQRT1_2;

    this.spaceLpFilter = rawCtx.createBiquadFilter();
    this.spaceLpFilter.type = 'lowpass';
    this.spaceLpFilter.frequency.value = 5600;
    this.spaceLpFilter.Q.value = Math.SQRT1_2;

    this.spaceDelayL = rawCtx.createDelay(0.06);
    this.spaceDelayL.delayTime.value = 0.0137;
    this.spaceDelayR = rawCtx.createDelay(0.06);
    this.spaceDelayR.delayTime.value = 0.0211;

    this.spaceApL = rawCtx.createBiquadFilter();
    this.spaceApL.type = 'allpass';
    this.spaceApL.frequency.value = 740;
    this.spaceApL.Q.value = 0.7;

    this.spaceApR = rawCtx.createBiquadFilter();
    this.spaceApR.type = 'allpass';
    this.spaceApR.frequency.value = 1180;
    this.spaceApR.Q.value = 0.7;

    this.spaceFbL = rawCtx.createGain();
    this.spaceFbL.gain.value = 0;
    this.spaceFbR = rawCtx.createGain();
    this.spaceFbR.gain.value = 0;
    this.spaceMerger = rawCtx.createChannelMerger(2);

    this.spaceDry = rawCtx.createGain();
    this.spaceDry.gain.value = 1.0;
    this.spaceWet = rawCtx.createGain();
    this.spaceWet.gain.value = 0.0;

    this.compressor = rawCtx.createDynamicsCompressor();
    this.compressor.threshold.value = -10;
    this.compressor.knee.value = 8;
    this.compressor.ratio.value = 2.2;
    this.compressor.attack.value = 0.006;
    this.compressor.release.value = 0.095;

    this.compressorMakeup = rawCtx.createGain();
    this.compressorMakeup.gain.value = 1.0;

    // =========================================================================
    // Sonic Shaper 6: Turntable Vinyl Scratch & Motorized Tape-Stop Physics
    // =========================================================================
    this.vinylBypassGain = rawCtx.createGain();
    this.vinylBypassGain.gain.value = 1.0;

    this.vinylSplitter = rawCtx.createChannelSplitter(2);
    this.vinylDelayL = rawCtx.createDelay(1.6);
    this.vinylDelayL.delayTime.value = 0.002;
    this.vinylDelayR = rawCtx.createDelay(1.6);
    this.vinylDelayR.delayTime.value = 0.002;
    this.vinylMerger = rawCtx.createChannelMerger(2);

    this.vinylLpFilter = rawCtx.createBiquadFilter();
    this.vinylLpFilter.type = 'lowpass';
    this.vinylLpFilter.frequency.value = 20000;
    this.vinylLpFilter.Q.value = 0.75;

    this.vinylDuckGain = rawCtx.createGain();
    this.vinylDuckGain.gain.value = 1.0;

    this.vinylDustBp = rawCtx.createBiquadFilter();
    this.vinylDustBp.type = 'bandpass';
    this.vinylDustBp.frequency.value = 2850;
    this.vinylDustBp.Q.value = 2.4;

    this.vinylDustGain = rawCtx.createGain();
    this.vinylDustGain.gain.value = 0.0;

    this.vinylOutSum = rawCtx.createGain();
    this.vinylOutSum.gain.value = 1.0;

    // Modular Master FX Patchbay Bus (Direct Thru by default)
    this.fxChainIn = rawCtx.createGain();
    this.fxChainIn.gain.value = 1.0;
    this.fxChainOut = rawCtx.createGain();
    this.fxChainOut.gain.value = 1.0;
    this.currentFxOrderSignature = 'DIRECT';
    this.activePatchedUnits = [];

    // Master Stereo vs Mono-Sum Check Stage
    this.masterStereoPass = rawCtx.createGain();
    this.masterStereoPass.gain.value = 1.0;

    this.masterMonoSum = rawCtx.createGain();
    this.masterMonoSum.channelCount = 1;
    this.masterMonoSum.channelCountMode = 'explicit';
    this.masterMonoSum.gain.value = 0.0;

    this.outputGain = rawCtx.createGain();
    this.outputGain.gain.value = 1.0;

    this.safetyLimiter = rawCtx.createDynamicsCompressor();
    this.safetyLimiter.threshold.value = -1.0;
    this.safetyLimiter.knee.value = 1.5;
    this.safetyLimiter.ratio.value = 18;
    this.safetyLimiter.attack.value = 0.002;
    this.safetyLimiter.release.value = 0.06;

    // Output Telemetry & Stereo Phase Scope Analysers
    this.outAnalyser = rawCtx.createAnalyser();
    this.outAnalyser.fftSize = 512;

    this.fftAnalyserNode = rawCtx.createAnalyser();
    this.fftAnalyserNode.fftSize = 128;
    this.fftAnalyserNode.minDecibels = -84;
    this.fftAnalyserNode.maxDecibels = -10;
    this.fftAnalyserNode.smoothingTimeConstant = 0.72;

    this.stereoScopeSplitter = rawCtx.createChannelSplitter(2);
    this.analyserL = rawCtx.createAnalyser();
    this.analyserL.fftSize = PHASE_SCOPE_SAMPLES;
    this.analyserR = rawCtx.createAnalyser();
    this.analyserR.fftSize = PHASE_SCOPE_SAMPLES;

    // Pre-Limiter Master Output Stereo VU & True Clipping Analysers
    this.vuSplitter = rawCtx.createChannelSplitter(2);
    this.vuAnalyserL = rawCtx.createAnalyser();
    this.vuAnalyserL.fftSize = 256;
    this.vuAnalyserR = rawCtx.createAnalyser();
    this.vuAnalyserR.fftSize = 256;

    // =========================================================================
    // 0. Build OSC Synthesizer Panel Voice Bank (sub-branches dynamically gated!)
    // =========================================================================
    this.oscVoiceGate = rawCtx.createGain();
    this.oscVoiceGate.gain.value = 0;

    this.oscPrimary = new Tone.FatOscillator({
      frequency: 65.41,
      type: 'sawtooth',
      count: 3,
      spread: 24,
    });
    this.primaryWaveGain = rawCtx.createGain();
    this.primaryWaveGain.gain.value = 0.55;

    this.oscPulse = new Tone.PulseOscillator({
      frequency: 65.41,
      width: 0.35,
    });
    this.pulseWaveGain = rawCtx.createGain();
    this.pulseWaveGain.gain.value = 0;

    this.oscSync = new Tone.FMOscillator({
      frequency: 65.41,
      type: 'sawtooth',
      modulationType: 'sawtooth',
      harmonicity: 2.5,
      modulationIndex: 6,
    });
    this.syncWaveGain = rawCtx.createGain();
    this.syncWaveGain.gain.value = 0;

    this.oscSecondary = new Tone.Oscillator({
      frequency: 65.41,
      type: 'sawtooth',
    });
    this.secondaryWaveGain = rawCtx.createGain();
    this.secondaryWaveGain.gain.value = 0.32;

    this.ringModNode = rawCtx.createGain();
    this.ringModNode.gain.value = 0;
    this.ringMixGain = rawCtx.createGain();
    this.ringMixGain.gain.value = 0;

    this.noiseGen = new Tone.Noise('pink');
    this.noiseGain = rawCtx.createGain();
    this.noiseGain.gain.value = 0;

    Tone.connect(this.oscPrimary, this.primaryWaveGain);
    Tone.connect(this.oscPulse, this.pulseWaveGain);
    Tone.connect(this.oscSync, this.syncWaveGain);
    Tone.connect(this.oscSecondary, this.secondaryWaveGain);

    this.primaryWaveGain.connect(this.ringModNode);
    this.pulseWaveGain.connect(this.ringModNode);
    this.syncWaveGain.connect(this.ringModNode);
    Tone.connect(this.oscSecondary, this.ringModNode.gain);
    this.ringModNode.connect(this.ringMixGain);

    Tone.connect(this.noiseGen, this.noiseGain);
    Tone.connect(this.noiseGen, this.vinylDustBp);
    this.vinylDustBp.connect(this.vinylDustGain);

    this.oscPrimary.start();
    this.oscPulse.start();
    this.oscSync.start();
    this.oscSecondary.start();
    this.noiseGen.start();

    // =========================================================================
    // 1. Build Dual-Operator FM Growl Oscillator Bank + Sub Anchor + 4-Stage Synth ADSR
    // =========================================================================
    this.fmVoiceGate = rawCtx.createGain();
    this.fmVoiceGate.gain.value = 0;
    this.subDirectGate = rawCtx.createGain();
    this.subDirectGate.channelCount = 1;
    this.subDirectGate.channelCountMode = 'explicit';
    this.subDirectGate.gain.value = 0;

    this.synthAmpEnvGain = rawCtx.createGain();
    this.synthAmpEnvGain.gain.value = 0;
    this.synthLfoAmpGain = rawCtx.createGain();
    this.synthLfoAmpGain.gain.value = 1.0;
    this.synthSubEnvGain = rawCtx.createGain();
    this.synthSubEnvGain.channelCount = 1;
    this.synthSubEnvGain.channelCountMode = 'explicit';
    this.synthSubEnvGain.gain.value = 0;

    this.fmCarrier = new Tone.FMOscillator({
      frequency: 65.41,
      type: 'sine',
      modulationType: 'sine',
      harmonicity: 2,
      modulationIndex: 3.5,
    });

    this.fmMetallicOsc = new Tone.FMOscillator({
      frequency: 65.41,
      type: 'triangle',
      modulationType: 'triangle',
      harmonicity: 3,
      modulationIndex: 2.5,
    });
    this.fmMetallicGain = rawCtx.createGain();
    this.fmMetallicGain.gain.value = 0;

    this.unisonOsc = new Tone.FatOscillator({
      frequency: 65.41,
      type: 'sawtooth',
      count: 3,
      spread: 32,
    });
    this.unisonGain = rawCtx.createGain();
    this.unisonGain.gain.value = 0.34;

    this.subOsc = new Tone.Oscillator({
      frequency: 32.7,
      type: 'sine',
    });
    this.subGain = rawCtx.createGain();
    this.subGain.gain.value = 0.68;

    Tone.connect(this.fmCarrier, this.fmVoiceGate);
    Tone.connect(this.fmMetallicOsc, this.fmMetallicGain);
    // fmMetallicGain -> fmVoiceGate is dynamically gated ONLY when Throat Comb + Metal > 1% is active!
    Tone.connect(this.unisonOsc, this.unisonGain);
    Tone.connect(this.subOsc, this.subGain);
    this.subGain.connect(this.subDirectGate);

    this.fmCarrier.start();
    this.fmMetallicOsc.start();
    this.unisonOsc.start();
    this.subOsc.start();

    // =========================================================================
    // 2. Build Granular Gate + Synth ADSR/LFO Bus + 100% Native C++ Kick & Master Chain
    // =========================================================================
    this.grainGate = rawCtx.createGain();
    this.grainGate.gain.value = 0;

    // Route Synth Voice Gates through Dedicated 4-Stage Synth ADSR + Synth LFO Amp Stage
    this.oscVoiceGate.connect(this.synthAmpEnvGain);
    this.fmVoiceGate.connect(this.synthAmpEnvGain);
    this.grainGate.connect(this.synthAmpEnvGain);
    this.synthAmpEnvGain.connect(this.synthLfoAmpGain);
    this.subDirectGate.connect(this.synthSubEnvGain);

    // Kick Panel 1: Phase-Locked Per-Hit Kick Engine + Deterministic TR-909 Tok Impulse Buffer
    this.kickVoiceGate = rawCtx.createGain();
    this.kickVoiceGate.gain.value = 0;

    this.kickBodyDetuneSource = rawCtx.createConstantSource();
    this.kickBodyDetuneSource.offset.value = 0;

    this.kickHarmDetuneSource = rawCtx.createConstantSource();
    this.kickHarmDetuneSource.offset.value = 0;

    // Pre-generate 100% deterministic, phase-aligned analog TR-909 Tok click buffer (zero random live noise!)
    const tokSr = rawCtx.sampleRate || 44100;
    const tokLen = Math.max(64, Math.floor(tokSr * 0.036));
    this.kickTokBuffer = rawCtx.createBuffer(1, tokLen, tokSr);
    const tokData = this.kickTokBuffer.getChannelData(0);
    for (let i = 0; i < tokLen; i++) {
      const t = i / tokSr;
      // Positive-leading analog pulse + deterministic seeded transient micro-burst
      const initPulse = Math.exp(-t / 0.00075) * 0.88;
      const metalSnap =
        (Math.sin(2 * Math.PI * 1680 * t) * 0.55 + Math.sin(2 * Math.PI * 3150 * t) * 0.45) *
        Math.exp(-t / 0.0028);
      const seededHash = Math.abs((Math.sin((i + 1) * 12.9898) * 43758.5453) % 1) * 2 - 1;
      const burst = seededHash * Math.exp(-t / 0.0034) * 0.68;
      tokData[i] = clamp(initPulse + metalSnap * 0.52 + burst, -1, 1);
    }

    this.kickLfoAmpGain = rawCtx.createGain();
    this.kickLfoAmpGain.gain.value = 1.0;

    // Tok High-Frequency Bandpass Shaping Filter
    this.kickTokBpFilter = rawCtx.createBiquadFilter();
    this.kickTokBpFilter.type = 'bandpass';
    this.kickTokBpFilter.frequency.value = 2650;
    this.kickTokBpFilter.Q.value = 1.45;

    this.kickRawSum = rawCtx.createGain();
    this.kickRawSum.gain.value = 1.0;

    // Parallel Club-Mono Sub Reinforcement (< 88 Hz phase-coherent sub weight)
    this.kickSubLp = rawCtx.createBiquadFilter();
    this.kickSubLp.type = 'lowpass';
    this.kickSubLp.frequency.value = 88;
    this.kickSubLp.Q.value = Math.SQRT1_2;

    this.kickSubReinforce = rawCtx.createGain();
    this.kickSubReinforce.channelCount = 1;
    this.kickSubReinforce.channelCountMode = 'explicit';
    this.kickSubReinforce.gain.value = 0.34;

    // Kick Panel 2: Pre-Distortion "Frequency Hunt" EQ + Multi-Stage Hard-Clip / Wavefolder
    this.kickPreHp = rawCtx.createBiquadFilter();
    this.kickPreHp.type = 'highpass';
    this.kickPreHp.frequency.value = 30;
    this.kickPreHp.Q.value = Math.SQRT1_2;

    this.kickDryKrachGain = rawCtx.createGain();
    this.kickDryKrachGain.gain.value = 1.0;

    this.kickPreEq = rawCtx.createBiquadFilter();
    this.kickPreEq.type = 'peaking';
    this.kickPreEq.frequency.value = 1180;
    this.kickPreEq.Q.value = 4.2;
    this.kickPreEq.gain.value = 0;

    this.kickPreDrive = rawCtx.createGain();
    this.kickPreDrive.gain.value = 1.0;

    this.kickShaper = rawCtx.createWaveShaper();
    this.kickShaper.oversample = '4x';
    this.setKickClipCurve('GABBER', 0);

    this.kickPostHp = rawCtx.createBiquadFilter();
    this.kickPostHp.type = 'highpass';
    this.kickPostHp.frequency.value = 28;
    this.kickPostHp.Q.value = Math.SQRT1_2;

    this.kickPostDip = rawCtx.createBiquadFilter();
    this.kickPostDip.type = 'peaking';
    this.kickPostDip.frequency.value = 335;
    this.kickPostDip.Q.value = 1.35;
    this.kickPostDip.gain.value = 0;

    this.kickPostLp = rawCtx.createBiquadFilter();
    this.kickPostLp.type = 'lowpass';
    this.kickPostLp.frequency.value = 9800;
    this.kickPostLp.Q.value = 0.75;

    this.kickWetKrachGain = rawCtx.createGain();
    this.kickWetKrachGain.gain.value = 0;

    this.kickDryPunchSum = rawCtx.createGain();
    this.kickDryPunchSum.gain.value = 1.0;

    // Kick Panel 3: Industrial Techno Cavern Rumble + Kick-Triggered Sidechain Pump
    this.rumbleIn = rawCtx.createGain();
    this.rumbleIn.gain.value = 0.85;

    this.rumbleDelay = rawCtx.createDelay(0.45);
    this.rumbleDelay.delayTime.value = 0.105;

    this.rumbleAp1 = rawCtx.createBiquadFilter();
    this.rumbleAp1.type = 'allpass';
    this.rumbleAp1.frequency.value = 185;
    this.rumbleAp1.Q.value = 0.9;

    this.rumbleAp2 = rawCtx.createBiquadFilter();
    this.rumbleAp2.type = 'allpass';
    this.rumbleAp2.frequency.value = 325;
    this.rumbleAp2.Q.value = 0.9;

    this.rumbleFbGain = rawCtx.createGain();
    this.rumbleFbGain.gain.value = 0;

    this.rumbleHp = rawCtx.createBiquadFilter();
    this.rumbleHp.type = 'highpass';
    this.rumbleHp.frequency.value = 34;
    this.rumbleHp.Q.value = Math.SQRT1_2;

    this.rumbleLp = rawCtx.createBiquadFilter();
    this.rumbleLp.type = 'lowpass';
    this.rumbleLp.frequency.value = 280;
    this.rumbleLp.Q.value = 1.15;

    this.rumbleShaper = rawCtx.createWaveShaper();
    this.rumbleShaper.oversample = 'none';
    this.rumbleShaper.curve = RUMBLE_DRIVE_CURVE;

    this.rumbleDuckGain = rawCtx.createGain();
    this.rumbleDuckGain.channelCount = 1;
    this.rumbleDuckGain.channelCountMode = 'explicit';
    this.rumbleDuckGain.gain.value = 0;

    // Wire Native Kick Bus (per-hit phase-locked voices connect into kickLfoAmpGain & kickTokBpFilter!)
    this.kickLfoAmpGain.connect(this.kickRawSum);
    this.kickTokBpFilter.connect(this.kickRawSum);

    this.kickRawSum.connect(this.kickSubLp);
    this.kickSubLp.connect(this.kickSubReinforce);
    this.kickSubReinforce.connect(this.kickVoiceGate);

    this.kickRawSum.connect(this.kickPreHp);
    this.kickPreHp.connect(this.kickDryKrachGain);
    this.kickDryKrachGain.connect(this.kickDryPunchSum);

    // Pre-EQ + Multi-Stage Clipper wet branch (input kickPreHp -> kickPreEq dynamically gated!)
    this.kickPreEq.connect(this.kickPreDrive);
    this.kickPreDrive.connect(this.kickShaper);
    this.kickShaper.connect(this.kickPostHp);
    this.kickPostHp.connect(this.kickPostDip);
    this.kickPostDip.connect(this.kickPostLp);
    this.kickPostLp.connect(this.kickWetKrachGain);
    this.kickWetKrachGain.connect(this.kickDryPunchSum);

    this.kickDryPunchSum.connect(this.kickVoiceGate);

    // Industrial Rumble parallel branch (input kickDryPunchSum -> rumbleIn dynamically gated!)
    this.rumbleIn.connect(this.rumbleDelay);
    this.rumbleDelay.connect(this.rumbleAp1);
    this.rumbleAp1.connect(this.rumbleAp2);
    this.rumbleAp2.connect(this.rumbleHp);
    this.rumbleHp.connect(this.rumbleLp);
    this.rumbleLp.connect(this.rumbleFbGain);
    this.rumbleFbGain.connect(this.rumbleDelay);
    this.rumbleLp.connect(this.rumbleShaper);
    this.rumbleShaper.connect(this.rumbleDuckGain);
    this.rumbleDuckGain.connect(this.kickVoiceGate);

    this.kickBodyDetuneSource.start(startAt);
    this.kickHarmDetuneSource.start(startAt);

    // =========================================================================
    // 3. Wire 115 Hz Multiband Crossover + Growl + Dynamic Sonic Shaper Stages
    // =========================================================================
    this.inputGain.connect(this.inAnalyser);
    this.inputGain.connect(this.dryBranch);
    this.dryBranch.connect(this.compressor);

    this.inputGain.connect(this.hpFilter);
    this.hpFilter.connect(this.lpFilter);
    this.kickFullBandDirect.connect(this.multibandSum);

    // Branch A: Warm Mono Sub Band (< 115 Hz) -> subtle analog tape warmth, bypasses all phase/stereo mangling!
    this.lpFilter.connect(this.xoverLow1);
    this.xoverLow1.connect(this.xoverLow2);
    this.xoverLow2.connect(this.lowBandShaper);
    this.lowBandShaper.connect(this.lowBandGain);
    this.lowBandGain.connect(this.multibandSum);

    // Branch B: Mid/High Growl + Sonic Shapers (> 115 Hz)
    this.lpFilter.connect(this.xoverHigh1);
    this.xoverHigh1.connect(this.xoverHigh2);
    this.xoverHigh2.connect(this.wahFilter);

    // Stage B: Metallic Comb Resonator (input dynamically gated)
    this.wahFilter.connect(this.combSum);
    this.combDelay.connect(this.combWet);
    this.combWet.connect(this.combSum);
    this.combDelay.connect(this.combDamping);
    this.combDamping.connect(this.combFeedback);
    this.combFeedback.connect(this.combDelay);

    // Stage C: Vocal Formants + Counter-Swept Notch
    this.combSum.connect(this.formant1);
    this.formant1.connect(this.formant2);
    this.formant2.connect(this.notchFilter);

    // Stage D: Staircase Bitcrusher (wet input dynamically gated)
    this.notchFilter.connect(this.crushDry);
    this.crushDry.connect(this.crushSum);
    this.crushShaper.connect(this.crushWet);
    this.crushWet.connect(this.crushSum);

    // Shaper 1: 8-Stage All-Pass Phase Disperser (wet input dynamically gated)
    this.crushSum.connect(this.disperserDry);
    this.disperserDry.connect(this.disperserSum);
    this.disperserStages[this.disperserStages.length - 1].connect(this.disperserWet);
    this.disperserWet.connect(this.disperserSum);

    // Shaper 2: Quadrature Hilbert Bode SSB Shifter (with Stereo Barberpole USB Left / LSB Right)
    this.disperserSum.connect(this.freqShiftDry);
    this.freqShiftDry.connect(this.freqShiftSum);
    this.freqShiftIn.connect(this.hilbertI[0]);
    this.freqShiftIn.connect(this.hilbertQ[0]);
    this.hilbertI[3].connect(this.bodeRingI);
    this.hilbertQ[3].connect(this.bodeRingQ);

    this.bodeRingI.connect(this.bodeSumL);
    this.bodeRingQ.connect(this.bodeSignL);
    this.bodeSignL.connect(this.bodeSumL);

    this.bodeRingI.connect(this.bodeSumR);
    this.bodeRingQ.connect(this.bodeSignR);
    this.bodeSignR.connect(this.bodeSumR);

    this.bodeSumL.connect(this.bodeStereoMerger, 0, 0);
    this.bodeSumR.connect(this.bodeStereoMerger, 0, 1);
    this.bodeStereoMerger.connect(this.bodeWetGain);
    this.bodeWetGain.connect(this.freqShiftSum);

    this.bodeSumL.connect(this.bodeFbLp);
    this.bodeFbLp.connect(this.bodeFbGain);
    this.bodeFbGain.connect(this.freqShiftIn);

    // Shaper 5: Dual-Peak Reese Mirror Notch
    this.freqShiftSum.connect(this.reeseNotchLow);
    this.reeseNotchLow.connect(this.reeseNotchHigh);
    this.reeseNotchHigh.connect(this.reesePeakLow);
    this.reesePeakLow.connect(this.reesePeakHigh);

    // Shaper 8: Open-Loop 8-Band Dynamic Spectral Gate Filterbank (wet input & pre-analyser gated)
    this.reesePeakHigh.connect(this.spectralDry);
    this.spectralDry.connect(this.spectralSum);
    this.spectralWet.connect(this.spectralSum);

    // Chest Body Warmth -> 2x-Oversampled Saturation (TONE) -> Analog Cabinet LPF -> midBandGate
    this.spectralSum.connect(this.bodyWarmthFilter);
    this.bodyWarmthFilter.connect(this.toneDry);
    this.toneDry.connect(this.postToneCabinetLp);
    this.tonePreGain.connect(this.toneShaper);
    this.toneShaper.connect(this.toneWet);
    this.toneWet.connect(this.postToneCabinetLp);
    this.postToneCabinetLp.connect(this.midBandGate);

    // Natural Unison Stereo Spread (> Xover Only, dynamically gated)
    this.midBandGate.connect(this.unisonWidthDry);
    this.unisonWidthDry.connect(this.unisonWidthSum);
    this.unisonSpreadL.connect(this.unisonWidthMerger, 0, 0);
    this.unisonSpreadR.connect(this.unisonWidthMerger, 0, 1);
    this.unisonWidthMerger.connect(this.unisonWidthWet);
    this.unisonWidthWet.connect(this.unisonWidthSum);

    // Shaper 3: Stereo Haas / Chorus Dimension Expander (> Xover Only, dynamically gated)
    this.unisonWidthSum.connect(this.haasDry);
    this.haasDry.connect(this.haasStageSum);
    this.haasIn.connect(this.haasDelayL);
    this.haasIn.connect(this.haasDelayR);
    this.haasDelayL.connect(this.haasMerger, 0, 0);
    this.haasDelayR.connect(this.haasMerger, 0, 1);
    this.haasMerger.connect(this.haasStereoGate);
    this.haasStereoGate.connect(this.haasStageSum);

    // Phase Scope Differential Stereo Phase Alignment (> Xover Only, bypassed at 0° & normal R)
    this.haasStageSum.connect(this.phaseBypassGain);
    this.phaseBypassGain.connect(this.multibandSum);

    this.phaseSplitter.connect(this.phaseApL1, 0);
    this.phaseApL1.connect(this.phaseApL2);
    this.phaseApL2.connect(this.phaseMerger, 0, 0);

    this.phaseSplitter.connect(this.phaseApR1, 1);
    this.phaseApR1.connect(this.phaseApR2);
    this.phaseApR2.connect(this.phaseRightPolarity);
    this.phaseRightPolarity.connect(this.phaseMerger, 0, 1);

    // Shaper 4: Post-Recombination Native 3-Band Upward/Downward Multiband OTT (dynamically gated)
    this.multibandSum.connect(this.ottDry);
    this.ottDry.connect(this.ottSum);

    this.ottIn.connect(this.ottLpFilter);
    this.ottLpFilter.connect(this.ottPreLow);
    this.ottPreLow.connect(this.ottCompLow);
    this.ottCompLow.connect(this.ottMakeupLow);
    this.ottMakeupLow.connect(this.ottWet);

    this.ottIn.connect(this.ottBpFilter);
    this.ottBpFilter.connect(this.ottPreMid);
    this.ottPreMid.connect(this.ottCompMid);
    this.ottCompMid.connect(this.ottMakeupMid);
    this.ottMakeupMid.connect(this.ottWet);

    this.ottIn.connect(this.ottHpFilter);
    this.ottHpFilter.connect(this.ottPreHigh);
    this.ottPreHigh.connect(this.ottCompHigh);
    this.ottCompHigh.connect(this.ottMakeupHigh);
    this.ottMakeupHigh.connect(this.ottWet);

    this.ottWet.connect(this.ottSum);

    // Native 3-Band Tone EQ + Band-Limited Stereo Air-Stabiliser (STABILISE) + Compensated Glue Compressor
    this.ottSum.connect(this.eqLow);
    this.eqLow.connect(this.eqMid);
    this.eqMid.connect(this.eqHigh);

    this.eqHigh.connect(this.spaceDry);
    this.spaceDry.connect(this.wetBranch);

    this.spaceIn.connect(this.spaceHpFilter);
    this.spaceHpFilter.connect(this.spaceLpFilter);
    this.spaceLpFilter.connect(this.spaceDelayL);
    this.spaceLpFilter.connect(this.spaceDelayR);
    this.spaceDelayL.connect(this.spaceApL);
    this.spaceDelayR.connect(this.spaceApR);
    this.spaceApL.connect(this.spaceMerger, 0, 0);
    this.spaceApR.connect(this.spaceMerger, 0, 1);
    this.spaceApL.connect(this.spaceFbR);
    this.spaceFbR.connect(this.spaceDelayR);
    this.spaceApR.connect(this.spaceFbL);
    this.spaceFbL.connect(this.spaceDelayL);
    this.spaceMerger.connect(this.spaceWet);
    this.spaceWet.connect(this.wetBranch);

    this.wetBranch.connect(this.compressor);
    this.compressor.connect(this.compressorMakeup);

    // Shaper 6: Turntable Vinyl Scratch & Motorized Tape-Stop Brake (bypassed when inactive!)
    this.compressorMakeup.connect(this.vinylBypassGain);
    this.vinylBypassGain.connect(this.vinylOutSum);

    this.vinylSplitter.connect(this.vinylDelayL, 0);
    this.vinylSplitter.connect(this.vinylDelayR, 1);
    this.vinylDelayL.connect(this.vinylMerger, 0, 0);
    this.vinylDelayR.connect(this.vinylMerger, 0, 1);
    this.vinylMerger.connect(this.vinylLpFilter);
    this.vinylLpFilter.connect(this.vinylDuckGain);

    // Modular Master FX Patchbay -> Stereo vs Mono-Sum Check -> Output Gain -> Safety Limiter
    this.vinylOutSum.connect(this.fxChainIn);
    this.fxChainIn.connect(this.fxChainOut);
    this.fxChainOut.connect(this.masterStereoPass);
    this.masterStereoPass.connect(this.outputGain);
    this.fxChainOut.connect(this.masterMonoSum);
    this.masterMonoSum.connect(this.outputGain);

    this.outputGain.connect(this.safetyLimiter);
    this.safetyLimiter.connect(rawCtx.destination);

    // Analysers (Zero-allocation native Web Audio nodes)
    this.outputGain.connect(this.vuSplitter);
    this.vuSplitter.connect(this.vuAnalyserL, 0);
    this.vuSplitter.connect(this.vuAnalyserR, 1);

    this.safetyLimiter.connect(this.outAnalyser);
    this.safetyLimiter.connect(this.fftAnalyserNode);
    this.safetyLimiter.connect(this.stereoScopeSplitter);
    this.stereoScopeSplitter.connect(this.analyserL, 0);
    this.stereoScopeSplitter.connect(this.analyserR, 1);

    this.isGraphBuilt = true;
    if (this.currentParams) {
      this.syncSubgraphRouting(this.currentParams);
    }
    this.ensureGrainPlayer();
    this.startControlLoop();
  }

  private ensureGrainPlayer(): void {
    if (!this.isGraphBuilt || !this.buffer || !this.grainGate) return;
    if (this.player) {
      try {
        this.player.stop();
        this.player.dispose();
      } catch {
        // ignore
      }
    }
    this.player = new Tone.GrainPlayer(this.buffer);
    Tone.connect(this.player, this.grainGate);
    this.player.loop = true;
    if (this.currentParams) {
      this.applyPlayerGranularProps(this.currentParams);
    }
    this.player.start(Tone.now());
  }

  private startControlLoop(): void {
    if (this.trackingInterval) clearInterval(this.trackingInterval);

    // 28 ms (~36 Hz) control loop using zero-timeline-allocation smoothers
    const intervalMs = 28;
    this.trackingInterval = setInterval(() => {
      if (!this.isGraphBuilt || !this.currentParams) return;
      const p = this.currentParams;
      const nowPerfMs = performance.now();
      const isHeldOrDrone = this.activeMidiNote !== null || this.isDronePlaying;
      const isKickTailRinging = Boolean(p.kickMode) && nowPerfMs < this.kickRingUntilMs;
      const isSynthTailRinging = !p.kickMode && nowPerfMs < this.synthRingUntilMs;
      const isSounding = isHeldOrDrone || isKickTailRinging || isSynthTailRinging;

      // Motorized turntable brake recovery
      const prevBrake = this.brakeProgress;
      if (!p.bypass && p.vinylBrake && isSounding) {
        this.brakeProgress = Math.min(1, this.brakeProgress + 0.042);
      } else if (this.brakeProgress > 0) {
        this.brakeProgress = Math.max(0, this.brakeProgress - 0.085);
        if (this.brakeProgress === 0 && prevBrake > 0) {
          this.syncSubgraphRouting(p);
        }
      }

      if (!isSounding) {
        this.liveGrowlLevel *= 0.8;
        this.liveKickPump *= 0.82;
        this.liveSynthEnvPhase = 0;
        this.liveSynthEnvLevel = 0;
        this.thumpEnv = 0;
        if (this.isVinylWired) {
          setParamSmooth(this.vinylDustGain?.gain, 0, 0.5);
          setParamSmooth(this.vinylDelayL?.delayTime, 0.002, 0.4);
          setParamSmooth(this.vinylDelayR?.delayTime, 0.002, 0.4);
          setParamSmooth(this.vinylLpFilter?.frequency, 20000, 0.4, 5);
          setParamSmooth(this.vinylDuckGain?.gain, 1.0, 0.4);
        }
        if (this.isVoicesAwake) {
          this.silentElapsedMs += intervalMs;
          const releaseWaitMs = p.kickMode ? 240 : 180;
          if (this.silentElapsedMs >= releaseWaitMs && this.brakeProgress === 0) {
            this.suspendVoicesWhenSilent();
          }
        }
        return;
      }

      this.silentElapsedMs = 0;
      const nowMs = nowPerfMs;
      const nowSec = nowMs / 1000;
      const rawCtx = Tone.getContext().rawContext;
      const audioNow = rawCtx.currentTime;

      const targetMidi =
        (this.activeMidiNote !== null ? this.activeMidiNote : this.lastPlayedMidi) +
        p.basePitchSemitones;

      const targetHz = midiToFreq(targetMidi);
      const glideCoef = p.glideMs <= 5 ? 1 : clamp(intervalMs / Math.max(8, p.glideMs), 0.08, 1);
      this.currentFreqHz += (targetHz - this.currentFreqHz) * glideCoef;

      // Sample-Accurate 4/4 BPM Kick Stomper Scheduler (85ms Lookahead -> Zero Jitter, Identical Beats)
      if (p.kickMode && (p.kickPower ?? true)) {
        const bpm = clamp(p.kickBpm ?? 150, 115, 240);
        const beatSec = 60 / bpm;

        if (isHeldOrDrone && p.kickLoop) {
          if (this.nextKickHitTime <= audioNow - 0.12) {
            this.nextKickHitTime = audioNow + 0.008;
          }
          while (this.nextKickHitTime <= audioNow + 0.085) {
            const kickRootHz = this.computeKickRootHz(targetMidi);
            this.triggerKickHit(this.nextKickHitTime, kickRootHz, p);
            this.nextKickHitTime += beatSec;
          }
        }

        // Sync JunoScratch playhead phase & Kick ADSR phase to active beat or 1-Shot ADSR cycle
        const elapsedSinceHit = Math.max(0, audioNow - this.lastKickHitAudioTime);
        const atkSec = clamp((p.kickAttackMs ?? 1.8) / 1000, 0.0005, 0.065);
        const decSec = clamp((p.kickDecayMs ?? 240) / 1000, 0.04, 1.2);
        const susNorm = clamp((p.kickSustain ?? 68) / 100, 0, 1);
        const relSec = clamp((p.kickReleaseMs ?? 220) / 1000, 0.025, 1.2);
        const adsrTotalSec = p.kickLoop
          ? beatSec
          : Math.max(0.14, atkSec + decSec * 0.65 + susNorm * 0.22 + relSec * 0.85);

        this.liveKickEnvPhase = p.kickLoop
          ? (elapsedSinceHit / beatSec) % 1
          : clamp(elapsedSinceHit / adsrTotalSec, 0, 1);

        const cycleSec = p.kickLoop
          ? beatSec / Math.max(0.25, clamp(p.curveSpeed ?? 1.0, 0.25, 20.0))
          : adsrTotalSec;
        this.envPhase = p.kickLoop
          ? (elapsedSinceHit / cycleSec) % 1
          : clamp(elapsedSinceHit / cycleSec, 0, 1);

        // Live Sidechain Rumble Pump Meter (ducks at beat start, swells into off-beat!)
        const beatFrac = clamp(elapsedSinceHit / beatSec, 0, 1);
        const duckAmt = clamp((p.kickDuck ?? 75) / 100, 0, 1);
        const pumpShape = p.kickRumblePower
          ? clamp(1 - duckAmt * Math.exp(-beatFrac * 5.2), 0.08, 1) *
            clamp((p.kickRumbleAmt ?? 0) / 100, 0.12, 1)
          : clamp(Math.exp(-beatFrac * 4.5), 0.1, 0.95);
        this.liveKickPump = this.liveKickPump * 0.45 + pumpShape * 0.55;
      } else {
        // Sonic Shaper 7: Sub-Harmonic Transient Pitch Spike Decay ("Sub Thump")
        if (this.thumpEnv > 0.001) {
          const decayCoef =
            p.thumpMode === 'FAST' ? 0.32 : p.thumpMode === '808' ? 0.74 : 0.54;
          this.thumpEnv *= decayCoef;
          if (this.thumpEnv < 0.002) this.thumpEnv = 0;
        }

        // Track 4-Stage Synth ADSR Playhead Phase & Normalized Filter/Drive Contour Level
        const atkSec = clamp((p.attackMs ?? 12) / 1000, 0.005, 0.6);
        const decSec = clamp((p.decayMs ?? 320) / 1000, 0.04, 1.5);
        const susNorm = clamp((p.sustain ?? 82) / 100, 0, 1);
        const relSec = clamp((p.releaseMs ?? 150) / 1000, 0.04, 1.5);

        if (this.synthIsGateOpen) {
          const elapsedOn = Math.max(0, audioNow - this.synthNoteOnAudioTime);
          if (elapsedOn < atkSec) {
            const u = clamp(elapsedOn / atkSec, 0, 1);
            this.liveSynthEnvPhase = u * 0.19;
            this.liveSynthEnvLevel = 1 - Math.pow(1 - u, 1.75);
          } else if (elapsedOn < atkSec + decSec) {
            const u = clamp((elapsedOn - atkSec) / decSec, 0, 1);
            this.liveSynthEnvPhase = 0.19 + u * (0.524 - 0.19);
            const expDrop = (Math.exp(-u * 3.0) - Math.exp(-3.0)) / (1 - Math.exp(-3.0));
            this.liveSynthEnvLevel = susNorm + (1 - susNorm) * expDrop;
          } else {
            this.liveSynthEnvPhase = 0.595;
            this.liveSynthEnvLevel = susNorm;
          }
        } else {
          const elapsedOff = Math.max(0, audioNow - this.synthNoteOffAudioTime);
          const u = clamp(elapsedOff / relSec, 0, 1);
          this.liveSynthEnvPhase = 0.667 + u * (1.0 - 0.667);
          const expRel = (Math.exp(-u * 3.2) - Math.exp(-3.2)) / (1 - Math.exp(-3.2));
          this.liveSynthEnvLevel = susNorm * expRel;
        }

        const duration = Math.max(0.2, this.buffer?.duration || 4.0);
        if (!p.grainFreeze) {
          const curveRate = clamp(p.curveSpeed ?? 1.0, 0.25, 20.0);
          const rateScale = p.grainPower ? this.liveSpeedMultiplier : 1.0;
          const step = ((intervalMs / 1000) * curveRate * Math.max(0.18, rateScale)) / duration;
          if (p.curveMode === 'oneshot') {
            this.envPhase = Math.min(1, this.envPhase + step);
          } else {
            this.envPhase = (this.envPhase + step) % 1;
          }
        }
      }

      const effectivePhase = p.grainReverse ? (1 - this.envPhase + 1) % 1 : this.envPhase;

      const speedEnvY = this.interpolateSmooth(this.currentSpeedEnv.points, effectivePhase);
      const growlPitchEnvY = this.interpolateSmooth(this.currentPitchEnv.points, effectivePhase);

      // Kick Dedicated LFO Modulator (SINE / TRI / SAW / SQR -> HUNT / FM / PITCH / AMP)
      let kickLfoVal = 0;
      const kickLfoRate = clamp(p.kickLfoRateHz ?? 4.0, 0.2, 24.0);
      if (p.kickMode) {
        this.kickLfoPhase = (this.kickLfoPhase + (intervalMs / 1000) * kickLfoRate) % 1;
        const lp = this.kickLfoPhase;
        const lfoShape: KickLfoShape = p.kickLfoShape ?? 'SAW';
        if (lfoShape === 'SINE') {
          kickLfoVal = Math.sin(lp * Math.PI * 2);
        } else if (lfoShape === 'TRI') {
          kickLfoVal = lp < 0.5 ? 1 - 4 * lp : -1 + 4 * (lp - 0.5);
        } else if (lfoShape === 'SAW') {
          kickLfoVal = 1 - 2 * lp;
        } else {
          kickLfoVal = Math.tanh(Math.sin(lp * Math.PI * 2) * 9);
        }
      }

      // Synth Dedicated LFO Modulator (SINE / TRI / SAW / SQR -> GROWL / VOWEL / FILTER / PITCH / AMP)
      let synthLfoVal = 0;
      const synthLfoRate = clamp(p.synthLfoRateHz ?? 2.8, 0.1, 24.0);
      if (!p.kickMode) {
        this.synthLfoPhase = (this.synthLfoPhase + (intervalMs / 1000) * synthLfoRate) % 1;
        const sp = this.synthLfoPhase;
        const sShape: KickLfoShape = p.synthLfoShape ?? 'SINE';
        if (sShape === 'SINE') {
          synthLfoVal = Math.sin(sp * Math.PI * 2);
        } else if (sShape === 'TRI') {
          synthLfoVal = sp < 0.5 ? 1 - 4 * sp : -1 + 4 * (sp - 0.5);
        } else if (sShape === 'SAW') {
          synthLfoVal = 1 - 2 * sp;
        } else {
          synthLfoVal = Math.tanh(Math.sin(sp * Math.PI * 2) * 9);
        }
      }

      const synthLfoTarget: SynthLfoTarget = p.synthLfoTarget ?? 'GROWL';
      const synthLfoDepthNorm =
        !p.kickMode && p.synthLfoPower && !p.bypass
          ? clamp((p.synthLfoDepth ?? 0) / 100, 0, 1)
          : 0;

      if (this.synthLfoAmpGain) {
        const synthAmpTarget =
          synthLfoDepthNorm > 0.005 && synthLfoTarget === 'AMP'
            ? clamp(1 - ((1 - synthLfoVal) * 0.5) * synthLfoDepthNorm * 0.94, 0.04, 1.0)
            : 1.0;
        setParamSmooth(this.synthLfoAmpGain.gain, synthAmpTarget, 0.55, 0.005);
      }

      const kickLfoTarget: KickLfoTarget = p.kickLfoTarget ?? 'HUNT';
      const kickLfoDepthNorm =
        p.kickMode && p.kickLfoPower && !p.bypass
          ? clamp((p.kickLfoDepth ?? 0) / 100, 0, 1)
          : 0;

      if (
        this.kickBodyDetuneSource &&
        this.kickHarmDetuneSource &&
        this.kickLfoAmpGain
      ) {
        if (kickLfoDepthNorm > 0.005) {
          const bodyCents =
            kickLfoTarget === 'PITCH' ? kickLfoVal * kickLfoDepthNorm * 700 : 0;
          const harmCents =
            kickLfoTarget === 'PITCH'
              ? kickLfoVal * kickLfoDepthNorm * 700
              : kickLfoTarget === 'FM'
              ? kickLfoVal * kickLfoDepthNorm * 420
              : 0;
          const fmGainTarget =
            kickLfoTarget === 'FM'
              ? this.baseKickFmGain * clamp(1 + kickLfoVal * kickLfoDepthNorm * 0.9, 0.06, 2.3)
              : this.baseKickFmGain;
          const ampGateTarget =
            kickLfoTarget === 'AMP'
              ? clamp(1 - ((1 - kickLfoVal) * 0.5) * kickLfoDepthNorm * 0.94, 0.04, 1.0)
              : 1.0;

          setParamSmooth(this.kickBodyDetuneSource.offset, bodyCents, 0.55, 0.5);
          setParamSmooth(this.kickHarmDetuneSource.offset, harmCents, 0.55, 0.5);
          for (const v of this.activeKickVoices) {
            if (v.fmGain) {
              setParamSmooth(v.fmGain.gain, fmGainTarget, 0.5, 0.2);
            }
          }
          setParamSmooth(this.kickLfoAmpGain.gain, ampGateTarget, 0.55, 0.005);
        } else {
          setParamSmooth(this.kickBodyDetuneSource.offset, 0, 0.5, 0.5);
          setParamSmooth(this.kickHarmDetuneSource.offset, 0, 0.5, 0.5);
          setParamSmooth(this.kickLfoAmpGain.gain, 1.0, 0.5, 0.005);
        }
      }

      // Dynamic Pre-Distortion "Frequency Hunt" Curve + LFO Sweep (Evolving Krach / Piep / Zaag Tails!)
      if (p.kickMode && this.isKickKrachWired && this.kickPreEq) {
        const baseEqHz = clamp(p.kickEqFreqHz ?? 240, 240, 4200);
        const curveOct = p.kickEqSweep
          ? (growlPitchEnvY - 0.5) * 1.65 + (speedEnvY - 0.5) * 0.65
          : 0;
        const lfoOct =
          kickLfoDepthNorm > 0.005 && kickLfoTarget === 'HUNT'
            ? kickLfoVal * kickLfoDepthNorm * 1.45
            : 0;
        if (p.kickEqSweep || lfoOct !== 0) {
          const sweptHz = clamp(baseEqHz * Math.pow(2, curveOct + lfoOct), 200, 5200);
          setParamSmooth(this.kickPreEq.frequency, sweptHz, 0.52, 1.5);
          this.liveKickEqHz = sweptHz;
        } else {
          setParamSmooth(this.kickPreEq.frequency, baseEqHz, 0.5, 1.5);
          this.liveKickEqHz = baseEqHz;
        }
      } else {
        this.liveKickEqHz = clamp(p.kickEqFreqHz ?? 240, 240, 4200);
      }

      // Strictly isolate Synth-only Growl & Wobble LFOs when Kick Mode is active!
      const isWobbling = !p.kickMode && Boolean(p.fmPower) && p.fmWobbleRate > 0.005;
      const lfoPhase = isWobbling ? (nowSec * p.fmWobbleRate) % 1 : 0;
      const rawSine = isWobbling ? Math.sin(lfoPhase * Math.PI * 2) : 0;
      const wobbleContour = isWobbling ? Math.pow((rawSine + 1) * 0.5, 1.35) : 0.35;

      const growlMacro = !p.kickMode && p.fmPower ? clamp(p.fmGrowl / 100, 0, 1) : 0;
      const crushNorm = clamp((p.fmCrush ?? 0) / 100, 0, 1);
      const metalNorm = clamp((p.fmMetal ?? 0) / 100, 0, 1);
      const fmMetalToneNorm = !p.kickMode ? clamp((p.fmMetalAmt ?? 0) / 100, 0, 1) : 0;
      const inflectNorm = clamp((p.fmInflect ?? 65) / 100, 0, 1);

      // Synth ADSR Filter/Timbre Contour + Synth LFO Growl Modulation
      const susRef = clamp((p.sustain ?? 82) / 100, 0, 1);
      const synthEnvTimbreDelta =
        !p.kickMode && (p.synthAdsrFilterMod ?? true)
          ? clamp((this.liveSynthEnvLevel - susRef * 0.65) * 0.52, -0.28, 0.45)
          : 0;
      const synthLfoGrowlMod =
        synthLfoDepthNorm > 0.005 && synthLfoTarget === 'GROWL'
          ? synthLfoVal * synthLfoDepthNorm * 0.52
          : 0;

      const envBoost = clamp((growlPitchEnvY - 0.25) * 1.18, 0, 1);
      const baseDynamicGrowl =
        growlMacro * (0.36 + wobbleContour * 0.64) * (0.58 + envBoost * 0.62);
      const dynamicGrowl = clamp(
        baseDynamicGrowl +
          synthLfoGrowlMod +
          (growlMacro > 0.02 || synthLfoGrowlMod > 0 ? synthEnvTimbreDelta * 0.45 : 0),
        0,
        1
      );
      this.liveGrowlLevel = dynamicGrowl;

      const thumpAmtNorm =
        !p.bypass && p.thumpPower ? clamp((p.thumpAmount ?? 0) / 100, 0, 1) : 0;
      const thumpPitchSt = this.thumpEnv * thumpAmtNorm * 28;
      const synthLfoPitchSt =
        synthLfoDepthNorm > 0.005 && synthLfoTarget === 'PITCH'
          ? synthLfoVal * synthLfoDepthNorm * 7.0
          : 0;

      const growlPitchInflectSt =
        p.fmPower && growlMacro > 0.01 && inflectNorm > 0.01
          ? (isWobbling ? wobbleContour - 0.32 : (growlPitchEnvY - 0.5) * 0.9) *
            growlMacro *
            inflectNorm *
            2.2
          : 0;
      const envPitchSt =
        (growlPitchEnvY - 0.5) * 4 +
        growlPitchInflectSt +
        this.pitchBendSemitones +
        thumpPitchSt +
        synthLfoPitchSt;
      const envPitchBendRatio = Math.pow(2, envPitchSt / 12);
      const carrierHz = clamp(this.currentFreqHz * envPitchBendRatio, 18, 5000);

      // 0. Update OSC Panel Synthesizer Voices (only active sub-oscillators)
      if (p.oscPower && this.oscPrimary && this.oscPulse && this.oscSync && this.oscSecondary) {
        const shapeNorm = clamp(p.oscShape / 100, 0, 1);

        if (this.isPrimaryWaveWired || this.isRingModWired) {
          setParamSmooth(this.oscPrimary.frequency, carrierHz, 0.55, 0.05);
        }
        if (this.isPulseWaveWired || this.isRingModWired) {
          setParamSmooth(this.oscPulse.frequency, carrierHz, 0.55, 0.05);
          const pwmMod = p.fmPower || p.fmGrowl > 0 ? rawSine * 0.12 : 0;
          const pwmWidth = clamp(0.08 + shapeNorm * 0.76 + pwmMod, 0.05, 0.92);
          setParamSmooth(this.oscPulse.width, pwmWidth, 0.45, 0.002);
        }
        if (this.isSyncWaveWired) {
          setParamSmooth(this.oscSync.frequency, carrierHz, 0.55, 0.05);
          if (p.oscWave === 'METAL') {
            // Inharmonic Riddim Metal Oscillator: √2..7.36x square-modulated FM clang
            const inharmRatio = 1.414 + shapeNorm * 5.95 + dynamicGrowl * 1.65;
            const metalOscIdx = 3.6 + shapeNorm * 18.5 + dynamicGrowl * 8.0;
            setParamSmooth(this.oscSync.harmonicity, inharmRatio, 0.48, 0.01);
            setParamSmooth(this.oscSync.modulationIndex, metalOscIdx, 0.48, 0.03);
          } else {
            const syncHarm = 1.0 + shapeNorm * 3.4 + dynamicGrowl * 1.8;
            setParamSmooth(this.oscSync.harmonicity, syncHarm, 0.45, 0.01);
            setParamSmooth(this.oscSync.modulationIndex, 1.4 + shapeNorm * 5.2, 0.45, 0.02);
          }
        }
        if (this.isSecondaryWaveWired) {
          const osc2Hz = clamp(carrierHz * Math.pow(2, p.oscInterval / 12), 16, 8000);
          setParamSmooth(
            this.oscSecondary.frequency,
            osc2Hz * (1 + (p.oscDetune / 100) * 0.012),
            0.55,
            0.05
          );
        }
      }

      // 1. Update Dual-Operator FM Growl Synth Bank (Organic Low-Bessel Voicing) + Sub Thump Knock
      if (
        this.fmCarrier &&
        this.fmMetallicOsc &&
        this.fmMetallicGain &&
        this.unisonOsc &&
        this.subOsc &&
        this.unisonGain &&
        this.subGain
      ) {
        if (p.fmPower) {
          setParamSmooth(this.fmCarrier.frequency, carrierHz, 0.55, 0.05);
          setParamSmooth(this.fmCarrier.harmonicity, p.fmRatio, 0.5, 0.01);

          // Continuous Organic -> Riddim Metallic Bessel FM Scaling:
          // At fmMetalAmt = 0% (default), stays warm & weighty (3.0..7.2); dialing up fmMetalAmt unleashes 22..48x Riddim sidebands!
          const organicScale =
            p.toneMode === 'TEAROUT'
              ? 7.2
              : p.toneMode === 'SCREAM'
              ? 6.4
              : p.toneMode === 'ROAR'
              ? 5.4
              : p.toneMode === 'YOI'
              ? 4.8
              : p.toneMode === 'CLIP'
              ? 4.0
              : 3.0;
          const riddimScale =
            p.toneMode === 'TEAROUT'
              ? 44.0
              : p.toneMode === 'SCREAM'
              ? 48.0
              : p.toneMode === 'ROAR'
              ? 34.0
              : p.toneMode === 'YOI'
              ? 32.0
              : p.toneMode === 'CLIP'
              ? 36.0
              : 22.0;
          const modeIndexScale =
            organicScale + Math.pow(fmMetalToneNorm, 1.15) * (riddimScale - organicScale);
          const targetModIndex =
            0.35 + fmMetalToneNorm * 2.2 + Math.pow(dynamicGrowl, 1.1) * modeIndexScale;
          this.liveFmIndex = targetModIndex;
          setParamSmooth(this.fmCarrier.modulationIndex, targetModIndex, 0.5, 0.03);

          // Secondary metallic operator wakes when FM Metal Bite > 1% OR Throat Comb + Metal > 1% is active!
          if (this.isFmMetallicWired) {
            setParamSmooth(this.fmMetallicOsc.frequency, carrierHz, 0.55, 0.05);
            const effMetalOp = clamp(
              Math.max(fmMetalToneNorm, p.combPower ? metalNorm * 0.45 : 0),
              0,
              1
            );
            const metalHarmRatio = clamp(
              p.fmRatio * (1.5 + fmMetalToneNorm * 1.85) + fmMetalToneNorm * 0.41,
              1.5,
              9.5
            );
            setParamSmooth(this.fmMetallicOsc.harmonicity, metalHarmRatio, 0.5, 0.02);
            const metalModIdx =
              0.8 +
              (0.25 + dynamicGrowl * 0.75) * effMetalOp * (6.2 + fmMetalToneNorm * 22.0);
            setParamSmooth(this.fmMetallicOsc.modulationIndex, metalModIdx, 0.45, 0.04);
            const metalVoiceLevel = clamp(
              effMetalOp * (0.09 + dynamicGrowl * 0.16 + fmMetalToneNorm * 0.1),
              0,
              0.34
            );
            setParamSmooth(this.fmMetallicGain.gain, metalVoiceLevel, 0.45);
          }

          if (this.isFmUnisonWired) {
            setParamSmooth(this.unisonOsc.frequency, carrierHz, 0.55, 0.05);
            setParamSmooth(this.unisonGain.gain, 0.38, 0.45);
          } else {
            setParamSmooth(this.unisonGain.gain, 0, 0.45);
          }
        } else {
          this.liveFmIndex = 0;
        }

        // Direct -1 Octave Pure Sub Sine + Sub Thump chest transient spike
        const subTotalSt = this.pitchBendSemitones + thumpPitchSt + synthLfoPitchSt;
        const subBendRatio = Math.pow(2, subTotalSt / 12);
        const cleanSubHz = clamp(this.currentFreqHz * 0.5 * subBendRatio, 18, 650);
        setParamSmooth(this.subOsc.frequency, cleanSubHz, 0.65, 0.05);

        const subActive =
          (p.fmSubOctave || (p.thumpPower && this.thumpEnv > 0.02)) &&
          (p.fmPower || p.oscPower);
        const baseSubGain = p.fmSubOctave ? 0.72 : 0;
        const thumpSubBoost = this.thumpEnv * thumpAmtNorm * 0.52;
        setParamSmooth(
          this.subGain.gain,
          subActive ? clamp(baseSubGain + thumpSubBoost, 0, 1.08) : 0,
          0.55
        );
      }

      // Momentary low-band chest punch lift on note transient
      if (this.lowBandGain) {
        const subNorm = clamp((p.subPunch ?? 50) / 100, 0, 1);
        const subGainLinear =
          subNorm <= 0.5 ? 0.38 + (subNorm / 0.5) * 0.66 : 1.04 + ((subNorm - 0.5) / 0.5) * 0.56;
        const transientChest = 1 + this.thumpEnv * thumpAmtNorm * 0.48;
        setParamSmooth(this.lowBandGain.gain, subGainLinear * transientChest, 0.5);
      }

      // 2. Update Dedicated Mid/High (> Xover) Organic Growl Signal-Processing Pipeline
      const lfoFilterActive = synthLfoDepthNorm > 0.005 && synthLfoTarget === 'FILTER';
      const lfoVowelActive = synthLfoDepthNorm > 0.005 && synthLfoTarget === 'VOWEL';
      const lfoGrowlActive = synthLfoDepthNorm > 0.005 && synthLfoTarget === 'GROWL';

      if (
        this.wahFilter &&
        this.combDelay &&
        this.combDamping &&
        this.combFeedback &&
        this.combWet &&
        this.formant1 &&
        this.formant2 &&
        this.notchFilter &&
        this.crushDry &&
        this.crushWet
      ) {
        // Stage A: Broad Analog Wah Filter (warm chest-to-throat sweep, zero piercing whistle)
        const wahAmtNorm = clamp(p.wahAmount / 100, 0, 1);
        const wahModTriggered =
          (p.wahPower && (wahAmtNorm > 0.005 || dynamicGrowl > 0.01)) || lfoFilterActive;
        if (!p.bypass && wahModTriggered) {
          const morphSpan = clamp(p.wahMorph / 100, 0, 1);
          const baseHz = clamp(p.wahBaseHz || 230, 145, 850);
          const lfoSweepDelta = lfoFilterActive
            ? synthLfoVal * synthLfoDepthNorm * 0.46
            : lfoGrowlActive
            ? synthLfoVal * synthLfoDepthNorm * 0.32
            : 0;
          const wahSweep = clamp(
            0.12 +
              wobbleContour * morphSpan * (0.36 + dynamicGrowl * 0.58) +
              (growlPitchEnvY - 0.5) * 0.34 * morphSpan +
              synthEnvTimbreDelta * 0.35 +
              lfoSweepDelta,
            0,
            1
          );
          const maxHz = Math.max(baseHz + 260, 2150);
          const wahHz = baseHz * Math.pow(maxHz / baseHz, wahSweep);
          const wahGainDb = p.wahPower
            ? wahAmtNorm * 6.8 + dynamicGrowl * 3.8
            : synthLfoDepthNorm * 5.5;
          const wahQ =
            1.15 + clamp(p.wahResonance / 100, 0, 1) * (3.1 + fmMetalToneNorm * 6.4);
          setParamSmooth(this.wahFilter.frequency, wahHz, 0.48, 0.5);
          setParamSmooth(this.wahFilter.Q, wahQ, 0.45, 0.02);
          setParamSmooth(this.wahFilter.gain, wahGainDb, 0.45, 0.05);
          this.liveWahHz = wahHz;
        } else {
          setParamSmooth(this.wahFilter.gain, 0, 0.45, 0.02);
          this.liveWahHz = clamp(p.wahBaseHz || 230, 145, 850);
        }

        // Stage B: Key-Tracked Throat Comb Resonator (scales from warm damping to razor-sharp Riddim pipe)
        if (this.isCombWired) {
          const harmMult = clamp(p.combHarmonic || 4.0, 1.0, 8.0);
          const combTargetHz = p.combKeyTrack
            ? clamp(carrierHz * harmMult * (0.9 + wobbleContour * 0.22), 125, 780)
            : clamp(65.41 * harmMult * (0.92 + wobbleContour * 0.18), 125, 780);
          const combDelaySec = clamp(1 / combTargetHz, 0.00125, 0.008);
          const fbNorm = clamp((p.combFeedbackAmt ?? 55) / 100, 0, 1);
          const dampNorm = clamp((p.combDamp ?? 60) / 100, 0, 1);
          const combBrightDrive = Math.max(metalNorm * 0.55, fmMetalToneNorm);
          const dampHz = 850 + dampNorm * (4800 + combBrightDrive * 5550);
          const combFb = 0.08 + fbNorm * (0.42 + Math.max(metalNorm, fmMetalToneNorm) * 0.24);
          const effWet = clamp(
            metalNorm * (0.34 + dynamicGrowl * 0.14 + fmMetalToneNorm * 0.12),
            0,
            0.56
          );

          setParamSmooth(this.combDelay.delayTime, combDelaySec, 0.45, 0.00002);
          setParamSmooth(this.combDamping.frequency, dampHz, 0.45, 2);
          setParamSmooth(this.combFeedback.gain, combFb, 0.45);
          setParamSmooth(this.combWet.gain, effWet, 0.45);
          this.liveCombMs = combDelaySec * 1000;
        }

        // Stage C: Warm Vocal Formant Tract (U-O-A-E-I) + Counter-Swept Neuro Notch
        const talkNorm = clamp((p.formantTalk ?? 0) / 100, 0, 1);
        const formantTriggered =
          (p.formantPower && (talkNorm > 0.005 || dynamicGrowl > 0.01)) || lfoVowelActive;
        if (!p.bypass && formantTriggered) {
          const baseVowel = clamp(p.fmVowel / 100, 0, 1);
          const effTalkSpan = clamp(
            Math.max(talkNorm, lfoVowelActive ? synthLfoDepthNorm : 0) + dynamicGrowl * 0.58,
            0,
            1
          );
          const lfoVowelDelta = lfoVowelActive
            ? synthLfoVal * synthLfoDepthNorm * 0.48
            : lfoGrowlActive
            ? synthLfoVal * synthLfoDepthNorm * 0.26
            : 0;
          const sweptVowel = clamp(
            baseVowel +
              (wobbleContour - 0.35) * (0.24 + dynamicGrowl * 0.56) * effTalkSpan +
              (growlPitchEnvY - 0.5) * 0.32 * effTalkSpan +
              synthEnvTimbreDelta * 0.24 +
              lfoVowelDelta,
            0,
            1
          );
          const [f1, f2] = interpolateFormants(sweptVowel);
          this.liveF1Hz = f1;
          this.liveF2Hz = f2;

          const baseTalkGain = p.formantPower
            ? talkNorm * 6.4 + dynamicGrowl * 4.0
            : synthLfoDepthNorm * 7.2;
          const formantGainDb =
            baseTalkGain * (p.toneMode === 'YOI' ? 1.15 : p.toneMode === 'ROAR' ? 1.06 : 1.0);
          setParamSmooth(this.formant1.frequency, f1, 0.48, 0.5);
          setParamSmooth(this.formant2.frequency, f2, 0.48, 0.5);
          setParamSmooth(this.formant1.gain, formantGainDb, 0.45, 0.05);
          setParamSmooth(this.formant2.gain, formantGainDb * 0.84, 0.45, 0.05);

          if (p.notchEnable && p.notchDepth > 0 && (talkNorm > 0.01 || dynamicGrowl > 0.02)) {
            if (this.notchFilter.type !== 'notch') {
              this.notchFilter.type = 'notch';
            }
            const notchNorm = clamp(p.notchDepth / 100, 0, 1);
            const notchHz = clamp(
              240 + (1 - wobbleContour) * 1650 * (0.35 + notchNorm * 0.65),
              175,
              3200
            );
            setParamSmooth(this.notchFilter.frequency, notchHz, 0.45, 0.5);
            setParamSmooth(this.notchFilter.Q, 1.6 + notchNorm * 4.8, 0.45, 0.02);
          } else {
            if (this.notchFilter.type !== 'peaking') {
              this.notchFilter.type = 'peaking';
            }
            setParamSmooth(this.notchFilter.gain, 0, 0.45, 0.02);
          }
        } else {
          const [f1, f2] = interpolateFormants(clamp(p.fmVowel / 100, 0, 1));
          this.liveF1Hz = f1;
          this.liveF2Hz = f2;
          setParamSmooth(this.formant1.gain, 0, 0.45, 0.02);
          setParamSmooth(this.formant2.gain, 0, 0.45, 0.02);
          if (this.notchFilter.type !== 'peaking') {
            this.notchFilter.type = 'peaking';
          }
          setParamSmooth(this.notchFilter.gain, 0, 0.45, 0.02);
        }

        // Stage D: 2x-Oversampled Mid-Band Staircase Bitcrusher (> Xover only, strictly user-controlled)
        if (this.isCrushWired) {
          const effCrush = clamp(crushNorm * (0.78 + dynamicGrowl * 0.22), 0, 1);
          const tier = Math.round(effCrush * 10);
          this.setCrushTier(tier);
          setParamSmooth(this.crushDry.gain, 1 - effCrush * 0.72, 0.45);
          setParamSmooth(this.crushWet.gain, effCrush * 0.84, 0.45);
          this.liveCrushBits = Number((16 - effCrush * 12.0).toFixed(1));
        } else {
          this.setCrushTier(0);
          this.liveCrushBits = 16;
        }
      }

      // Dynamic Chest Warmth + Post-Distortion Analog Cabinet LPF (Warm organic default; opens up with Metal Osc / FM Metal!)
      if (this.bodyWarmthFilter && this.postToneCabinetLp) {
        const metalBrightNorm = Math.max(
          fmMetalToneNorm,
          p.oscPower && p.oscWave === 'METAL' ? 0.65 : 0
        );
        const chestGainDb = !p.bypass
          ? (1.6 + dynamicGrowl * 2.6 + (p.tonePower ? (p.toneDrive / 100) * 1.1 : 0)) *
            (1 - metalBrightNorm * 0.32)
          : 0;
        setParamSmooth(this.bodyWarmthFilter.gain, chestGainDb, 0.45, 0.04);

        const modeCabBaseHz =
          p.toneMode === 'TUBE'
            ? 5400
            : p.toneMode === 'ROAR'
            ? 6400
            : p.toneMode === 'YOI'
            ? 7000
            : p.toneMode === 'CLIP'
            ? 7800
            : p.toneMode === 'TEAROUT'
            ? 8400
            : 9400;
        const metalOpenedCabHz =
          modeCabBaseHz * Math.pow(18200 / modeCabBaseHz, metalBrightNorm * 0.86);
        const baseCabHz = p.tonePower ? metalOpenedCabHz : 13500 + metalBrightNorm * 4500;
        const envCabOct = synthEnvTimbreDelta * 1.25 + (dynamicGrowl - 0.35) * 0.45;
        const lfoCabOct = lfoFilterActive
          ? synthLfoVal * synthLfoDepthNorm * 2.15
          : lfoGrowlActive
          ? synthLfoVal * synthLfoDepthNorm * 0.85
          : 0;
        const maxCabCeil = 16500 + metalBrightNorm * 2500;
        const targetCabHz = p.bypass
          ? 18500
          : clamp(baseCabHz * Math.pow(2, envCabOct + lfoCabOct), 360, maxCabCeil);
        const targetCabQ = lfoFilterActive ? 1.15 + synthLfoDepthNorm * 1.85 : 0.82;
        setParamSmooth(this.postToneCabinetLp.frequency, targetCabHz, 0.5, 2.0);
        setParamSmooth(this.postToneCabinetLp.Q, targetCabQ, 0.45, 0.02);
      }

      // =======================================================================
      // 2B. Update Sonic Shapers (only active/wired shapers run DSP math!)
      // =======================================================================

      // Shaper 1: 8-Stage High-Q All-Pass Phase Disperser
      const basePinchHz = clamp(p.disperserFreqHz ?? 280, 80, 1200);
      if (this.isDisperserWired && this.disperserDry && this.disperserWet) {
        const dispAmt = clamp((p.disperserAmount ?? 0) / 100, 0, 1);
        const sweepSpan = clamp((p.disperserSweep ?? 55) / 100, 0, 1);
        const pinchRatio = Math.pow(
          2.6,
          ((wobbleContour - 0.35) * 0.8 + (growlPitchEnvY - 0.5) * 0.9) * sweepSpan
        );
        const liveDispHz = clamp(basePinchHz * pinchRatio, 75, 2600);
        const dispQ = 0.85 + clamp((p.disperserPinch ?? 60) / 100, 0, 1) * 5.2;

        const denom = Math.max(1, this.disperserStages.length - 1);
        for (let i = 0; i < this.disperserStages.length; i++) {
          const spreadHz = liveDispHz * (0.84 + (i / denom) * 0.36);
          setParamSmooth(this.disperserStages[i].frequency, spreadHz, 0.48, 0.5);
          setParamSmooth(this.disperserStages[i].Q, dispQ, 0.45, 0.02);
        }
        setParamSmooth(this.disperserDry.gain, 1 - dispAmt * 0.86, 0.45);
        setParamSmooth(this.disperserWet.gain, dispAmt * 1.02, 0.45);
        this.liveDisperserHz = liveDispHz;
      } else {
        this.liveDisperserHz = basePinchHz;
      }

      // Shaper 2: Bode Single-Sideband Shifter (with Stereo Barberpole USB/LSB Imaging)
      if (
        this.isFreqShiftWired &&
        this.freqShiftDry &&
        this.bodeWetGain &&
        this.bodeFbGain &&
        this.bodeCosOsc &&
        this.bodeSinOsc &&
        this.bodeSignL &&
        this.bodeSignR
      ) {
        const mixNorm = clamp((p.freqShiftMix ?? 0) / 100, 0, 1);
        const rawHz = clamp(p.freqShiftHz ?? 0, -400, 400);
        const effHz = p.freqShiftBarber
          ? rawHz * 0.03
          : rawHz * (1 + (growlPitchEnvY - 0.5) * 0.25);
        const absHz = clamp(Math.abs(effHz), 0.04, 800);
        const signL = effHz >= 0 ? -1 : 1;
        const signR = p.freqShiftBarber ? -signL : signL;
        const fbNorm = clamp((p.freqShiftFeedback ?? 0) / 100, 0, 1);

        setParamSmooth(this.bodeCosOsc.frequency, absHz, 0.5, 0.02);
        setParamSmooth(this.bodeSinOsc.frequency, absHz, 0.5, 0.02);
        setParamDirect(this.bodeSignL.gain, signL);
        setParamDirect(this.bodeSignR.gain, signR);
        setParamSmooth(this.freqShiftDry.gain, 1 - mixNorm * 0.72, 0.45);
        setParamSmooth(this.bodeWetGain.gain, mixNorm * 1.06, 0.45);
        setParamSmooth(this.bodeFbGain.gain, fbNorm * 0.48, 0.45);
      }

      // Shaper 5: Dual-Peak "Reese Notch" & Mirror Phaser Matrix
      if (this.reeseNotchLow && this.reeseNotchHigh && this.reesePeakLow && this.reesePeakHigh) {
        const reeseNorm = clamp((p.reeseDepth ?? 0) / 100, 0, 1);
        if (!p.bypass && p.reesePower && reeseNorm > 0.005) {
          if (this.reeseNotchLow.type !== 'notch') this.reeseNotchLow.type = 'notch';
          if (this.reeseNotchHigh.type !== 'notch') this.reeseNotchHigh.type = 'notch';

          const sweepBase = clamp((p.reeseSweep ?? 50) / 100, 0, 1);
          const mirrorPos = clamp(
            sweepBase * 0.62 + wobbleContour * 0.24 + (growlPitchEnvY - 0.5) * 0.34,
            0,
            1
          );
          const lowNotchHz = 155 * Math.pow(540 / 155, mirrorPos);
          const highNotchHz = 3100 * Math.pow(680 / 3100, mirrorPos);
          const notchQ = 1.6 + reeseNorm * 6.0;
          const peakDb = reeseNorm * 8.0;

          setParamSmooth(this.reeseNotchLow.frequency, lowNotchHz, 0.48, 0.5);
          setParamSmooth(this.reeseNotchLow.Q, notchQ, 0.45, 0.02);
          setParamSmooth(this.reeseNotchHigh.frequency, highNotchHz, 0.48, 0.5);
          setParamSmooth(this.reeseNotchHigh.Q, notchQ, 0.45, 0.02);

          setParamSmooth(this.reesePeakLow.frequency, lowNotchHz * 1.28, 0.48, 0.5);
          setParamSmooth(this.reesePeakLow.gain, peakDb, 0.45, 0.05);
          setParamSmooth(this.reesePeakHigh.frequency, highNotchHz * 0.78, 0.48, 0.5);
          setParamSmooth(this.reesePeakHigh.gain, peakDb * 0.9, 0.45, 0.05);
        } else {
          if (this.reeseNotchLow.type !== 'peaking') this.reeseNotchLow.type = 'peaking';
          if (this.reeseNotchHigh.type !== 'peaking') this.reeseNotchHigh.type = 'peaking';
          setParamSmooth(this.reeseNotchLow.gain, 0, 0.45, 0.02);
          setParamSmooth(this.reeseNotchHigh.gain, 0, 0.45, 0.02);
          setParamSmooth(this.reesePeakLow.gain, 0, 0.45, 0.02);
          setParamSmooth(this.reesePeakHigh.gain, 0, 0.45, 0.02);
        }
      }

      // Shaper 8: Open-Loop Pre-Sidechain 8-Band Spectral Gate (100% feedback-free, soft-knee smoothed!)
      if (this.isSpectralWired && this.spectralAnalyser && this.spectralDry && this.spectralWet) {
        if (nowMs - this.lastSpectralReadMs >= 32) {
          this.spectralAnalyser.getByteFrequencyData(this.spectralByteBuf);
          this.lastSpectralReadMs = nowMs;
        }

        const specMix = clamp((p.spectralMix ?? 0) / 100, 0, 1);
        const threshNorm = clamp((p.spectralThresh ?? 42) / 100, 0, 1);
        const threshVal = 0.1 + threshNorm * 0.68;
        const resoNorm = clamp((p.spectralReso ?? 58) / 100, 0, 1);
        const specQ = 2.0 + resoNorm * 6.5;

        const sr = Tone.getContext().rawContext.sampleRate || 44100;
        const binWidthHz = sr / 64;
        const maxBin = this.spectralByteBuf.length - 1;

        for (let b = 0; b < 8; b++) {
          // Interpolate exact pre-gate sidechain bin energy (open-loop: zero self-feedback!)
          const exactBin = clamp(SPECTRAL_BAND_FREQS[b] / binWidthHz, 0.2, maxBin - 1);
          const b0 = Math.floor(exactBin);
          const frac = exactBin - b0;
          const rawByte =
            this.spectralByteBuf[b0] * (1 - frac) + this.spectralByteBuf[b0 + 1] * frac;
          const sidechainEnergy = rawByte / 255;

          const bandLevel = clamp(
            sidechainEnergy * 0.84 +
              0.16 *
                Math.pow(
                  0.5 + 0.5 * Math.sin(effectivePhase * Math.PI * 2 * (1 + (b % 3)) + b * 0.8),
                  1.3
                ),
            0,
            1
          );

          // Continuous Hermite soft-knee gate (eliminates hard binary threshold clicks & chatter)
          const knee = 0.2;
          const rawGate = clamp((bandLevel - (threshVal - knee * 0.5)) / knee, 0, 1);
          const softGate = rawGate * rawGate * (3 - 2 * rawGate);

          // Per-band attack/release envelope follower
          const prevEnv = this.spectralGateEnv[b];
          const envAlpha = softGate > prevEnv ? 0.38 : 0.16;
          const nextEnv = prevEnv + (softGate - prevEnv) * envAlpha;
          this.spectralGateEnv[b] = nextEnv;

          this.liveSpectralBands[b] =
            this.liveSpectralBands[b] * 0.45 +
            clamp(0.08 + bandLevel * (0.38 + nextEnv * 0.62), 0.08, 0.96) * 0.55;

          setParamSmooth(this.spectralBandFilters[b].Q, specQ, 0.35, 0.04);
          // Headroom-compensated band gain so 8 open resonant bands never overload downstream shapers
          const bandGain = (0.03 + nextEnv * 0.97) * (0.56 + resoNorm * 0.34);
          setParamSmooth(this.spectralBandGains[b].gain, bandGain, 0.42, 0.004);
        }

        setParamSmooth(this.spectralDry.gain, 1 - specMix * 0.84, 0.42);
        setParamSmooth(this.spectralWet.gain, specMix * 0.96, 0.42);
      }

      // Shaper 6: Turntable Vinyl Scratch & Motorized Tape-Stop Physics (only when wired!)
      if (
        this.isVinylWired &&
        this.vinylDelayL &&
        this.vinylDelayR &&
        this.vinylLpFilter &&
        this.vinylDuckGain &&
        this.vinylDustGain
      ) {
        const scratchAmt =
          !p.bypass && p.scratchPower ? clamp((p.scratchAmount ?? 0) / 100, 0, 1) : 0;
        const scratchOffsetSec =
          scratchAmt > 0.005
            ? (1 - speedEnvY) * 0.036 * scratchAmt +
              (0.5 + 0.5 * Math.sin(effectivePhase * Math.PI * 4)) * 0.016 * scratchAmt
            : 0;

        const brakeQuad = this.brakeProgress * this.brakeProgress;
        const brakeDelaySec = brakeQuad * 0.72;
        const totalVinylDelay = clamp(0.002 + scratchOffsetSec + brakeDelaySec, 0.001, 1.45);

        const brakeCutoffHz =
          this.brakeProgress > 0.01
            ? clamp(20000 * Math.pow(130 / 20000, this.brakeProgress), 120, 20000)
            : 20000;
        const brakeDuck =
          this.brakeProgress > 0.86
            ? clamp(1 - (this.brakeProgress - 0.86) / 0.14, 0, 1)
            : 1.0;

        setParamSmooth(this.vinylDelayL.delayTime, totalVinylDelay, 0.48, 0.00002);
        setParamSmooth(
          this.vinylDelayR.delayTime,
          totalVinylDelay + scratchAmt * 0.0004,
          0.48,
          0.00002
        );
        setParamSmooth(this.vinylLpFilter.frequency, brakeCutoffHz, 0.45, 4);
        setParamSmooth(this.vinylDuckGain.gain, brakeDuck, 0.48);

        if (this.isVinylDustWired) {
          const dustPulse = Math.random() > 0.72 ? 1.4 : 0.35;
          const dustTarget =
            scratchAmt > 0.01 && brakeDuck > 0.1 ? scratchAmt * 0.042 * dustPulse : 0;
          setParamSmooth(this.vinylDustGain.gain, dustTarget, 0.45);
        }
      }

      // 3. Update Granular Sampler Layer (only when Grain is powered on)
      if (this.player && p.grainPower && this.buffer) {
        const envSpeedFactor =
          speedEnvY <= 0.5
            ? 0.2 + (speedEnvY / 0.5) * 0.8
            : 1.0 + ((speedEnvY - 0.5) / 0.5) * 1.8;

        const targetSpeed = p.grainFreeze ? 0.04 : p.baseSpeed * envSpeedFactor;
        this.liveSpeedMultiplier = clamp(targetSpeed, 0.05, 4.0);

        const chromaticSemitones = targetMidi - 36;
        const envSemitones = (growlPitchEnvY - 0.5) * 12 + synthLfoPitchSt + this.pitchBendSemitones;
        const totalCents = clamp((chromaticSemitones + envSemitones) * 100, -3600, 3600);

        try {
          if (Math.abs(this.player.playbackRate - this.liveSpeedMultiplier) > 0.005) {
            this.player.playbackRate = this.liveSpeedMultiplier;
          }
          if (Math.abs(this.player.detune - totalCents) > 1) {
            this.player.detune = totalCents;
          }
        } catch {
          // ignore transient grain updates
        }
      } else {
        this.liveSpeedMultiplier = 1.0;
      }
    }, intervalMs);
  }

  private applyOscPanelProps(params: SynthParams): void {
    if (
      !this.oscPrimary ||
      !this.oscSecondary ||
      !this.primaryWaveGain ||
      !this.pulseWaveGain ||
      !this.syncWaveGain ||
      !this.secondaryWaveGain ||
      !this.ringMixGain ||
      !this.noiseGain
    ) {
      return;
    }

    const detuneNorm = clamp(params.oscDetune / 100, 0, 1);
    const hasOsc2Layer = params.oscDetune > 0 || params.oscInterval !== 0;

    switch (params.oscWave) {
      case 'SAW':
        if (this.oscPrimary.type !== 'sawtooth') this.oscPrimary.type = 'sawtooth';
        this.oscPrimary.spread = detuneNorm <= 0.005 ? 0 : 6 + detuneNorm * 30;
        if (this.oscSecondary.type !== 'sawtooth') this.oscSecondary.type = 'sawtooth';
        setParamDirect(this.primaryWaveGain.gain, hasOsc2Layer ? 0.55 : 0.74);
        setParamDirect(this.pulseWaveGain.gain, 0);
        setParamDirect(this.syncWaveGain.gain, 0);
        break;
      case 'SUPER':
        if (this.oscPrimary.type !== 'sawtooth') this.oscPrimary.type = 'sawtooth';
        this.oscPrimary.spread = 18 + detuneNorm * 62;
        if (this.oscSecondary.type !== 'sawtooth') this.oscSecondary.type = 'sawtooth';
        setParamDirect(this.primaryWaveGain.gain, 0.7);
        setParamDirect(this.pulseWaveGain.gain, 0);
        setParamDirect(this.syncWaveGain.gain, 0);
        break;
      case 'PULSE':
        if (this.oscSecondary.type !== 'square') this.oscSecondary.type = 'square';
        setParamDirect(this.primaryWaveGain.gain, 0);
        setParamDirect(this.pulseWaveGain.gain, hasOsc2Layer ? 0.62 : 0.76);
        setParamDirect(this.syncWaveGain.gain, 0);
        break;
      case 'SYNC':
        if (this.oscSync) {
          if (this.oscSync.type !== 'sawtooth') this.oscSync.type = 'sawtooth';
          if (this.oscSync.modulationType !== 'sawtooth') this.oscSync.modulationType = 'sawtooth';
        }
        if (this.oscSecondary.type !== 'sawtooth') this.oscSecondary.type = 'sawtooth';
        setParamDirect(this.primaryWaveGain.gain, 0);
        setParamDirect(this.pulseWaveGain.gain, 0);
        setParamDirect(this.syncWaveGain.gain, hasOsc2Layer ? 0.68 : 0.78);
        break;
      case 'METAL':
        if (this.oscSync) {
          if (this.oscSync.type !== 'square') this.oscSync.type = 'square';
          if (this.oscSync.modulationType !== 'square') this.oscSync.modulationType = 'square';
        }
        if (this.oscSecondary.type !== 'square') this.oscSecondary.type = 'square';
        setParamDirect(this.primaryWaveGain.gain, 0);
        setParamDirect(this.pulseWaveGain.gain, 0);
        setParamDirect(this.syncWaveGain.gain, hasOsc2Layer ? 0.64 : 0.74);
        break;
      case 'TRI':
        if (this.oscPrimary.type !== 'triangle') this.oscPrimary.type = 'triangle';
        this.oscPrimary.spread = detuneNorm <= 0.005 ? 0 : 5 + detuneNorm * 24;
        if (this.oscSecondary.type !== 'triangle') this.oscSecondary.type = 'triangle';
        setParamDirect(this.primaryWaveGain.gain, hasOsc2Layer ? 0.68 : 0.82);
        setParamDirect(this.pulseWaveGain.gain, 0);
        setParamDirect(this.syncWaveGain.gain, 0);
        break;
    }

    if (params.oscRingMod) {
      setParamDirect(this.secondaryWaveGain.gain, 0.15);
      setParamDirect(this.ringMixGain.gain, 0.78);
    } else {
      setParamDirect(this.secondaryWaveGain.gain, hasOsc2Layer ? 0.34 : 0);
      setParamDirect(this.ringMixGain.gain, 0);
    }

    const noiseNorm = clamp(params.oscNoise / 100, 0, 1);
    setParamDirect(this.noiseGain.gain, noiseNorm * 0.28);
  }

  private computeKickRootHz(midiNote: number): number {
    // Fold upper octaves smoothly into club-ready kick fundamental range (32 Hz - 155 Hz)
    let m = midiNote;
    while (m > 51) m -= 12;
    while (m < 24) m += 12;
    const bendRatio = Math.pow(2, this.pitchBendSemitones / 12);
    return clamp(midiToFreq(m) * bendRatio, 28, 175);
  }

  private applyKickChainProps(p: SynthParams): void {
    if (
      !this.kickTokBpFilter ||
      !this.kickSubReinforce ||
      !this.kickDryKrachGain ||
      !this.kickWetKrachGain ||
      !this.kickPreEq ||
      !this.kickPreDrive ||
      !this.kickPostDip ||
      !this.kickPostLp ||
      !this.rumbleDelay ||
      !this.rumbleLp ||
      !this.rumbleFbGain
    ) {
      return;
    }

    const tailType: KickTailType = p.kickTailType ?? '909';
    const punchNorm = clamp((p.kickPunch ?? 78) / 100, 0, 1);
    const fmRatio = clamp(p.kickFmRatio ?? 2.0, 0.5, 8.0);
    const ratioBoost = 0.52 + fmRatio * 0.2;

    // 1. Configure Kick Sub Reinforcement & Base FM Depth per Tail Topology
    switch (tailType) {
      case '909':
        this.baseKickFmGain = 0;
        setParamDirect(this.kickSubReinforce.gain, 0.44);
        break;
      case 'SUB':
        this.baseKickFmGain = (12 + punchNorm * 42) * ratioBoost;
        setParamDirect(this.kickSubReinforce.gain, 0.46);
        break;
      case 'SAW':
        this.baseKickFmGain = (18 + punchNorm * 54) * ratioBoost;
        setParamDirect(this.kickSubReinforce.gain, 0.4);
        break;
      case 'ZAAG':
        this.baseKickFmGain = (32 + punchNorm * 74) * ratioBoost;
        setParamDirect(this.kickSubReinforce.gain, 0.42);
        break;
      case 'KRACH':
        this.baseKickFmGain = (115 + punchNorm * 260) * (0.62 + fmRatio * 0.14);
        setParamDirect(this.kickSubReinforce.gain, 0.44);
        break;
      case 'PIEP':
        this.baseKickFmGain = (26 + punchNorm * 64) * ratioBoost;
        setParamDirect(this.kickSubReinforce.gain, 0.42);
        break;
    }

    setParamDirect(
      this.kickTokBpFilter.frequency,
      p.kickTokBoost ? 4200 : tailType === '909' ? 2550 : 2850,
      1
    );

    // 2. Configure Pre-Distortion Resonant EQ + Calibrated Console/Gabber Clipper
    const clipMode: KickClipMode = p.kickClipMode ?? 'GABBER';
    const driveNorm = clamp((p.kickDrive ?? 0) / 100, 0, 1);
    const eqGainNorm = clamp((p.kickEqGain ?? 0) / 100, 0, 1);
    const eqFreqHz = clamp(p.kickEqFreqHz ?? 240, 240, 4200);

    if (this.isKickKrachWired) {
      const effectiveDrive = Math.max(driveNorm, eqGainNorm * 0.35);
      const tier = effectiveDrive <= 0.01 ? 0 : Math.max(1, Math.round(effectiveDrive * 10));
      this.setKickClipCurve(clipMode, tier);

      if (!p.kickEqSweep && !(p.kickLfoPower && p.kickLfoTarget === 'HUNT')) {
        setParamDirect(this.kickPreEq.frequency, eqFreqHz, 0.5);
      }
      // Musical resonant peak (+0..+13.5 dB, Q 1.15..4.2) instead of extreme +22.5 dB overdrive
      setParamDirect(
        this.kickPreEq.Q,
        clipMode === 'GABBER' ? 1.15 + eqGainNorm * 2.35 : 1.3 + eqGainNorm * 3.4
      );
      setParamDirect(this.kickPreEq.gain, eqGainNorm * 13.5);

      // Smooth quadratic console drive (1.0x clean -> 2.1x warm Gabber -> 4.2x hardcore slam)
      const preDriveGain = 1.0 + driveNorm * 0.85 + driveNorm * driveNorm * 2.35;
      setParamDirect(this.kickPreDrive.gain, preDriveGain);

      // Post-clip 335 Hz box-mud scoop for authentic hollow Rotterdam 909 -> Gabber character
      const boxCutDb =
        clipMode === 'GABBER' ? -driveNorm * (1.4 + eqGainNorm * 2.6) : -driveNorm * 1.4;
      setParamDirect(this.kickPostDip.gain, boxCutDb);

      setParamDirect(
        this.kickPostLp.frequency,
        clipMode === 'GABBER'
          ? 8600
          : clipMode === 'BOILER'
          ? 7800
          : clipMode === 'ZAAG'
          ? 9200
          : 11200,
        5
      );

      const wetMix = clamp(Math.max(driveNorm, eqGainNorm * 0.65), 0, 1);
      const wetComp = 0.94 / (1.0 + driveNorm * 0.36 + eqGainNorm * 0.16);
      setParamDirect(this.kickDryKrachGain.gain, 1 - wetMix * 0.92);
      setParamDirect(this.kickWetKrachGain.gain, wetMix * wetComp);
    } else {
      this.setKickClipCurve(clipMode, 0);
      setParamDirect(this.kickPostDip.gain, 0);
      setParamDirect(this.kickDryKrachGain.gain, 1.0);
      setParamDirect(this.kickWetKrachGain.gain, 0.0);
    }

    // 3. Configure Industrial Techno Cavern Rumble Bus (100% Bounded Feedback <= 0.36)
    if (this.isKickRumbleWired) {
      const bpm = clamp(p.kickBpm ?? 150, 115, 240);
      const beatSec = 60 / bpm;
      const delaySec = clamp(beatSec * (p.kickRumbleGroove ? 0.375 : 0.25), 0.045, 0.36);
      const rumbleNorm = clamp((p.kickRumbleAmt ?? 0) / 100, 0, 1);
      const lpHz = clamp(p.kickRumbleLpHz ?? 280, 110, 1200);

      setParamDirect(this.rumbleDelay.delayTime, delaySec, 0.0005);
      setParamDirect(this.rumbleLp.frequency, lpHz, 0.5);
      setParamDirect(this.rumbleFbGain.gain, 0.12 + rumbleNorm * 0.24);
    } else {
      setParamDirect(this.rumbleFbGain.gain, 0);
    }
  }

  /**
   * 100% Phase-Locked (0.0 rad) Per-Hit Web Audio Kick Synthesizer.
   * Every kick hit spawns fresh sample-accurate C++ oscillators + deterministic Tok buffer at exact `t0`
   * while cleanly micro-choking any prior voice in 2.0 ms — guaranteeing hard, sample-identical kicks on every beat!
   */
  private triggerKickHit(hitTime: number, rootHz: number, p: SynthParams): void {
    if (
      !this.kickLfoAmpGain ||
      !this.kickTokBpFilter ||
      !this.kickTokBuffer ||
      !this.rumbleDuckGain
    ) {
      return;
    }

    const rawCtx = Tone.getContext().rawContext;
    const nowAudio = rawCtx.currentTime;
    const t0 = Math.max(nowAudio + 0.0008, hitTime);
    this.lastKickHitAudioTime = t0;

    if (p.kickLfoSync) {
      this.kickLfoPhase = 0;
    }

    // 0. Prune completed voices and cleanly micro-choke any still-ringing hit over 2.0 ms at `t0`
    const remainingVoices: typeof this.activeKickVoices = [];
    for (const prev of this.activeKickVoices) {
      if (prev.stopAt <= nowAudio - 0.03) {
        for (const n of prev.nodes) {
          try {
            n.disconnect();
          } catch {
            // ignore
          }
        }
        continue;
      }
      if (prev.stopAt > t0) {
        const ext = prev.chokeGain.gain as AudioParam & {
          cancelAndHoldAtTime?: (t: number) => AudioParam;
        };
        if (typeof ext.cancelAndHoldAtTime === 'function') {
          ext.cancelAndHoldAtTime(t0);
        } else {
          prev.chokeGain.gain.cancelScheduledValues(t0);
        }
        prev.chokeGain.gain.linearRampToValueAtTime(0, t0 + 0.002);
        const chokeStop = t0 + 0.004;
        prev.stopAt = chokeStop;
        for (const s of prev.sources) {
          try {
            s.stop(chokeStop);
          } catch {
            // ignore
          }
        }
      }
      remainingVoices.push(prev);
    }
    this.activeKickVoices = remainingVoices;

    const tailType: KickTailType = p.kickTailType ?? '909';
    const punchNorm = clamp((p.kickPunch ?? 78) / 100, 0, 1);
    const fmRatio = clamp(p.kickFmRatio ?? 2.0, 0.5, 8.0);
    const ratioBoost = 0.52 + fmRatio * 0.2;
    const tokNorm = clamp((p.kickTok ?? 58) / 100, 0, 1);
    const sweepSec = clamp((p.kickSweepMs ?? 42) / 1000, 0.008, 0.22);

    // 4-Stage Kick ADSR Envelope Parameters
    const atkSec = clamp((p.kickAttackMs ?? 1.2) / 1000, 0.0005, 0.065);
    const decSec = clamp((p.kickDecayMs ?? 280) / 1000, 0.04, 1.2);
    const susNorm = clamp((p.kickSustain ?? 64) / 100, 0, 1);
    const susGain = Math.max(0.0008, susNorm * 0.96);
    const relSec = clamp((p.kickReleaseMs ?? 220) / 1000, 0.025, 1.2);
    const bpm = clamp(p.kickBpm ?? 165, 115, 240);
    const beatSec = 60 / bpm;

    // Extend ring-out guard so 1-shot taps finish their full ADSR + cavern rumble decay
    const totalEnvSec = atkSec + decSec * 0.75 + susNorm * 0.28 + relSec;
    const rumbleExtraMs = p.kickRumblePower ? 520 : 140;
    const hitOffsetMs = Math.max(0, (t0 - nowAudio) * 1000);
    this.kickRingUntilMs = Math.max(
      this.kickRingUntilMs,
      performance.now() + hitOffsetMs + totalEnvSec * 1000 + rumbleExtraMs
    );

    // 1. Configure Per-Hit Oscillator Waveforms & Hard Analog Gain Balance
    let bodyType: OscillatorType = 'sine';
    let harmType: OscillatorType = 'triangle';
    let bodyGainVal = 1.04;
    let harmGainVal = 0.09;
    let subGainVal = 0.38;
    let fmGainVal = 0;

    switch (tailType) {
      case '909':
        bodyType = 'sine';
        harmType = 'triangle';
        bodyGainVal = 1.05;
        harmGainVal = 0.09;
        subGainVal = 0.4;
        fmGainVal = 0;
        break;
      case 'SUB':
        bodyType = 'sine';
        harmType = 'sine';
        bodyGainVal = 0.98;
        harmGainVal = 0.2;
        subGainVal = 0.34;
        fmGainVal = (12 + punchNorm * 42) * ratioBoost;
        break;
      case 'SAW':
        bodyType = 'sawtooth';
        harmType = 'sawtooth';
        bodyGainVal = 0.78;
        harmGainVal = 0.42;
        subGainVal = 0.48;
        fmGainVal = (18 + punchNorm * 54) * ratioBoost;
        break;
      case 'ZAAG':
        bodyType = 'sawtooth';
        harmType = 'sawtooth';
        bodyGainVal = 0.74;
        harmGainVal = 0.56;
        subGainVal = 0.5;
        fmGainVal = (32 + punchNorm * 74) * ratioBoost;
        break;
      case 'KRACH':
        bodyType = 'sawtooth';
        harmType = 'square';
        bodyGainVal = 0.78;
        harmGainVal = 0.32;
        subGainVal = 0.54;
        fmGainVal = (115 + punchNorm * 260) * (0.62 + fmRatio * 0.14);
        break;
      case 'PIEP':
        bodyType = 'sine';
        harmType = 'sawtooth';
        bodyGainVal = 0.86;
        harmGainVal = 0.5;
        subGainVal = 0.42;
        fmGainVal = (26 + punchNorm * 64) * ratioBoost;
        break;
    }

    const bodyOsc = rawCtx.createOscillator();
    bodyOsc.type = bodyType;

    const subSineOsc = rawCtx.createOscillator();
    subSineOsc.type = 'sine';

    const harmOsc = rawCtx.createOscillator();
    harmOsc.type = harmType;

    if (this.kickBodyDetuneSource) {
      this.kickBodyDetuneSource.connect(bodyOsc.detune);
      this.kickBodyDetuneSource.connect(subSineOsc.detune);
    }
    if (this.kickHarmDetuneSource) {
      this.kickHarmDetuneSource.connect(harmOsc.detune);
    }

    const bodyGain = rawCtx.createGain();
    bodyGain.gain.value = bodyGainVal;
    const subSineGain = rawCtx.createGain();
    subSineGain.gain.value = subGainVal;
    const harmGain = rawCtx.createGain();
    harmGain.gain.value = harmGainVal;

    let fmGain: GainNode | null = null;
    if (fmGainVal > 0 || (p.kickLfoPower && p.kickLfoTarget === 'FM')) {
      fmGain = rawCtx.createGain();
      fmGain.gain.value = fmGainVal;
      harmOsc.connect(fmGain);
      fmGain.connect(bodyOsc.frequency);
    }

    const ampEnvGain = rawCtx.createGain();
    ampEnvGain.gain.value = 0;

    const chokeGain = rawCtx.createGain();
    chokeGain.gain.setValueAtTime(1.0, t0);

    bodyOsc.connect(bodyGain);
    subSineOsc.connect(subSineGain);
    harmOsc.connect(harmGain);

    bodyGain.connect(ampEnvGain);
    subSineGain.connect(ampEnvGain);
    harmGain.connect(ampEnvGain);
    ampEnvGain.connect(chokeGain);
    chokeGain.connect(this.kickLfoAmpGain);

    const sources: AudioScheduledSourceNode[] = [bodyOsc, subSineOsc, harmOsc];
    const nodes: AudioNode[] = [
      bodyOsc,
      subSineOsc,
      harmOsc,
      bodyGain,
      subSineGain,
      harmGain,
      ampEnvGain,
      chokeGain,
    ];
    if (fmGain) nodes.push(fmGain);

    // 2. Hard Analog Exponential Pitch-Drop Envelope (0.0 rad Phase-Locked at `t0`)
    const sweepSemitones = tailType === '909' ? 18 + punchNorm * 28 : 18 + punchNorm * 44;
    const peakBodyHz = clamp(
      rootHz * Math.pow(2, sweepSemitones / 12),
      110,
      tailType === '909' ? 480 : 2600
    );

    if (tailType === '909') {
      // Authentic TR-909 dual-slope chest punch: crisp 16ms upper-chest snap into solid fundamental
      const kneeHz = Math.max(rootHz * 1.48, rootHz + 24);
      const fastSnapSec = Math.min(0.019, sweepSec * 0.34);
      bodyOsc.frequency.setValueAtTime(peakBodyHz, t0);
      bodyOsc.frequency.exponentialRampToValueAtTime(kneeHz, t0 + fastSnapSec);
      bodyOsc.frequency.exponentialRampToValueAtTime(rootHz, t0 + sweepSec * 1.1);
      bodyOsc.frequency.exponentialRampToValueAtTime(
        Math.max(28, rootHz * 0.97),
        t0 + sweepSec * 1.1 + Math.max(0.18, totalEnvSec * 0.85)
      );
    } else {
      const kneeHz = Math.max(rootHz * 1.55, rootHz + 28);
      const fastSnapSec = Math.min(0.018, sweepSec * 0.32);
      bodyOsc.frequency.setValueAtTime(peakBodyHz, t0);
      bodyOsc.frequency.exponentialRampToValueAtTime(kneeHz, t0 + fastSnapSec);
      bodyOsc.frequency.exponentialRampToValueAtTime(rootHz, t0 + sweepSec);
      bodyOsc.frequency.exponentialRampToValueAtTime(
        Math.max(24, rootHz * 0.94),
        t0 + sweepSec + Math.max(0.18, totalEnvSec * 0.85)
      );
    }

    subSineOsc.frequency.setValueAtTime(
      Math.min(260, peakBodyHz * (tailType === '909' ? 0.72 : 0.52)),
      t0
    );
    subSineOsc.frequency.exponentialRampToValueAtTime(rootHz, t0 + sweepSec * 0.82);

    if (tailType === '909') {
      harmOsc.frequency.setValueAtTime(Math.min(520, peakBodyHz * 1.5), t0);
      harmOsc.frequency.exponentialRampToValueAtTime(rootHz * 2, t0 + sweepSec * 0.7);
    } else if (tailType === 'PIEP') {
      const piepTargetHz = clamp((p.kickEqFreqHz ?? 2250) * (0.55 + fmRatio * 0.28), 750, 4800);
      harmOsc.frequency.setValueAtTime(Math.min(6200, piepTargetHz * 1.45), t0);
      harmOsc.frequency.exponentialRampToValueAtTime(piepTargetHz, t0 + sweepSec * 0.75);
    } else if (tailType === 'KRACH') {
      const krachModHz = clamp(rootHz * fmRatio, 20, 6500);
      harmOsc.frequency.setValueAtTime(Math.min(7500, krachModHz * 3.1), t0);
      harmOsc.frequency.exponentialRampToValueAtTime(krachModHz, t0 + sweepSec * 0.9);
    } else if (tailType === 'ZAAG') {
      const zaagModHz = clamp(rootHz * fmRatio * 1.016, 20, 6500);
      harmOsc.frequency.setValueAtTime(Math.min(7500, peakBodyHz * fmRatio * 0.82), t0);
      harmOsc.frequency.exponentialRampToValueAtTime(zaagModHz, t0 + sweepSec);
    } else if (tailType === 'SAW') {
      const sawModHz = clamp(rootHz * fmRatio * 1.006, 20, 6500);
      harmOsc.frequency.setValueAtTime(Math.min(7500, peakBodyHz * fmRatio * 0.82), t0);
      harmOsc.frequency.exponentialRampToValueAtTime(sawModHz, t0 + sweepSec);
    } else {
      const subModHz = clamp(rootHz * fmRatio, 18, 5200);
      harmOsc.frequency.setValueAtTime(Math.min(6000, peakBodyHz * fmRatio * 0.75), t0);
      harmOsc.frequency.exponentialRampToValueAtTime(subModHz, t0 + sweepSec * 0.75);
    }

    // 3. Sample-Accurate 4-Stage Kick ADSR Envelope (Identical Start = 0 & End = 0 Every Beat)
    const effAtkSec = Math.max(0.0005, atkSec);
    const decTau = Math.max(0.012, decSec * 0.28);
    ampEnvGain.gain.setValueAtTime(0, t0);
    ampEnvGain.gain.linearRampToValueAtTime(1.0, t0 + effAtkSec);
    ampEnvGain.gain.setTargetAtTime(susGain, t0 + effAtkSec, decTau);

    let voiceStopAt: number;
    if (p.kickLoop) {
      const maxSustainEnd = t0 + Math.max(effAtkSec + 0.018, beatSec * 0.74);
      const sustainEnd = Math.min(
        maxSustainEnd,
        t0 + effAtkSec + decSec * 0.52 + beatSec * 0.24 * susNorm
      );
      const loopGateLimit = t0 + Math.max(effAtkSec + 0.03, beatSec - 0.003);
      const relTau = Math.max(0.01, Math.min(relSec * 0.24, (loopGateLimit - sustainEnd) * 0.36));
      ampEnvGain.gain.setTargetAtTime(0.0001, sustainEnd, Math.max(0.006, relTau));
      ampEnvGain.gain.linearRampToValueAtTime(0, loopGateLimit);
      voiceStopAt = loopGateLimit + 0.004;
    } else {
      const sustainEnd = t0 + effAtkSec + decSec * 0.65 + susNorm * Math.min(0.32, decSec * 0.45);
      const relTau = Math.max(0.012, relSec * 0.3);
      ampEnvGain.gain.setTargetAtTime(0.0001, sustainEnd, relTau);
      const endZero = sustainEnd + relTau * 5.6;
      ampEnvGain.gain.linearRampToValueAtTime(0, endZero);
      voiceStopAt = endZero + 0.01;
    }

    // 4. Deterministic Phase-Locked Tok Click + 0° Constructive Bridged-T Knock (0 - 22 ms)
    if (tokNorm > 0.01) {
      const tokSrc = rawCtx.createBufferSource();
      tokSrc.buffer = this.kickTokBuffer;

      const tokGain = rawCtx.createGain();
      const clickPeak = tokNorm * (p.kickTokBoost ? 0.92 : tailType === '909' ? 0.58 : 0.72);
      const clickDur = tailType === '909' ? 0.0085 : 0.011;
      tokGain.gain.setValueAtTime(clickPeak, t0);
      tokGain.gain.exponentialRampToValueAtTime(0.0001, t0 + clickDur);
      tokGain.gain.linearRampToValueAtTime(0, t0 + clickDur + 0.002);

      tokSrc.connect(tokGain);
      tokGain.connect(this.kickTokBpFilter);
      tokSrc.start(t0);
      tokSrc.stop(Math.min(voiceStopAt, t0 + 0.032));
      sources.push(tokSrc);
      nodes.push(tokSrc, tokGain);

      const knockOsc = rawCtx.createOscillator();
      knockOsc.type = tailType === '909' ? 'sine' : 'triangle';
      const knockStartHz = p.kickTokBoost ? 520 : tailType === '909' ? 320 : 380;
      const knockEndHz = tailType === '909' ? 68 : 88;
      const knockDur = tailType === '909' ? 0.021 : 0.016;
      knockOsc.frequency.setValueAtTime(knockStartHz, t0);
      knockOsc.frequency.exponentialRampToValueAtTime(knockEndHz, t0 + knockDur);

      const knockGain = rawCtx.createGain();
      knockGain.gain.setValueAtTime(0, t0);
      knockGain.gain.linearRampToValueAtTime(
        tokNorm * (tailType === '909' ? 0.84 : 0.72),
        t0 + 0.0008
      );
      knockGain.gain.exponentialRampToValueAtTime(0.0001, t0 + knockDur + 0.002);
      knockGain.gain.linearRampToValueAtTime(0, t0 + knockDur + 0.004);

      knockOsc.connect(knockGain);
      knockGain.connect(chokeGain);
      knockOsc.start(t0);
      knockOsc.stop(Math.min(voiceStopAt, t0 + knockDur + 0.006));
      sources.push(knockOsc);
      nodes.push(knockOsc, knockGain);
    }

    bodyOsc.start(t0);
    subSineOsc.start(t0);
    harmOsc.start(t0);

    bodyOsc.stop(voiceStopAt);
    subSineOsc.stop(voiceStopAt);
    harmOsc.stop(voiceStopAt);

    this.activeKickVoices.push({
      chokeGain,
      fmGain,
      stopAt: voiceStopAt,
      sources,
      nodes,
    });

    // 5. Kick-Triggered Industrial Rumble Sidechain Duck & Off-Beat Swell
    if (this.isKickRumbleWired && p.kickRumblePower) {
      const rumbleLevel = clamp((p.kickRumbleAmt ?? 0) / 100, 0, 1) * 0.88;
      const duckNorm = clamp((p.kickDuck ?? 75) / 100, 0, 1);
      const duckFloor = rumbleLevel * (1 - duckNorm * 0.94);
      const swellTau = clamp(beatSec * 0.22, 0.035, 0.14);

      const ext = this.rumbleDuckGain.gain as AudioParam & {
        cancelAndHoldAtTime?: (t: number) => AudioParam;
      };
      if (typeof ext.cancelAndHoldAtTime === 'function') {
        ext.cancelAndHoldAtTime(t0);
      } else {
        this.rumbleDuckGain.gain.cancelScheduledValues(t0);
      }
      this.rumbleDuckGain.gain.setValueAtTime(duckFloor, t0 + 0.002);
      this.rumbleDuckGain.gain.setValueAtTime(duckFloor, t0 + 0.032);
      this.rumbleDuckGain.gain.setTargetAtTime(rumbleLevel, t0 + 0.034, swellTau);
      if (!p.kickLoop) {
        this.rumbleDuckGain.gain.setTargetAtTime(
          0.0001,
          t0 + Math.max(0.22, totalEnvSec * 0.75),
          0.14
        );
      }
    }
  }

  /**
   * Sample-Accurate 4-Stage Synth ADSR Envelope Trigger (Attack -> Decay -> Sustain).
   * Anchors from current gain with zero discontinuity so fast retriggers never click.
   */
  private triggerSynthAdsrOn(p: SynthParams, retrigger: boolean): void {
    if (!this.synthAmpEnvGain || !this.synthSubEnvGain) return;
    const rawCtx = Tone.getContext().rawContext;
    const t0 = rawCtx.currentTime;

    const atkSec = clamp((p.attackMs ?? 12) / 1000, 0.005, 0.6);
    const decSec = clamp((p.decayMs ?? 320) / 1000, 0.04, 1.5);
    const susNorm = clamp((p.sustain ?? 82) / 100, 0, 1);
    const susGain = Math.max(0.0005, susNorm);
    const decTau = Math.max(0.012, decSec * 0.3);

    if (!retrigger && this.synthIsGateOpen) {
      rampAudioGate(this.synthAmpEnvGain.gain, susGain, t0, Math.max(0.018, decTau));
      rampAudioGate(this.synthSubEnvGain.gain, susGain, t0, Math.max(0.018, decTau));
      return;
    }

    this.synthNoteOnAudioTime = t0;
    this.synthIsGateOpen = true;
    this.synthRingUntilMs = 0;

    if (p.synthLfoSync ?? true) {
      this.synthLfoPhase = 0;
    }

    const scheduleAdsr = (param: AudioParam) => {
      const curVal = clamp(Number.isFinite(param.value) ? param.value : 0, 0.0006, 1.0);
      const ext = param as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
      if (typeof ext.cancelAndHoldAtTime === 'function') {
        ext.cancelAndHoldAtTime(t0);
      } else {
        param.cancelScheduledValues(t0);
      }
      param.setValueAtTime(curVal, t0);
      param.linearRampToValueAtTime(1.0, t0 + atkSec);
      param.setTargetAtTime(susGain, t0 + atkSec, decTau);
    };

    scheduleAdsr(this.synthAmpEnvGain.gain);
    scheduleAdsr(this.synthSubEnvGain.gain);
  }

  /**
   * Sample-Accurate Synth ADSR Release Stage (exponential ring-out from current plateau/slope).
   */
  private triggerSynthAdsrOff(p: SynthParams): void {
    if (!this.synthAmpEnvGain || !this.synthSubEnvGain || !this.synthIsGateOpen) return;
    const rawCtx = Tone.getContext().rawContext;
    const t0 = rawCtx.currentTime;
    const relSec = clamp((p.releaseMs ?? 150) / 1000, 0.04, 1.5);
    const relTau = Math.max(0.012, relSec * 0.28);

    this.synthIsGateOpen = false;
    this.synthNoteOffAudioTime = t0;
    this.synthRingUntilMs = Math.max(
      this.synthRingUntilMs,
      performance.now() + relSec * 1000 + 90
    );

    rampAudioGate(this.synthAmpEnvGain.gain, 0.0001, t0, relTau);
    rampAudioGate(this.synthSubEnvGain.gain, 0.0001, t0, relTau);
  }

  private updateVoiceGates(): void {
    if (
      !this.oscVoiceGate ||
      !this.fmVoiceGate ||
      !this.subDirectGate ||
      !this.grainGate ||
      !this.kickVoiceGate ||
      !this.currentParams
    ) {
      return;
    }
    const p = this.currentParams;
    const isHeldOrDrone = this.activeMidiNote !== null || this.isDronePlaying;
    const isKickRinging = Boolean(p.kickMode) && performance.now() < this.kickRingUntilMs;
    const isSynthRinging = !p.kickMode && performance.now() < this.synthRingUntilMs;
    const isSounding = isHeldOrDrone || isKickRinging || isSynthRinging;
    if (isSounding) {
      this.wakeVoicesIfNeeded();
    }

    const rawNow = Tone.getContext().rawContext.currentTime;

    if (p.kickMode) {
      // Mute Synth voices cleanly while Kick & Master engine is active
      this.synthIsGateOpen = false;
      this.synthRingUntilMs = 0;
      rampAudioGate(this.oscVoiceGate.gain, 0, rawNow, 0.012);
      rampAudioGate(this.fmVoiceGate.gain, 0, rawNow, 0.012);
      rampAudioGate(this.subDirectGate.gain, 0, rawNow, 0.012);
      rampAudioGate(this.grainGate.gain, 0, rawNow, 0.012);
      if (this.synthAmpEnvGain) rampAudioGate(this.synthAmpEnvGain.gain, 0, rawNow, 0.012);
      if (this.synthSubEnvGain) rampAudioGate(this.synthSubEnvGain.gain, 0, rawNow, 0.012);

      const kickTarget = isSounding && (p.kickPower ?? true) ? 0.96 : 0;
      if (kickTarget > 0) {
        // Open instantaneously before t0 so Kick #1's 0ms transient is 100% identical to Kick #2..N!
        setParamDirect(this.kickVoiceGate.gain, kickTarget);
      } else {
        rampAudioGate(this.kickVoiceGate.gain, 0, rawNow, 0.035);
      }
      return;
    }

    rampAudioGate(this.kickVoiceGate.gain, 0, rawNow, 0.015);

    // Individual synth voice mix gates stay open during held notes AND ADSR release tails
    // while `synthAmpEnvGain` & `synthSubEnvGain` sculpt the full 4-stage ADSR envelope!
    const synthVoicesActive = isHeldOrDrone || isSynthRinging;
    const mixTau = synthVoicesActive ? 0.008 : 0.025;

    const growlNorm = clamp(p.fmGrowl / 100, 0, 1);
    const oscTarget = synthVoicesActive && p.oscPower ? (p.oscLevel / 100) * 0.78 : 0;
    const fmTarget = synthVoicesActive && p.fmPower ? 0.56 + growlNorm * 0.42 : 0;
    const subTarget =
      synthVoicesActive && (p.fmSubOctave || p.thumpPower) && (p.fmPower || p.oscPower) ? 0.78 : 0;
    const grainTarget = synthVoicesActive && p.grainPower && this.buffer !== null ? 0.82 : 0;

    rampAudioGate(this.oscVoiceGate.gain, oscTarget, rawNow, mixTau);
    rampAudioGate(this.fmVoiceGate.gain, fmTarget, rawNow, mixTau);
    rampAudioGate(this.subDirectGate.gain, subTarget, rawNow, mixTau);
    rampAudioGate(this.grainGate.gain, grainTarget, rawNow, mixTau);
  }

  async triggerNoteOn(
    midi: number,
    speedEnv: EnvelopeData,
    pitchEnv: EnvelopeData,
    params: SynthParams,
    retrigger = true
  ): Promise<void> {
    await this.unMute();
    this.currentSpeedEnv = speedEnv;
    this.currentPitchEnv = pitchEnv;
    this.currentParams = { ...params };
    this.ensureGraph();
    this.wakeVoicesIfNeeded();

    const wasSilent = this.activeMidiNote === null && !this.isDronePlaying;
    this.activeMidiNote = midi;
    this.lastPlayedMidi = midi;

    if (params.curveMode === 'oneshot' && retrigger) {
      this.envPhase = 0;
    }
    if (retrigger || wasSilent) {
      if (params.thumpPower && (params.thumpAmount ?? 0) > 0) {
        this.thumpEnv = 1.0;
      }
    }
    if (wasSilent) {
      this.currentFreqHz = midiToFreq(midi + params.basePitchSemitones);
    }

    this.applyOscPanelProps(params);
    this.applyFxChainProps(params);
    this.applyKickChainProps(params);
    this.applyPlayerGranularProps(params);

    if (params.kickMode && (params.kickPower ?? true) && retrigger) {
      const rawNow = Tone.getContext().rawContext.currentTime;
      const rootHz = this.computeKickRootHz(midi + params.basePitchSemitones);
      // Schedule 6ms ahead so t0 lands cleanly ahead of Web Audio's 128-sample render block
      const hitAt = rawNow + 0.006;
      this.triggerKickHit(hitAt, rootHz, params);
      const bpm = clamp(params.kickBpm ?? 150, 115, 240);
      this.nextKickHitTime = hitAt + 60 / bpm;
      this.envPhase = 0;
    } else if (!params.kickMode) {
      this.triggerSynthAdsrOn(params, retrigger || wasSilent);
    }

    this.updateVoiceGates();
  }

  triggerNoteOff(midi?: number): void {
    if (midi !== undefined && this.activeMidiNote !== null && this.activeMidiNote !== midi) {
      return;
    }
    if (this.currentParams?.latchMode) {
      return;
    }
    this.activeMidiNote = null;
    if (this.currentParams?.kickMode && this.currentParams.kickLoop && !this.isDronePlaying) {
      // Fade out looped rumble tail smoothly when loop stops
      if (this.rumbleDuckGain && this.isKickRumbleWired) {
        const rawNow = Tone.getContext().rawContext.currentTime;
        rampAudioGate(this.rumbleDuckGain.gain, 0, rawNow, 0.12);
      }
    } else if (this.currentParams && !this.currentParams.kickMode && !this.isDronePlaying) {
      this.triggerSynthAdsrOff(this.currentParams);
    }
    this.updateVoiceGates();
  }

  releaseAllLatchedNotes(): void {
    this.activeMidiNote = null;
    if (this.currentParams && !this.currentParams.kickMode && !this.isDronePlaying) {
      this.triggerSynthAdsrOff(this.currentParams);
    }
    this.updateVoiceGates();
  }

  async setDronePlay(
    playing: boolean,
    speedEnvelope: EnvelopeData,
    pitchEnvelope: EnvelopeData,
    params: SynthParams
  ): Promise<void> {
    if (playing) {
      await this.unMute();
      this.currentSpeedEnv = speedEnvelope;
      this.currentPitchEnv = pitchEnvelope;
      this.currentParams = { ...params };
      this.ensureGraph();
      this.wakeVoicesIfNeeded();
      if (params.curveMode === 'oneshot') {
        this.envPhase = 0;
      }
      if (params.thumpPower && (params.thumpAmount ?? 0) > 0) {
        this.thumpEnv = 1.0;
      }
      this.isDronePlaying = true;
      this.applyOscPanelProps(params);
      this.applyFxChainProps(params);
      this.applyKickChainProps(params);
      this.applyPlayerGranularProps(params);

      if (params.kickMode && (params.kickPower ?? true)) {
        const rawNow = Tone.getContext().rawContext.currentTime;
        const midi =
          (this.activeMidiNote !== null ? this.activeMidiNote : this.lastPlayedMidi) +
          params.basePitchSemitones;
        const hitAt = rawNow + 0.006;
        this.triggerKickHit(hitAt, this.computeKickRootHz(midi), params);
        const bpm = clamp(params.kickBpm ?? 150, 115, 240);
        this.nextKickHitTime = hitAt + 60 / bpm;
        this.envPhase = 0;
      } else if (!params.kickMode) {
        this.triggerSynthAdsrOn(params, true);
      }

      this.updateVoiceGates();
    } else {
      this.isDronePlaying = false;
      this.kickRingUntilMs = 0;
      this.stopAllKickVoices();
      if (!params.latchMode) {
        this.activeMidiNote = null;
      }
      if (this.rumbleDuckGain && this.isKickRumbleWired) {
        const rawNow = Tone.getContext().rawContext.currentTime;
        rampAudioGate(this.rumbleDuckGain.gain, 0, rawNow, 0.06);
      }
      if (!params.kickMode && this.activeMidiNote === null) {
        this.triggerSynthAdsrOff(params);
      }
      this.updateVoiceGates();
    }
  }

  generateBuiltInSample(id: BuiltInSampleId): number {
    const rawCtx = Tone.getContext().rawContext;
    const sr = rawCtx.sampleRate || 44100;
    const durationSec = 4.0;
    const totalSamples = Math.floor(sr * durationSec);
    const audioBuf = rawCtx.createBuffer(1, totalSamples, sr);
    const data = audioBuf.getChannelData(0);

    let drumPhase = 0;
    let knockPhase = 0;
    let prevHitIdx = -1;
    let localSampleIdx = 0;

    for (let i = 0; i < totalSamples; i++) {
      const t = i / sr;
      let sample = 0;

      if (id === '909-drum') {
        // 100% Identical Phase-Locked Dry Analog TR-909 4/4 Bass Drum Loop (8 identical kicks over 4.0s)
        const hitIdx = Math.floor(t * 2);
        if (hitIdx !== prevHitIdx) {
          drumPhase = 0;
          knockPhase = 0;
          localSampleIdx = 0;
          prevHitIdx = hitIdx;
        }
        const hitSec = localSampleIdx / sr;
        localSampleIdx++;
        const instHz =
          52 + 185 * Math.exp(-hitSec / 0.015) + 48 * Math.exp(-hitSec / 0.065);
        const knockHz = 72 + 235 * Math.exp(-hitSec / 0.0085);
        drumPhase += (2 * Math.PI * instHz) / sr;
        knockPhase += (2 * Math.PI * knockHz) / sr;

        const bodyEnv = Math.min(1, hitSec / 0.0008) * Math.exp(-hitSec / 0.21);
        const knockEnv = Math.exp(-hitSec / 0.015);
        const clickNoise =
          hitSec < 0.007
            ? (Math.abs((Math.sin((localSampleIdx + 1) * 12.9898) * 43758.5453) % 1) * 2 - 1) *
              Math.exp(-hitSec / 0.0022) *
              0.42
            : 0;
        sample = clamp(
          Math.sin(drumPhase) * bodyEnv * 0.88 +
            Math.sin(knockPhase) * knockEnv * 0.34 +
            clickNoise,
          -0.98,
          0.98
        );
      } else if (id === 'sub-pulse') {
        const freqs = [65.41, 65.41, 77.78, 87.31, 98.0, 87.31, 77.78, 58.27];
        const stepIdx = Math.floor(t * 2) % freqs.length;
        const localT = (t * 2) % 1;
        const f = freqs[stepIdx];
        const env = Math.exp(-localT * 3.0) * Math.min(1, localT * 90);
        const sub = Math.sin(2 * Math.PI * f * t) * 0.65;
        const harm2 = Math.sin(2 * Math.PI * f * 2 * t + 0.3) * 0.28 * Math.exp(-localT * 4.2);
        const harm3 =
          Math.tanh(Math.sin(2 * Math.PI * f * 3 * t) * 2.5) * 0.2 * Math.exp(-localT * 5.5);
        sample = (sub + harm2 + harm3) * env;
      } else if (id === 'reese-bass') {
        const fBase = 65.41;
        const saw1 = ((fBase * 0.992 * t) % 1) * 2 - 1;
        const saw2 = ((fBase * 1.008 * t) % 1) * 2 - 1;
        const subSine = Math.sin(2 * Math.PI * (fBase * 0.5) * t);
        const lfoCut = 0.55 + 0.45 * Math.sin(2 * Math.PI * 0.75 * t);
        sample =
          Math.tanh((saw1 * 0.38 + saw2 * 0.38) * (1.3 + lfoCut * 1.6)) * 0.58 + subSine * 0.4;
      } else if (id === 'chord-stabs') {
        const chordNotes = [130.81, 155.56, 196.0, 233.08, 293.66];
        const trig = (t * 2.5) % 1;
        const env = Math.exp(-trig * 4.2) * Math.min(1, trig * 80);
        let sum = 0;
        for (const n of chordNotes) {
          sum += Math.sin(2 * Math.PI * n * t) * 0.5 + (((n * 1.003 * t) % 1) * 2 - 1) * 0.25;
        }
        const bass =
          Math.sin(2 * Math.PI * 65.41 * t) * Math.exp(-((t * 1.25) % 1) * 2.4) * 0.45;
        sample = (sum / chordNotes.length) * env * 0.9 + bass;
      } else {
        const beat = (t * 4) % 4;
        const sixteenth = (t * 8) % 1;
        const kickIdx = Math.floor(t * 4);
        const kickT = beat % 1;
        const kickSec = kickT * 0.25;
        if (kickIdx !== prevHitIdx) {
          drumPhase = 0;
          prevHitIdx = kickIdx;
        }
        const kickPitch = 48 + 145 * Math.exp(-kickSec / 0.018);
        drumPhase += (2 * Math.PI * kickPitch) / sr;
        const kick = Math.sin(drumPhase) * Math.exp(-kickT * 5.8) * 0.8;
        const snareActive = Math.floor(beat) % 2 === 1;
        const noise = (Math.sin(i * 12.9898) * 43758.5453) % 1;
        const snare = snareActive
          ? (noise * 0.55 + Math.sin(2 * Math.PI * 185 * kickSec) * 0.35) * Math.exp(-kickT * 13)
          : 0;
        const hat = noise * Math.exp(-sixteenth * 26) * 0.22;
        const acidFreq = [65.4, 65.4, 130.8, 98.0, 77.8, 65.4, 116.5, 87.3][
          Math.floor(t * 8) % 8
        ];
        const acid =
          Math.tanh(Math.sin(2 * Math.PI * acidFreq * t) * 2.4) * Math.exp(-sixteenth * 5) * 0.35;
        sample = clamp(kick + snare + hat + acid, -0.95, 0.95);
      }

      const edgeSamples = Math.floor(sr * 0.005);
      if (i < edgeSamples) sample *= i / edgeSamples;
      if (i > totalSamples - edgeSamples) sample *= (totalSamples - i) / edgeSamples;

      data[i] = clamp(sample, -0.98, 0.98);
    }

    this.buffer = new Tone.ToneAudioBuffer(audioBuf);
    if (this.isGraphBuilt) {
      this.ensureGrainPlayer();
    }
    return durationSec;
  }

  async loadAudioFile(file: File): Promise<number> {
    const arrayBuf = await file.arrayBuffer();
    const rawCtx = Tone.getContext().rawContext;
    const decoded = await rawCtx.decodeAudioData(arrayBuf.slice(0));
    this.buffer = new Tone.ToneAudioBuffer(decoded);

    if (this.isGraphBuilt) {
      this.ensureGrainPlayer();
    }
    return decoded.duration;
  }

  clearSample(): void {
    if (this.player) {
      try {
        this.player.stop();
        this.player.dispose();
      } catch {
        // ignore
      }
      this.player = null;
    }
    this.buffer = null;
    if (this.grainGate && this.isGraphBuilt) {
      const rawNow = Tone.getContext().rawContext.currentTime;
      rampAudioGate(this.grainGate.gain, 0, rawNow, 0.015);
    }
  }

  hasSample(): boolean {
    return this.buffer !== null;
  }

  getWaveformData(numPoints = 220): Float32Array | null {
    if (!this.buffer) return null;
    try {
      const channelData = this.buffer.getChannelData(0);
      const step = Math.max(1, Math.floor(channelData.length / numPoints));
      const result = new Float32Array(numPoints);
      for (let i = 0; i < numPoints; i++) {
        let max = 0;
        const base = i * step;
        for (let j = 0; j < step && base + j < channelData.length; j++) {
          const val = Math.abs(channelData[base + j]);
          if (val > max) max = val;
        }
        result[i] = Math.min(1, max);
      }
      return result;
    } catch {
      return null;
    }
  }

  private applyPlayerGranularProps(params: SynthParams): void {
    if (!this.player) return;
    const sizeSec = clamp(params.grainSizeMs / 1000, 0.015, 0.5);
    const overlapSec = clamp(params.grainOverlapMs / 1000, 0.005, Math.min(0.25, sizeSec * 0.85));
    if (Math.abs(Number(this.player.grainSize) - sizeSec) > 0.001) {
      this.player.grainSize = sizeSec;
    }
    if (Math.abs(Number(this.player.overlap) - overlapSec) > 0.001) {
      this.player.overlap = overlapSec;
    }
    if (this.player.reverse !== params.grainReverse) {
      this.player.reverse = params.grainReverse;
    }
  }

  private applyFxChainProps(params: SynthParams): void {
    if (
      !this.inputGain ||
      !this.outputGain ||
      !this.dryBranch ||
      !this.wetBranch ||
      !this.hpFilter ||
      !this.lpFilter ||
      !this.lowBandGain ||
      !this.toneDry ||
      !this.tonePreGain ||
      !this.toneWet ||
      !this.eqLow ||
      !this.eqMid ||
      !this.eqHigh ||
      !this.compressor ||
      !this.compressorMakeup ||
      !this.fmCarrier
    ) {
      return;
    }

    this.syncSubgraphRouting(params);

    const rawNow = Tone.getContext().rawContext.currentTime;
    rampAudioGate(this.inputGain.gain, dbToGain(params.inGainDb), rawNow, 0.018);
    rampAudioGate(this.outputGain.gain, dbToGain(params.outGainDb), rawNow, 0.018);

    // FM Modulator Waveform: Organic sine/triangle at 0% default -> Sawtooth / Square Riddim bite as fmMetalAmt increases!
    const fmMetalTone = clamp((params.fmMetalAmt ?? 0) / 100, 0, 1);
    const wantModType =
      fmMetalTone > 0.68
        ? 'square'
        : fmMetalTone > 0.28
        ? 'sawtooth'
        : params.toneMode === 'TEAROUT' || params.toneMode === 'SCREAM'
        ? 'triangle'
        : 'sine';
    if (this.fmCarrier.modulationType !== wantModType) {
      this.fmCarrier.modulationType = wantModType;
    }
    if (this.fmMetallicOsc) {
      const wantMetalOpType = fmMetalTone > 0.35 ? 'square' : 'triangle';
      if (this.fmMetallicOsc.type !== wantMetalOpType) {
        this.fmMetallicOsc.type = wantMetalOpType;
      }
      if (this.fmMetallicOsc.modulationType !== wantMetalOpType) {
        this.fmMetallicOsc.modulationType = wantMetalOpType;
      }
    }

    // Master Stereo vs Mono-Sum Check
    if (this.masterStereoPass && this.masterMonoSum) {
      const monoCheck = Boolean(params.haasMonoCheck);
      setParamDirect(this.masterStereoPass.gain, monoCheck ? 0 : 1);
      setParamDirect(this.masterMonoSum.gain, monoCheck ? 1 : 0);
    }

    if (params.bypass) {
      rampAudioGate(this.dryBranch.gain, 1, rawNow, 0.018);
      rampAudioGate(this.wetBranch.gain, 0, rawNow, 0.018);
      return;
    }

    const wetRatio = clamp(params.dryWet / 100, 0, 1);
    rampAudioGate(this.dryBranch.gain, (1 - wetRatio) * 0.7, rawNow, 0.018);
    rampAudioGate(this.wetBranch.gain, 0.25 + wetRatio * 0.85, rawNow, 0.018);

    setParamDirect(this.hpFilter.frequency, clamp(params.hpFreq, 20, 600), 0.2);
    setParamDirect(this.lpFilter.frequency, clamp(params.lpFreq, 500, 20000), 1);

    const xoverHz = clamp(params.xoverFreqHz || 115, 60, 240);
    if (this.xoverLow1 && this.xoverLow2 && this.xoverHigh1 && this.xoverHigh2) {
      setParamDirect(this.xoverLow1.frequency, xoverHz, 0.2);
      setParamDirect(this.xoverLow2.frequency, xoverHz, 0.2);
      setParamDirect(this.xoverHigh1.frequency, xoverHz, 0.2);
      setParamDirect(this.xoverHigh2.frequency, xoverHz, 0.2);
    }

    const subNorm = clamp((params.subPunch ?? 50) / 100, 0, 1);
    const subGainLinear =
      subNorm <= 0.5 ? 0.35 + (subNorm / 0.5) * 0.65 : 1.0 + ((subNorm - 0.5) / 0.5) * 0.55;
    setParamDirect(this.lowBandGain.gain, subGainLinear);

    if (this.midBandGate) {
      setParamDirect(this.midBandGate.gain, params.subSolo ? 0 : 1);
    }

    // Natural Unison Stereo Spread (> Xover Only)
    if (
      this.unisonWidthDry &&
      this.unisonWidthWet &&
      this.unisonLfoGainL &&
      this.unisonLfoGainR
    ) {
      if (this.isUnisonStereoWired) {
        const detAmt = params.oscPower ? clamp(params.oscDetune / 100, 0, 1) : 0;
        const uniAmt = params.fmPower && params.fmUnison ? 0.48 : 0;
        const stereoAmt = clamp(Math.max(detAmt * 0.58, uniAmt), 0, 0.68);
        setParamDirect(this.unisonLfoGainL.gain, stereoAmt * 0.00055, 1e-6);
        setParamDirect(this.unisonLfoGainR.gain, -stereoAmt * 0.00055, 1e-6);
        setParamDirect(this.unisonWidthDry.gain, 1 - stereoAmt * 0.55);
        setParamDirect(this.unisonWidthWet.gain, stereoAmt * 0.85);
      } else {
        setParamDirect(this.unisonWidthDry.gain, 1.0);
        setParamDirect(this.unisonWidthWet.gain, 0.0);
      }
    }

    // Sonic Shaper 3: Stereo Haas / Chorus Dimension Expander (> Xover Only)
    if (
      this.haasDry &&
      this.haasDelayL &&
      this.haasDelayR &&
      this.haasLfoGainL &&
      this.haasLfoGainR &&
      this.haasStereoGate
    ) {
      if (this.isHaasWired) {
        const widthNorm = clamp((params.haasWidth ?? 0) / 100, 0, 1);
        const delaySec = clamp((params.haasDelayMs ?? 9.5) / 1000, 0.0018, 0.024);
        const detuneNorm = clamp((params.haasDetune ?? 35) / 100, 0, 1);

        setParamDirect(this.haasDelayL.delayTime, 0.0012, 1e-5);
        setParamDirect(this.haasDelayR.delayTime, delaySec, 1e-5);
        setParamDirect(this.haasLfoGainL.gain, detuneNorm * 0.00085, 1e-6);
        setParamDirect(this.haasLfoGainR.gain, -detuneNorm * 0.00085, 1e-6);
        setParamDirect(this.haasDry.gain, 1 - widthNorm * 0.82);
        setParamDirect(this.haasStereoGate.gain, widthNorm * 1.06);
      } else {
        setParamDirect(this.haasDry.gain, 1.0);
        setParamDirect(this.haasStereoGate.gain, 0.0);
      }
    }

    // Phase Scope Differential Stereo Phase Alignment (-180°..+180° + Right Polarity Invert, > Xover)
    if (
      this.isPhaseRotatorWired &&
      this.phaseApL1 &&
      this.phaseApL2 &&
      this.phaseApR1 &&
      this.phaseApR2 &&
      this.phaseRightPolarity
    ) {
      const deg = clamp(params.phaseAlignDeg ?? 0, -180, 180);
      const octShift = deg / 180;
      const ratioL = Math.pow(2.6, -octShift);
      const ratioR = Math.pow(2.6, octShift);
      setParamDirect(this.phaseApL1.frequency, clamp(520 * ratioL, 90, 6000), 0.5);
      setParamDirect(this.phaseApL2.frequency, clamp(1450 * ratioL, 180, 12000), 0.5);
      setParamDirect(this.phaseApR1.frequency, clamp(520 * ratioR, 90, 6000), 0.5);
      setParamDirect(this.phaseApR2.frequency, clamp(1450 * ratioR, 180, 12000), 0.5);
      setParamDirect(this.phaseRightPolarity.gain, params.phaseInvertR ? -1.0 : 1.0);
    }

    // Master Growl projection lift (Synth Mode only)
    if (this.multibandSum) {
      const growlLift =
        !params.kickMode && params.fmPower
          ? 1.0 + clamp(params.fmGrowl / 100, 0, 1) * 0.3
          : 1.0;
      setParamDirect(this.multibandSum.gain, growlLift);
    }

    // Sonic Shaper 4: Native 3-Band Upward/Downward Multiband OTT Dynamics
    if (
      this.ottDry &&
      this.ottWet &&
      this.ottPreLow &&
      this.ottPreMid &&
      this.ottPreHigh &&
      this.ottCompLow &&
      this.ottCompMid &&
      this.ottCompHigh &&
      this.ottMakeupLow &&
      this.ottMakeupMid &&
      this.ottMakeupHigh
    ) {
      if (this.isOttWired) {
        const ottNorm = clamp((params.ottAmount ?? 0) / 100, 0, 1);
        const flavor = params.ottMode ?? 'UPWARD';
        const preScale = 1 + ottNorm * 1.4;
        setParamDirect(
          this.ottPreLow.gain,
          preScale * (flavor === 'SLAM' ? 1.24 : flavor === 'CRISP' ? 1.04 : 1.12)
        );
        setParamDirect(this.ottPreMid.gain, preScale * (flavor === 'SLAM' ? 1.28 : 1.2));
        setParamDirect(
          this.ottPreHigh.gain,
          preScale * (flavor === 'CRISP' ? 1.58 : flavor === 'SLAM' ? 1.38 : 1.34)
        );

        setParamDirect(this.ottCompLow.ratio, flavor === 'SLAM' ? 10 : 6.5);
        setParamDirect(this.ottCompMid.ratio, flavor === 'SLAM' ? 11 : 7.5);
        setParamDirect(this.ottCompHigh.ratio, flavor === 'SLAM' ? 12 : 8.5);

        setParamDirect(this.ottMakeupLow.gain, flavor === 'SLAM' ? 1.48 : 1.28);
        setParamDirect(this.ottMakeupMid.gain, flavor === 'SLAM' ? 1.45 : 1.36);
        setParamDirect(
          this.ottMakeupHigh.gain,
          flavor === 'CRISP' ? 1.92 : flavor === 'SLAM' ? 1.68 : 1.6
        );

        setParamDirect(this.ottDry.gain, 1 - ottNorm * 0.78);
        setParamDirect(this.ottWet.gain, ottNorm * 0.94);
      } else {
        setParamDirect(this.ottDry.gain, 1.0);
        setParamDirect(this.ottWet.gain, 0.0);
      }
    }

    // 4x-Oversampled Saturation (TONE) + Calibrated Headroom & Warm Chest/Throat 3-Band EQ
    if (this.isToneWired) {
      const driveNorm = clamp(params.toneDrive / 100, 0, 1);
      const driveCurve = driveNorm * (0.45 + 0.55 * driveNorm);
      const tier = Math.round(driveNorm * 10);
      this.setToneCurve(params.toneMode, tier);

      setParamDirect(this.tonePreGain.gain, 1.0 + driveCurve * 0.95);
      const wetAmt = clamp(0.18 + driveNorm * 0.78, 0, 0.96);
      const makeupComp = 1.0 / (1.0 + driveCurve * 0.28);
      setParamDirect(this.toneDry.gain, 1.0 - wetAmt * 0.88);
      setParamDirect(this.toneWet.gain, wetAmt * 0.96 * makeupComp);

      switch (params.toneMode) {
        case 'TEAROUT':
          setParamDirect(this.eqLow.gain, 3.0 * driveNorm);
          setParamDirect(this.eqMid.gain, 2.2 * driveNorm);
          setParamDirect(this.eqHigh.gain, 1.0 * driveNorm);
          break;
        case 'ROAR':
          setParamDirect(this.eqLow.gain, 3.4 * driveNorm);
          setParamDirect(this.eqMid.gain, 2.6 * driveNorm);
          setParamDirect(this.eqHigh.gain, 0.3 * driveNorm);
          break;
        case 'YOI':
          setParamDirect(this.eqLow.gain, 2.8 * driveNorm);
          setParamDirect(this.eqMid.gain, 2.8 * driveNorm);
          setParamDirect(this.eqHigh.gain, 0.6 * driveNorm);
          break;
        case 'SCREAM':
          setParamDirect(this.eqLow.gain, 2.2 * driveNorm);
          setParamDirect(this.eqMid.gain, 2.0 * driveNorm);
          setParamDirect(this.eqHigh.gain, 1.3 * driveNorm);
          break;
        case 'TUBE':
          setParamDirect(this.eqLow.gain, 3.2 * driveNorm);
          setParamDirect(this.eqMid.gain, 1.8 * driveNorm);
          setParamDirect(this.eqHigh.gain, -1.8 * driveNorm);
          break;
        case 'CLIP':
          setParamDirect(this.eqLow.gain, 3.0 * driveNorm);
          setParamDirect(this.eqMid.gain, 1.5 * driveNorm);
          setParamDirect(this.eqHigh.gain, 0.5 * driveNorm);
          break;
      }
    } else {
      this.setToneCurve(params.toneMode, 0);
      setParamDirect(this.toneDry.gain, 1.0);
      setParamDirect(this.toneWet.gain, 0.0);
      setParamDirect(this.eqLow.gain, 0);
      setParamDirect(this.eqMid.gain, 0);
      setParamDirect(this.eqHigh.gain, 0);
    }

    // Band-Limited Stereo Air-Stabiliser & Gain-Compensated Glue Bus (STABILISE)
    if (this.isSpaceWired && this.spaceWet && this.spaceFbL && this.spaceFbR) {
      const spaceNorm = clamp(params.spaceAmount / 100, 0, 1);
      // Strictly stable cross-feedback <= 0.30 on > 300 Hz band (zero comb ringing, zero sub mud!)
      const fbGain = 0.1 + spaceNorm * 0.2;
      setParamDirect(this.spaceFbL.gain, fbGain);
      setParamDirect(this.spaceFbR.gain, fbGain);
      setParamDirect(this.spaceWet.gain, spaceNorm * 0.26);

      // Smooth glue compression paired with automatic makeup gain so loudness never pumps or collapses
      setParamDirect(this.compressor.threshold, -10 - spaceNorm * 9);
      setParamDirect(this.compressor.knee, 10);
      setParamDirect(this.compressor.ratio, 2.2 + spaceNorm * 3.0);
      setParamDirect(this.compressorMakeup.gain, 1.0 + spaceNorm * 0.28);
    } else if (this.spaceWet) {
      setParamDirect(this.spaceWet.gain, 0);
      if (this.spaceFbL) setParamDirect(this.spaceFbL.gain, 0);
      if (this.spaceFbR) setParamDirect(this.spaceFbR.gain, 0);
      if (params.kickMode) {
        // 100% uncompressed unity pass-through in Kick Mode when STABILISE is off so transients stay rock-hard & identical
        setParamDirect(this.compressor.threshold, 0);
        setParamDirect(this.compressor.knee, 0);
        setParamDirect(this.compressor.ratio, 1.0);
        setParamDirect(this.compressorMakeup.gain, 1.0);
      } else {
        setParamDirect(this.compressor.threshold, -8);
        setParamDirect(this.compressor.knee, 6);
        setParamDirect(this.compressor.ratio, 2.0);
        setParamDirect(this.compressorMakeup.gain, 1.0);
      }
    }
  }

  updateLiveParams(params: SynthParams): void {
    const prevKickMode = Boolean(this.currentParams?.kickMode);
    const nextKickMode = Boolean(params.kickMode);
    this.currentParams = { ...params };
    if (this.isGraphBuilt) {
      this.applyOscPanelProps(params);
      this.applyFxChainProps(params);
      this.applyKickChainProps(params);

      // If user flips from Synth -> Kick while Drone Play or a held note is active, fire the Kick immediately!
      if (!prevKickMode && nextKickMode && (this.isDronePlaying || this.activeMidiNote !== null)) {
        this.wakeVoicesIfNeeded();
        this.syncSubgraphRouting(params);
        this.applyKickChainProps(params);
        const rawNow = Tone.getContext().rawContext.currentTime;
        const midi =
          (this.activeMidiNote !== null ? this.activeMidiNote : this.lastPlayedMidi) +
          params.basePitchSemitones;
        const hitAt = rawNow + 0.006;
        this.triggerKickHit(hitAt, this.computeKickRootHz(midi), params);
        this.nextKickHitTime = hitAt + 60 / clamp(params.kickBpm ?? 150, 115, 240);
      } else if (
        prevKickMode &&
        !nextKickMode &&
        (this.isDronePlaying || this.activeMidiNote !== null)
      ) {
        this.stopAllKickVoices();
        this.wakeVoicesIfNeeded();
        this.syncSubgraphRouting(params);
        this.triggerSynthAdsrOn(params, true);
      } else if (
        !nextKickMode &&
        this.synthIsGateOpen &&
        this.synthAmpEnvGain &&
        this.synthSubEnvGain
      ) {
        // Real-time Sustain plateau tracking when user drags Sustain handle while holding a key or Drone Play!
        const rawNow = Tone.getContext().rawContext.currentTime;
        const atkSec = clamp((params.attackMs ?? 12) / 1000, 0.005, 0.6);
        if (rawNow >= this.synthNoteOnAudioTime + atkSec) {
          const susGain = Math.max(0.0005, clamp((params.sustain ?? 82) / 100, 0, 1));
          rampAudioGate(this.synthAmpEnvGain.gain, susGain, rawNow, 0.024);
          rampAudioGate(this.synthSubEnvGain.gain, susGain, rawNow, 0.024);
        }
      }
      this.updateVoiceGates();
    }
    if (this.player) {
      this.applyPlayerGranularProps(params);
    }
  }

  applyEnvelopes(speedEnvelope: EnvelopeData, pitchEnvelope: EnvelopeData): void {
    this.currentSpeedEnv = speedEnvelope;
    this.currentPitchEnv = pitchEnvelope;
  }

  stopAll(): void {
    this.stopPatchPreview(false);
    this.isDronePlaying = false;
    this.activeMidiNote = null;
    this.pitchBendSemitones = 0;
    this.thumpEnv = 0;
    this.kickRingUntilMs = 0;
    this.synthIsGateOpen = false;
    this.synthRingUntilMs = 0;
    if (this.isGraphBuilt) {
      this.updateVoiceGates();
    }
  }

  /**
   * Triggers a non-destructive 2-second audio audition of a candidate preset
   * without mutating the caller's loaded UI patch, then restores the live audio graph.
   */
  async startPatchPreview(options: {
    previewParams: SynthParams;
    speedEnv: EnvelopeData;
    pitchEnv: EnvelopeData;
    defaultSample?: BuiltInSampleId;
    fallbackLiveState: {
      params: SynthParams;
      speedEnv: EnvelopeData;
      pitchEnv: EnvelopeData;
    };
    durationMs?: number;
    onEnded?: () => void;
  }): Promise<void> {
    if (this.previewTimerId !== null) {
      clearTimeout(this.previewTimerId);
      this.previewTimerId = null;
    }

    const token = ++this.previewRunToken;

    if (!this.previewSnapshot) {
      const baseParams = this.currentParams ?? options.fallbackLiveState.params;
      const baseSpeed = this.currentParams
        ? this.currentSpeedEnv
        : options.fallbackLiveState.speedEnv;
      const basePitch = this.currentParams
        ? this.currentPitchEnv
        : options.fallbackLiveState.pitchEnv;

      this.previewSnapshot = {
        params: { ...baseParams },
        speedEnv: { points: baseSpeed.points.map((pt) => ({ ...pt })) },
        pitchEnv: { points: basePitch.points.map((pt) => ({ ...pt })) },
        buffer: this.buffer,
        wasDronePlaying: this.isDronePlaying,
        activeMidiNote: this.activeMidiNote,
        lastPlayedMidi: this.lastPlayedMidi,
      };
    }

    await this.unMute();
    if (token !== this.previewRunToken) return;

    this.ensureGraph();
    this.isDronePlaying = false;

    if (options.previewParams.grainPower && options.defaultSample) {
      this.generateBuiltInSample(options.defaultSample);
    }

    const previewMidi = (clamp(options.previewParams.octave ?? 1, 0, 4) + 1) * 12;
    const auditionParams: SynthParams = {
      ...options.previewParams,
      latchMode: false,
      bypass: false,
    };

    await this.triggerNoteOn(
      previewMidi,
      options.speedEnv,
      options.pitchEnv,
      auditionParams,
      true
    );
    if (token !== this.previewRunToken) return;

    this.previewTimerId = setTimeout(() => {
      if (token !== this.previewRunToken) return;
      this.stopPatchPreview(true);
      options.onEnded?.();
    }, options.durationMs ?? 2000);
  }

  stopPatchPreview(restoreLiveState = true): void {
    ++this.previewRunToken;
    if (this.previewTimerId !== null) {
      clearTimeout(this.previewTimerId);
      this.previewTimerId = null;
    }

    const snap = this.previewSnapshot;
    this.previewSnapshot = null;

    if (!restoreLiveState || !snap) {
      return;
    }

    this.activeMidiNote = null;
    this.isDronePlaying = false;
    this.kickRingUntilMs = 0;
    this.stopAllKickVoices();
    this.synthIsGateOpen = false;
    this.synthRingUntilMs = 0;
    if (this.rumbleDuckGain && this.isKickRumbleWired && this.isGraphBuilt) {
      const rawNow = Tone.getContext().rawContext.currentTime;
      rampAudioGate(this.rumbleDuckGain.gain, 0, rawNow, 0.04);
    }

    if (this.buffer !== snap.buffer) {
      if (snap.buffer === null) {
        this.clearSample();
      } else {
        this.buffer = snap.buffer;
        if (this.isGraphBuilt) {
          this.ensureGrainPlayer();
        }
      }
    }

    this.currentSpeedEnv = snap.speedEnv;
    this.currentPitchEnv = snap.pitchEnv;
    this.lastPlayedMidi = snap.lastPlayedMidi;
    this.isDronePlaying = snap.wasDronePlaying;
    this.activeMidiNote = snap.activeMidiNote;

    if (snap.params) {
      if (snap.wasDronePlaying) {
        void this.setDronePlay(true, snap.speedEnv, snap.pitchEnv, snap.params);
      } else if (snap.activeMidiNote !== null) {
        void this.triggerNoteOn(
          snap.activeMidiNote,
          snap.speedEnv,
          snap.pitchEnv,
          snap.params,
          true
        );
      } else {
        if (this.synthAmpEnvGain) this.synthAmpEnvGain.gain.value = 0;
        if (this.synthSubEnvGain) this.synthSubEnvGain.gain.value = 0;
        this.updateLiveParams(snap.params);
      }
    }
  }

  setPitchBendSemitones(semitones: number): void {
    this.pitchBendSemitones = clamp(semitones, -12, 12);
  }

  isActiveSounding(): boolean {
    const now = performance.now();
    return (
      this.isDronePlaying ||
      this.activeMidiNote !== null ||
      (Boolean(this.currentParams?.kickMode) && now < this.kickRingUntilMs) ||
      (!this.currentParams?.kickMode && now < this.synthRingUntilMs)
    );
  }

  getCurrentPhase(): number {
    return this.currentParams?.grainReverse ? (1 - this.envPhase + 1) % 1 : this.envPhase;
  }

  resetPlayhead(): void {
    this.envPhase = 0;
  }

  /**
   * Zero-allocation 60 FPS Stereo Phase Scope & Pearson Correlation sampler.
   * Called directly from `PhaseScopeDisplay` canvas `requestAnimationFrame`
   * without triggering React state updates.
   */
  samplePhaseScope(): PhaseScopeSnapshot {
    const sounding = this.isActiveSounding();
    if (!this.isGraphBuilt || !this.analyserL || !this.analyserR || !sounding) {
      this.smoothedCorrelation += (1.0 - this.smoothedCorrelation) * 0.14;
      this.smoothedWidthPct *= 0.86;
      this.smoothedRms *= 0.82;
      this.phaseSnapshot.correlation = this.smoothedCorrelation;
      this.phaseSnapshot.widthPct = this.smoothedWidthPct;
      this.phaseSnapshot.rms = this.smoothedRms;
      this.phaseSnapshot.isActive = false;
      return this.phaseSnapshot;
    }

    this.analyserL.getFloatTimeDomainData(this.scopeBufL);
    this.analyserR.getFloatTimeDomainData(this.scopeBufR);

    let sumLL = 0;
    let sumRR = 0;
    let sumLR = 0;
    let sumMidSq = 0;
    let sumSideSq = 0;

    const len = PHASE_SCOPE_SAMPLES;
    for (let i = 0; i < len; i++) {
      const l = this.scopeBufL[i];
      const r = this.scopeBufR[i];
      sumLL += l * l;
      sumRR += r * r;
      sumLR += l * r;
      const mid = (l + r) * 0.70710678;
      const side = (l - r) * 0.70710678;
      sumMidSq += mid * mid;
      sumSideSq += side * side;
    }

    const rms = Math.sqrt((sumLL + sumRR) / (2 * len));
    const denom = Math.sqrt(sumLL * sumRR);
    const rawCorr = denom > 1e-6 ? clamp(sumLR / denom, -1, 1) : 1.0;
    const totalMS = sumMidSq + sumSideSq;
    const rawWidth = totalMS > 1e-6 ? clamp(Math.sqrt(sumSideSq / totalMS) * 140, 0, 100) : 0;

    this.smoothedRms += (rms - this.smoothedRms) * 0.25;
    if (rms > 0.002) {
      this.smoothedCorrelation += (rawCorr - this.smoothedCorrelation) * 0.22;
      this.smoothedWidthPct += (rawWidth - this.smoothedWidthPct) * 0.22;
    }

    this.phaseSnapshot.correlation = this.smoothedCorrelation;
    this.phaseSnapshot.widthPct = this.smoothedWidthPct;
    this.phaseSnapshot.rms = this.smoothedRms;
    this.phaseSnapshot.isActive = rms > 0.0015;
    return this.phaseSnapshot;
  }

  /**
   * Clears sticky L/R clip indicators and resets held peak readouts on the global VU meter.
   */
  clearMasterClip(): void {
    this.vuClipLatchedL = false;
    this.vuClipLatchedR = false;
    this.vuMaxPeakDb = -60;
    this.vuHoldDbL = -60;
    this.vuHoldDbR = -60;
    this.vuHoldUntilMsL = 0;
    this.vuHoldUntilMsR = 0;
  }

  /**
   * Zero-allocation 60 FPS Master Output Stereo VU, Peak-Hold & Clipping sampler.
   * Taps pre-limiter `outputGain` stereo channels so true >= 0.0 dBFS clipping is
   * accurately detected while `safetyLimiter` protects physical audio output.
   */
  sampleMasterVu(): MasterVuSnapshot {
    const now = performance.now();
    const dtSec =
      this.vuLastSampleMs > 0 ? clamp((now - this.vuLastSampleMs) / 1000, 0.004, 0.1) : 1 / 60;
    this.vuLastSampleMs = now;

    if (!this.isGraphBuilt || !this.vuAnalyserL || !this.vuAnalyserR) {
      this.masterVuSnapshot.rmsDbL = -60;
      this.masterVuSnapshot.rmsDbR = -60;
      this.masterVuSnapshot.peakDbL = -60;
      this.masterVuSnapshot.peakDbR = -60;
      this.masterVuSnapshot.holdDbL = -60;
      this.masterVuSnapshot.holdDbR = -60;
      this.masterVuSnapshot.maxPeakDb = this.vuMaxPeakDb;
      this.masterVuSnapshot.clipNow = false;
      this.masterVuSnapshot.clipLatchedL = this.vuClipLatchedL;
      this.masterVuSnapshot.clipLatchedR = this.vuClipLatchedR;
      this.masterVuSnapshot.limiterGrDb = 0;
      this.masterVuSnapshot.isActive = false;
      return this.masterVuSnapshot;
    }

    this.vuAnalyserL.getFloatTimeDomainData(this.vuBufL);
    this.vuAnalyserR.getFloatTimeDomainData(this.vuBufR);

    let sumSqL = 0;
    let sumSqR = 0;
    let rawPeakL = 0;
    let rawPeakR = 0;
    const n = this.vuBufL.length;

    for (let i = 0; i < n; i++) {
      const sl = this.vuBufL[i];
      const sr = this.vuBufR[i];
      sumSqL += sl * sl;
      sumSqR += sr * sr;
      const al = sl < 0 ? -sl : sl;
      const ar = sr < 0 ? -sr : sr;
      if (al > rawPeakL) rawPeakL = al;
      if (ar > rawPeakR) rawPeakR = ar;
    }

    const rawRmsL = Math.sqrt(sumSqL / n);
    const rawRmsR = Math.sqrt(sumSqR / n);

    // Ballistic VU RMS smoothing (fast attack, smooth musical decay)
    this.vuRmsLinL += (rawRmsL - this.vuRmsLinL) * (rawRmsL > this.vuRmsLinL ? 0.45 : 0.14);
    this.vuRmsLinR += (rawRmsR - this.vuRmsLinR) * (rawRmsR > this.vuRmsLinR ? 0.45 : 0.14);

    // Fast PPM Peak bar smoothing (instant transient catch, controlled fallback)
    if (rawPeakL >= this.vuPeakLinL) {
      this.vuPeakLinL = rawPeakL;
    } else {
      this.vuPeakLinL *= Math.pow(0.18, dtSec);
    }
    if (rawPeakR >= this.vuPeakLinR) {
      this.vuPeakLinR = rawPeakR;
    } else {
      this.vuPeakLinR *= Math.pow(0.18, dtSec);
    }

    const linToDb = (lin: number): number =>
      lin <= 0.001 ? -60 : clamp(20 * Math.log10(lin), -60, 6);

    const rmsDbL = linToDb(this.vuRmsLinL);
    const rmsDbR = linToDb(this.vuRmsLinR);
    const peakDbL = linToDb(this.vuPeakLinL);
    const peakDbR = linToDb(this.vuPeakLinR);
    const instPeakDbL = linToDb(rawPeakL);
    const instPeakDbR = linToDb(rawPeakR);

    // Peak-hold markers (1.1s hold, then 15 dB/sec falloff)
    if (instPeakDbL >= this.vuHoldDbL) {
      this.vuHoldDbL = instPeakDbL;
      this.vuHoldUntilMsL = now + 1100;
    } else if (now > this.vuHoldUntilMsL) {
      this.vuHoldDbL = Math.max(peakDbL, this.vuHoldDbL - 15 * dtSec);
    }

    if (instPeakDbR >= this.vuHoldDbR) {
      this.vuHoldDbR = instPeakDbR;
      this.vuHoldUntilMsR = now + 1100;
    } else if (now > this.vuHoldUntilMsR) {
      this.vuHoldDbR = Math.max(peakDbR, this.vuHoldDbR - 15 * dtSec);
    }

    const instMaxDb = Math.max(instPeakDbL, instPeakDbR);
    if (instMaxDb > this.vuMaxPeakDb && instMaxDb > -59.5) {
      this.vuMaxPeakDb = instMaxDb;
    }

    // Clipping threshold at >= -0.05 dBFS (|sample| >= 0.994)
    const clipL = rawPeakL >= 0.994;
    const clipR = rawPeakR >= 0.994;
    if (clipL) this.vuClipLatchedL = true;
    if (clipR) this.vuClipLatchedR = true;

    const gr = this.safetyLimiter ? clamp(this.safetyLimiter.reduction, -24, 0) : 0;
    const active = rawPeakL > 0.0012 || rawPeakR > 0.0012 || this.vuPeakLinL > 0.002 || this.vuPeakLinR > 0.002;

    this.masterVuSnapshot.rmsDbL = rmsDbL;
    this.masterVuSnapshot.rmsDbR = rmsDbR;
    this.masterVuSnapshot.peakDbL = peakDbL;
    this.masterVuSnapshot.peakDbR = peakDbR;
    this.masterVuSnapshot.holdDbL = this.vuHoldDbL;
    this.masterVuSnapshot.holdDbR = this.vuHoldDbR;
    this.masterVuSnapshot.maxPeakDb = this.vuMaxPeakDb;
    this.masterVuSnapshot.clipNow = clipL || clipR;
    this.masterVuSnapshot.clipLatchedL = this.vuClipLatchedL;
    this.masterVuSnapshot.clipLatchedR = this.vuClipLatchedR;
    this.masterVuSnapshot.limiterGrDb = gr;
    this.masterVuSnapshot.isActive = active;
    return this.masterVuSnapshot;
  }

  private computeAnalyserMeter(analyser: AnalyserNode | null, buf: Float32Array): number {
    if (!analyser) return 0.5;
    analyser.getFloatTimeDomainData(buf as Float32Array<ArrayBuffer>);
    let sumSq = 0;
    for (let i = 0; i < buf.length; i++) {
      sumSq += buf[i] * buf[i];
    }
    const rms = Math.sqrt(sumSq / buf.length);
    if (rms <= 1e-5) return 0.02;
    const db = 20 * Math.log10(rms);
    return clamp((db + 52) / 52, 0.02, 1);
  }

  getTelemetry(): TelemetryFrame {
    const isSounding = this.isActiveSounding();
    const restingPhase = this.getCurrentPhase();
    if (!isSounding || !this.isGraphBuilt) {
      return {
        phase: restingPhase,
        inMeter: 0.04,
        outMeter: 0.04,
        grainMeter: 0.08,
        growlMeter: 0.08,
        activeMidiNote: this.activeMidiNote,
        fftBins: null,
        scopeSamples: [],
        masterWaveBars: [],
        wahFreqHz: Math.round(this.liveWahHz),
        formantF1Hz: Math.round(this.liveF1Hz),
        formantF2Hz: Math.round(this.liveF2Hz),
        combDelayMs: Number(this.liveCombMs.toFixed(2)),
        fmModIndex: 0,
        crushBits: 16,
        spectralBands: [0.18, 0.28, 0.22, 0.35, 0.26, 0.32, 0.2, 0.14],
        ottBands: [0.22, 0.28, 0.24],
        disperserLiveHz: Math.round(this.liveDisperserHz),
        kickEqLiveHz: Math.round(this.liveKickEqHz),
        kickPumpMeter: 0.14,
        kickEnvPhase: 0,
        kickLfoPhase: Number(this.kickLfoPhase.toFixed(3)),
        synthEnvPhase: 0,
        synthLfoPhase: Number(this.synthLfoPhase.toFixed(3)),
      };
    }

    const inLvl = this.computeAnalyserMeter(this.inAnalyser, this.inWaveBuf);
    const outLvl = this.computeAnalyserMeter(this.outAnalyser, this.outWaveBuf);

    if (this.fftAnalyserNode) {
      const nowMs = performance.now();
      if (nowMs - this.lastFftReadMs >= 50) {
        this.fftAnalyserNode.getByteFrequencyData(this.fftByteBuf);
        this.lastFftReadMs = nowMs;
      }
    }

    // Compute live Low / Mid / High 3-band OTT meter energies via integer byte bins (zero log10!)
    const avgByteRange = (start: number, end: number) => {
      let sum = 0;
      let count = 0;
      const limit = Math.min(end, this.fftByteBuf.length - 1);
      for (let i = start; i <= limit; i++) {
        sum += this.fftByteBuf[i] / 255;
        count++;
      }
      return count > 0 ? sum / count : 0.35;
    };
    const ottBoost = this.currentParams?.ottPower
      ? 0.22 + clamp((this.currentParams.ottAmount ?? 0) / 100, 0, 1) * 0.4
      : 0;
    this.liveOttBands = [
      clamp(avgByteRange(1, 5) + ottBoost * 0.72, 0.12, 0.96),
      clamp(avgByteRange(6, 22) + ottBoost * 0.82, 0.12, 0.96),
      clamp(avgByteRange(23, 54) + ottBoost * 0.92, 0.1, 0.96),
    ];

    // Passive Spectral Gate analyzer preview when Spectral Gate is bypassed/off
    if (!this.isSpectralWired) {
      for (let b = 0; b < 8; b++) {
        const binIdx = Math.min(this.fftByteBuf.length - 1, Math.round(2 + b * 6.5));
        const e = clamp(0.08 + (this.fftByteBuf[binIdx] / 255) * 0.84, 0.08, 0.9);
        this.liveSpectralBands[b] = this.liveSpectralBands[b] * 0.55 + e * 0.45;
      }
    }

    // Windowed RMS/Peak + Temporal Ballistics for STABILISE Scope (eliminates zero-crossing jitter!)
    const rawWave = this.outWaveBuf;
    const scopeSamples = new Array<number>(SCOPE_BAR_COUNT);
    const scopeSliceLen = Math.max(2, Math.floor(rawWave.length / SCOPE_BAR_COUNT));
    for (let i = 0; i < SCOPE_BAR_COUNT; i++) {
      const base = i * scopeSliceLen;
      let peak = 0;
      let sumSq = 0;
      let cnt = 0;
      for (let j = 0; j < scopeSliceLen && base + j < rawWave.length; j++) {
        const mag = Math.abs(rawWave[base + j]);
        if (mag > peak) peak = mag;
        sumSq += mag * mag;
        cnt++;
      }
      const rms = cnt > 0 ? Math.sqrt(sumSq / cnt) : 0;
      const u = i / (SCOPE_BAR_COUNT - 1);
      const bell = 0.58 + 0.42 * Math.sin(u * Math.PI);
      const target = clamp((rms * 1.45 + peak * 0.65 + 0.08) * bell, 0.1, 0.95);
      const prev = this.smoothedScopeBars[i] || target;
      const alpha = target > prev ? 0.42 : 0.22;
      const next = prev + (target - prev) * alpha;
      this.smoothedScopeBars[i] = next;
      scopeSamples[i] = next;
    }

    // Windowed Peak + Temporal Ballistics for Master JUNOSCRATCH Screen Bars
    const masterWaveBars = new Array<number>(MASTER_BAR_COUNT);
    const barStep = Math.max(1, Math.floor(rawWave.length / MASTER_BAR_COUNT));
    for (let i = 0; i < MASTER_BAR_COUNT; i++) {
      const base = i * barStep;
      let peak = 0;
      for (let j = 0; j < barStep && base + j < rawWave.length; j++) {
        const mag = Math.abs(rawWave[base + j]);
        if (mag > peak) peak = mag;
      }
      const u = i / (MASTER_BAR_COUNT - 1);
      const edgeTaper = 0.46 + 0.54 * Math.sin(u * Math.PI);
      const target = clamp((peak * 2.1 + 0.05) * edgeTaper, 0.06, 0.94);
      const prev = this.smoothedMasterBars[i] || target;
      const alpha = target > prev ? 0.46 : 0.25;
      const next = prev + (target - prev) * alpha;
      this.smoothedMasterBars[i] = next;
      masterWaveBars[i] = next;
    }

    const effectivePhase =
      this.currentParams?.grainReverse ? (1 - this.envPhase + 1) % 1 : this.envPhase;

    return {
      phase: effectivePhase,
      inMeter: inLvl,
      outMeter: outLvl,
      grainMeter: clamp(inLvl * (0.45 + this.liveSpeedMultiplier * 0.3), 0.08, 1),
      growlMeter: clamp(0.15 + this.liveGrowlLevel * 0.85, 0.1, 1),
      activeMidiNote: this.activeMidiNote ?? (this.isDronePlaying ? this.lastPlayedMidi : null),
      fftBins: null,
      scopeSamples,
      masterWaveBars,
      wahFreqHz: Math.round(this.liveWahHz),
      formantF1Hz: Math.round(this.liveF1Hz),
      formantF2Hz: Math.round(this.liveF2Hz),
      combDelayMs: Number(this.liveCombMs.toFixed(2)),
      fmModIndex: Number(this.liveFmIndex.toFixed(1)),
      crushBits: this.liveCrushBits,
      spectralBands: [...this.liveSpectralBands],
      ottBands: [...this.liveOttBands],
      disperserLiveHz: Math.round(this.liveDisperserHz),
      kickEqLiveHz: Math.round(this.liveKickEqHz),
      kickPumpMeter: Number(this.liveKickPump.toFixed(2)),
      kickEnvPhase: Number(this.liveKickEnvPhase.toFixed(3)),
      kickLfoPhase: Number(this.kickLfoPhase.toFixed(3)),
      synthEnvPhase: Number(this.liveSynthEnvPhase.toFixed(3)),
      synthLfoPhase: Number(this.synthLfoPhase.toFixed(3)),
    };
  }

  private interpolateSmooth(points: Point[], t: number): number {
    if (points.length === 0) return 0.5;
    if (points.length === 1) return points[0].y;

    let sorted = points;
    for (let i = 1; i < points.length; i++) {
      if (points[i].x < points[i - 1].x) {
        sorted = [...points].sort((a, b) => a.x - b.x);
        break;
      }
    }
    if (t <= sorted[0].x) return sorted[0].y;
    if (t >= sorted[sorted.length - 1].x) return sorted[sorted.length - 1].y;

    let p0 = sorted[0];
    let p1 = sorted[sorted.length - 1];
    for (let i = 0; i < sorted.length - 1; i++) {
      if (t >= sorted[i].x && t <= sorted[i + 1].x) {
        p0 = sorted[i];
        p1 = sorted[i + 1];
        break;
      }
    }
    if (p1.x === p0.x) return p0.y;

    const linear = (t - p0.x) / (p1.x - p0.x);
    const smooth = (1 - Math.cos(linear * Math.PI)) * 0.5;
    return clamp(p0.y + smooth * (p1.y - p0.y), 0, 1);
  }
}

export const audioEngine = new AudioEngine();
