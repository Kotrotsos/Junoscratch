import React, { useEffect, useRef, useState } from 'react';
import { audioEngine } from '../../audioEngine';
import { PhaseScopeMode } from '../../types';
import { ACCENT_PALETTES, DspAccent, clamp } from './tokens';
import { MidiLearnOverlayTag, useMidiLearnTarget } from './MidiLearnContext';
import { MicroKnob } from './RotaryKnob';
import { cn } from '../../utils';

export interface PhaseScopeDisplayProps {
  mode: PhaseScopeMode;
  onChangeMode: (next: PhaseScopeMode) => void;
  frozen?: boolean;
  phaseAlignDeg: number; // -180 .. +180
  onChangePhaseAlignDeg: (deg: number) => void;
  haasWidth?: number; // 0 .. 100
  onChangeHaasWidth?: (w: number) => void;
  invertR?: boolean;
  monoCheck?: boolean;
  accent?: DspAccent;
  modeMidiId?: string;
  alignMidiId?: string;
  widthMidiId?: string;
  className?: string;
}

export const PhaseScopeDisplay = React.memo(function PhaseScopeDisplay({
  mode,
  onChangeMode,
  frozen = false,
  phaseAlignDeg,
  onChangePhaseAlignDeg,
  haasWidth = 0,
  onChangeHaasWidth,
  invertR = false,
  monoCheck = false,
  accent = 'emerald',
  modeMidiId = 'phaseScopeMode',
  alignMidiId = 'phaseAlignDeg',
  widthMidiId = 'haasWidth',
  className,
}: PhaseScopeDisplayProps) {
  const palette = ACCENT_PALETTES[accent];
  const modeMidi = useMidiLearnTarget(modeMidiId, 'Phase Scope Mode');
  const alignMidi = useMidiLearnTarget(alignMidiId, 'Stereo Phase Align (°)');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const corrBarRef = useRef<HTMLDivElement>(null);
  const corrThumbRef = useRef<HTMLSpanElement>(null);
  const corrReadoutRef = useRef<HTMLSpanElement>(null);
  const widthReadoutRef = useRef<HTMLSpanElement>(null);

  const [scrubbing, setScrubbing] = useState(false);
  const scrubStartXRef = useRef(0);
  const scrubStartDegRef = useRef(phaseAlignDeg);

  const modeRef = useRef(mode);
  const frozenRef = useRef(frozen);
  const paletteRef = useRef(palette);
  modeRef.current = mode;
  frozenRef.current = frozen;
  paletteRef.current = palette;

  // Handle horizontal/vertical drag on scope screen to scrub phase alignment (-180°..+180°)
  const handleCanvasPointerDown = (e: React.PointerEvent) => {
    if (alignMidi.interceptLearnEvent(e)) return;
    e.preventDefault();
    scrubStartXRef.current = e.clientX;
    scrubStartDegRef.current = phaseAlignDeg;
    setScrubbing(true);
  };

  useEffect(() => {
    if (!scrubbing) return;
    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - scrubStartXRef.current;
      const raw = scrubStartDegRef.current + (dx / 110) * 180;
      const snapped = clamp(Math.round(raw / 2) * 2, -180, 180);
      onChangePhaseAlignDeg(snapped);
    };
    const onUp = () => setScrubbing(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [scrubbing, onChangePhaseAlignDeg]);

  // Self-contained 60 FPS Canvas Vectorscope + DOM-ref Correlation Meter (0 React re-renders!)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let cssW = 114;
    let cssH = 120;
    let dpr = Math.min(2, window.devicePixelRatio || 1);

    const syncSize = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width > 8 && rect.height > 8) {
        cssW = rect.width;
        cssH = rect.height;
        dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#070A10';
        ctx.fillRect(0, 0, cssW, cssH);
      }
    };

    syncSize();
    const ro = new ResizeObserver(syncSize);
    ro.observe(canvas);

    let autoGainPeak = 0.28;
    let lastDomUpdateMs = 0;
    let rafId = 0;

    const drawGraticule = (cx: number, cy: number, radius: number, currentMode: PhaseScopeMode) => {
      ctx.save();
      ctx.lineWidth = 1;

      if (currentMode === 'goniometer') {
        // Outer rotated M/S diamond reticle
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.11)';
        ctx.beginPath();
        ctx.moveTo(cx, cy - radius);
        ctx.lineTo(cx + radius, cy);
        ctx.lineTo(cx, cy + radius);
        ctx.lineTo(cx - radius, cy);
        ctx.closePath();
        ctx.stroke();

        // Inner 50% calibration circle
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.055)';
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 0.52, 0, Math.PI * 2);
        ctx.stroke();

        // L (-45°) and R (+45°) diagonal stereo axes
        const diag = radius * 0.7071;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.065)';
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(cx - diag, cy - diag);
        ctx.lineTo(cx + diag, cy + diag);
        ctx.moveTo(cx + diag, cy - diag);
        ctx.lineTo(cx - diag, cy + diag);
        ctx.stroke();
        ctx.setLineDash([]);

        // Primary Mid (vertical) & Side (horizontal) axes
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.beginPath();
        ctx.moveTo(cx, cy - radius);
        ctx.lineTo(cx, cy + radius);
        ctx.moveTo(cx - radius, cy);
        ctx.lineTo(cx + radius, cy);
        ctx.stroke();

        // Micro-calibrated axis labels: M, L, R, S
        ctx.fillStyle = 'rgba(154, 165, 190, 0.62)';
        ctx.font = '600 7.5px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('M', cx, 3);
        ctx.fillStyle = 'rgba(138, 148, 172, 0.5)';
        ctx.fillText('L', cx - diag - 4, cy - diag - 4);
        ctx.fillText('R', cx + diag + 4, cy - diag - 4);
      } else {
        // X/Y Lissajous Circular & Orthogonal Graticule
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.11)';
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 0.94, 0, Math.PI * 2);
        ctx.stroke();

        // Orthogonal L (X) and R (Y) axes
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.beginPath();
        ctx.moveTo(cx - radius, cy);
        ctx.lineTo(cx + radius, cy);
        ctx.moveTo(cx, cy - radius);
        ctx.lineTo(cx, cy + radius);
        ctx.stroke();

        // +45° Mono In-Phase Reference Diagonal
        const d = radius * 0.66;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(cx - d, cy + d);
        ctx.lineTo(cx + d, cy - d);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = 'rgba(154, 165, 190, 0.62)';
        ctx.font = '600 7.5px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('R', cx, 3);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText('L', cssW - 4, cy);
      }

      ctx.restore();
    };

    const renderFrame = (nowMs: number) => {
      rafId = requestAnimationFrame(renderFrame);

      if (frozenRef.current) {
        return;
      }

      const snap = audioEngine.samplePhaseScope();
      const pal = paletteRef.current;
      const currentMode = modeRef.current;

      const cx = cssW * 0.5;
      const cy = cssH * 0.52;
      const radius = Math.max(18, Math.min(cssW, cssH) * 0.43);

      // Phosphor persistence fade (instant clear when prefers-reduced-motion)
      ctx.fillStyle = reducedMotion ? '#070A10' : 'rgba(7, 10, 16, 0.36)';
      ctx.fillRect(0, 0, cssW, cssH);

      drawGraticule(cx, cy, radius, currentMode);

      const corr = snap.correlation;
      const isPhaseWarning = snap.isActive && corr < -0.05;
      const traceStroke = isPhaseWarning ? '#FDA4AF' : pal.bright;
      const traceGlow = isPhaseWarning ? '#FB7185' : pal.primary;

      if (snap.isActive) {
        let frameMax = 0.05;
        const lArr = snap.l;
        const rArr = snap.r;
        const n = lArr.length;
        for (let i = 0; i < n; i += 2) {
          const m = Math.max(Math.abs(lArr[i]), Math.abs(rArr[i]));
          if (m > frameMax) frameMax = m;
        }
        // Fast attack, smooth release auto-gain normalization
        if (frameMax > autoGainPeak) {
          autoGainPeak += (frameMax - autoGainPeak) * 0.38;
        } else {
          autoGainPeak += (Math.max(0.12, frameMax) - autoGainPeak) * 0.08;
        }
        const gain = (radius * 0.84) / Math.max(0.12, autoGainPeak * 1.35);

        ctx.save();
        ctx.strokeStyle = traceStroke;
        ctx.lineWidth = 1.45;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.shadowColor = traceGlow;
        ctx.shadowBlur = 7;

        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const l = lArr[i];
          const r = rArr[i];
          let px: number;
          let py: number;
          if (currentMode === 'goniometer') {
            // Left -> top-left (-45°), Right -> top-right (+45°), Mono -> vertical M axis
            const side = (r - l) * 0.70710678;
            const mid = (l + r) * 0.70710678;
            px = cx + clamp(side * gain, -radius * 0.96, radius * 0.96);
            py = cy - clamp(mid * gain, -radius * 0.96, radius * 0.96);
          } else {
            px = cx + clamp(l * gain * 0.92, -radius * 0.95, radius * 0.95);
            py = cy - clamp(r * gain * 0.92, -radius * 0.95, radius * 0.95);
          }
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.restore();
      } else {
        // Resting calibrated center phosphor reticle dot
        ctx.save();
        ctx.fillStyle = pal.bright;
        ctx.shadowColor = pal.primary;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(cx, cy, 2.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Update Correlation Meter Bar + Tabular Readouts at ~14 Hz (zero React re-renders!)
      const pct = clamp((corr + 1) * 50, 2, 98);
      if (corrThumbRef.current) {
        corrThumbRef.current.style.left = `${pct.toFixed(1)}%`;
        corrThumbRef.current.style.backgroundColor = isPhaseWarning ? '#FDA4AF' : pal.bright;
      }
      if (corrBarRef.current) {
        if (corr >= 0) {
          corrBarRef.current.style.left = '50%';
          corrBarRef.current.style.width = `${(corr * 50).toFixed(1)}%`;
          corrBarRef.current.style.backgroundColor = pal.primary;
        } else {
          const w = Math.abs(corr) * 50;
          corrBarRef.current.style.left = `${(50 - w).toFixed(1)}%`;
          corrBarRef.current.style.width = `${w.toFixed(1)}%`;
          corrBarRef.current.style.backgroundColor = '#FB7185';
        }
      }

      if (nowMs - lastDomUpdateMs >= 72) {
        lastDomUpdateMs = nowMs;
        if (corrReadoutRef.current) {
          const sign = corr >= 0 ? '+' : '';
          const glyph = isPhaseWarning ? '▲ ' : '● ';
          corrReadoutRef.current.textContent = `${glyph}${sign}${corr.toFixed(2)}`;
          corrReadoutRef.current.style.color = isPhaseWarning ? '#FDA4AF' : pal.bright;
        }
        if (widthReadoutRef.current) {
          widthReadoutRef.current.textContent = `${Math.round(snap.widthPct)}%`;
        }
      }
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, []);

  return (
    <div
      className={cn(
        'grid grid-cols-[114px_minmax(92px,1fr)] items-stretch gap-x-2.5 h-full pt-0.5 select-none',
        className
      )}
    >
      {/* Left Recessed CRT Vectorscope / Lissajous Screen */}
      <div className="relative h-full min-h-[116px]" onContextMenu={alignMidi.handleContextMenu}>
        <MidiLearnOverlayTag
          midiId={alignMidiId}
          binding={alignMidi.binding}
          isArmed={alignMidi.isArmed}
          midiLearnMode={alignMidi.midiLearnMode}
          onUnbind={alignMidi.unbind}
          compact
        />
        <div
          onPointerDown={handleCanvasPointerDown}
          onDoubleClick={() => !alignMidi.enabled && onChangePhaseAlignDeg(0)}
          title="Real-Time Stereo Phase Scope — Drag horizontally to rotate stereo phase (±180°), double-click for 0°"
          className={cn(
            'dsp-well rounded-[14px] w-full h-full relative overflow-hidden cursor-crosshair transition-shadow',
            alignMidi.isArmed && 'ring-2 ring-[#FFB35C] shadow-[0_0_14px_rgba(255,159,67,0.5)]',
            !alignMidi.isArmed && alignMidi.enabled && alignMidi.binding && 'ring-2 ring-[#38BDF8]/85',
            !alignMidi.isArmed &&
              alignMidi.enabled &&
              !alignMidi.binding &&
              'ring-1 ring-[#38BDF8]/40 hover:ring-[#38BDF8]'
          )}
        >
          <canvas ref={canvasRef} className="w-full h-full block" />

          {/* Subtle status badges inside bottom corners of scope (unboxed clean text) */}
          {(frozen || invertR || monoCheck) && (
            <div className="absolute bottom-1 inset-x-1.5 flex items-center justify-between pointer-events-none font-mono text-[7.5px] leading-none">
              <span className="text-[#FDA4AF]">
                {invertR ? 'Ø INV-R' : monoCheck ? 'MONO' : ''}
              </span>
              {frozen && <span style={{ color: palette.bright }}>HOLD</span>}
            </div>
          )}
        </div>
      </div>

      {/* Right Column: M/S vs X/Y Switch + Calibrated Correlation Meter + Bottom-Aligned Knobs */}
      <div className="h-full flex flex-col justify-between items-stretch gap-1.5">
        {/* Top Row: Interactive M/S (Goniometer) vs X/Y (Lissajous) Mode Switch */}
        <div className="relative" onContextMenu={modeMidi.handleContextMenu}>
          <MidiLearnOverlayTag
            midiId={modeMidiId}
            binding={modeMidi.binding}
            isArmed={modeMidi.isArmed}
            midiLearnMode={modeMidi.midiLearnMode}
            onUnbind={modeMidi.unbind}
            compact
          />
          <div
            onPointerDownCapture={(e) => {
              if (modeMidi.interceptLearnEvent(e)) return;
            }}
            className={cn(
              'dsp-well rounded-[10px] p-0.5 grid grid-cols-2 gap-0.5',
              modeMidi.isArmed && 'ring-2 ring-[#FFB35C]',
              !modeMidi.isArmed && modeMidi.enabled && modeMidi.binding && 'ring-2 ring-[#38BDF8]/85',
              !modeMidi.isArmed && modeMidi.enabled && !modeMidi.binding && 'ring-1 ring-[#38BDF8]/40'
            )}
          >
            <button
              type="button"
              onClick={() => !modeMidi.enabled && onChangeMode('goniometer')}
              className={cn(
                'h-5 rounded-[7px] font-display text-[8.5px] font-semibold tracking-[0.08em] uppercase whitespace-nowrap shrink-0 cursor-pointer transition-colors focus-visible:outline-none',
                mode === 'goniometer'
                  ? 'bg-white/12 text-white'
                  : 'text-[#778095] hover:text-[#C4CCDE]'
              )}
              style={mode === 'goniometer' ? { color: palette.bright } : undefined}
              title="Mid/Side Mastering Goniometer (Vertical = Mono Mid, Horizontal = Side)"
            >
              M/S
            </button>
            <button
              type="button"
              onClick={() => !modeMidi.enabled && onChangeMode('lissajous')}
              className={cn(
                'h-5 rounded-[7px] font-display text-[8.5px] font-semibold tracking-[0.08em] uppercase whitespace-nowrap shrink-0 cursor-pointer transition-colors focus-visible:outline-none',
                mode === 'lissajous'
                  ? 'bg-white/12 text-white'
                  : 'text-[#778095] hover:text-[#C4CCDE]'
              )}
              style={mode === 'lissajous' ? { color: palette.bright } : undefined}
              title="X/Y Orthogonal Lissajous Oscilloscope (X = Left, Y = Right)"
            >
              X/Y
            </button>
          </div>
        </div>

        {/* Middle Row: Real-Time Stereo Phase Correlation Meter (-1 · 0 · +1) */}
        <div className="dsp-well rounded-[10px] px-2 py-1.5 flex flex-col gap-1">
          <div className="flex items-center justify-between gap-1 whitespace-nowrap">
            <span className="font-display font-semibold text-[7.5px] tracking-[0.08em] uppercase text-[#838C9F]">
              CORR
            </span>
            <span
              ref={corrReadoutRef}
              className="font-mono text-[9px] font-semibold tabular-nums leading-none"
              style={{ color: palette.bright }}
            >
              ● +1.00
            </span>
          </div>

          {/* Bidirectional Center-Zero Correlation Bar */}
          <div className="relative w-full h-[5px] rounded-full bg-white/[0.08] overflow-visible">
            <span
              aria-hidden="true"
              className="absolute left-1/2 top-[-2px] bottom-[-2px] w-[1px] bg-white/25"
            />
            <div
              ref={corrBarRef}
              className="absolute top-0 bottom-0 rounded-full"
              style={{ left: '50%', width: '50%', backgroundColor: palette.primary }}
            />
            <span
              ref={corrThumbRef}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full shadow-[0_0_6px_rgba(255,255,255,0.8)]"
              style={{ left: '98%', backgroundColor: palette.bright }}
            />
          </div>

          <div className="flex items-center justify-between font-mono text-[7px] tabular-nums text-[#697286] leading-none">
            <span>-1</span>
            <span>0</span>
            <span className="flex items-center gap-1">
              <span ref={widthReadoutRef} className="text-[#949EB4]">
                0%
              </span>
              <span>+1</span>
            </span>
          </div>
        </div>

        {/* Bottom Row: Grid-Aligned Phase Align (±180°) & Stereo Width MicroKnobs */}
        <div className="grid grid-cols-2 gap-x-2 w-full justify-items-center items-end">
          <MicroKnob
            label="ALIGN"
            midiId={alignMidiId}
            accent={accent}
            value={phaseAlignDeg}
            min={-180}
            max={180}
            step={2}
            defaultValue={0}
            formatValue={(v) => `${v > 0 ? '+' : ''}${Math.round(v)}°`}
            onChange={onChangePhaseAlignDeg}
          />
          {onChangeHaasWidth ? (
            <MicroKnob
              label="STEREO"
              midiId={widthMidiId}
              accent={accent}
              value={haasWidth}
              min={0}
              max={100}
              step={1}
              defaultValue={0}
              formatValue={(v) => `${Math.round(v)}% Haas`}
              onChange={onChangeHaasWidth}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
});
