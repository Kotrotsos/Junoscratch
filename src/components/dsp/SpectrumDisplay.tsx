import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { clamp } from './tokens';
import { cn } from '../../utils';

export interface SpectralBand {
  id: string;
  label: string;
  frequency: number; // 10 - 360 Hz
  gainDb: number; // -60 to +12 dB
  width: number; // 0 to 100
  active: boolean;
  colorStart: string;
  colorEnd: string;
}

export interface SpectrumDisplayProps {
  title?: string;
  bands: SpectralBand[];
  onUpdateBand?: (id: string, patch: Partial<SpectralBand>) => void;
  bypassed?: boolean;
  dryWet?: number; // 0 - 100
  animateSpectrum?: boolean;
  axisTicks?: number[];
  className?: string;
}

const MIN_LOG_HZ = 8;
const MAX_LOG_HZ = 520;

function hzToXNorm(hz: number): number {
  const clamped = clamp(hz, MIN_LOG_HZ, MAX_LOG_HZ);
  return (
    (Math.log10(clamped) - Math.log10(MIN_LOG_HZ)) /
    (Math.log10(MAX_LOG_HZ) - Math.log10(MIN_LOG_HZ))
  );
}

function xNormToHz(norm: number): number {
  const clamped = clamp(norm, 0.04, 0.92);
  return Math.pow(
    10,
    Math.log10(MIN_LOG_HZ) + clamped * (Math.log10(MAX_LOG_HZ) - Math.log10(MIN_LOG_HZ))
  );
}

