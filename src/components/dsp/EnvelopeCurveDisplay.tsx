import React, { useRef, useState, useEffect, useCallback } from 'react';
import { ACCENT_PALETTES, DspAccent, clamp } from './tokens';
import { Point } from '../../types';
import { cn } from '../../utils';

export interface EnvelopeCurveDisplayProps {
  title: string;
  points: Point[];
  onChange: (points: Point[]) => void;
  accent?: DspAccent;
  minLabel?: string;
  maxLabel?: string;
  playhead?: number;
  waveform?: Float32Array | null;
  height?: number;
  className?: string;
}

export function EnvelopeCurveDisplay({
  title,
  points,
  onChange,
  accent = 'blue',
  minLabel = '0.1x',
  maxLabel = '4.0x',
  playhead,
  waveform,
  height = 170,
  className,
}: EnvelopeCurveDisplayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const palette = ACCENT_PALETTES[accent];

  const sorted = [...points].sort((a, b) => a.x - b.x);

  const getCoords = useCallback((clientX: number, clientY: number) => {
    if (!containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: clamp((clientX - rect.left) / rect.width, 0, 1),
      y: clamp(1 - (clientY - rect.top) / rect.height, 0, 1),
    };
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    const coords = getCoords(e.clientX, e.clientY);
    if (!coords) return;

    let hit = -1;
    let best = 0.055;
    sorted.forEach((p, idx) => {
      const d = Math.hypot(p.x - coords.x, p.y - coords.y);
      if (d < best) {
        best = d;
        hit = idx;
      }
    });

    if (hit !== -1) {
      setDragIdx(hit);
    } else {
      const next = [...sorted, coords].sort((a, b) => a.x - b.x);
      onChange(next);
      const insertedIdx = next.findIndex((p) => p.x === coords.x && p.y === coords.y);
      setDragIdx(insertedIdx);
    }
  };

  useEffect(() => {
    if (dragIdx === null) return;
    const onMove = (e: PointerEvent) => {
      const coords = getCoords(e.clientX, e.clientY);
      if (!coords) return;
      const next = [...sorted];
      const minX = dragIdx === 0 ? 0 : next[dragIdx - 1].x + 0.015;
      const maxX = dragIdx === next.length - 1 ? 1 : next[dragIdx + 1].x - 0.015;
      next[dragIdx] = {
        x: dragIdx === 0 ? 0 : dragIdx === next.length - 1 ? 1 : clamp(coords.x, minX, maxX),
        y: coords.y,
      };
      onChange(next);
    };
    const onUp = () => setDragIdx(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragIdx, sorted, getCoords, onChange]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (sorted.length <= 2) return;
    const coords = getCoords(e.clientX, e.clientY);
    if (!coords) return;
    let hit = -1;
    let best = 0.06;
    sorted.forEach((p, idx) => {
      if (idx === 0 || idx === sorted.length - 1) return;
      const d = Math.hypot(p.x - coords.x, p.y - coords.y);
      if (d < best) {
        best = d;
        hit = idx;
      }
    });
    if (hit !== -1) {
      onChange(sorted.filter((_, idx) => idx !== hit));
    }
  };

  const lineCoords = sorted.map((p) => `${(p.x * 1000).toFixed(1)} ${((1 - p.y) * 100).toFixed(1)}`);
  const strokePath = `M ${lineCoords.join(' L ')}`;
  const areaPath = `M ${(sorted[0].x * 1000).toFixed(1)} 100 L ${lineCoords.join(' L ')} L ${(sorted[sorted.length - 1].x * 1000).toFixed(1)} 100 Z`;
  const gradId = `env-grad-${title.replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onContextMenu={handleContextMenu}
      style={{ height }}
      className={cn(
        'dsp-well rounded-[18px] w-full relative overflow-hidden cursor-crosshair touch-none select-none',
        className
      )}
    >
      {/* Vertical Hairline Grid */}
      {[0.2, 0.4, 0.6, 0.8].map((pos) => (
        <div
          key={pos}
          aria-hidden="true"
          className="absolute top-0 bottom-0 w-[1px] bg-white/[0.045] pointer-events-none"
          style={{ left: `${pos * 100}%` }}
        />
      ))}
      <div
        aria-hidden="true"
        className="absolute left-0 right-0 top-1/2 h-[1px] bg-white/[0.05] pointer-events-none"
      />

      {/* Header & Scale Readouts */}
      <div className="absolute top-2.5 left-3.5 right-3.5 flex items-center justify-between pointer-events-none z-10">
        <span
          className="font-display font-semibold text-[10px] tracking-[0.1em] uppercase"
          style={{ color: palette.bright }}
        >
          {title}
        </span>
        <span className="font-mono text-[9.5px] tabular-nums text-[#676F82]">
          {maxLabel}
        </span>
      </div>
      <div className="absolute bottom-2 left-3.5 right-3.5 flex items-center justify-between pointer-events-none z-10">
        <span className="font-mono text-[9px] text-[#565D6F]">
          Click to add node · Right-click to remove
        </span>
        <span className="font-mono text-[9.5px] tabular-nums text-[#676F82]">
          {minLabel}
        </span>
      </div>

      {/* Optional Audio Waveform Silhouette */}
      {waveform && (
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none opacity-20"
          viewBox="0 0 1000 100"
          preserveAspectRatio="none"
        >
          <path
            d={`M ${Array.from(waveform)
              .map((v, i) => `${((i / (waveform.length - 1)) * 1000).toFixed(1)} ${(50 - v * 42).toFixed(1)}`)
              .join(' L ')} L 1000 50 L ${Array.from(waveform)
              .map((v, i) => `${(((waveform.length - 1 - i) / (waveform.length - 1)) * 1000).toFixed(1)} ${(50 + v * 42).toFixed(1)}`)
              .join(' L ')} Z`}
            fill="#9BA3B8"
          />
        </svg>
      )}

      {/* Glowing Envelope Fill & Stroke */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox="0 0 1000 100"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={palette.primary} stopOpacity="0.46" />
            <stop offset="100%" stopColor={palette.primary} stopOpacity="0.04" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#${gradId})`} />
        <path
          d={strokePath}
          fill="none"
          stroke={palette.bright}
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          style={{ filter: `drop-shadow(0 0 6px ${palette.primary})` }}
        />
      </svg>

      {/* Playhead */}
      {playhead !== undefined && playhead >= 0 && (
        <div
          className="absolute top-0 bottom-0 w-[1.5px] bg-white shadow-[0_0_10px_#FFFFFF] pointer-events-none z-10"
          style={{ left: `${playhead * 100}%` }}
        />
      )}

      {/* Node Handles */}
      {sorted.map((pt, idx) => (
        <div
          key={idx}
          className="absolute -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-[#151821] border-2 pointer-events-none z-20 transition-transform duration-75"
          style={{
            left: `${pt.x * 100}%`,
            top: `${(1 - pt.y) * 100}%`,
            borderColor: palette.bright,
            boxShadow: `0 0 8px ${palette.primary}`,
          }}
        />
      ))}
    </div>
  );
}
