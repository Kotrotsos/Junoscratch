import React, { useState, useRef, useEffect, useCallback, useId } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { KickClipMode, KickLfoShape, KickLfoTarget, KickTailType, SynthLfoTarget } from '../../types';
import { ACCENT_PALETTES, clamp, DspAccent } from './tokens';
import { MidiLearnOverlayTag, useMidiLearnTarget } from './MidiLearnContext';
import { cn } from '../../utils';

const KICK_TAIL_MODES: KickTailType[] = ['909', 'SUB', 'SAW', 'ZAAG', 'KRACH', 'PIEP'];
const KICK_CLIP_MODES: KickClipMode[] = ['GABBER', 'GCLIP', 'FOLD', 'ZAAG', 'BOILER'];
const KICK_LFO_SHAPES: KickLfoShape[] = ['SINE', 'TRI', 'SAW', 'SQR'];
const KICK_LFO_TARGETS: KickLfoTarget[] = ['HUNT', 'FM', 'PITCH', 'AMP'];
const SYNTH_LFO_TARGETS: SynthLfoTarget[] = ['GROWL', 'VOWEL', 'FILTER', 'PITCH', 'AMP'];

/* ============================================================================
 * 1. KickOscDisplay — Recessed Tok + Pitch-Drop + FM Ratio + Tail Scope (KICK BODY)
 * ============================================================================ */
export interface KickOscDisplayProps {
  tailType: KickTailType;
  onChangeTailType: (next: KickTailType) => void;
  punch: number; // 0..100
  fmRatio?: number; // 0.5..8.0
  tok: number; // 0..100
  sweepMs: number; // 10..180
  decayMs: number; // 60..1200
  sustain?: number; // 0..100
  loopActive: boolean;
  onToggleLoop?: () => void;
  accent?: DspAccent;
  midiId?: string;
  className?: string;
}

export const KickOscDisplay = React.memo(function KickOscDisplay({
  tailType,
  onChangeTailType,
  punch,
  fmRatio = 2.0,
  tok,
  sweepMs,
  decayMs,
  sustain = 68,
  loopActive,
  onToggleLoop,
  accent = 'cyan',
  midiId,
  className,
}: KickOscDisplayProps) {
  const palette = ACCENT_PALETTES[accent];
  const midi = useMidiLearnTarget(midiId, 'Kick Tail Engine');
  const idx = Math.max(0, KICK_TAIL_MODES.indexOf(tailType));

  const cycle = (dir: -1 | 1) => {
    const nextIdx = (idx + dir + KICK_TAIL_MODES.length) % KICK_TAIL_MODES.length;
    onChangeTailType(KICK_TAIL_MODES[nextIdx]);
  };

  const punchNorm = clamp(punch / 100, 0, 1);
  const tokNorm = clamp(tok / 100, 0, 1);
  const sweepNorm = clamp((sweepMs - 10) / 170, 0.04, 1);
  const decayNorm = clamp((decayMs - 60) / 1140, 0.06, 1);
  const susNorm = clamp(sustain / 100, 0, 1);
  const safeRatio = clamp(fmRatio, 0.5, 8.0);

  // Build synthesized kick waveform + FM harmonic overtones + ADSR contour preview
  const { wavePath, envPath } = React.useMemo(() => {
    const wPts: string[] = [];
    const ePts: string[] = [];
    const steps = 72;
    let phase = 0;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // Exponential pitch-drop frequency multiplier
      const sweepDecay = Math.exp(-t / (0.06 + sweepNorm * 0.24));
      const freqMult = 1.55 + sweepDecay * (4.0 + punchNorm * 6.2);

      // ADSR Decay -> Sustain plateau -> Tail release preview
      const decEnd = 0.14 + decayNorm * 0.34;
      const tailEnv =
        t <= decEnd
          ? susNorm + (1 - susNorm) * Math.exp(-t / Math.max(0.05, decEnd * 0.45))
          : susNorm * Math.exp(-(t - decEnd) / 0.42);

      phase += (freqMult * 0.15) % 1;
      const cyc = phase % 1;
      const fmMod = Math.sin(cyc * Math.PI * 2 * safeRatio);

      let carrier = 0;
      switch (tailType) {
        case '909': {
          // Pure analog TR-909 sine drum + Bridged-T 175 Hz woody knock (zero FM dirt)
          const knock = t < 0.16 ? Math.sin(t * Math.PI * 26) * Math.exp(-t * 18) * 0.34 : 0;
          carrier = clamp(Math.sin(cyc * Math.PI * 2) * 0.94 + knock, -1, 1);
          break;
        }
        case 'SUB':
          carrier = Math.sin(cyc * Math.PI * 2 + fmMod * (0.18 + (safeRatio - 0.5) * 0.18));
          break;
        case 'SAW': {
          const warped = (((cyc + fmMod * 0.08 * safeRatio) % 1) + 1) % 1;
          carrier = (1 - 2 * warped) * 0.8 + fmMod * 0.24;
          carrier = clamp(carrier, -1, 1);
          break;
        }
        case 'ZAAG':
          carrier =
            (1 - 2 * cyc) * 0.58 +
            (1 - 2 * ((cyc * safeRatio * 1.02 + 0.2) % 1)) * 0.52;
          carrier = clamp(carrier * 1.35, -1, 1);
          break;
        case 'KRACH':
          // Microwave FM buzz wave driven by FM Ratio
          carrier = Math.sin(
            cyc * Math.PI * 2 + fmMod * (1.45 + punchNorm * 1.2 + safeRatio * 0.22)
          );
          carrier = clamp(carrier * 1.45, -1, 1);
          break;
        case 'PIEP':
          carrier =
            Math.sin(cyc * Math.PI * 2) * 0.56 +
            Math.sin(t * Math.PI * (22 + safeRatio * 7.5)) * 0.56 * (0.35 + tailEnv * 0.65);
          carrier = clamp(carrier * 1.25, -1, 1);
          break;
      }

      // Initial Tok click spike near t = 0
      const tokSpike = t < 0.065 ? (1 - t / 0.065) * tokNorm * (i % 2 === 0 ? 1 : -0.92) : 0;
      const sample = clamp(carrier * clamp(tailEnv, 0.05, 1) * 0.88 + tokSpike * 0.65, -1, 1);

      const x = t * 100;
      const yWave = 20 - sample * 14.5;
      const yEnv =
        34 - clamp(sweepDecay * (0.4 + punchNorm * 0.6) * 0.58 + tailEnv * 0.42, 0, 1) * 28;
      wPts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${yWave.toFixed(1)}`);
      ePts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${yEnv.toFixed(1)}`);
    }
    return { wavePath: wPts.join(' '), envPath: ePts.join(' ') };
  }, [tailType, punchNorm, tokNorm, sweepNorm, decayNorm, susNorm, safeRatio]);

  const ratioLabel =
    tailType === '909'
      ? 'ANLG'
      : Number.isInteger(safeRatio)
      ? `${safeRatio.toFixed(1)}x`
      : `${safeRatio.toFixed(2).replace(/0$/, '')}x`;

  return (
    <div className="relative w-full min-w-0" onContextMenu={midi.handleContextMenu}>
      <MidiLearnOverlayTag
        midiId={midiId}
        binding={midi.binding}
        isArmed={midi.isArmed}
        midiLearnMode={midi.midiLearnMode}
        onUnbind={midi.unbind}
        compact
      />
      <div
        onPointerDownCapture={(e) => {
          if (midi.interceptLearnEvent(e)) return;
        }}
        className={cn(
          'dsp-well rounded-[14px] w-full min-w-[82px] h-[68px] px-2 py-1.5 relative overflow-hidden flex flex-col justify-between select-none transition-shadow',
          midi.enabled && 'cursor-pointer',
          midi.isArmed && 'ring-2 ring-[#FFB35C] shadow-[0_0_14px_rgba(255,159,67,0.5)]',
          !midi.isArmed && midi.enabled && midi.binding && 'ring-2 ring-[#38BDF8]/85',
          !midi.isArmed &&
            midi.enabled &&
            !midi.binding &&
            'ring-1 ring-[#38BDF8]/40 hover:ring-[#38BDF8]',
          className
        )}
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{ background: palette.wellGlow }}
        />

        {/* Top Row: Kick Tail Engine + FM Ratio + Trigger Mode */}
        <div className="relative z-10 flex items-center justify-between gap-1 whitespace-nowrap">
          <div className="inline-flex items-center gap-1 min-w-0">
            <span
              className="font-display font-semibold text-[8.5px] tracking-[0.09em] uppercase"
              style={{
                color: palette.bright,
                textShadow: `0 0 8px ${palette.primary}`,
              }}
            >
              {tailType}
            </span>
            <span className="font-mono text-[8px] tabular-nums text-[#8DA2B8]">
              {ratioLabel}
            </span>
          </div>

          {onToggleLoop ? (
            <button
              type="button"
              onClick={() => !midi.enabled && onToggleLoop()}
              title="Toggle 1-Shot Drum Hit vs 4/4 BPM Stomper Loop"
              className="font-mono text-[8px] tabular-nums text-[#9BA3B8] hover:text-white transition-colors cursor-pointer focus-visible:outline-none"
              style={{
                color: loopActive ? palette.bright : '#8E96AA',
              }}
            >
              {loopActive ? '4/4' : '1-SHOT'}
            </button>
          ) : (
            <span className="font-mono text-[8px] tabular-nums text-[#8E96AA]">
              {Math.round(decayMs)}ms
            </span>
          )}
        </div>

        {/* Bottom Row: Chevrons + Live Kick Transient & FM Tail Oscilloscope */}
        <div className="relative z-10 w-full flex items-center justify-between gap-0.5">
          <button
            type="button"
            onClick={() => !midi.enabled && cycle(-1)}
            aria-label="Previous kick tail oscillator"
            className="w-3.5 h-6 flex items-center justify-center text-[#788094] hover:text-white transition-colors cursor-pointer shrink-0 focus-visible:outline-none"
          >
            <ChevronLeft size={11} strokeWidth={2} />
          </button>

          <svg
            className="flex-1 h-[36px] overflow-visible pointer-events-none"
            viewBox="0 0 100 40"
            preserveAspectRatio="none"
          >
            <line
              x1="0"
              y1="20"
              x2="100"
              y2="20"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="1"
            />
            <path
              d={envPath}
              fill="none"
              stroke={palette.primary}
              strokeOpacity="0.45"
              strokeDasharray="2 2"
              strokeWidth="1.15"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={wavePath}
              fill="none"
              stroke={palette.bright}
              strokeWidth="1.65"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              style={{ filter: `drop-shadow(0 0 5px ${palette.primary})` }}
            />
          </svg>

          <button
            type="button"
            onClick={() => !midi.enabled && cycle(1)}
            aria-label="Next kick tail oscillator"
            className="w-3.5 h-6 flex items-center justify-center text-[#788094] hover:text-white transition-colors cursor-pointer shrink-0 focus-visible:outline-none"
          >
            <ChevronRight size={11} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
});

