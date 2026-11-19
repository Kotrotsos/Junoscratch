import React, { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, GripVertical, PlugZap, X } from 'lucide-react';
import {
  FxDelayMode,
  FxDeviceType,
  FxDistortMode,
  FxReverbMode,
  FxSaturatorMode,
  FxSlotItem,
} from '../../types';
import { ACCENT_PALETTES, DspAccent, clamp, formatFilterFreq } from './tokens';
import { MicroKnob } from './RotaryKnob';
import { IconToggleButton, MacroRandomizeButton } from './HardwareButtons';
import { cn } from '../../utils';

export const MAX_FX_CHAIN_SLOTS = 6;

interface FxCatalogEntry {
  type: FxDeviceType;
  title: string;
  shortCode: string;
  subtitle: string;
  accent: DspAccent;
}

export const FX_DEVICE_CATALOG: FxCatalogEntry[] = [
  {
    type: 'saturator',
    title: 'Saturator',
    shortCode: 'SAT',
    subtitle: 'Tape · Triode · Iron',
    accent: 'amber',
  },
  {
    type: 'peq',
    title: 'Parametric EQ',
    shortCode: 'PEQ',
    subtitle: '3-Band Draggable Curve',
    accent: 'emerald',
  },
  {
    type: 'distort',
    title: 'Distort',
    shortCode: 'DST',
    subtitle: 'Gabber · Hard · Fold · Rect',
    accent: 'rose',
  },
  {
    type: 'delay',
    title: 'Delay',
    shortCode: 'DLY',
    subtitle: 'Ping-Pong · Stereo · Slap',
    accent: 'cyan',
  },
  {
    type: 'reverb',
    title: 'Reverb',
    shortCode: 'REV',
    subtitle: 'Hall · Bunker · Plate',
    accent: 'violet',
  },
];

