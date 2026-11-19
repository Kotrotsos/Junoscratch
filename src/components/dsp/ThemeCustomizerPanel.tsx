import React from 'react';
import { RotateCcw, X } from 'lucide-react';
import {
  DEFAULT_THEME_SETTINGS,
  THEME_PRESETS,
  ThemeSettings,
} from './tokens';
import { cn } from '../../utils';

export interface ThemeCustomizerPanelProps {
  theme: ThemeSettings;
  onChangeTheme: (next: ThemeSettings) => void;
  onClose?: () => void;
  className?: string;
}

interface ColorSwatchFieldProps {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}

function ColorSwatchField({ label, value, onChange }: ColorSwatchFieldProps) {
  return (
    <label className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-[#161923] border border-white/10 hover:border-white/25 transition-colors cursor-pointer select-none">
      <span className="relative w-5 h-5 rounded-full overflow-hidden border border-white/25 shrink-0 shadow-inner">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} colour`}
          className="absolute -inset-2 w-9 h-9 cursor-pointer border-0 p-0 bg-transparent"
        />
      </span>
      <span className="flex flex-col leading-tight min-w-0">
        <span className="font-display text-[9.5px] font-semibold tracking-[0.07em] uppercase text-[#CFD5E4] whitespace-nowrap truncate">
          {label}
        </span>
        <span className="font-mono text-[9px] tabular-nums text-[#7C8499] uppercase">
          {value}
        </span>
      </span>
    </label>
  );
}

interface LightingSliderFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (val: number) => void;
}

function LightingSliderField({
  label,
  value,
  min,
  max,
  step = 5,
  unit = '%',
  onChange,
}: LightingSliderFieldProps) {
  return (
    <div className="flex flex-col gap-1.5 min-w-[120px] flex-1">
      <div className="flex items-center justify-between text-[10px] gap-2">
        <span className="font-display font-semibold tracking-[0.07em] uppercase text-[#B5BDD0] whitespace-nowrap">
          {label}
        </span>
        <span className="font-mono text-[10px] tabular-nums text-[#E4E8F4] shrink-0">
          {value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={(e) => e.currentTarget.blur()}
        className="w-full h-1.5 rounded-full appearance-none bg-[#232736] accent-[var(--accent-blue-bright)] cursor-pointer"
      />
    </div>
  );
}

export function ThemeCustomizerPanel({
  theme,
  onChangeTheme,
  onClose,
  className,
}: ThemeCustomizerPanelProps) {
  const merged = { ...DEFAULT_THEME_SETTINGS, ...theme };

  const updateFields = (patch: Partial<ThemeSettings>) => {
    onChangeTheme({
      ...merged,
      presetId: 'custom',
      ...patch,
    });
  };

  return (
    <div
      style={{ borderRadius: 'var(--module-radius)' }}
      className={cn(
        'mb-3.5 p-4 bg-[#11141C]/96 border border-white/12 shadow-[inset_0_2px_10px_rgba(0,0,0,0.85)] flex flex-col gap-3.5 text-[#E4E7F0] relative z-20',
        className
      )}
    >
      {/* Top Row: Hardware Finish Presets + Reset / Close */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-display text-[10.5px] font-semibold tracking-[0.09em] uppercase text-[#98A0B5] mr-1 whitespace-nowrap">
            Finish Presets:
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {THEME_PRESETS.map((preset) => {
              const isSelected = merged.presetId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => onChangeTheme(preset.settings)}
                  className={cn(
                    'px-3 py-1 rounded-full font-display text-[10px] font-semibold tracking-[0.07em] uppercase transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0 border',
                    isSelected
                      ? 'bg-[#252A3A] border-white/35 text-white shadow-sm'
                      : 'bg-[#171A24] border-white/10 text-[#949CB0] hover:text-white hover:border-white/25'
                  )}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full border border-white/30 shrink-0"
                    style={{ backgroundColor: preset.settings.surfaceColor }}
                  />
                  <span>{preset.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onChangeTheme(DEFAULT_THEME_SETTINGS)}
            className="px-2.5 py-1 rounded-full bg-[#191D28] border border-white/12 hover:border-white/30 text-[10px] font-display font-semibold tracking-[0.08em] uppercase text-[#AEB6CA] hover:text-white flex items-center gap-1 cursor-pointer transition-colors whitespace-nowrap shrink-0"
            title="Reset colours and textures to default Obsidian Studio"
          >
            <RotateCcw size={11} />
            <span>Reset</span>
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close theme settings"
              className="w-6 h-6 rounded-full bg-[#191D28] border border-white/12 hover:border-white/30 text-[#AEB6CA] hover:text-white flex items-center justify-center cursor-pointer transition-colors"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Middle Row: Chassis, JunoScratch Waveform & Curves, Filter, and Rack Accent Swatches */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 xl:grid-cols-9 gap-2">
        <ColorSwatchField
          label="Backdrop"
          value={merged.backdropColor}
          onChange={(hex) => updateFields({ backdropColor: hex })}
        />
        <ColorSwatchField
          label="Chassis"
          value={merged.surfaceColor}
          onChange={(hex) => updateFields({ surfaceColor: hex })}
        />
        <ColorSwatchField
          label="Screen Well"
          value={merged.screenColor}
          onChange={(hex) => updateFields({ screenColor: hex })}
        />
        <ColorSwatchField
          label="Waveform"
          value={merged.waveformColor}
          onChange={(hex) => updateFields({ waveformColor: hex })}
        />
        <ColorSwatchField
          label="Speed Curve"
          value={merged.speedCurveColor}
          onChange={(hex) => updateFields({ speedCurveColor: hex, grainColor: hex })}
        />
        <ColorSwatchField
          label="Growl / Pitch"
          value={merged.growlCurveColor}
          onChange={(hex) => updateFields({ growlCurveColor: hex, growlColor: hex })}
        />
        <ColorSwatchField
          label="OSC Accent"
          value={merged.oscColor}
          onChange={(hex) => updateFields({ oscColor: hex })}
        />
        <ColorSwatchField
          label="FX Accent"
          value={merged.fxColor}
          onChange={(hex) => updateFields({ fxColor: hex })}
        />
        <ColorSwatchField
          label="Filter Glow"
          value={merged.filterColor}
          onChange={(hex) => updateFields({ filterColor: hex })}
        />
      </div>

      {/* Bottom Row: Brushed Metal, Surface Noise, Shadow Depth, Bevel Rim, Phosphor Glow & Corner Radius */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 pt-2 border-t border-white/8">
        <LightingSliderField
          label="Brushed Metal"
          value={merged.brushedMetal}
          min={0}
          max={100}
          step={5}
          unit="%"
          onChange={(val) => updateFields({ brushedMetal: val })}
        />
        <LightingSliderField
          label="Surface Noise"
          value={merged.noiseAmount}
          min={0}
          max={100}
          step={5}
          unit="%"
          onChange={(val) => updateFields({ noiseAmount: val })}
        />
        <LightingSliderField
          label="Shadow Depth"
          value={merged.shadowDepth}
          min={0}
          max={200}
          step={5}
          unit="%"
          onChange={(val) => updateFields({ shadowDepth: val })}
        />
        <LightingSliderField
          label="Bevel & Rim"
          value={merged.bevelIntensity}
          min={0}
          max={200}
          step={5}
          unit="%"
          onChange={(val) => updateFields({ bevelIntensity: val })}
        />
        <LightingSliderField
          label="Phosphor Glow"
          value={merged.glowIntensity}
          min={0}
          max={200}
          step={5}
          unit="%"
          onChange={(val) => updateFields({ glowIntensity: val })}
        />
        <LightingSliderField
          label="Corner Radius"
          value={merged.cornerRadius}
          min={8}
          max={38}
          step={2}
          unit="px"
          onChange={(val) => updateFields({ cornerRadius: val })}
        />
      </div>
    </div>
  );
}