/* ============================================================================
 * 2. KrachEqClipDisplay — Pre-Distortion "Frequency Hunt" + Hard-Clip/Wavefold Screen
 * ============================================================================ */
export interface KrachEqClipDisplayProps {
  clipMode: KickClipMode;
  onChangeClipMode: (next: KickClipMode) => void;
  drive: number; // 0..100
  eqFreqHz: number; // 240..4200
  eqGain: number; // 0..100
  accent?: DspAccent;
  midiId?: string;
  className?: string;
}

export const KrachEqClipDisplay = React.memo(function KrachEqClipDisplay({
  clipMode,
  onChangeClipMode,
  drive,
  eqFreqHz,
  eqGain,
  accent = 'amber',
  midiId,
  className,
}: KrachEqClipDisplayProps) {
  const palette = ACCENT_PALETTES[accent];
  const midi = useMidiLearnTarget(midiId, 'Krach Clipper Mode');
  const idx = Math.max(0, KICK_CLIP_MODES.indexOf(clipMode));

  const cycle = (dir: -1 | 1) => {
    const nextIdx = (idx + dir + KICK_CLIP_MODES.length) % KICK_CLIP_MODES.length;
    onChangeClipMode(KICK_CLIP_MODES[nextIdx]);
  };

  const driveNorm = clamp(drive / 100, 0, 1);
  const gainNorm = clamp(eqGain / 100, 0, 1);

  // Map 240..4200 Hz logarithmically to X = 14..88
  const peakX =
    14 +
    clamp(
      (Math.log10(clamp(eqFreqHz, 240, 4200)) - Math.log10(240)) /
        (Math.log10(4200) - Math.log10(240)),
      0,
      1
    ) *
      74;

  const { eqCurvePath, clipWavePath } = React.useMemo(() => {
    const eqPts: string[] = [];
    const clipPts: string[] = [];
    const steps = 54;
    const sigma = 11 - gainNorm * 5.2;
    const peakHeight = 3 + gainNorm * 21;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = t * 100;

      // 1. Pre-Distortion Parametric Peaking Curve ("Frequency Hunt")
      const bell = Math.exp(-Math.pow((x - peakX) / sigma, 2)) * peakHeight;
      const yEq = clamp(30 - bell, 4, 34);
      eqPts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${yEq.toFixed(1)}`);

      // 2. Clipped / Folded Transfer Waveform Preview (calibrated headroom)
      const raw = Math.sin(t * Math.PI * 2);
      const g = 1 + driveNorm * 2.55;
      let shaped = raw;
      switch (clipMode) {
        case 'GABBER': {
          const midBark = Math.sin(t * Math.PI * 4) * 0.22 * (0.3 + gainNorm * 0.7) * driveNorm;
          const driven = (raw + midBark) * g;
          shaped =
            driven >= 0
              ? clamp(Math.tanh(driven * 1.35) * 0.65 + clamp(driven, 0, 0.88) * 0.35, 0, 0.88)
              : clamp(Math.tanh(driven * 1.05) * 0.82, -0.8, 0);
          break;
        }
        case 'GCLIP':
          shaped = clamp(raw * g, -0.88, 0.88);
          break;
        case 'FOLD':
          shaped = clamp(Math.sin(raw * g * 1.25) * 0.9, -0.9, 0.9);
          break;
        case 'ZAAG':
          shaped =
            raw >= 0
              ? clamp(raw * g * 1.15, 0, 0.9)
              : clamp(Math.tanh(raw * g * 0.78) * 0.72, -0.82, 0);
          break;
        case 'BOILER': {
          const u = clamp(raw * (1 + driveNorm * 1.85), -1.16, 1.16);
          const cheb = 4 * u * u * u - 3 * u;
          shaped = Math.tanh(u * 1.28 + cheb * 0.28 * driveNorm) * 0.9;
          break;
        }
      }
      const yClip = 20 - shaped * 13;
      clipPts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${yClip.toFixed(1)}`);
    }

    return { eqCurvePath: eqPts.join(' '), clipWavePath: clipPts.join(' ') };
  }, [clipMode, driveNorm, gainNorm, peakX]);

  const freqLabel =
    eqFreqHz >= 1000 ? `${(eqFreqHz / 1000).toFixed(2)}k` : `${Math.round(eqFreqHz)}Hz`;

  return (
    <div className="relative w-full min-w-0" onContextMenu={midi.handleContextMenu}>
      <MidiLearnOverlayTag
        midiId={midiId}
        binding={midi.binding}
        isArmed={midi.isArmed}
        midiLearnMode={midi.midiLearnMode}
        onUnbind={midi.unbind}
        compact
      />
      <div
        onPointerDownCapture={(e) => {
          if (midi.interceptLearnEvent(e)) return;
        }}
        className={cn(
          'dsp-well rounded-[14px] w-full min-w-[82px] h-[68px] px-2 py-1.5 relative overflow-hidden flex flex-col justify-between select-none transition-shadow',
          midi.enabled && 'cursor-pointer',
          midi.isArmed && 'ring-2 ring-[#FFB35C] shadow-[0_0_14px_rgba(255,159,67,0.5)]',
          !midi.isArmed && midi.enabled && midi.binding && 'ring-2 ring-[#38BDF8]/85',
          !midi.isArmed &&
            midi.enabled &&
            !midi.binding &&
            'ring-1 ring-[#38BDF8]/40 hover:ring-[#38BDF8]',
          className
        )}
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{
            background: palette.wellGlow,
            opacity: 0.65 + driveNorm * 0.35,
          }}
        />

        {/* Top Row: Clipper Stage Mode + Pre-EQ Frequency Hunt Readout */}
        <div className="relative z-10 flex items-center justify-between gap-1 whitespace-nowrap">
          <span
            className="font-display font-semibold text-[8.5px] tracking-[0.09em] uppercase"
            style={{
              color: palette.bright,
              textShadow: `0 0 8px ${palette.primary}`,
            }}
          >
            {clipMode}
          </span>
          <span className="font-mono text-[8px] tabular-nums text-[#A5AEBF]">
            {freqLabel}
          </span>
        </div>

        {/* Bottom Row: Chevrons + Pre-EQ Resonant Spike & Clipped Wave SVG */}
        <div className="relative z-10 w-full flex items-center justify-between gap-0.5">
          <button
            type="button"
            onClick={() => !midi.enabled && cycle(-1)}
            aria-label="Previous kick distortion mode"
            className="w-3.5 h-6 flex items-center justify-center text-[#788094] hover:text-white transition-colors cursor-pointer shrink-0 focus-visible:outline-none"
          >
            <ChevronLeft size={11} strokeWidth={2} />
          </button>

          <svg
            className="flex-1 h-[36px] overflow-visible pointer-events-none"
            viewBox="0 0 100 38"
            preserveAspectRatio="none"
          >
            {/* Hard-clip ceiling guides */}
            <line
              x1="0"
              y1="8"
              x2="100"
              y2="8"
              stroke="rgba(255,255,255,0.08)"
              strokeDasharray="2 2"
              strokeWidth="0.9"
            />
            <line
              x1="0"
              y1="32"
              x2="100"
              y2="32"
              stroke="rgba(255,255,255,0.08)"
              strokeDasharray="2 2"
              strokeWidth="0.9"
            />
            {/* Shaded Pre-EQ Frequency Hunt Bell */}
            <path
              d={`${eqCurvePath} L 100 36 L 0 36 Z`}
              fill={palette.primary}
              fillOpacity={0.14 + gainNorm * 0.16}
            />
            <path
              d={eqCurvePath}
              fill="none"
              stroke={palette.primary}
              strokeOpacity="0.68"
              strokeWidth="1.25"
              vectorEffect="non-scaling-stroke"
            />
            {/* Post-Clipper / Wavefolder Output Contour */}
            <path
              d={clipWavePath}
              fill="none"
              stroke={palette.bright}
              strokeWidth="1.75"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              style={{ filter: `drop-shadow(0 0 ${4 + driveNorm * 5}px ${palette.primary})` }}
            />
          </svg>

          <button
            type="button"
            onClick={() => !midi.enabled && cycle(1)}
            aria-label="Next kick distortion mode"
            className="w-3.5 h-6 flex items-center justify-center text-[#788094] hover:text-white transition-colors cursor-pointer shrink-0 focus-visible:outline-none"
          >
            <ChevronRight size={11} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
});