export function createDefaultFxSlot(type: FxDeviceType): FxSlotItem {
  const uid = `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  switch (type) {
    case 'saturator':
      return {
        id: uid,
        type: 'saturator',
        enabled: true,
        mix: 80,
        satMode: 'TAPE',
        satDrive: 36,
        satTone: 8,
        satPunch: 45,
      };
    case 'peq':
      return {
        id: uid,
        type: 'peq',
        enabled: true,
        mix: 100,
        eqLowHz: 95,
        eqLowGainDb: 2.5,
        eqMidHz: 1180,
        eqMidGainDb: 3.5,
        eqMidQ: 1.8,
        eqHighHz: 6500,
        eqHighGainDb: 2.0,
      };
    case 'distort':
      return {
        id: uid,
        type: 'distort',
        enabled: true,
        mix: 100,
        distMode: 'GABBER',
        distDrive: 46,
        distToneHz: 7600,
        distPunch: 62,
        distTightCut: false,
      };
    case 'delay':
      return {
        id: uid,
        type: 'delay',
        enabled: true,
        mix: 34,
        delayMode: 'PING',
        delayTimeMs: 280,
        delayFeedback: 46,
        delayTone: 62,
      };
    case 'reverb':
      return {
        id: uid,
        type: 'reverb',
        enabled: true,
        mix: 32,
        revMode: 'HALL',
        revSize: 58,
        revDamp: 56,
        revPreDelayMs: 18,
      };
  }
}

function randStep(min: number, max: number, step: number): number {
  const raw = min + Math.random() * (max - min);
  const snapped = Math.round(raw / step) * step;
  const decimals = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  return clamp(Number(snapped.toFixed(decimals)), min, max);
}

function pickOne<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function randomizeFxSlot(slot: FxSlotItem): Partial<FxSlotItem> {
  switch (slot.type) {
    case 'saturator':
      return {
        enabled: true,
        satMode: pickOne(['TAPE', 'TRIODE', 'IRON'] as const),
        satDrive: randStep(18, 76, 1),
        satTone: randStep(-32, 36, 1),
        satPunch: randStep(24, 82, 1),
        mix: randStep(55, 96, 1),
      };
    case 'peq':
      return {
        enabled: true,
        mix: 100,
        eqLowHz: randStep(45, 240, 5),
        eqLowGainDb: randStep(-8.0, 9.5, 0.5),
        eqMidHz: randStep(320, 4600, 10),
        eqMidGainDb: randStep(-10.0, 11.5, 0.5),
        eqMidQ: randStep(0.7, 5.5, 0.1),
        eqHighHz: randStep(2800, 13500, 100),
        eqHighGainDb: randStep(-7.5, 9.5, 0.5),
      };
    case 'distort':
      return {
        enabled: true,
        distMode: pickOne(['GABBER', 'HARD', 'FOLD', 'RECT'] as const),
        distDrive: randStep(24, 78, 1),
        distToneHz: randStep(2200, 12800, 50),
        distPunch: randStep(32, 86, 1),
        distTightCut: Math.random() > 0.72,
        mix: randStep(68, 100, 1),
      };
    case 'delay':
      return {
        enabled: true,
        delayMode: pickOne(['PING', 'STEREO', 'SLAP'] as const),
        delayTimeMs: randStep(45, 760, 5),
        delayFeedback: randStep(18, 76, 1),
        delayTone: randStep(24, 88, 1),
        mix: randStep(16, 58, 1),
      };
    case 'reverb':
      return {
        enabled: true,
        revMode: pickOne(['HALL', 'BUNKER', 'PLATE'] as const),
        revSize: randStep(24, 92, 1),
        revDamp: randStep(22, 86, 1),
        revPreDelayMs: randStep(4, 92, 1),
        mix: randStep(16, 56, 1),
      };
  }
}

function BulkheadTrsJack({
  label,
  sublabel,
  side,
  active,
  meterLevel,
}: {
  label: string;
  sublabel: string;
  side: 'send' | 'return';
  active: boolean;
  meterLevel: number;
}) {
  const glowAmt = active ? clamp(0.35 + meterLevel * 0.65, 0.35, 1) : 0.15;
  return (
    <div
      className={cn(
        'shrink-0 w-[62px] self-stretch rounded-xl px-1.5 py-2 flex flex-col items-center justify-between select-none relative z-10',
        'border shadow-[inset_0_2px_6px_rgba(0,0,0,0.85),0_1px_0_rgba(255,255,255,0.06)]'
      )}
      style={{
        background:
          'linear-gradient(180deg, color-mix(in srgb, var(--module-bottom) 82%, #05070B) 0%, #090B11 100%)',
        borderColor: 'var(--module-border)',
      }}
    >
      <div className="flex flex-col items-center gap-0.5">
        <span
          className="font-mono text-[8px] font-bold tracking-[0.12em] uppercase whitespace-nowrap"
          style={{ color: 'var(--hw-label)' }}
        >
          {label}
        </span>
        <span className="font-mono text-[7px] tracking-[0.08em] uppercase text-[#6E768A] whitespace-nowrap">
          {sublabel}
        </span>
      </div>

      {/* Machined 1/4" TRS Hex Nut Socket + Plugged Ferrule */}
      <div className="relative w-[36px] h-[36px] flex items-center justify-center">
        <div
          className="w-[34px] h-[34px] rounded-full flex items-center justify-center border border-white/15 shadow-[0_3px_8px_rgba(0,0,0,0.9),inset_0_1px_1px_rgba(255,255,255,0.22)]"
          style={{
            background: 'conic-gradient(from 30deg, #3A4050, #1B1F29, #495064, #1A1E28, #3A4050)',
          }}
        >
          <div
            className="w-[22px] h-[22px] rounded-full flex items-center justify-center transition-shadow duration-150"
            style={{
              backgroundColor: '#07090E',
              boxShadow: active
                ? `inset 0 0 6px rgba(0,0,0,0.95), 0 0 ${Math.round(10 * glowAmt)}px var(--accent-cyan)`
                : 'inset 0 2px 4px rgba(0,0,0,0.95)',
              border: active
                ? '1.5px solid var(--accent-cyan-bright)'
                : '1px solid rgba(255,255,255,0.12)',
            }}
          >
            <div className="w-[10px] h-[10px] rounded-full bg-gradient-to-b from-[#CBD5E1] to-[#475569] shadow-[0_0_4px_rgba(0,0,0,0.9)]" />
          </div>
        </div>

        {/* Horizontal TRS Cable Strain-Relief Boot Exiting Toward Patchbay */}
        <div
          className={cn(
            'absolute top-1/2 -translate-y-1/2 w-[10px] h-[8px] rounded-[2px] border border-white/15 bg-gradient-to-b from-[#475063] to-[#1E2330]',
            side === 'send' ? '-right-[7px]' : '-left-[7px]'
          )}
        />
      </div>

      {/* Signal Presence LED */}
      <div className="flex items-center gap-1">
        <span
          className="w-[5px] h-[5px] rounded-full"
          style={{
            backgroundColor: active ? 'var(--accent-cyan-bright)' : '#394050',
            boxShadow: active ? '0 0 6px var(--accent-cyan)' : 'none',
          }}
        />
        <span className="font-mono text-[7.5px] tabular-nums text-[#7C8498]">
          {side === 'send' ? 'SEND' : 'RTN'}
        </span>
      </div>
    </div>
  );
}

function PatchCordLink({
  accent,
  active,
  compact = false,
}: {
  accent: DspAccent;
  active: boolean;
  compact?: boolean;
}) {
  const palette = ACCENT_PALETTES[accent];
  return (
    <div
      aria-hidden="true"
      className={cn(
        'shrink-0 self-center flex items-center justify-center relative select-none pointer-events-none',
        compact ? 'w-[22px] h-[44px]' : 'w-[26px] h-[44px]'
      )}
    >
      <svg className="w-full h-full overflow-visible" viewBox="0 0 26 44" fill="none">
        {/* Cable Shadow */}
        <path
          d="M 0 22 C 8 33, 18 33, 26 22"
          stroke="rgba(0,0,0,0.78)"
          strokeWidth="5.5"
          strokeLinecap="round"
        />
        {/* Braided Outer Jacket */}
        <path
          d="M 0 22 C 8 32, 18 32, 26 22"
          stroke="#232836"
          strokeWidth="3.8"
          strokeLinecap="round"
        />
        {/* Illuminated Signal Core */}
        <path
          d="M 0 22 C 8 32, 18 32, 26 22"
          stroke={active ? palette.bright : '#525A6E'}
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeDasharray={active ? 'none' : '2.5 2.5'}
          style={active ? { filter: `drop-shadow(0 0 4px ${palette.primary})` } : undefined}
        />
        {/* Left & Right TRS Metal Ferrules */}
        <rect x="-2" y="18.5" width="4.5" height="7" rx="1.2" fill="#94A3B8" />
        <rect x="23.5" y="18.5" width="4.5" height="7" rx="1.2" fill="#94A3B8" />
      </svg>
    </div>
  );
}

const MIN_EQ_HZ = 25;
const MAX_EQ_HZ = 18000;
const LOG_MIN_EQ = Math.log(MIN_EQ_HZ);
const LOG_MAX_EQ = Math.log(MAX_EQ_HZ);

function hzToNormX(hz: number): number {
  return clamp((Math.log(clamp(hz, MIN_EQ_HZ, MAX_EQ_HZ)) - LOG_MIN_EQ) / (LOG_MAX_EQ - LOG_MIN_EQ), 0.04, 0.96);
}

function normXToHz(nx: number): number {
  return Math.exp(LOG_MIN_EQ + clamp(nx, 0, 1) * (LOG_MAX_EQ - LOG_MIN_EQ));
}

function ParametricEqInteractiveGraph({
  slot,
  enabled,
  onChange,
}: {
  slot: FxSlotItem;
  enabled: boolean;
  onChange: (patch: Partial<FxSlotItem>) => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragBand, setDragBand] = useState<'low' | 'mid' | 'high' | null>(null);
  const palette = ACCENT_PALETTES.emerald;

  const lowHz = clamp(slot.eqLowHz ?? 95, 30, 450);
  const lowDb = clamp(slot.eqLowGainDb ?? 2.5, -15, 15);
  const midHz = clamp(slot.eqMidHz ?? 1180, 180, 6500);
  const midDb = clamp(slot.eqMidGainDb ?? 3.5, -15, 15);
  const midQ = clamp(slot.eqMidQ ?? 1.8, 0.4, 10);
  const highHz = clamp(slot.eqHighHz ?? 6500, 1500, 16000);
  const highDb = clamp(slot.eqHighGainDb ?? 2.0, -15, 15);

  const W = 184;
  const H = 56;
  const padY = 7;

  const dbToY = (db: number) => H / 2 - (clamp(db, -15, 15) / 15) * (H / 2 - padY);
  const yToDb = (py: number) => clamp(((H / 2 - py) / (H / 2 - padY)) * 15, -15, 15);

  // Compute composite 3-band EQ response curve across 46 log-spaced points
  const sampleEqDb = (hz: number): number => {
    const logRatioLow = Math.log2(hz / lowHz);
    const lowResp = lowDb / (1 + Math.pow(2, logRatioLow * 2.4));

    const octDistMid = Math.log2(hz / midHz);
    const bwOct = 1.15 / Math.max(0.35, midQ);
    const midResp = midDb * Math.exp(-(octDistMid * octDistMid) / (2 * bwOct * bwOct));

    const logRatioHigh = Math.log2(highHz / hz);
    const highResp = highDb / (1 + Math.pow(2, logRatioHigh * 2.4));

    return clamp(lowResp + midResp + highResp, -15.5, 15.5);
  };

  const pts: string[] = [];
  const steps = 44;
  for (let i = 0; i <= steps; i++) {
    const nx = i / steps;
    const hz = normXToHz(nx);
    const x = nx * W;
    const y = dbToY(sampleEqDb(hz));
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  const linePath = `M ${pts.join(' L ')}`;
  const areaPath = `${linePath} L ${W},${(H / 2).toFixed(1)} L 0,${(H / 2).toFixed(1)} Z`;

  const updateBandFromPointer = (band: 'low' | 'mid' | 'high', clientX: number, clientY: number) => {
    const el = svgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nx = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    const py = ((clientY - rect.top) / Math.max(1, rect.height)) * H;
    const db = Number(yToDb(py).toFixed(1));
    const rawHz = normXToHz(nx);

    if (band === 'low') {
      onChange({ eqLowHz: Math.round(clamp(rawHz, 30, 450)), eqLowGainDb: db });
    } else if (band === 'mid') {
      onChange({ eqMidHz: Math.round(clamp(rawHz, 180, 6500)), eqMidGainDb: db });
    } else {
      onChange({ eqHighHz: Math.round(clamp(rawHz, 1500, 16000)), eqHighGainDb: db });
    }
  };

  const nodes: { id: 'low' | 'mid' | 'high'; x: number; y: number; hz: number; db: number }[] = [
    { id: 'low', x: hzToNormX(lowHz) * W, y: dbToY(lowDb), hz: lowHz, db: lowDb },
    { id: 'mid', x: hzToNormX(midHz) * W, y: dbToY(midDb), hz: midHz, db: midDb },
    { id: 'high', x: hzToNormX(highHz) * W, y: dbToY(highDb), hz: highHz, db: highDb },
  ];

  const activeNode = dragBand ? nodes.find((n) => n.id === dragBand) : null;

  return (
    <div
      className="dsp-well rounded-lg h-[58px] relative overflow-hidden select-none touch-none"
      onWheel={(e) => {
        e.preventDefault();
        const dir = e.deltaY < 0 ? 1 : -1;
        onChange({ eqMidQ: Number(clamp(midQ + dir * 0.25, 0.4, 10).toFixed(2)) });
      }}
      title="Drag L/M/H nodes to sculpt Hz & dB · Scroll wheel to adjust Mid Q"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none transition-opacity duration-200"
        style={{ background: palette.wellGlow, opacity: enabled ? 0.9 : 0.2 }}
      />

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-full relative z-10 overflow-visible"
        onPointerMove={(e) => {
          if (!dragBand) return;
          updateBandFromPointer(dragBand, e.clientX, e.clientY);
        }}
        onPointerUp={() => setDragBand(null)}
        onPointerCancel={() => setDragBand(null)}
      >
        {/* 0 dB Reference Line + Octave Grid */}
        <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
        {[100, 1000, 10000].map((gHz) => {
          const gx = hzToNormX(gHz) * W;
          return (
            <line
              key={gHz}
              x1={gx}
              y1="0"
              x2={gx}
              y2={H}
              stroke="rgba(255,255,255,0.06)"
              strokeDasharray="2 2"
            />
          );
        })}

        {/* Response Fill & Glowing Curve */}
        <path d={areaPath} fill={enabled ? palette.soft : 'rgba(255,255,255,0.05)'} />
        <path
          d={linePath}
          fill="none"
          stroke={enabled ? palette.bright : '#64748B'}
          strokeWidth="1.8"
          style={enabled ? { filter: `drop-shadow(0 0 5px ${palette.primary})` } : undefined}
        />

        {/* 3 Draggable EQ Band Handles */}
        {nodes.map((n) => {
          const isGrabbed = dragBand === n.id;
          return (
            <g
              key={n.id}
              className="cursor-grab active:cursor-grabbing"
              onPointerDown={(e) => {
                e.stopPropagation();
                e.currentTarget.setPointerCapture(e.pointerId);
                setDragBand(n.id);
              }}
            >
              <circle cx={n.x} cy={n.y} r={10} fill="transparent" />
              <circle
                cx={n.x}
                cy={n.y}
                r={isGrabbed ? 5.2 : 4}
                fill="#0B0F17"
                stroke={enabled ? palette.bright : '#94A3B8'}
                strokeWidth="1.8"
                style={enabled ? { filter: `drop-shadow(0 0 5px ${palette.primary})` } : undefined}
              />
            </g>
          );
        })}
      </svg>

      {/* Top-Right Compact Readout */}
      <div className="absolute top-1 right-1.5 z-20 pointer-events-none font-mono text-[8px] tabular-nums text-[#CBD5E1]/90 bg-black/45 px-1 rounded">
        {activeNode
          ? `${formatFilterFreq(activeNode.hz)} ${activeNode.db >= 0 ? '+' : ''}${activeNode.db.toFixed(1)}dB`
          : `Q ${midQ.toFixed(1)}`}
      </div>
    </div>
  );
}

function FxUnitScreen({
  slot,
  accent,
  onChange,
}: {
  slot: FxSlotItem;
  accent: DspAccent;
  onChange: (patch: Partial<FxSlotItem>) => void;
}) {
  if (slot.type === 'peq') {
    return (
      <ParametricEqInteractiveGraph slot={slot} enabled={slot.enabled} onChange={onChange} />
    );
  }

  const palette = ACCENT_PALETTES[accent];
  const W = 184;
  const H = 40;

  if (slot.type === 'saturator') {
    const drive = clamp((slot.satDrive ?? 36) / 100, 0, 1);
    const punch = clamp((slot.satPunch ?? 45) / 100, 0, 1);
    const mode: FxSaturatorMode = slot.satMode ?? 'TAPE';
    const pts: string[] = [];
    for (let i = 0; i <= 36; i++) {
      const u = i / 36;
      const x = u * 2 - 1;
      const g = 1.0 + drive * 1.55 + punch * 0.22;
      let y = Math.tanh(x * g) / Math.tanh(Math.max(0.85, g * 0.72));
      y = clamp(y * 0.88, -0.94, 0.94);
      if (mode === 'TRIODE') {
        y = x >= 0 ? Math.tanh(x * g * 1.18) * 0.92 : Math.tanh(x * g * 0.9) * 0.9;
      } else if (mode === 'IRON') {
        y = clamp(Math.tanh(x * g * 1.05 + x * x * x * 0.28 * drive), -0.94, 0.94);
      }
      pts.push(`${(8 + u * (W - 16)).toFixed(1)},${(H / 2 - y * (H * 0.38)).toFixed(1)}`);
    }
    return (
      <div className="dsp-well rounded-lg h-[58px] p-1.5 flex flex-col justify-between relative overflow-hidden">
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{ background: palette.wellGlow, opacity: slot.enabled ? 0.85 : 0.18 }}
        />
        <div className="relative z-10 flex items-center justify-between gap-1">
          {(['TAPE', 'TRIODE', 'IRON'] as FxSaturatorMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onChange({ satMode: m })}
              className={cn(
                'flex-1 py-0.5 rounded font-mono text-[8px] font-bold tracking-[0.06em] uppercase cursor-pointer transition-colors',
                mode === m ? 'bg-white/12 text-white' : 'text-[#727A8E] hover:text-[#B8C0D4]'
              )}
              style={mode === m && slot.enabled ? { color: palette.bright } : undefined}
            >
              {m}
            </button>
          ))}
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[32px] relative z-10 overflow-visible">
          <line x1="8" y1={H / 2} x2={W - 8} y2={H / 2} stroke="rgba(255,255,255,0.1)" />
          <path
            d={`M ${pts.join(' L ')}`}
            fill="none"
            stroke={slot.enabled ? palette.bright : '#64748B'}
            strokeWidth="1.9"
            style={slot.enabled ? { filter: `drop-shadow(0 0 4px ${palette.primary})` } : undefined}
          />
        </svg>
      </div>
    );
  }

  if (slot.type === 'distort') {
    const drive = clamp((slot.distDrive ?? 46) / 100, 0, 1);
    const punch = clamp((slot.distPunch ?? 62) / 100, 0, 1);
    const mode: FxDistortMode = slot.distMode ?? 'GABBER';
    const tight = slot.distTightCut ?? false;
    const pts: string[] = [];
    for (let i = 0; i <= 48; i++) {
      const u = i / 48;
      const s = Math.sin(u * Math.PI * 2);
      const g = 1.0 + drive * drive * 3.8 + drive * 0.9;
      let y = s;
      if (mode === 'GABBER') {
        const bark = Math.sin(u * Math.PI * 4) * 0.28 * punch * (0.35 + drive * 0.65);
        const d = (s + bark) * g;
        y =
          d >= 0
            ? clamp(Math.tanh(d * 1.25) * 0.55 + clamp(d, 0, 0.9) * 0.45, 0, 0.9)
            : clamp(Math.tanh(d * 1.02) * 0.82, -0.82, 0);
      } else if (mode === 'HARD') {
        y = clamp(s * g, -0.9, 0.9);
      } else if (mode === 'FUZZ') {
        y = Math.sign(s) * (1 - Math.exp(-Math.abs(s * g * 1.5))) * 0.9;
      } else if (mode === 'FOLD') {
        y = clamp(Math.sin(s * g * 1.35) * 0.88, -0.92, 0.92);
      } else {
        y = clamp(Math.abs(s * g) * 1.15 - 0.38 * drive, -0.88, 0.92);
      }
      pts.push(`${(6 + u * (W - 12)).toFixed(1)},${(H / 2 - y * (H * 0.38)).toFixed(1)}`);
    }
    const modeOptions: Array<{ id: FxDistortMode; label: string }> = [
      { id: 'GABBER', label: 'GABR' },
      { id: 'HARD', label: 'HARD' },
      { id: 'FOLD', label: 'FOLD' },
      { id: 'RECT', label: 'RECT' },
    ];
    return (
      <div className="dsp-well rounded-lg h-[58px] p-1.5 flex flex-col justify-between relative overflow-hidden">
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{ background: palette.wellGlow, opacity: slot.enabled ? 0.85 : 0.18 }}
        />
        <div className="relative z-10 flex items-center justify-between gap-0.5">
          {modeOptions.map((opt) => {
            const isSelected = mode === opt.id || (mode === 'FUZZ' && opt.id === 'HARD');
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => onChange({ distMode: opt.id })}
                title={
                  opt.id === 'GABBER'
                    ? 'Gabber Console Rail Clipper — Mackie CR-1604 style asymmetric rail clip for 909 kicks'
                    : `${opt.id} distortion curve`
                }
                className={cn(
                  'px-1 py-0.5 rounded font-mono text-[7.5px] font-bold uppercase cursor-pointer transition-colors whitespace-nowrap',
                  isSelected ? 'bg-white/12' : 'text-[#727A8E] hover:text-[#B8C0D4]'
                )}
                style={isSelected && slot.enabled ? { color: palette.bright } : undefined}
              >
                {opt.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => onChange({ distTightCut: !tight })}
            title="92 Hz Pre-Clip Sub Cut — Leave OFF for full 909 -> Gabber kick sub intermodulation; enable for mid/high bass layers"
            className={cn(
              'px-1 py-0.5 rounded font-mono text-[7px] font-bold uppercase cursor-pointer border whitespace-nowrap',
              tight
                ? 'border-white/20 bg-white/10 text-white'
                : 'border-white/5 text-[#646C80]'
            )}
          >
            CUT
          </button>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[32px] relative z-10 overflow-visible">
          <line x1="6" y1={H / 2} x2={W - 6} y2={H / 2} stroke="rgba(255,255,255,0.1)" />
          <path
            d={`M ${pts.join(' L ')}`}
            fill="none"
            stroke={slot.enabled ? palette.bright : '#64748B'}
            strokeWidth="1.8"
            style={slot.enabled ? { filter: `drop-shadow(0 0 4px ${palette.primary})` } : undefined}
          />
        </svg>
      </div>
    );
  }

  if (slot.type === 'delay') {
    const mode: FxDelayMode = slot.delayMode ?? 'PING';
    const fb = clamp((slot.delayFeedback ?? 46) / 100, 0.12, 0.85);
    const timeNorm = clamp(((slot.delayTimeMs ?? 280) - 20) / 1180, 0.1, 1);
    const taps = [0, 1, 2, 3, 4, 5];
    return (
      <div className="dsp-well rounded-lg h-[58px] p-1.5 flex flex-col justify-between relative overflow-hidden">
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{ background: palette.wellGlow, opacity: slot.enabled ? 0.85 : 0.18 }}
        />
        <div className="relative z-10 flex items-center justify-between gap-1">
          {(['PING', 'STEREO', 'SLAP'] as FxDelayMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onChange({ delayMode: m })}
              className={cn(
                'flex-1 py-0.5 rounded font-mono text-[8px] font-bold uppercase cursor-pointer transition-colors',
                mode === m ? 'bg-white/12' : 'text-[#727A8E] hover:text-[#B8C0D4]'
              )}
              style={mode === m && slot.enabled ? { color: palette.bright } : undefined}
            >
              {m}
            </button>
          ))}
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[32px] relative z-10">
          <line x1="8" y1={H - 5} x2={W - 8} y2={H - 5} stroke="rgba(255,255,255,0.12)" />
          {taps.map((idx) => {
            const spacing = (14 + timeNorm * 16) * (mode === 'SLAP' ? 0.58 : 1);
            const x = clamp(14 + idx * spacing, 12, W - 12);
            const amp = Math.pow(fb, idx * 0.82);
            const barH = Math.max(4, amp * (H - 10));
            const isRightTap = mode === 'PING' && idx % 2 === 1;
            return (
              <rect
                key={idx}
                x={x}
                y={H - 5 - barH}
                width={isRightTap ? 4 : 5}
                height={barH}
                rx="1.5"
                fill={slot.enabled ? palette.bright : '#64748B'}
                opacity={isRightTap ? 0.68 : 0.95}
              />
            );
          })}
        </svg>
      </div>
    );
  }

  // 'reverb'
  const revMode: FxReverbMode = slot.revMode ?? 'HALL';
  const sizeNorm = clamp((slot.revSize ?? 58) / 100, 0.1, 1);
  const preNorm = clamp((slot.revPreDelayMs ?? 18) / 140, 0, 0.35);
  const startX = 12 + preNorm * 42;
  const endX = 58 + sizeNorm * (W - 68);

  return (
    <div className="dsp-well rounded-lg h-[58px] p-1.5 flex flex-col justify-between relative overflow-hidden">
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{ background: palette.wellGlow, opacity: slot.enabled ? 0.85 : 0.18 }}
      />
      <div className="relative z-10 flex items-center justify-between gap-1">
        {(['HALL', 'BUNKER', 'PLATE'] as FxReverbMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onChange({ revMode: m })}
            className={cn(
              'flex-1 py-0.5 rounded font-mono text-[8px] font-bold uppercase cursor-pointer transition-colors',
              revMode === m ? 'bg-white/12' : 'text-[#727A8E] hover:text-[#B8C0D4]'
            )}
            style={revMode === m && slot.enabled ? { color: palette.bright } : undefined}
          >
            {m}
          </button>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[32px] relative z-10">
        <line x1="8" y1={H - 5} x2={W - 8} y2={H - 5} stroke="rgba(255,255,255,0.12)" />
        <line
          x1="10"
          y1={H - 5}
          x2="10"
          y2="7"
          stroke={slot.enabled ? '#FFFFFF' : '#64748B'}
          strokeWidth="2"
        />
        <path
          d={`M ${startX.toFixed(1)} 8 Q ${(startX + (endX - startX) * 0.35).toFixed(1)} ${(H - 9).toFixed(1)}, ${endX.toFixed(1)} ${H - 5} L ${startX.toFixed(1)} ${H - 5} Z`}
          fill={slot.enabled ? palette.soft : 'rgba(255,255,255,0.06)'}
          stroke={slot.enabled ? palette.bright : '#64748B'}
          strokeWidth="1.6"
        />
      </svg>
    </div>
  );
}

export interface FxChainPatchbayProps {
  slots: FxSlotItem[];
  onChangeSlots: (next: FxSlotItem[]) => void;
  isPlaying: boolean;
  bypassed: boolean;
  meterLevel: number;
}

export function FxChainPatchbay({
  slots,
  onChangeSlots,
  isPlaying,
  bypassed,
  meterLevel,
}: FxChainPatchbayProps) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const canAddMore = slots.length < MAX_FX_CHAIN_SLOTS;

  const handleHookDevice = (type: FxDeviceType) => {
    if (!canAddMore) return;
    onChangeSlots([...slots, createDefaultFxSlot(type)]);
  };

  const handleUnplugSlot = (id: string) => {
    onChangeSlots(slots.filter((s) => s.id !== id));
  };

  const handleUpdateSlot = (id: string, patch: Partial<FxSlotItem>) => {
    onChangeSlots(slots.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const handleMoveSlot = (from: number, to: number) => {
    if (to < 0 || to >= slots.length || from === to) return;
    const copy = [...slots];
    const [moved] = copy.splice(from, 1);
    copy.splice(to, 0, moved);
    onChangeSlots(copy);
  };

  const activeChainSummary =
    slots.length === 0
      ? 'DIRECT BYPASS CORD · 0 FX HOOKED'
      : `SEND ➔ ${slots
          .map((s, i) => {
            const meta = FX_DEVICE_CATALOG.find((c) => c.type === s.type);
            return `${String(i + 1).padStart(2, '0')}:${meta?.shortCode ?? 'FX'}${s.enabled ? '' : '(OFF)'}`;
          })
          .join(' ➔ ')} ➔ RTN`;

  const chainSignalLive = isPlaying && !bypassed;

  return (
    <div className="dsp-module rounded-2xl p-2.5 flex flex-col gap-2 min-w-0">
      {/* Top Hardware Patchbay Supply Dock */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <PlugZap size={13} className="shrink-0 text-[var(--accent-cyan-bright)]" />
          <span
            className="font-display text-[10.5px] font-bold tracking-[0.12em] uppercase whitespace-nowrap"
            style={{ color: 'var(--hw-title)' }}
          >
            FX INSERT PATCHBAY
          </span>
          <span className="hidden sm:inline-block font-mono text-[9px] tabular-nums truncate text-[#8992A8]">
            {activeChainSummary}
          </span>
        </div>

        {/* Hook-In FX Cartridge Supply Buttons */}
        <div className="flex flex-wrap items-center gap-1.5">
          {FX_DEVICE_CATALOG.map((dev) => {
            const pal = ACCENT_PALETTES[dev.accent];
            return (
              <button
                key={dev.type}
                type="button"
                disabled={!canAddMore}
                onClick={() => handleHookDevice(dev.type)}
                title={
                  canAddMore
                    ? `Hook ${dev.title} (${dev.subtitle}) into the end of the FX chain`
                    : `Maximum ${MAX_FX_CHAIN_SLOTS} FX units reached`
                }
                className={cn(
                  'px-2.5 py-1 rounded-lg flex items-center gap-1.5 font-display text-[9.5px] font-semibold tracking-[0.07em] uppercase whitespace-nowrap transition-all cursor-pointer',
                  'dsp-button-cap border border-white/10 hover:brightness-110 disabled:opacity-40 disabled:pointer-events-none'
                )}
                style={{ color: 'var(--hw-title)' }}
              >
                <span
                  className="w-[5px] h-[5px] rounded-full shrink-0"
                  style={{ backgroundColor: pal.bright, boxShadow: `0 0 5px ${pal.primary}` }}
                />
                <span>+ {dev.title}</span>
              </button>
            );
          })}

          {slots.length > 0 && (
            <button
              type="button"
              onClick={() => onChangeSlots([])}
              title="Unplug all FX devices and restore direct bypass cord"
              className="px-2 py-1 rounded-lg font-mono text-[8.5px] font-semibold uppercase tracking-[0.08em] text-[#9BA3B8] hover:text-white bg-black/30 border border-white/10 cursor-pointer whitespace-nowrap"
            >
              Unplug All ({slots.length}/{MAX_FX_CHAIN_SLOTS})
            </button>
          )}
        </div>
      </div>

      {/* Recessed DIN-Rail Hardware Hook-In Cavity */}
      <div
        className="relative rounded-xl p-2.5 flex items-stretch gap-0 min-h-[188px] min-w-0 overflow-hidden border"
        style={{
          background:
            'linear-gradient(180deg, rgba(6,8,13,0.92) 0%, rgba(12,15,23,0.96) 50%, rgba(7,9,14,0.95) 100%)',
          borderColor: 'rgba(0,0,0,0.75)',
          boxShadow: 'inset 0 4px 14px rgba(0,0,0,0.92), 0 1px 0 rgba(255,255,255,0.06)',
        }}
      >
        {/* Brushed Dual Horizontal DIN Mounting Rails Behind Modules */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-12 top-[34%] h-[8px] rounded-sm border-y border-white/10 opacity-75"
          style={{
            background:
              'repeating-linear-gradient(90deg, #1B202C 0px, #1B202C 18px, #0D1017 18px, #0D1017 26px)',
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-12 bottom-[28%] h-[8px] rounded-sm border-y border-white/10 opacity-75"
          style={{
            background:
              'repeating-linear-gradient(90deg, #1B202C 0px, #1B202C 18px, #0D1017 18px, #0D1017 26px)',
          }}
        />

        {/* Left Main Device Bulkhead Send Jack */}
        <BulkheadTrsJack
          label="MAIN OUT"
          sublabel="FX SEND"
          side="send"
          active={chainSignalLive}
          meterLevel={meterLevel}
        />

        {/* Center DIN-Rail Bay: Empty Direct Patch Cord OR Hooked Hardware FX Modules */}
        {slots.length === 0 ? (
          <div className="flex-1 min-w-0 px-3 flex flex-col items-center justify-center relative z-10 gap-2.5">
            {/* Direct-Thru Patch Cord SVG Spanning Send -> Return */}
            <svg
              aria-hidden="true"
              viewBox="0 0 600 44"
              preserveAspectRatio="none"
              className="w-full h-[32px] pointer-events-none overflow-visible"
            >
              <path
                d="M 0 20 C 170 44, 430 44, 600 20"
                fill="none"
                stroke="rgba(0,0,0,0.8)"
                strokeWidth="6"
                strokeLinecap="round"
              />
              <path
                d="M 0 20 C 170 42, 430 42, 600 20"
                fill="none"
                stroke="#262C3B"
                strokeWidth="4"
                strokeLinecap="round"
              />
              <path
                d="M 0 20 C 170 42, 430 42, 600 20"
                fill="none"
                stroke={chainSignalLive ? 'var(--accent-cyan-bright)' : '#5A6378'}
                strokeWidth="1.6"
                strokeDasharray="6 4"
                style={
                  chainSignalLive
                    ? { filter: 'drop-shadow(0 0 5px var(--accent-cyan))' }
                    : undefined
                }
              />
            </svg>

            <div className="text-center">
              <div className="font-display text-[10.5px] font-semibold tracking-[0.12em] uppercase text-[#CFD6E6]">
                NO FX HOOKED · DIRECT HARDWIRED BYPASS
              </div>
              <div className="font-mono text-[9px] text-[#7D869C] mt-0.5">
                Click any hardware FX unit below or above to patch it into the main signal bus
              </div>
            </div>

            {/* 5 Recessed Quick-Hook DIN Socket Bays */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 w-full max-w-[780px]">
              {FX_DEVICE_CATALOG.map((dev) => {
                const pal = ACCENT_PALETTES[dev.accent];
                return (
                  <button
                    key={dev.type}
                    type="button"
                    onClick={() => handleHookDevice(dev.type)}
                    className={cn(
                      'group rounded-xl px-2.5 py-2 flex flex-col items-center gap-1 cursor-pointer transition-all',
                      'bg-[#121621]/90 hover:bg-[#191F2E] border border-dashed border-white/15 hover:border-white/30'
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-[6px] h-[6px] rounded-full"
                        style={{ backgroundColor: pal.bright, boxShadow: `0 0 6px ${pal.primary}` }}
                      />
                      <span className="font-display text-[9.5px] font-bold tracking-[0.08em] uppercase text-[#E2E8F0]">
                        {dev.title}
                      </span>
                    </div>
                    <span className="font-mono text-[8px] text-[#7D869C] group-hover:text-[#AEB7CC] whitespace-nowrap">
                      Hook In +
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex-1 min-w-0 overflow-x-auto py-0.5 flex items-stretch relative z-10">
            <div className="flex items-stretch min-w-max pr-1">
              {slots.map((slot, idx) => {
                const meta =
                  FX_DEVICE_CATALOG.find((c) => c.type === slot.type) ?? FX_DEVICE_CATALOG[0];
                const pal = ACCENT_PALETTES[meta.accent];
                const isDropTarget = overIdx === idx && dragIdx !== null && dragIdx !== idx;

                return (
                  <React.Fragment key={slot.id}>
                    <PatchCordLink
                      accent={meta.accent}
                      active={chainSignalLive && slot.enabled}
                      compact={slots.length >= 4}
                    />

                    {/* Individual Hooked Hardware FX Unit */}
                    <div
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (overIdx !== idx) setOverIdx(idx);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragIdx !== null && dragIdx !== idx) {
                          handleMoveSlot(dragIdx, idx);
                        }
                        setDragIdx(null);
                        setOverIdx(null);
                      }}
                      className={cn(
                        'w-[228px] shrink-0 dsp-module rounded-xl p-2 flex flex-col justify-between gap-1.5 relative transition-transform duration-150',
                        !slot.enabled && 'opacity-75',
                        dragIdx === idx && 'opacity-55 scale-[0.98]',
                        isDropTarget && 'ring-2 ring-[var(--accent-cyan-bright)]'
                      )}
                    >
                      {/* Side-Mounted 1/4" Input & Output Jack Collars */}
                      <span
                        aria-hidden="true"
                        className="absolute -left-[4px] top-1/2 -translate-y-1/2 w-[5px] h-[14px] rounded-l bg-[#64748B] border border-black/70"
                      />
                      <span
                        aria-hidden="true"
                        className="absolute -right-[4px] top-1/2 -translate-y-1/2 w-[5px] h-[14px] rounded-r bg-[#64748B] border border-black/70"
                      />

                      {/* Unit Header: Drag Handle + Slot Index + Title + Reorder + Macro Randomize + Power + Unplug */}
                      <div className="flex items-center justify-between gap-1 min-w-0">
                        <div
                          draggable
                          onDragStart={(e) => {
                            setDragIdx(idx);
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', String(idx));
                          }}
                          onDragEnd={() => {
                            setDragIdx(null);
                            setOverIdx(null);
                          }}
                          title="Drag to reorder FX unit in chain"
                          className="flex items-center gap-1 min-w-0 cursor-grab active:cursor-grabbing select-none"
                        >
                          <GripVertical size={12} className="shrink-0 text-[#6F788D]" />
                          <span
                            className="font-mono text-[8.5px] font-bold tabular-nums px-1 py-0.5 rounded bg-black/40"
                            style={{ color: slot.enabled ? pal.bright : 'var(--hw-muted)' }}
                          >
                            {String(idx + 1).padStart(2, '0')}
                          </span>
                          <span
                            className="font-display text-[9.5px] font-bold tracking-[0.08em] uppercase truncate"
                            style={{
                              color: slot.enabled ? 'var(--hw-title)' : 'var(--hw-title-inactive)',
                            }}
                          >
                            {meta.title}
                          </span>
                        </div>

                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => handleMoveSlot(idx, idx - 1)}
                            title="Move earlier in FX chain"
                            className="w-[18px] h-[18px] rounded flex items-center justify-center text-[#8C95AA] hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:pointer-events-none cursor-pointer"
                          >
                            <ChevronLeft size={11} />
                          </button>
                          <button
                            type="button"
                            disabled={idx === slots.length - 1}
                            onClick={() => handleMoveSlot(idx, idx + 1)}
                            title="Move later in FX chain"
                            className="w-[18px] h-[18px] rounded flex items-center justify-center text-[#8C95AA] hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:pointer-events-none cursor-pointer"
                          >
                            <ChevronRight size={11} />
                          </button>
                          <MacroRandomizeButton
                            size="xs"
                            accent={meta.accent}
                            label={`Macro Randomize ${meta.title}`}
                            onRandomize={() => handleUpdateSlot(slot.id, randomizeFxSlot(slot))}
                          />
                          <IconToggleButton
                            icon="power"
                            active={slot.enabled}
                            accent={meta.accent}
                            label={`Toggle ${meta.title}`}
                            onToggle={() => handleUpdateSlot(slot.id, { enabled: !slot.enabled })}
                          />
                          <button
                            type="button"
                            onClick={() => handleUnplugSlot(slot.id)}
                            title={`Unplug ${meta.title} from FX chain`}
                            className="w-[20px] h-[20px] rounded-full flex items-center justify-center text-[#8C95AA] hover:text-[#FDA4AF] hover:bg-rose-500/15 cursor-pointer transition-colors"
                          >
                            <X size={11} />
                          </button>
                        </div>
                      </div>

                      {/* Unit Interactive OLED Display */}
                      <FxUnitScreen
                        slot={slot}
                        accent={meta.accent}
                        onChange={(patch) => handleUpdateSlot(slot.id, patch)}
                      />

                      {/* Unit Precision Parameter MicroKnobs */}
                      <div className="grid grid-cols-4 gap-1 pt-0.5 justify-items-center">
                        {slot.type === 'saturator' && (
                          <>
                            <MicroKnob
                              value={slot.satDrive ?? 36}
                              min={0}
                              max={100}
                              step={1}
                              defaultValue={36}
                              accent={meta.accent}
                              label="DRIVE"
                              onChange={(v) => handleUpdateSlot(slot.id, { satDrive: v })}
                            />
                            <MicroKnob
                              value={slot.satPunch ?? 45}
                              min={0}
                              max={100}
                              step={1}
                              defaultValue={45}
                              accent={meta.accent}
                              label="BODY"
                              onChange={(v) => handleUpdateSlot(slot.id, { satPunch: v })}
                            />
                            <MicroKnob
                              value={slot.satTone ?? 8}
                              min={-50}
                              max={50}
                              step={1}
                              defaultValue={8}
                              accent={meta.accent}
                              label="WARMTH"
                              formatValue={(v) => `${v > 0 ? '+' : ''}${Math.round(v)}`}
                              onChange={(v) => handleUpdateSlot(slot.id, { satTone: v })}
                            />
                            <MicroKnob
                              value={slot.mix}
                              min={0}
                              max={100}
                              step={1}
                              defaultValue={80}
                              accent={meta.accent}
                              label="MIX"
                              onChange={(v) => handleUpdateSlot(slot.id, { mix: v })}
                            />
                          </>
                        )}

                        {slot.type === 'peq' && (
                          <>
                            <MicroKnob
                              value={slot.eqLowGainDb ?? 2.5}
                              min={-15}
                              max={15}
                              step={0.5}
                              defaultValue={2.5}
                              accent={meta.accent}
                              label="LOW"
                              formatValue={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}dB`}
                              onChange={(v) => handleUpdateSlot(slot.id, { eqLowGainDb: v })}
                            />
                            <MicroKnob
                              value={slot.eqMidHz ?? 1180}
                              min={180}
                              max={6500}
                              step={10}
                              defaultValue={1180}
                              accent={meta.accent}
                              label="MID HZ"
                              formatValue={(v) => formatFilterFreq(v)}
                              onChange={(v) => handleUpdateSlot(slot.id, { eqMidHz: v })}
                            />
                            <MicroKnob
                              value={slot.eqMidGainDb ?? 3.5}
                              min={-15}
                              max={15}
                              step={0.5}
                              defaultValue={3.5}
                              accent={meta.accent}
                              label="MID DB"
                              formatValue={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}dB`}
                              onChange={(v) => handleUpdateSlot(slot.id, { eqMidGainDb: v })}
                            />
                            <MicroKnob
                              value={slot.eqHighGainDb ?? 2.0}
                              min={-15}
                              max={15}
                              step={0.5}
                              defaultValue={2.0}
                              accent={meta.accent}
                              label="HIGH"
                              formatValue={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}dB`}
                              onChange={(v) => handleUpdateSlot(slot.id, { eqHighGainDb: v })}
                            />
                          </>
                        )}

                        {slot.type === 'distort' && (
                          <>
                            <MicroKnob
                              value={slot.distDrive ?? 46}
                              min={0}
                              max={100}
                              step={1}
                              defaultValue={46}
                              accent={meta.accent}
                              label="GAIN"
                              onChange={(v) => handleUpdateSlot(slot.id, { distDrive: v })}
                            />
                            <MicroKnob
                              value={slot.distPunch ?? 62}
                              min={0}
                              max={100}
                              step={1}
                              defaultValue={62}
                              accent={meta.accent}
                              label="PUNCH"
                              onChange={(v) => handleUpdateSlot(slot.id, { distPunch: v })}
                            />
                            <MicroKnob
                              value={slot.distToneHz ?? 7600}
                              min={700}
                              max={16000}
                              step={50}
                              defaultValue={7600}
                              accent={meta.accent}
                              label="TONE"
                              formatValue={(v) => formatFilterFreq(v)}
                              onChange={(v) => handleUpdateSlot(slot.id, { distToneHz: v })}
                            />
                            <MicroKnob
                              value={slot.mix}
                              min={0}
                              max={100}
                              step={1}
                              defaultValue={100}
                              accent={meta.accent}
                              label="MIX"
                              onChange={(v) => handleUpdateSlot(slot.id, { mix: v })}
                            />
                          </>
                        )}

                        {slot.type === 'delay' && (
                          <>
                            <MicroKnob
                              value={slot.delayTimeMs ?? 280}
                              min={20}
                              max={1200}
                              step={5}
                              defaultValue={280}
                              accent={meta.accent}
                              label="TIME"
                              formatValue={(v) => `${Math.round(v)}ms`}
                              onChange={(v) => handleUpdateSlot(slot.id, { delayTimeMs: v })}
                            />
                            <MicroKnob
                              value={slot.delayFeedback ?? 46}
                              min={0}
                              max={84}
                              step={1}
                              defaultValue={46}
                              accent={meta.accent}
                              label="FDBK"
                              onChange={(v) => handleUpdateSlot(slot.id, { delayFeedback: v })}
                            />
                            <MicroKnob
                              value={slot.delayTone ?? 62}
                              min={0}
                              max={100}
                              step={1}
                              defaultValue={62}
                              accent={meta.accent}
                              label="DAMP"
                              onChange={(v) => handleUpdateSlot(slot.id, { delayTone: v })}
                            />
                            <MicroKnob
                              value={slot.mix}
                              min={0}
                              max={100}
                              step={1}
                              defaultValue={34}
                              accent={meta.accent}
                              label="MIX"
                              onChange={(v) => handleUpdateSlot(slot.id, { mix: v })}
                            />
                          </>
                        )}

                        {slot.type === 'reverb' && (
                          <>
                            <MicroKnob
                              value={slot.revSize ?? 58}
                              min={0}
                              max={100}
                              step={1}
                              defaultValue={58}
                              accent={meta.accent}
                              label="SIZE"
                              onChange={(v) => handleUpdateSlot(slot.id, { revSize: v })}
                            />
                            <MicroKnob
                              value={slot.revDamp ?? 56}
                              min={0}
                              max={100}
                              step={1}
                              defaultValue={56}
                              accent={meta.accent}
                              label="DAMP"
                              onChange={(v) => handleUpdateSlot(slot.id, { revDamp: v })}
                            />
                            <MicroKnob
                              value={slot.revPreDelayMs ?? 18}
                              min={0}
                              max={140}
                              step={1}
                              defaultValue={18}
                              accent={meta.accent}
                              label="PRE"
                              formatValue={(v) => `${Math.round(v)}ms`}
                              onChange={(v) => handleUpdateSlot(slot.id, { revPreDelayMs: v })}
                            />
                            <MicroKnob
                              value={slot.mix}
                              min={0}
                              max={100}
                              step={1}
                              defaultValue={32}
                              accent={meta.accent}
                              label="MIX"
                              onChange={(v) => handleUpdateSlot(slot.id, { mix: v })}
                            />
                          </>
                        )}
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}

              <PatchCordLink
                accent="cyan"
                active={chainSignalLive}
                compact={slots.length >= 4}
              />
            </div>
          </div>
        )}

        {/* Right Main Device Bulkhead Return Jack */}
        <BulkheadTrsJack
          label="MASTER IN"
          sublabel="FX RETURN"
          side="return"
          active={chainSignalLive}
          meterLevel={meterLevel}
        />
      </div>
    </div>
  );
}