export function SpectrumDisplay({
  title = 'BASSMAKER',
  bands,
  onUpdateBand,
  bypassed = false,
  dryWet = 100,
  animateSpectrum = true,
  axisTicks = [10, 20, 40, 80, 160, 320],
  className,
}: SpectrumDisplayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tickPhase, setTickPhase] = useState(0);

  // Gentle organic real-time analyzer motion
  useEffect(() => {
    if (!animateSpectrum) return;
    let raf: number;
    let last = 0;
    const step = (ts: number) => {
      if (ts - last > 50) {
        setTickPhase(ts * 0.0022);
        last = ts;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [animateSpectrum]);

  // Generate jagged FFT spectrum mountain ridge matching the reference aesthetic
  const fftPath = useMemo(() => {
    const numPts = 140;
    const basePeaks = [
      { pos: 0.16, amp: 0.42, sharp: 0.04 },
      { pos: 0.23, amp: 0.56, sharp: 0.035 },
      { pos: 0.39, amp: 0.62, sharp: 0.03 },
      { pos: 0.56, amp: 0.64, sharp: 0.035 },
      { pos: 0.72, amp: 0.68, sharp: 0.015 },
      { pos: 0.81, amp: 0.82, sharp: 0.025 },
      { pos: 0.88, amp: 0.48, sharp: 0.03 },
    ];

    const coords: string[] = ['M 0 100'];
    for (let i = 0; i <= numPts; i++) {
      const x = i / numPts;
      let yVal = 0.08;
      for (const pk of basePeaks) {
        const d = (x - pk.pos) / pk.sharp;
        yVal += pk.amp * Math.exp(-0.5 * d * d);
      }
      // Deterministic fine FFT harmonic spikes + subtle live shimmer
      const harmonic =
        Math.abs(Math.sin(i * 1.9 + tickPhase * 0.9)) * 0.14 +
        Math.abs(Math.cos(i * 4.7 - tickPhase * 1.4)) * 0.11;
      const totalAmp = clamp(yVal * (0.68 + harmonic), 0.03, 0.92);
      const svgX = (x * 1000).toFixed(1);
      const svgY = (100 - totalAmp * 78).toFixed(1);
      coords.push(`L ${svgX} ${svgY}`);
    }
    coords.push('L 1000 100 Z');
    return coords.join(' ');
  }, [tickPhase]);

  // Build smooth Gaussian bell curves for each active band
  const bandCurves = useMemo(() => {
    const wetScale = bypassed ? 0.15 : 0.25 + (dryWet / 100) * 0.75;
    return bands.map((band) => {
      const centerX = hzToXNorm(band.frequency);
      const gainNorm = clamp((band.gainDb - -60) / 72, 0.06, 1);
      const peakHeight = (band.active ? gainNorm : 0.08) * 68 * wetScale;
      const sigma = 0.045 + (band.width / 100) * 0.085;

      const pts: string[] = ['M 0 100'];
      const steps = 100;
      for (let i = 0; i <= steps; i++) {
        const x = i / steps;
        const dist = (x - centerX) / sigma;
        const bell = Math.exp(-0.5 * dist * dist);
        // Subtle low-end ambient tail on left for SUB 1
        const subFloor =
          band.id === 'sub1' && band.active && !bypassed
            ? Math.exp(-x * 9) * peakHeight * 0.24
            : 0;
        const y = 100 - Math.min(88, bell * peakHeight + subFloor);
        pts.push(`L ${(x * 1000).toFixed(1)} ${y.toFixed(2)}`);
      }
      pts.push('L 1000 100 Z');

      return {
        band,
        path: pts.join(' '),
        cxPct: centerX * 100,
        cyPct: 100 - peakHeight,
      };
    });
  }, [bands, bypassed, dryWet]);

  const updateBandFromPointer = useCallback(
    (clientX: number, clientY: number, id: string) => {
      if (!containerRef.current || !onUpdateBand) return;
      const rect = containerRef.current.getBoundingClientRect();
      const xNorm = clamp((clientX - rect.left) / rect.width, 0.06, 0.85);
      const yNorm = clamp(1 - (clientY - rect.top) / rect.height, 0.08, 0.88);
      const nextHz = Math.round(xNormToHz(xNorm));
      const nextGain = Number((-60 + (yNorm / 0.75) * 72).toFixed(1));
      onUpdateBand(id, {
        frequency: clamp(nextHz, 18, 280),
        gainDb: clamp(nextGain, -60, 12),
      });
    },
    [onUpdateBand]
  );

  useEffect(() => {
    if (!draggingId) return;
    const onMove = (e: PointerEvent) =>
      updateBandFromPointer(e.clientX, e.clientY, draggingId);
    const onUp = () => setDraggingId(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [draggingId, updateBandFromPointer]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'w-full h-[250px] sm:h-[275px] rounded-[22px] relative overflow-hidden select-none',
        'bg-gradient-to-b from-[#0A0C10] via-[#0E1118] to-[#141824]',
        'shadow-[inset_0_4px_18px_rgba(0,0,0,0.95),inset_0_0_0_1px_rgba(0,0,0,0.9),0_1px_0_rgba(255,255,255,0.12)]',
        className
      )}
    >
      {/* Logarithmic Frequency Grid Lines & Top Labels (10, 20, 40, 80, 160, 320) */}
      {axisTicks.map((hz) => {
        const leftPct = hzToXNorm(hz) * 100;
        return (
          <div
            key={hz}
            className="absolute top-0 bottom-0 pointer-events-none"
            style={{ left: `${leftPct}%` }}
          >
            <span className="block -translate-x-1/2 pt-2.5 font-sans text-[9.5px] font-medium tabular-nums text-[#636A7B]">
              {hz}
            </span>
            <div className="w-[1px] h-full bg-white/[0.045] mt-1" />
          </div>
        );
      })}

      {/* Center Hardware Wordmark + Dual Phosphor Dots */}
      <div className="absolute inset-x-0 top-[54px] flex items-center justify-center pointer-events-none z-10">
        <div className="flex items-center gap-1.5">
          <span className="font-display font-bold text-[22px] tracking-[0.06em] uppercase text-[#434857]">
            {title}
          </span>
          <div className="flex flex-col gap-[3.5px] ml-0.5">
            <span
              className="w-[4.5px] h-[4.5px] rounded-full bg-[#FF9A3E]"
              style={{ boxShadow: '0 0 8px rgba(255, 154, 62, 0.9)' }}
            />
            <span
              className="w-[4.5px] h-[4.5px] rounded-full bg-[#7C9BFF]"
              style={{ boxShadow: '0 0 8px rgba(124, 155, 255, 0.9)' }}
            />
          </div>
        </div>
      </div>

      {/* Ambient Bottom Floor Glow matching Active Curves */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-28 pointer-events-none transition-opacity duration-200"
        style={{
          opacity: bypassed ? 0.15 : 0.85,
          background:
            'radial-gradient(ellipse 36% 80% at 24% 100%, rgba(92, 98, 255, 0.45) 0%, transparent 75%), radial-gradient(ellipse 38% 75% at 42% 100%, rgba(255, 118, 138, 0.38) 0%, transparent 75%)',
        }}
      />

      {/* Main Spectral SVG Stage */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox="0 0 1000 100"
        preserveAspectRatio="none"
      >
        <defs>
          {bandCurves.map(({ band }) => (
            <linearGradient
              key={`grad-${band.id}`}
              id={`band-grad-${band.id}`}
              x1="0%"
              y1="0%"
              x2="0%"
              y2="100%"
            >
              <stop offset="0%" stopColor={band.colorStart} stopOpacity="0.82" />
              <stop offset="65%" stopColor={band.colorEnd} stopOpacity="0.88" />
              <stop offset="100%" stopColor={band.colorEnd} stopOpacity="0.95" />
            </linearGradient>
          ))}
          <linearGradient id="fft-mountain-grad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#5C6378" stopOpacity="0.38" />
            <stop offset="100%" stopColor="#1B1E28" stopOpacity="0.08" />
          </linearGradient>
        </defs>

        {/* Background Jagged FFT Analyzer Silhouette */}
        <path
          d={fftPath}
          fill="url(#fft-mountain-grad)"
          stroke="rgba(138, 148, 174, 0.2)"
          strokeWidth="0.8"
          vectorEffect="non-scaling-stroke"
        />

        {/* Luminous Additive Harmonic Bell Curves */}
        {bandCurves.map(({ band, path }) => (
          <path
            key={band.id}
            d={path}
            fill={`url(#band-grad-${band.id})`}
            style={{
              mixBlendMode: 'screen',
              opacity: band.active ? 1 : 0.18,
              transition: draggingId === band.id ? 'none' : 'opacity 180ms ease',
            }}
          />
        ))}
      </svg>

      {/* Interactive Draggable Peak Nodes for Direct Spectrum Manipulation */}
      {onUpdateBand &&
        bandCurves.map(({ band, cxPct, cyPct }) => {
          if (!band.active) return null;
          const isActiveNode = draggingId === band.id || hoveredId === band.id;
          return (
            <button
              key={`node-${band.id}`}
              type="button"
              aria-label={`Adjust ${band.label} frequency and gain`}
              onPointerDown={(e) => {
                e.preventDefault();
                setDraggingId(band.id);
              }}
              onPointerEnter={() => setHoveredId(band.id)}
              onPointerLeave={() => setHoveredId(null)}
              className="absolute -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center cursor-grab active:cursor-grabbing z-20 focus-visible:outline-none"
              style={{
                left: `${cxPct}%`,
                top: `${clamp(cyPct, 14, 88)}%`,
              }}
            >
              <span
                className={cn(
                  'rounded-full border border-white/80 transition-all duration-150',
                  isActiveNode ? 'w-3.5 h-3.5 scale-110' : 'w-2 h-2 opacity-55 hover:opacity-100'
                )}
                style={{
                  backgroundColor: band.colorStart,
                  boxShadow: `0 0 12px ${band.colorStart}`,
                }}
              />
              {isActiveNode && (
                <span className="absolute -top-7 px-2 py-0.5 rounded bg-[#0E1016]/95 border border-white/15 font-mono text-[10px] tabular-nums text-white whitespace-nowrap pointer-events-none shadow-lg">
                  {band.label}: {band.frequency} Hz · {band.gainDb > 0 ? '+' : ''}
                  {band.gainDb.toFixed(1)} dB
                </span>
              )}
            </button>
          );
        })}

      {/* Bypass Status Watermark Pill-Free Text */}
      {bypassed && (
        <div className="absolute bottom-3 right-4 font-mono text-[10px] tracking-[0.12em] uppercase text-[#9BA2B4]">
          SIGNAL BYPASSED
        </div>
      )}
    </div>
  );
}