/* ============================================================================
 * 3. KickAdsrDisplay — Glowing Interactive ADSR Graph with Draggable Handles
 * ============================================================================ */
type AdsrHandleId = 'attack' | 'decaySustain' | 'release';

export interface KickAdsrPatch {
  kickAttackMs?: number;
  kickDecayMs?: number;
  kickSustain?: number;
  kickReleaseMs?: number;
}

export interface KickAdsrDisplayProps {
  attackMs: number; // 0.5..65
  decayMs: number; // 60..1200
  sustain: number; // 0..100
  releaseMs: number; // 30..1200
  onChangeAdsr: (patch: KickAdsrPatch) => void;
  envPhase?: number; // 0..1 live envelope progress
  isPlaying?: boolean;
  accent?: DspAccent;
  midiId?: string;
  className?: string;
}

export const KickAdsrDisplay = React.memo(function KickAdsrDisplay({
  attackMs,
  decayMs,
  sustain,
  releaseMs,
  onChangeAdsr,
  envPhase = 0,
  isPlaying = false,
  accent = 'cyan',
  midiId,
  className,
}: KickAdsrDisplayProps) {
  const palette = ACCENT_PALETTES[accent];
  const midi = useMidiLearnTarget(midiId, 'Kick Sustain / ADSR');
  const gradId = useId();

  const [activeHandle, setActiveHandle] = useState<AdsrHandleId | null>(null);
  const [hoveredHandle, setHoveredHandle] = useState<AdsrHandleId | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragStartRef = useRef<{
    handle: AdsrHandleId;
    startX: number;
    startY: number;
    atk: number;
    dec: number;
    sus: number;
    rel: number;
  } | null>(null);

  const safeAtk = clamp(attackMs, 0.5, 65);
  const safeDec = clamp(decayMs, 60, 1200);
  const safeSus = clamp(sustain, 0, 100);
  const safeRel = clamp(releaseMs, 30, 1200);

  // Normalized 0..1 coordinates
  const atkNorm = clamp((safeAtk - 0.5) / 64.5, 0, 1);
  const decNorm = clamp((safeDec - 60) / 1140, 0, 1);
  const susNorm = clamp(safeSus / 100, 0, 1);
  const relNorm = clamp((safeRel - 30) / 1170, 0, 1);

  // SVG coordinate space: width 164, height 42 (yPeak = 6, yFloor = 36.5)
  const xStart = 5;
  const yPeak = 6;
  const yFloor = 36.5;
  const xA = xStart + 5 + atkNorm * 32; // 10..42
  const xD = xA + 12 + decNorm * 44; // 22..98
  const yS = yFloor - susNorm * (yFloor - yPeak); // 36.5..6
  const xS = xD + 16; // Sustain hold plateau
  const xR = Math.min(158, xS + 9 + relNorm * 41); // Release tail endpoint

  // Build smooth analog RC-curved ADSR path + live playhead dot coordinates
  const { strokePath, areaPath, tracerPt } = React.useMemo(() => {
    const pts: Array<{ x: number; y: number }> = [];

    // Stage 1: Attack (convex punch rise)
    const atkSteps = 8;
    for (let i = 0; i <= atkSteps; i++) {
      const u = i / atkSteps;
      const x = xStart + (xA - xStart) * u;
      const shaped = 1 - Math.pow(1 - u, 1.85);
      const y = yFloor - shaped * (yFloor - yPeak);
      pts.push({ x, y });
    }

    // Stage 2: Decay (concave exponential drop to sustain plateau)
    const decSteps = 14;
    for (let i = 1; i <= decSteps; i++) {
      const u = i / decSteps;
      const x = xA + (xD - xA) * u;
      const expDrop = (Math.exp(-u * 3.1) - Math.exp(-3.1)) / (1 - Math.exp(-3.1));
      const y = yS + (yPeak - yS) * expDrop;
      pts.push({ x, y });
    }

    // Stage 3: Sustain plateau
    pts.push({ x: xS, y: yS });

    // Stage 4: Release (concave exponential ring-out to baseline)
    const relSteps = 14;
    for (let i = 1; i <= relSteps; i++) {
      const u = i / relSteps;
      const x = xS + (xR - xS) * u;
      const expRel = (Math.exp(-u * 3.3) - Math.exp(-3.3)) / (1 - Math.exp(-3.3));
      const y = yFloor - (yFloor - yS) * expRel;
      pts.push({ x, y });
    }

    const d = pts
      .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(' ');
    const area = `${d} L ${xR.toFixed(1)} ${yFloor.toFixed(1)} L ${xStart.toFixed(1)} ${yFloor.toFixed(1)} Z`;

    const pNorm = clamp(envPhase, 0, 1);
    const sampleIdx = Math.min(pts.length - 1, Math.floor(pNorm * (pts.length - 1)));
    const pt = pts[sampleIdx] || { x: xStart, y: yFloor };

    return { strokePath: d, areaPath: area, tracerPt: pt };
  }, [xA, xD, xS, xR, yS, envPhase]);

  const startHandleDrag = useCallback(
    (handle: AdsrHandleId, e: React.PointerEvent) => {
      if (midi.interceptLearnEvent(e)) return;
      e.preventDefault();
      e.stopPropagation();
      dragStartRef.current = {
        handle,
        startX: e.clientX,
        startY: e.clientY,
        atk: safeAtk,
        dec: safeDec,
        sus: safeSus,
        rel: safeRel,
      };
      setActiveHandle(handle);
    },
    [midi, safeAtk, safeDec, safeSus, safeRel]
  );

  useEffect(() => {
    if (!activeHandle) return;

    const handleMove = (e: PointerEvent) => {
      const st = dragStartRef.current;
      if (!st) return;
      const fine = e.shiftKey ? 0.3 : 1.0;
      const dx = (e.clientX - st.startX) * fine;
      const dy = (st.startY - e.clientY) * fine;

      if (st.handle === 'attack') {
        const nextAtk = clamp(Number((st.atk + (dx / 85) * 64.5).toFixed(1)), 0.5, 65);
        onChangeAdsr({ kickAttackMs: nextAtk });
      } else if (st.handle === 'decaySustain') {
        const nextDec = clamp(Math.round((st.dec + (dx / 95) * 1140) / 5) * 5, 60, 1200);
        const nextSus = clamp(Math.round(st.sus + (dy / 48) * 100), 0, 100);
        onChangeAdsr({ kickDecayMs: nextDec, kickSustain: nextSus });
      } else if (st.handle === 'release') {
        const nextRel = clamp(Math.round((st.rel + (dx / 95) * 1170) / 5) * 5, 30, 1200);
        onChangeAdsr({ kickReleaseMs: nextRel });
      }
    };

    const handleUp = () => {
      dragStartRef.current = null;
      setActiveHandle(null);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [activeHandle, onChangeAdsr]);

  const resetHandle = (handle: AdsrHandleId) => {
    if (handle === 'attack') onChangeAdsr({ kickAttackMs: 1.8 });
    else if (handle === 'decaySustain') onChangeAdsr({ kickDecayMs: 240, kickSustain: 68 });
    else onChangeAdsr({ kickReleaseMs: 220 });
  };

  const focusedHandle = activeHandle ?? hoveredHandle;

  const activeTooltip =
    activeHandle === 'attack'
      ? `Attack ${safeAtk < 10 ? safeAtk.toFixed(1) : Math.round(safeAtk)} ms`
      : activeHandle === 'decaySustain'
      ? `Decay ${Math.round(safeDec)} ms · Sus ${Math.round(safeSus)}%`
      : activeHandle === 'release'
      ? `Release ${Math.round(safeRel)} ms`
      : null;

  return (
    <div className="relative flex-1 w-full min-w-0" onContextMenu={midi.handleContextMenu}>
      <MidiLearnOverlayTag
        midiId={midiId}
        binding={midi.binding}
        isArmed={midi.isArmed}
        midiLearnMode={midi.midiLearnMode}
        onUnbind={midi.unbind}
        compact
      />

      {activeTooltip && !midi.enabled && (
        <div className="absolute -top-6 left-1/2 -translate-x-1/2 z-30 px-1.5 py-0.5 rounded bg-[#111319] border border-white/15 font-mono text-[9px] tabular-nums text-white shadow-md whitespace-nowrap pointer-events-none">
          {activeTooltip}
        </div>
      )}

      <div
        onPointerDownCapture={(e) => {
          if (midi.interceptLearnEvent(e)) return;
        }}
        className={cn(
          'dsp-well rounded-[14px] w-full h-[66px] px-2 py-1 relative overflow-hidden flex flex-col justify-between select-none transition-shadow',
          midi.enabled && 'cursor-pointer',
          midi.isArmed && 'ring-2 ring-[#FFB35C] shadow-[0_0_14px_rgba(255,159,67,0.5)]',
          !midi.isArmed && midi.enabled && midi.binding && 'ring-2 ring-[#38BDF8]/85',
          !midi.isArmed &&
            midi.enabled &&
            !midi.binding &&
            'ring-1 ring-[#38BDF8]/40 hover:ring-[#38BDF8]',
          className
        )}
      >
        {/* Ambient Phosphor Backlight */}
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{
            background: palette.wellGlow,
            opacity: activeHandle ? 1 : 0.82,
          }}
        />

        {/* Top Telemetry Strip: Tabular A · D · S · R Readouts */}
        <div className="relative z-10 flex items-center justify-between gap-1 font-mono text-[7.5px] tabular-nums whitespace-nowrap">
          <span
            style={{
              color: focusedHandle === 'attack' ? palette.bright : '#9AA3B8',
              textShadow: focusedHandle === 'attack' ? `0 0 6px ${palette.primary}` : 'none',
            }}
          >
            A {safeAtk < 10 ? safeAtk.toFixed(1) : Math.round(safeAtk)}m
          </span>
          <span
            style={{
              color: focusedHandle === 'decaySustain' ? palette.bright : '#9AA3B8',
              textShadow: focusedHandle === 'decaySustain' ? `0 0 6px ${palette.primary}` : 'none',
            }}
          >
            D {Math.round(safeDec)}m
          </span>
          <span
            style={{
              color: focusedHandle === 'decaySustain' ? palette.bright : '#9AA3B8',
              textShadow: focusedHandle === 'decaySustain' ? `0 0 6px ${palette.primary}` : 'none',
            }}
          >
            S {Math.round(safeSus)}%
          </span>
          <span
            style={{
              color: focusedHandle === 'release' ? palette.bright : '#9AA3B8',
              textShadow: focusedHandle === 'release' ? `0 0 6px ${palette.primary}` : 'none',
            }}
          >
            R {Math.round(safeRel)}m
          </span>
        </div>

        {/* Interactive Glowing Envelope Curve + 3 Draggable Phosphor Nodes */}
        <svg
          ref={svgRef}
          className="relative z-10 w-full h-[44px] overflow-visible touch-none"
          viewBox="0 0 164 42"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={palette.bright} stopOpacity="0.38" />
              <stop offset="65%" stopColor={palette.primary} stopOpacity="0.14" />
              <stop offset="100%" stopColor={palette.primary} stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {/* Subtle Horizon Gridlines */}
          <line
            x1="4"
            y1="21"
            x2="160"
            y2="21"
            stroke="rgba(255,255,255,0.06)"
            strokeDasharray="2 2"
            strokeWidth="0.8"
          />
          <line
            x1="4"
            y1={yFloor}
            x2="160"
            y2={yFloor}
            stroke="rgba(255,255,255,0.1)"
            strokeWidth="0.9"
          />

          {/* Stage Drop Guides */}
          <line
            x1={xA}
            y1={yPeak}
            x2={xA}
            y2={yFloor}
            stroke={palette.primary}
            strokeOpacity="0.22"
            strokeDasharray="1.5 2"
            strokeWidth="0.8"
          />
          <line
            x1={xD}
            y1={yS}
            x2={xD}
            y2={yFloor}
            stroke={palette.primary}
            strokeOpacity="0.22"
            strokeDasharray="1.5 2"
            strokeWidth="0.8"
          />

          {/* Glowing Shaded Envelope Fill */}
          <path d={areaPath} fill={`url(#${gradId})`} />

          {/* Outer Soft Bloom Stroke */}
          <path
            d={strokePath}
            fill="none"
            stroke={palette.primary}
            strokeOpacity="0.45"
            strokeWidth="3.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            style={{ filter: `blur(2px)` }}
          />

          {/* Core Laser-Sharp Envelope Trace */}
          <path
            d={strokePath}
            fill="none"
            stroke={palette.bright}
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            style={{ filter: `drop-shadow(0 0 6px ${palette.primary})` }}
          />

          {/* Live Kick Envelope Playhead Tracer */}
          {isPlaying && (
            <circle
              cx={tracerPt.x}
              cy={tracerPt.y}
              r="2.4"
              fill="#FFFFFF"
              style={{ filter: `drop-shadow(0 0 6px ${palette.bright})` }}
              className="pointer-events-none"
            />
          )}

          {/* Handle 1: Attack Peak Node */}
          <g
            onPointerDown={(e) => startHandleDrag('attack', e)}
            onDoubleClick={() => resetHandle('attack')}
            onPointerEnter={() => setHoveredHandle('attack')}
            onPointerLeave={() => setHoveredHandle((h) => (h === 'attack' ? null : h))}
            className="cursor-ew-resize"
          >
            <circle cx={xA} cy={yPeak} r="8.5" fill="transparent" />
            <circle
              cx={xA}
              cy={yPeak}
              r={focusedHandle === 'attack' ? 5.2 : 3.8}
              fill={palette.primary}
              fillOpacity={focusedHandle === 'attack' ? 0.38 : 0.22}
              style={{ filter: `drop-shadow(0 0 6px ${palette.primary})` }}
            />
            <circle
              cx={xA}
              cy={yPeak}
              r={focusedHandle === 'attack' ? 2.8 : 2.2}
              fill="#FFFFFF"
              stroke={palette.bright}
              strokeWidth="1.2"
              style={{ filter: `drop-shadow(0 0 5px ${palette.bright})` }}
            />
          </g>

          {/* Handle 2: 2D Decay + Sustain Knee Node */}
          <g
            onPointerDown={(e) => startHandleDrag('decaySustain', e)}
            onDoubleClick={() => resetHandle('decaySustain')}
            onPointerEnter={() => setHoveredHandle('decaySustain')}
            onPointerLeave={() => setHoveredHandle((h) => (h === 'decaySustain' ? null : h))}
            className="cursor-move"
          >
            <circle cx={xD} cy={yS} r="9" fill="transparent" />
            <circle
              cx={xD}
              cy={yS}
              r={focusedHandle === 'decaySustain' ? 5.6 : 4.1}
              fill={palette.primary}
              fillOpacity={focusedHandle === 'decaySustain' ? 0.42 : 0.24}
              style={{ filter: `drop-shadow(0 0 7px ${palette.primary})` }}
            />
            <circle
              cx={xD}
              cy={yS}
              r={focusedHandle === 'decaySustain' ? 3.0 : 2.35}
              fill="#FFFFFF"
              stroke={palette.bright}
              strokeWidth="1.2"
              style={{ filter: `drop-shadow(0 0 6px ${palette.bright})` }}
            />
          </g>

          {/* Handle 3: Release Tail Node */}
          <g
            onPointerDown={(e) => startHandleDrag('release', e)}
            onDoubleClick={() => resetHandle('release')}
            onPointerEnter={() => setHoveredHandle('release')}
            onPointerLeave={() => setHoveredHandle((h) => (h === 'release' ? null : h))}
            className="cursor-ew-resize"
          >
            <circle cx={xR} cy={yFloor} r="8.5" fill="transparent" />
            <circle
              cx={xR}
              cy={yFloor}
              r={focusedHandle === 'release' ? 5.2 : 3.8}
              fill={palette.primary}
              fillOpacity={focusedHandle === 'release' ? 0.38 : 0.22}
              style={{ filter: `drop-shadow(0 0 6px ${palette.primary})` }}
            />
            <circle
              cx={xR}
              cy={yFloor}
              r={focusedHandle === 'release' ? 2.8 : 2.2}
              fill="#FFFFFF"
              stroke={palette.bright}
              strokeWidth="1.2"
              style={{ filter: `drop-shadow(0 0 5px ${palette.bright})` }}
            />
          </g>
        </svg>
      </div>
    </div>
  );
});

/* ============================================================================
 * 4. KickLfoDisplay — Recessed Glowing Kick LFO Wave + Target + Rate Well
 * ============================================================================ */
export interface KickLfoDisplayProps {
  shape: KickLfoShape;
  onChangeShape: (next: KickLfoShape) => void;
  target: KickLfoTarget;
  onChangeTarget: (next: KickLfoTarget) => void;
  rateHz: number; // 0.2..24.0
  onChangeRateHz: (hz: number) => void;
  depth: number; // 0..100
  lfoPhase?: number; // 0..1
  active?: boolean;
  accent?: DspAccent;
  midiId?: string;
  className?: string;
}

function evalLfoShape(shape: KickLfoShape, phase: number): number {
  const p = ((phase % 1) + 1) % 1;
  switch (shape) {
    case 'SINE':
      return Math.sin(p * Math.PI * 2);
    case 'TRI':
      return p < 0.5 ? 1 - 4 * p : -1 + 4 * (p - 0.5);
    case 'SAW':
      return 1 - 2 * p;
    case 'SQR':
      return Math.tanh(Math.sin(p * Math.PI * 2) * 9);
  }
}

export const KickLfoDisplay = React.memo(function KickLfoDisplay({
  shape,
  onChangeShape,
  target,
  onChangeTarget,
  rateHz,
  onChangeRateHz,
  depth,
  lfoPhase = 0,
  active = false,
  accent = 'violet',
  midiId,
  className,
}: KickLfoDisplayProps) {
  const palette = ACCENT_PALETTES[accent];
  const midi = useMidiLearnTarget(midiId, 'Kick LFO Rate (Hz)');
  const [draggingRate, setDraggingRate] = useState(false);
  const rateDragRef = useRef<{ startY: number; startHz: number }>({ startY: 0, startHz: rateHz });

  const shapeIdx = Math.max(0, KICK_LFO_SHAPES.indexOf(shape));
  const targetIdx = Math.max(0, KICK_LFO_TARGETS.indexOf(target));

  const cycleShape = (dir: -1 | 1) => {
    const next = (shapeIdx + dir + KICK_LFO_SHAPES.length) % KICK_LFO_SHAPES.length;
    onChangeShape(KICK_LFO_SHAPES[next]);
  };

  const cycleTarget = () => {
    const next = (targetIdx + 1) % KICK_LFO_TARGETS.length;
    onChangeTarget(KICK_LFO_TARGETS[next]);
  };

  const safeRate = clamp(rateHz, 0.2, 24.0);
  const depthNorm = clamp(depth / 100, 0.14, 1);

  useEffect(() => {
    if (!draggingRate) return;

    const onMove = (e: PointerEvent) => {
      const dy = rateDragRef.current.startY - e.clientY;
      const sens = e.shiftKey ? 280 : 95;
      const next = clamp(
        Number((rateDragRef.current.startHz + (dy / sens) * 23.8).toFixed(1)),
        0.2,
        24.0
      );
      onChangeRateHz(next);
    };

    const onUp = () => setDraggingRate(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [draggingRate, onChangeRateHz]);

  const { wavePath, dotX, dotY } = React.useMemo(() => {
    const pts: string[] = [];
    const steps = 48;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const v = evalLfoShape(shape, t) * depthNorm;
      const x = t * 100;
      const y = 19 - v * 13.5;
      pts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    const pNorm = ((lfoPhase % 1) + 1) % 1;
    const dx = pNorm * 100;
    const dy = 19 - evalLfoShape(shape, pNorm) * depthNorm * 13.5;
    return { wavePath: pts.join(' '), dotX: dx, dotY: dy };
  }, [shape, depthNorm, lfoPhase]);

  return (
    <div className="relative flex-1 min-w-[78px]" onContextMenu={midi.handleContextMenu}>
      <MidiLearnOverlayTag
        midiId={midiId}
        binding={midi.binding}
        isArmed={midi.isArmed}
        midiLearnMode={midi.midiLearnMode}
        onUnbind={midi.unbind}
        compact
      />

      {draggingRate && !midi.enabled && (
        <div className="absolute -top-6 left-1/2 -translate-x-1/2 z-30 px-1.5 py-0.5 rounded bg-[#111319] border border-white/15 font-mono text-[9px] tabular-nums text-white shadow-md whitespace-nowrap pointer-events-none">
          LFO {safeRate.toFixed(1)} Hz
        </div>
      )}

      <div
        onPointerDownCapture={(e) => {
          if (midi.interceptLearnEvent(e)) return;
        }}
        className={cn(
          'dsp-well rounded-[14px] w-full h-[66px] px-2 py-1.5 relative overflow-hidden flex flex-col justify-between select-none transition-shadow',
          midi.enabled && 'cursor-pointer',
          midi.isArmed && 'ring-2 ring-[#FFB35C] shadow-[0_0_14px_rgba(255,159,67,0.5)]',
          !midi.isArmed && midi.enabled && midi.binding && 'ring-2 ring-[#38BDF8]/85',
          !midi.isArmed &&
            midi.enabled &&
            !midi.binding &&
            'ring-1 ring-[#38BDF8]/40 hover:ring-[#38BDF8]',
          className
        )}
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{
            background: palette.wellGlow,
            opacity: active ? 0.95 : 0.45,
          }}
        />

        {/* Top Row: Clickable Target Selector + Draggable Hz Rate */}
        <div className="relative z-10 flex items-center justify-between gap-1 whitespace-nowrap">
          <button
            type="button"
            onClick={() => !midi.enabled && cycleTarget()}
            title="Click to cycle Kick LFO modulation target (HUNT EQ · FM · PITCH · AMP)"
            className="font-display font-semibold text-[8px] tracking-[0.08em] uppercase hover:text-white transition-colors cursor-pointer focus-visible:outline-none"
            style={{
              color: palette.bright,
              textShadow: active ? `0 0 7px ${palette.primary}` : 'none',
            }}
          >
            →{target}
          </button>

          <span
            role="slider"
            tabIndex={0}
            aria-label="Kick LFO Rate Hz"
            aria-valuemin={0.2}
            aria-valuemax={24.0}
            aria-valuenow={safeRate}
            title="Drag up/down or scroll to adjust LFO Rate (double-click to reset)"
            onPointerDown={(e) => {
              if (midi.enabled) return;
              e.preventDefault();
              e.stopPropagation();
              rateDragRef.current = { startY: e.clientY, startHz: safeRate };
              setDraggingRate(true);
            }}
            onDoubleClick={() => !midi.enabled && onChangeRateHz(4.0)}
            onWheel={(e) => {
              if (midi.enabled) return;
              e.preventDefault();
              const dir = e.deltaY < 0 ? 1 : -1;
              onChangeRateHz(clamp(Number((safeRate + dir * 0.2).toFixed(1)), 0.2, 24.0));
            }}
            className="font-mono text-[8px] tabular-nums text-[#C4CCE0] hover:text-white cursor-ns-resize px-0.5 rounded"
          >
            {safeRate.toFixed(1)}Hz
          </span>
        </div>

        {/* Bottom Row: Shape Chevrons + Glowing LFO Waveform + Live Phase Orb */}
        <div className="relative z-10 w-full flex items-center justify-between gap-0.5">
          <button
            type="button"
            onClick={() => !midi.enabled && cycleShape(-1)}
            aria-label="Previous LFO shape"
            className="w-3 h-6 flex items-center justify-center text-[#788094] hover:text-white transition-colors cursor-pointer shrink-0 focus-visible:outline-none"
          >
            <ChevronLeft size={10} strokeWidth={2} />
          </button>

          <svg
            className="flex-1 h-[34px] overflow-visible pointer-events-none"
            viewBox="0 0 100 38"
            preserveAspectRatio="none"
          >
            <line
              x1="0"
              y1="19"
              x2="100"
              y2="19"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="0.9"
            />
            <path
              d={wavePath}
              fill="none"
              stroke={active ? palette.bright : palette.primary}
              strokeOpacity={active ? 1 : 0.55}
              strokeWidth="1.7"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              style={{
                filter: active ? `drop-shadow(0 0 5px ${palette.primary})` : 'none',
              }}
            />
            {active && (
              <circle
                cx={dotX}
                cy={dotY}
                r="2.4"
                fill="#FFFFFF"
                style={{ filter: `drop-shadow(0 0 5px ${palette.bright})` }}
              />
            )}
          </svg>

          <button
            type="button"
            onClick={() => !midi.enabled && cycleShape(1)}
            aria-label="Next LFO shape"
            className="w-3 h-6 flex items-center justify-center text-[#788094] hover:text-white transition-colors cursor-pointer shrink-0 focus-visible:outline-none"
          >
            <ChevronRight size={10} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
});

/* ============================================================================
 * 5. SynthAdsrDisplay — Glowing Interactive Synth ADSR Graph with Draggable Handles
 * ============================================================================ */
export interface SynthAdsrPatch {
  attackMs?: number;
  decayMs?: number;
  sustain?: number;
  releaseMs?: number;
}

export interface SynthAdsrDisplayProps {
  attackMs: number; // 5..600
  decayMs: number; // 40..1500
  sustain: number; // 0..100
  releaseMs: number; // 40..1500
  onChangeAdsr: (patch: SynthAdsrPatch) => void;
  envPhase?: number; // 0..1 live envelope progress
  isPlaying?: boolean;
  accent?: DspAccent;
  midiId?: string;
  className?: string;
}

export const SynthAdsrDisplay = React.memo(function SynthAdsrDisplay({
  attackMs,
  decayMs,
  sustain,
  releaseMs,
  onChangeAdsr,
  envPhase = 0,
  isPlaying = false,
  accent = 'cyan',
  midiId,
  className,
}: SynthAdsrDisplayProps) {
  const palette = ACCENT_PALETTES[accent];
  const midi = useMidiLearnTarget(midiId, 'Synth Sustain / ADSR');
  const gradId = useId();

  const [activeHandle, setActiveHandle] = useState<AdsrHandleId | null>(null);
  const [hoveredHandle, setHoveredHandle] = useState<AdsrHandleId | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragStartRef = useRef<{
    handle: AdsrHandleId;
    startX: number;
    startY: number;
    atk: number;
    dec: number;
    sus: number;
    rel: number;
  } | null>(null);

  const safeAtk = clamp(attackMs, 5, 600);
  const safeDec = clamp(decayMs, 40, 1500);
  const safeSus = clamp(sustain, 0, 100);
  const safeRel = clamp(releaseMs, 40, 1500);

  // Non-linear perceptual mapping so fast attacks (5-80ms) and snappy decays have generous handle resolution
  const atkNorm = Math.pow(clamp((safeAtk - 5) / 595, 0, 1), 0.72);
  const decNorm = Math.pow(clamp((safeDec - 40) / 1460, 0, 1), 0.8);
  const susNorm = clamp(safeSus / 100, 0, 1);
  const relNorm = Math.pow(clamp((safeRel - 40) / 1460, 0, 1), 0.8);

  const xStart = 5;
  const yPeak = 6;
  const yFloor = 36.5;
  const xA = xStart + 5 + atkNorm * 34; // 10..44
  const xD = xA + 12 + decNorm * 42; // 22..98
  const yS = yFloor - susNorm * (yFloor - yPeak); // 36.5..6
  const xS = xD + 16; // Sustain hold plateau
  const xR = Math.min(158, xS + 9 + relNorm * 40); // Release tail endpoint

  const { strokePath, areaPath, tracerPt } = React.useMemo(() => {
    const pts: Array<{ x: number; y: number }> = [];

    // Stage 1: Attack (smooth analog rise)
    const atkSteps = 8;
    for (let i = 0; i <= atkSteps; i++) {
      const u = i / atkSteps;
      const x = xStart + (xA - xStart) * u;
      const shaped = 1 - Math.pow(1 - u, 1.75);
      const y = yFloor - shaped * (yFloor - yPeak);
      pts.push({ x, y });
    }

    // Stage 2: Decay (concave RC drop to sustain plateau)
    const decSteps = 14;
    for (let i = 1; i <= decSteps; i++) {
      const u = i / decSteps;
      const x = xA + (xD - xA) * u;
      const expDrop = (Math.exp(-u * 3.0) - Math.exp(-3.0)) / (1 - Math.exp(-3.0));
      const y = yS + (yPeak - yS) * expDrop;
      pts.push({ x, y });
    }

    // Stage 3: Sustain plateau (add intermediate samples so held-note playhead sits clearly on plateau)
    const susSteps = 6;
    for (let i = 1; i <= susSteps; i++) {
      const u = i / susSteps;
      pts.push({ x: xD + (xS - xD) * u, y: yS });
    }

    // Stage 4: Release (concave exponential ring-out to baseline)
    const relSteps = 14;
    for (let i = 1; i <= relSteps; i++) {
      const u = i / relSteps;
      const x = xS + (xR - xS) * u;
      const expRel = (Math.exp(-u * 3.2) - Math.exp(-3.2)) / (1 - Math.exp(-3.2));
      const y = yFloor - (yFloor - yS) * expRel;
      pts.push({ x, y });
    }

    const d = pts
      .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(' ');
    const area = `${d} L ${xR.toFixed(1)} ${yFloor.toFixed(1)} L ${xStart.toFixed(1)} ${yFloor.toFixed(1)} Z`;

    const pNorm = clamp(envPhase, 0, 1);
    const sampleIdx = Math.min(pts.length - 1, Math.floor(pNorm * (pts.length - 1)));
    const pt = pts[sampleIdx] || { x: xStart, y: yFloor };

    return { strokePath: d, areaPath: area, tracerPt: pt };
  }, [xA, xD, xS, xR, yS, envPhase]);

  const startHandleDrag = useCallback(
    (handle: AdsrHandleId, e: React.PointerEvent) => {
      if (midi.interceptLearnEvent(e)) return;
      e.preventDefault();
      e.stopPropagation();
      dragStartRef.current = {
        handle,
        startX: e.clientX,
        startY: e.clientY,
        atk: safeAtk,
        dec: safeDec,
        sus: safeSus,
        rel: safeRel,
      };
      setActiveHandle(handle);
    },
    [midi, safeAtk, safeDec, safeSus, safeRel]
  );

  useEffect(() => {
    if (!activeHandle) return;

    const handleMove = (e: PointerEvent) => {
      const st = dragStartRef.current;
      if (!st) return;
      const fine = e.shiftKey ? 0.3 : 1.0;
      const dx = (e.clientX - st.startX) * fine;
      const dy = (st.startY - e.clientY) * fine;

      if (st.handle === 'attack') {
        const startNorm = Math.pow(clamp((st.atk - 5) / 595, 0, 1), 0.72);
        const nextNorm = clamp(startNorm + dx / 92, 0, 1);
        const rawAtk = 5 + Math.pow(nextNorm, 1 / 0.72) * 595;
        const nextAtk = clamp(
          rawAtk < 40 ? Math.round(rawAtk) : Math.round(rawAtk / 5) * 5,
          5,
          600
        );
        onChangeAdsr({ attackMs: nextAtk });
      } else if (st.handle === 'decaySustain') {
        const startDecNorm = Math.pow(clamp((st.dec - 40) / 1460, 0, 1), 0.8);
        const nextDecNorm = clamp(startDecNorm + dx / 96, 0, 1);
        const rawDec = 40 + Math.pow(nextDecNorm, 1 / 0.8) * 1460;
        const nextDec = clamp(Math.round(rawDec / 10) * 10, 40, 1500);
        const nextSus = clamp(Math.round(st.sus + (dy / 48) * 100), 0, 100);
        onChangeAdsr({ decayMs: nextDec, sustain: nextSus });
      } else if (st.handle === 'release') {
        const startRelNorm = Math.pow(clamp((st.rel - 40) / 1460, 0, 1), 0.8);
        const nextRelNorm = clamp(startRelNorm + dx / 96, 0, 1);
        const rawRel = 40 + Math.pow(nextRelNorm, 1 / 0.8) * 1460;
        const nextRel = clamp(Math.round(rawRel / 10) * 10, 40, 1500);
        onChangeAdsr({ releaseMs: nextRel });
      }
    };

    const handleUp = () => {
      dragStartRef.current = null;
      setActiveHandle(null);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [activeHandle, onChangeAdsr]);

  const resetHandle = (handle: AdsrHandleId) => {
    if (handle === 'attack') onChangeAdsr({ attackMs: 12 });
    else if (handle === 'decaySustain') onChangeAdsr({ decayMs: 320, sustain: 82 });
    else onChangeAdsr({ releaseMs: 150 });
  };

  const focusedHandle = activeHandle ?? hoveredHandle;

  const activeTooltip =
    activeHandle === 'attack'
      ? `Attack ${Math.round(safeAtk)} ms`
      : activeHandle === 'decaySustain'
      ? `Decay ${Math.round(safeDec)} ms · Sus ${Math.round(safeSus)}%`
      : activeHandle === 'release'
      ? `Release ${Math.round(safeRel)} ms`
      : null;

  const fmtMs = (ms: number) =>
    ms >= 1000 ? `${(ms / 1000).toFixed(2).replace(/0$/, '')}s` : `${Math.round(ms)}m`;

  return (
    <div className="relative flex-1 w-full min-w-0" onContextMenu={midi.handleContextMenu}>
      <MidiLearnOverlayTag
        midiId={midiId}
        binding={midi.binding}
        isArmed={midi.isArmed}
        midiLearnMode={midi.midiLearnMode}
        onUnbind={midi.unbind}
        compact
      />

      {activeTooltip && !midi.enabled && (
        <div className="absolute -top-6 left-1/2 -translate-x-1/2 z-30 px-1.5 py-0.5 rounded bg-[#111319] border border-white/15 font-mono text-[9px] tabular-nums text-white shadow-md whitespace-nowrap pointer-events-none">
          {activeTooltip}
        </div>
      )}

      <div
        onPointerDownCapture={(e) => {
          if (midi.interceptLearnEvent(e)) return;
        }}
        className={cn(
          'dsp-well rounded-[14px] w-full h-[66px] px-2 py-1 relative overflow-hidden flex flex-col justify-between select-none transition-shadow',
          midi.enabled && 'cursor-pointer',
          midi.isArmed && 'ring-2 ring-[#FFB35C] shadow-[0_0_14px_rgba(255,159,67,0.5)]',
          !midi.isArmed && midi.enabled && midi.binding && 'ring-2 ring-[#38BDF8]/85',
          !midi.isArmed &&
            midi.enabled &&
            !midi.binding &&
            'ring-1 ring-[#38BDF8]/40 hover:ring-[#38BDF8]',
          className
        )}
      >
        {/* Ambient Phosphor Backlight */}
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{
            background: palette.wellGlow,
            opacity: activeHandle ? 1 : 0.84,
          }}
        />

        {/* Top Telemetry Strip: Tabular A · D · S · R Readouts */}
        <div className="relative z-10 flex items-center justify-between gap-1 font-mono text-[7.5px] tabular-nums whitespace-nowrap">
          <span
            style={{
              color: focusedHandle === 'attack' ? palette.bright : '#9AA3B8',
              textShadow: focusedHandle === 'attack' ? `0 0 6px ${palette.primary}` : 'none',
            }}
          >
            A {fmtMs(safeAtk)}
          </span>
          <span
            style={{
              color: focusedHandle === 'decaySustain' ? palette.bright : '#9AA3B8',
              textShadow: focusedHandle === 'decaySustain' ? `0 0 6px ${palette.primary}` : 'none',
            }}
          >
            D {fmtMs(safeDec)}
          </span>
          <span
            style={{
              color: focusedHandle === 'decaySustain' ? palette.bright : '#9AA3B8',
              textShadow: focusedHandle === 'decaySustain' ? `0 0 6px ${palette.primary}` : 'none',
            }}
          >
            S {Math.round(safeSus)}%
          </span>
          <span
            style={{
              color: focusedHandle === 'release' ? palette.bright : '#9AA3B8',
              textShadow: focusedHandle === 'release' ? `0 0 6px ${palette.primary}` : 'none',
            }}
          >
            R {fmtMs(safeRel)}
          </span>
        </div>

        {/* Interactive Glowing Envelope Curve + 3 Draggable Phosphor Nodes */}
        <svg
          ref={svgRef}
          className="relative z-10 w-full h-[44px] overflow-visible touch-none"
          viewBox="0 0 164 42"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={palette.bright} stopOpacity="0.4" />
              <stop offset="65%" stopColor={palette.primary} stopOpacity="0.15" />
              <stop offset="100%" stopColor={palette.primary} stopOpacity="0.01" />
            </linearGradient>
          </defs>

          <line
            x1="4"
            y1="21"
            x2="160"
            y2="21"
            stroke="rgba(255,255,255,0.06)"
            strokeDasharray="2 2"
            strokeWidth="0.8"
          />
          <line
            x1="4"
            y1={yFloor}
            x2="160"
            y2={yFloor}
            stroke="rgba(255,255,255,0.1)"
            strokeWidth="0.9"
          />

          <line
            x1={xA}
            y1={yPeak}
            x2={xA}
            y2={yFloor}
            stroke={palette.primary}
            strokeOpacity="0.22"
            strokeDasharray="1.5 2"
            strokeWidth="0.8"
          />
          <line
            x1={xD}
            y1={yS}
            x2={xD}
            y2={yFloor}
            stroke={palette.primary}
            strokeOpacity="0.22"
            strokeDasharray="1.5 2"
            strokeWidth="0.8"
          />

          <path d={areaPath} fill={`url(#${gradId})`} />

          <path
            d={strokePath}
            fill="none"
            stroke={palette.primary}
            strokeOpacity="0.46"
            strokeWidth="3.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            style={{ filter: `blur(2px)` }}
          />

          <path
            d={strokePath}
            fill="none"
            stroke={palette.bright}
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            style={{ filter: `drop-shadow(0 0 6px ${palette.primary})` }}
          />

          {isPlaying && (
            <circle
              cx={tracerPt.x}
              cy={tracerPt.y}
              r="2.4"
              fill="#FFFFFF"
              style={{ filter: `drop-shadow(0 0 6px ${palette.bright})` }}
              className="pointer-events-none"
            />
          )}

          {/* Handle 1: Attack Peak Node */}
          <g
            onPointerDown={(e) => startHandleDrag('attack', e)}
            onDoubleClick={() => resetHandle('attack')}
            onPointerEnter={() => setHoveredHandle('attack')}
            onPointerLeave={() => setHoveredHandle((h) => (h === 'attack' ? null : h))}
            className="cursor-ew-resize"
          >
            <circle cx={xA} cy={yPeak} r="8.5" fill="transparent" />
            <circle
              cx={xA}
              cy={yPeak}
              r={focusedHandle === 'attack' ? 5.2 : 3.8}
              fill={palette.primary}
              fillOpacity={focusedHandle === 'attack' ? 0.38 : 0.22}
              style={{ filter: `drop-shadow(0 0 6px ${palette.primary})` }}
            />
            <circle
              cx={xA}
              cy={yPeak}
              r={focusedHandle === 'attack' ? 2.8 : 2.2}
              fill="#FFFFFF"
              stroke={palette.bright}
              strokeWidth="1.2"
              style={{ filter: `drop-shadow(0 0 5px ${palette.bright})` }}
            />
          </g>

          {/* Handle 2: 2D Decay + Sustain Knee Node */}
          <g
            onPointerDown={(e) => startHandleDrag('decaySustain', e)}
            onDoubleClick={() => resetHandle('decaySustain')}
            onPointerEnter={() => setHoveredHandle('decaySustain')}
            onPointerLeave={() => setHoveredHandle((h) => (h === 'decaySustain' ? null : h))}
            className="cursor-move"
          >
            <circle cx={xD} cy={yS} r="9" fill="transparent" />
            <circle
              cx={xD}
              cy={yS}
              r={focusedHandle === 'decaySustain' ? 5.6 : 4.1}
              fill={palette.primary}
              fillOpacity={focusedHandle === 'decaySustain' ? 0.42 : 0.24}
              style={{ filter: `drop-shadow(0 0 7px ${palette.primary})` }}
            />
            <circle
              cx={xD}
              cy={yS}
              r={focusedHandle === 'decaySustain' ? 3.0 : 2.35}
              fill="#FFFFFF"
              stroke={palette.bright}
              strokeWidth="1.2"
              style={{ filter: `drop-shadow(0 0 6px ${palette.bright})` }}
            />
          </g>

          {/* Handle 3: Release Tail Node */}
          <g
            onPointerDown={(e) => startHandleDrag('release', e)}
            onDoubleClick={() => resetHandle('release')}
            onPointerEnter={() => setHoveredHandle('release')}
            onPointerLeave={() => setHoveredHandle((h) => (h === 'release' ? null : h))}
            className="cursor-ew-resize"
          >
            <circle cx={xR} cy={yFloor} r="8.5" fill="transparent" />
            <circle
              cx={xR}
              cy={yFloor}
              r={focusedHandle === 'release' ? 5.2 : 3.8}
              fill={palette.primary}
              fillOpacity={focusedHandle === 'release' ? 0.38 : 0.22}
              style={{ filter: `drop-shadow(0 0 6px ${palette.primary})` }}
            />
            <circle
              cx={xR}
              cy={yFloor}
              r={focusedHandle === 'release' ? 2.8 : 2.2}
              fill="#FFFFFF"
              stroke={palette.bright}
              strokeWidth="1.2"
              style={{ filter: `drop-shadow(0 0 5px ${palette.bright})` }}
            />
          </g>
        </svg>
      </div>
    </div>
  );
});

/* ============================================================================
 * 6. SynthLfoDisplay — Recessed Glowing Synth LFO Wave + Target + Rate Well
 * ============================================================================ */
export interface SynthLfoDisplayProps {
  shape: KickLfoShape;
  onChangeShape: (next: KickLfoShape) => void;
  target: SynthLfoTarget;
  onChangeTarget: (next: SynthLfoTarget) => void;
  rateHz: number; // 0.1..24.0
  onChangeRateHz: (hz: number) => void;
  depth: number; // 0..100
  lfoPhase?: number; // 0..1
  active?: boolean;
  accent?: DspAccent;
  midiId?: string;
  className?: string;
}

export const SynthLfoDisplay = React.memo(function SynthLfoDisplay({
  shape,
  onChangeShape,
  target,
  onChangeTarget,
  rateHz,
  onChangeRateHz,
  depth,
  lfoPhase = 0,
  active = false,
  accent = 'violet',
  midiId,
  className,
}: SynthLfoDisplayProps) {
  const palette = ACCENT_PALETTES[accent];
  const midi = useMidiLearnTarget(midiId, 'Synth LFO Rate (Hz)');
  const [draggingRate, setDraggingRate] = useState(false);
  const rateDragRef = useRef<{ startY: number; startHz: number }>({ startY: 0, startHz: rateHz });

  const shapeIdx = Math.max(0, KICK_LFO_SHAPES.indexOf(shape));
  const targetIdx = Math.max(0, SYNTH_LFO_TARGETS.indexOf(target));

  const cycleShape = (dir: -1 | 1) => {
    const next = (shapeIdx + dir + KICK_LFO_SHAPES.length) % KICK_LFO_SHAPES.length;
    onChangeShape(KICK_LFO_SHAPES[next]);
  };

  const cycleTarget = () => {
    const next = (targetIdx + 1) % SYNTH_LFO_TARGETS.length;
    onChangeTarget(SYNTH_LFO_TARGETS[next]);
  };

  const safeRate = clamp(rateHz, 0.1, 24.0);
  const depthNorm = clamp(depth / 100, 0.14, 1);

  useEffect(() => {
    if (!draggingRate) return;

    const onMove = (e: PointerEvent) => {
      const dy = rateDragRef.current.startY - e.clientY;
      const sens = e.shiftKey ? 280 : 95;
      const next = clamp(
        Number((rateDragRef.current.startHz + (dy / sens) * 23.9).toFixed(1)),
        0.1,
        24.0
      );
      onChangeRateHz(next);
    };

    const onUp = () => setDraggingRate(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [draggingRate, onChangeRateHz]);

  const { wavePath, dotX, dotY } = React.useMemo(() => {
    const pts: string[] = [];
    const steps = 48;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const v = evalLfoShape(shape, t) * depthNorm;
      const x = t * 100;
      const y = 19 - v * 13.5;
      pts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    const pNorm = ((lfoPhase % 1) + 1) % 1;
    const dx = pNorm * 100;
    const dy = 19 - evalLfoShape(shape, pNorm) * depthNorm * 13.5;
    return { wavePath: pts.join(' '), dotX: dx, dotY: dy };
  }, [shape, depthNorm, lfoPhase]);

  return (
    <div className="relative flex-1 min-w-[78px]" onContextMenu={midi.handleContextMenu}>
      <MidiLearnOverlayTag
        midiId={midiId}
        binding={midi.binding}
        isArmed={midi.isArmed}
        midiLearnMode={midi.midiLearnMode}
        onUnbind={midi.unbind}
        compact
      />

      {draggingRate && !midi.enabled && (
        <div className="absolute -top-6 left-1/2 -translate-x-1/2 z-30 px-1.5 py-0.5 rounded bg-[#111319] border border-white/15 font-mono text-[9px] tabular-nums text-white shadow-md whitespace-nowrap pointer-events-none">
          LFO {safeRate.toFixed(1)} Hz
        </div>
      )}

      <div
        onPointerDownCapture={(e) => {
          if (midi.interceptLearnEvent(e)) return;
        }}
        className={cn(
          'dsp-well rounded-[14px] w-full h-[66px] px-2 py-1.5 relative overflow-hidden flex flex-col justify-between select-none transition-shadow',
          midi.enabled && 'cursor-pointer',
          midi.isArmed && 'ring-2 ring-[#FFB35C] shadow-[0_0_14px_rgba(255,159,67,0.5)]',
          !midi.isArmed && midi.enabled && midi.binding && 'ring-2 ring-[#38BDF8]/85',
          !midi.isArmed &&
            midi.enabled &&
            !midi.binding &&
            'ring-1 ring-[#38BDF8]/40 hover:ring-[#38BDF8]',
          className
        )}
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{
            background: palette.wellGlow,
            opacity: active ? 0.95 : 0.45,
          }}
        />

        {/* Top Row: Clickable Target Selector + Draggable Hz Rate */}
        <div className="relative z-10 flex items-center justify-between gap-1 whitespace-nowrap">
          <button
            type="button"
            onClick={() => !midi.enabled && cycleTarget()}
            title="Click to cycle Synth LFO modulation target (GROWL · VOWEL · FILTER · PITCH · AMP)"
            className="font-display font-semibold text-[7.8px] tracking-[0.06em] uppercase hover:text-white transition-colors cursor-pointer focus-visible:outline-none"
            style={{
              color: palette.bright,
              textShadow: active ? `0 0 7px ${palette.primary}` : 'none',
            }}
          >
            →{target}
          </button>

          <span
            role="slider"
            tabIndex={0}
            aria-label="Synth LFO Rate Hz"
            aria-valuemin={0.1}
            aria-valuemax={24.0}
            aria-valuenow={safeRate}
            title="Drag up/down or scroll to adjust Synth LFO Rate (double-click to reset)"
            onPointerDown={(e) => {
              if (midi.enabled) return;
              e.preventDefault();
              e.stopPropagation();
              rateDragRef.current = { startY: e.clientY, startHz: safeRate };
              setDraggingRate(true);
            }}
            onDoubleClick={() => !midi.enabled && onChangeRateHz(2.8)}
            onWheel={(e) => {
              if (midi.enabled) return;
              e.preventDefault();
              const dir = e.deltaY < 0 ? 1 : -1;
              onChangeRateHz(clamp(Number((safeRate + dir * 0.2).toFixed(1)), 0.1, 24.0));
            }}
            className="font-mono text-[8px] tabular-nums text-[#C4CCE0] hover:text-white cursor-ns-resize px-0.5 rounded"
          >
            {safeRate.toFixed(1)}Hz
          </span>
        </div>

        {/* Bottom Row: Shape Chevrons + Glowing LFO Waveform + Live Phase Orb */}
        <div className="relative z-10 w-full flex items-center justify-between gap-0.5">
          <button
            type="button"
            onClick={() => !midi.enabled && cycleShape(-1)}
            aria-label="Previous Synth LFO shape"
            className="w-3 h-6 flex items-center justify-center text-[#788094] hover:text-white transition-colors cursor-pointer shrink-0 focus-visible:outline-none"
          >
            <ChevronLeft size={10} strokeWidth={2} />
          </button>

          <svg
            className="flex-1 h-[34px] overflow-visible pointer-events-none"
            viewBox="0 0 100 38"
            preserveAspectRatio="none"
          >
            <line
              x1="0"
              y1="19"
              x2="100"
              y2="19"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="0.9"
            />
            <path
              d={wavePath}
              fill="none"
              stroke={active ? palette.bright : palette.primary}
              strokeOpacity={active ? 1 : 0.55}
              strokeWidth="1.7"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              style={{
                filter: active ? `drop-shadow(0 0 5px ${palette.primary})` : 'none',
              }}
            />
            {active && (
              <circle
                cx={dotX}
                cy={dotY}
                r="2.4"
                fill="#FFFFFF"
                style={{ filter: `drop-shadow(0 0 5px ${palette.bright})` }}
              />
            )}
          </svg>

          <button
            type="button"
            onClick={() => !midi.enabled && cycleShape(1)}
            aria-label="Next Synth LFO shape"
            className="w-3 h-6 flex items-center justify-center text-[#788094] hover:text-white transition-colors cursor-pointer shrink-0 focus-visible:outline-none"
          >
            <ChevronRight size={10} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
});
