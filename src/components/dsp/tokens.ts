export type DspAccent = 'blue' | 'amber' | 'violet' | 'cyan' | 'emerald' | 'rose' | 'neutral';

export interface AccentPalette {
  primary: string;
  bright: string;
  soft: string;
  glow: string;
  wellGlow: string;
  textClass: string;
}

export const ACCENT_PALETTES: Record<DspAccent, AccentPalette> = {
  blue: {
    primary: 'var(--accent-blue)',
    bright: 'var(--accent-blue-bright)',
    soft: 'color-mix(in srgb, var(--accent-blue) 28%, transparent)',
    glow: '0 0 calc(10px * var(--glow-scale, 1)) color-mix(in srgb, var(--accent-blue) 85%, transparent), 0 0 calc(3px * var(--glow-scale, 1)) var(--accent-blue-bright)',
    wellGlow:
      'radial-gradient(ellipse 85% 65% at 50% 100%, color-mix(in srgb, var(--accent-blue) 42%, transparent) 0%, color-mix(in srgb, var(--accent-blue) 12%, transparent) 55%, transparent 100%)',
    textClass: 'text-[var(--accent-blue-bright)]',
  },
  amber: {
    primary: 'var(--accent-amber)',
    bright: 'var(--accent-amber-bright)',
    soft: 'color-mix(in srgb, var(--accent-amber) 28%, transparent)',
    glow: '0 0 calc(10px * var(--glow-scale, 1)) color-mix(in srgb, var(--accent-amber) 85%, transparent), 0 0 calc(3px * var(--glow-scale, 1)) var(--accent-amber-bright)',
    wellGlow:
      'radial-gradient(ellipse 85% 65% at 50% 100%, color-mix(in srgb, var(--accent-amber) 40%, transparent) 0%, color-mix(in srgb, var(--accent-amber) 12%, transparent) 55%, transparent 100%)',
    textClass: 'text-[var(--accent-amber-bright)]',
  },
  violet: {
    primary: 'var(--accent-violet)',
    bright: 'var(--accent-violet-bright)',
    soft: 'color-mix(in srgb, var(--accent-violet) 28%, transparent)',
    glow: '0 0 calc(10px * var(--glow-scale, 1)) color-mix(in srgb, var(--accent-violet) 85%, transparent), 0 0 calc(3px * var(--glow-scale, 1)) var(--accent-violet-bright)',
    wellGlow:
      'radial-gradient(ellipse 85% 65% at 50% 100%, color-mix(in srgb, var(--accent-violet) 44%, transparent) 0%, color-mix(in srgb, var(--accent-violet) 14%, transparent) 55%, transparent 100%)',
    textClass: 'text-[var(--accent-violet-bright)]',
  },
  cyan: {
    primary: 'var(--accent-cyan)',
    bright: 'var(--accent-cyan-bright)',
    soft: 'color-mix(in srgb, var(--accent-cyan) 26%, transparent)',
    glow: '0 0 calc(10px * var(--glow-scale, 1)) color-mix(in srgb, var(--accent-cyan) 85%, transparent), 0 0 calc(3px * var(--glow-scale, 1)) var(--accent-cyan-bright)',
    wellGlow:
      'radial-gradient(ellipse 85% 65% at 50% 100%, color-mix(in srgb, var(--accent-cyan) 38%, transparent) 0%, color-mix(in srgb, var(--accent-cyan) 12%, transparent) 55%, transparent 100%)',
    textClass: 'text-[var(--accent-cyan-bright)]',
  },
  emerald: {
    primary: 'var(--accent-filter)',
    bright: 'var(--accent-filter-bright)',
    soft: 'color-mix(in srgb, var(--accent-filter) 28%, transparent)',
    glow: '0 0 calc(10px * var(--glow-scale, 1)) color-mix(in srgb, var(--accent-filter) 85%, transparent), 0 0 calc(3px * var(--glow-scale, 1)) var(--accent-filter-bright)',
    wellGlow:
      'radial-gradient(ellipse 85% 65% at 50% 100%, color-mix(in srgb, var(--accent-filter) 42%, transparent) 0%, color-mix(in srgb, var(--accent-filter) 14%, transparent) 55%, transparent 100%)',
    textClass: 'text-[var(--accent-filter-bright)]',
  },
  rose: {
    primary: '#FB7185',
    bright: '#FDA4AF',
    soft: 'rgba(251, 113, 133, 0.26)',
    glow: '0 0 calc(10px * var(--glow-scale, 1)) rgba(251, 113, 133, 0.85), 0 0 calc(3px * var(--glow-scale, 1)) rgba(253, 164, 175, 0.9)',
    wellGlow:
      'radial-gradient(ellipse 85% 65% at 50% 100%, rgba(244, 63, 94, 0.38) 0%, rgba(159, 18, 57, 0.12) 55%, transparent 100%)',
    textClass: 'text-[#FDA4AF]',
  },
  neutral: {
    primary: '#E6EAF2',
    bright: '#FFFFFF',
    soft: 'rgba(230, 234, 242, 0.2)',
    glow: '0 0 calc(8px * var(--glow-scale, 1)) rgba(255, 255, 255, 0.7)',
    wellGlow:
      'radial-gradient(ellipse 85% 65% at 50% 100%, rgba(200, 210, 230, 0.18) 0%, transparent 100%)',
    textClass: 'text-[#E6EAF2]',
  },
};

export interface ThemeSettings {
  presetId: string;
  backdropColor: string;
  surfaceColor: string;
  screenColor: string;
  waveformColor: string;
  speedCurveColor: string;
  growlCurveColor: string;
  oscColor: string;
  grainColor: string;
  growlColor: string;
  fxColor: string;
  filterColor: string;
  shadowDepth: number; // 0..200 (%)
  bevelIntensity: number; // 0..200 (%)
  glowIntensity: number; // 0..200 (%)
  cornerRadius: number; // 8..38 (px)
  noiseAmount: number; // 0..100 (%)
  brushedMetal: number; // 0..100 (%)
}

export interface ThemePresetDefinition {
  id: string;
  name: string;
  settings: ThemeSettings;
}

export const THEME_PRESETS: ThemePresetDefinition[] = [
  {
    id: 'obsidian',
    name: 'Obsidian Studio',
    settings: {
      presetId: 'obsidian',
      backdropColor: '#272A34',
      surfaceColor: '#292C35',
      screenColor: '#0C0F17',
      waveformColor: '#9D7BFF',
      speedCurveColor: '#6E93FF',
      growlCurveColor: '#FF9A3E',
      oscColor: '#38BDF8',
      grainColor: '#6E93FF',
      growlColor: '#FF9A3E',
      fxColor: '#B16EFF',
      filterColor: '#10B981',
      shadowDepth: 100,
      bevelIntensity: 100,
      glowIntensity: 100,
      cornerRadius: 34,
      noiseAmount: 14,
      brushedMetal: 0,
    },
  },
  {
    id: 'gunmetal',
    name: 'Brushed Gunmetal',
    settings: {
      presetId: 'gunmetal',
      backdropColor: '#1C2029',
      surfaceColor: '#2B303C',
      screenColor: '#0A0E15',
      waveformColor: '#38BDF8',
      speedCurveColor: '#60A5FA',
      growlCurveColor: '#F59E0B',
      oscColor: '#38BDF8',
      grainColor: '#60A5FA',
      growlColor: '#F59E0B',
      fxColor: '#A78BFA',
      filterColor: '#2DD4BF',
      shadowDepth: 115,
      bevelIntensity: 135,
      glowIntensity: 105,
      cornerRadius: 24,
      noiseAmount: 28,
      brushedMetal: 78,
    },
  },
  {
    id: 'stealth',
    name: 'Matte Stealth',
    settings: {
      presetId: 'stealth',
      backdropColor: '#111318',
      surfaceColor: '#191B22',
      screenColor: '#080A0F',
      waveformColor: '#2DD4BF',
      speedCurveColor: '#38BDF8',
      growlCurveColor: '#FB7185',
      oscColor: '#2DD4BF',
      grainColor: '#60A5FA',
      growlColor: '#FB7185',
      fxColor: '#818CF8',
      filterColor: '#34D399',
      shadowDepth: 45,
      bevelIntensity: 55,
      glowIntensity: 80,
      cornerRadius: 16,
      noiseAmount: 42,
      brushedMetal: 0,
    },
  },
  {
    id: 'bronze',
    name: 'Vintage Bronze',
    settings: {
      presetId: 'bronze',
      backdropColor: '#211D1A',
      surfaceColor: '#2E2824',
      screenColor: '#120E0C',
      waveformColor: '#FBBF24',
      speedCurveColor: '#FB923C',
      growlCurveColor: '#F87171',
      oscColor: '#FBBF24',
      grainColor: '#FB923C',
      growlColor: '#F87171',
      fxColor: '#34D399',
      filterColor: '#22D3EE',
      shadowDepth: 125,
      bevelIntensity: 115,
      glowIntensity: 110,
      cornerRadius: 28,
      noiseAmount: 32,
      brushedMetal: 48,
    },
  },
  {
    id: 'nebula',
    name: 'Deep Nebula',
    settings: {
      presetId: 'nebula',
      backdropColor: '#161829',
      surfaceColor: '#21243B',
      screenColor: '#090B16',
      waveformColor: '#A78BFA',
      speedCurveColor: '#818CF8',
      growlCurveColor: '#F472B6',
      oscColor: '#22D3EE',
      grainColor: '#818CF8',
      growlColor: '#F472B6',
      fxColor: '#C084FC',
      filterColor: '#34D399',
      shadowDepth: 135,
      bevelIntensity: 120,
      glowIntensity: 145,
      cornerRadius: 34,
      noiseAmount: 18,
      brushedMetal: 20,
    },
  },
  {
    id: 'titanium',
    name: 'Brushed Titanium',
    settings: {
      presetId: 'titanium',
      backdropColor: '#C9D0DC',
      surfaceColor: '#DCE1EB',
      screenColor: '#0E131D',
      waveformColor: '#8B5CF6',
      speedCurveColor: '#3B82F6',
      growlCurveColor: '#F97316',
      oscColor: '#0EA5E9',
      grainColor: '#3B82F6',
      growlColor: '#F97316',
      fxColor: '#8B5CF6',
      filterColor: '#10B981',
      shadowDepth: 75,
      bevelIntensity: 160,
      glowIntensity: 95,
      cornerRadius: 26,
      noiseAmount: 22,
      brushedMetal: 85,
    },
  },
];

export const DEFAULT_THEME_SETTINGS: ThemeSettings = THEME_PRESETS[0].settings;

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0');
  const num = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(num)) return [41, 44, 53];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function mixHex(hexA: string, hexB: string, weightB: number): string {
  const [r1, g1, b1] = hexToRgb(hexA);
  const [r2, g2, b2] = hexToRgb(hexB);
  const w = clamp(weightB, 0, 1);
  return rgbToHex(r1 + (r2 - r1) * w, g1 + (g2 - g1) * w, b1 + (b2 - b1) * w);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function applyThemeToDocument(rawTheme: ThemeSettings): void {
  if (typeof document === 'undefined') return;
  const theme: ThemeSettings = { ...DEFAULT_THEME_SETTINGS, ...rawTheme };
  const root = document.documentElement;

  const surfaceLum = relativeLuminance(theme.surfaceColor);
  const backdropLum = relativeLuminance(theme.backdropColor);
  const isLightHardware = surfaceLum > 0.36;

  // Backdrop radial stops
  const bgCenter = mixHex(theme.backdropColor, '#FFFFFF', backdropLum > 0.4 ? 0.24 : 0.1);
  const bgMid = theme.backdropColor;
  const bgEdge = mixHex(theme.backdropColor, '#000000', backdropLum > 0.4 ? 0.16 : 0.35);

  // Chassis, Module, Knob, and Button gradient stops derived cohesively from surfaceColor
  const chassisTop = mixHex(theme.surfaceColor, '#FFFFFF', isLightHardware ? 0.22 : 0.04);
  const chassisBottom = mixHex(theme.surfaceColor, '#000000', isLightHardware ? 0.09 : 0.22);
  const chassisBorder = mixHex(theme.surfaceColor, '#000000', isLightHardware ? 0.28 : 0.52);

  const moduleTop = mixHex(theme.surfaceColor, '#FFFFFF', isLightHardware ? 0.34 : 0.07);
  const moduleBottom = mixHex(theme.surfaceColor, '#000000', isLightHardware ? 0.04 : 0.14);
  const moduleBorder = mixHex(theme.surfaceColor, '#000000', isLightHardware ? 0.2 : 0.42);

  const knobTop = mixHex(theme.surfaceColor, '#FFFFFF', isLightHardware ? 0.45 : 0.15);
  const knobBottom = mixHex(theme.surfaceColor, '#000000', isLightHardware ? 0.08 : 0.15);
  const knobCollar = isLightHardware
    ? mixHex(theme.surfaceColor, '#111520', 0.65)
    : mixHex(theme.surfaceColor, '#080A0F', 0.6);

  const btnTop = mixHex(theme.surfaceColor, '#FFFFFF', isLightHardware ? 0.38 : 0.11);
  const btnBottom = mixHex(theme.surfaceColor, '#000000', isLightHardware ? 0.06 : 0.14);
  const btnPressedTop = mixHex(theme.surfaceColor, '#000000', isLightHardware ? 0.14 : 0.22);
  const btnPressedBottom = mixHex(theme.surfaceColor, '#FFFFFF', isLightHardware ? 0.12 : 0.02);

  // Screen well stops
  const screenTop = mixHex(theme.screenColor, '#000000', 0.22);
  const screenMid = theme.screenColor;
  const screenBottom = mixHex(theme.screenColor, '#1E2538', 0.28);

  // Contrast-calibrated engraved hardware typography
  const hwTitle = isLightHardware ? '#161B26' : '#E4E7F0';
  const hwTitleInactive = isLightHardware ? '#6A7388' : '#6A7080';
  const hwLabel = isLightHardware ? '#283042' : '#C9CFD9';
  const hwMuted = isLightHardware ? '#495369' : '#9BA2B4';
  const topbarText = backdropLum > 0.4 ? '#2B3244' : '#858B9B';

  // Shadow, Elevation, Noise & Brushed Metal scaling
  const sScale = clamp(theme.shadowDepth / 100, 0, 2.2);
  const bScale = clamp(theme.bevelIntensity / 100, 0, 2.2);
  const gScale = clamp(theme.glowIntensity / 100, 0, 2.5);
  const noiseOp = clamp(theme.noiseAmount ?? 0, 0, 100) / 100;
  const brushedOp = clamp(theme.brushedMetal ?? 0, 0, 100) / 100;

  const chassisRad = clamp(theme.cornerRadius, 6, 42);
  const moduleRad = Math.max(4, Math.round(chassisRad * 0.65));

  root.style.setProperty('--bg-studio-center', bgCenter);
  root.style.setProperty('--bg-studio-mid', bgMid);
  root.style.setProperty('--bg-studio-edge', bgEdge);

  root.style.setProperty('--chassis-top', chassisTop);
  root.style.setProperty('--chassis-bottom', chassisBottom);
  root.style.setProperty('--chassis-border', chassisBorder);
  root.style.setProperty('--module-top', moduleTop);
  root.style.setProperty('--module-bottom', moduleBottom);
  root.style.setProperty('--module-border', moduleBorder);
  root.style.setProperty('--knob-top', knobTop);
  root.style.setProperty('--knob-bottom', knobBottom);
  root.style.setProperty('--knob-collar', knobCollar);
  root.style.setProperty('--btn-top', btnTop);
  root.style.setProperty('--btn-bottom', btnBottom);
  root.style.setProperty('--btn-pressed-top', btnPressedTop);
  root.style.setProperty('--btn-pressed-bottom', btnPressedBottom);

  root.style.setProperty('--screen-top', screenTop);
  root.style.setProperty('--screen-mid', screenMid);
  root.style.setProperty('--screen-bottom', screenBottom);
  root.style.setProperty('--waveform-color', theme.waveformColor);
  root.style.setProperty('--waveform-bright', mixHex(theme.waveformColor, '#FFFFFF', 0.35));

  root.style.setProperty('--hw-title', hwTitle);
  root.style.setProperty('--hw-title-inactive', hwTitleInactive);
  root.style.setProperty('--hw-label', hwLabel);
  root.style.setProperty('--hw-muted', hwMuted);
  root.style.setProperty('--topbar-text', topbarText);

  root.style.setProperty('--accent-cyan', theme.oscColor);
  root.style.setProperty('--accent-cyan-bright', mixHex(theme.oscColor, '#FFFFFF', 0.38));
  root.style.setProperty('--accent-blue', theme.grainColor);
  root.style.setProperty('--accent-blue-bright', mixHex(theme.grainColor, '#FFFFFF', 0.36));
  root.style.setProperty('--accent-amber', theme.growlColor);
  root.style.setProperty('--accent-amber-bright', mixHex(theme.growlColor, '#FFFFFF', 0.36));
  root.style.setProperty('--accent-violet', theme.fxColor);
  root.style.setProperty('--accent-violet-bright', mixHex(theme.fxColor, '#FFFFFF', 0.38));
  const fltCol = theme.filterColor || '#10B981';
  root.style.setProperty('--accent-filter', fltCol);
  root.style.setProperty('--accent-filter-bright', mixHex(fltCol, '#FFFFFF', 0.42));

  root.style.setProperty('--chassis-shadow-y1', `${Math.round(40 * sScale)}px`);
  root.style.setProperty('--chassis-shadow-b1', `${Math.round(80 * sScale)}px`);
  root.style.setProperty(
    '--chassis-shadow-a1',
    `${clamp((isLightHardware ? 0.28 : 0.78) * sScale, 0, 0.96).toFixed(2)}`
  );
  root.style.setProperty('--chassis-shadow-y2', `${Math.round(20 * sScale)}px`);
  root.style.setProperty('--chassis-shadow-b2', `${Math.round(36 * sScale)}px`);
  root.style.setProperty(
    '--chassis-shadow-a2',
    `${clamp((isLightHardware ? 0.24 : 0.85) * sScale, 0, 0.96).toFixed(2)}`
  );

  root.style.setProperty('--module-shadow-y', `${Math.round(6 * sScale)}px`);
  root.style.setProperty('--module-shadow-b', `${Math.round(14 * sScale)}px`);
  root.style.setProperty(
    '--module-shadow-a',
    `${clamp((isLightHardware ? 0.16 : 0.52) * sScale, 0, 0.9).toFixed(2)}`
  );

  root.style.setProperty('--knob-shadow-y', `${Math.round(10 * sScale)}px`);
  root.style.setProperty('--knob-shadow-b', `${Math.round(18 * sScale)}px`);
  root.style.setProperty(
    '--knob-shadow-a',
    `${clamp((isLightHardware ? 0.26 : 0.68) * sScale, 0, 0.92).toFixed(2)}`
  );
  root.style.setProperty(
    '--btn-shadow-a',
    `${clamp((isLightHardware ? 0.22 : 0.55) * sScale, 0, 0.9).toFixed(2)}`
  );

  root.style.setProperty(
    '--bevel-chassis',
    `${clamp((isLightHardware ? 0.65 : 0.22) * bScale, 0, 0.95).toFixed(2)}`
  );
  root.style.setProperty(
    '--bevel-module',
    `${clamp((isLightHardware ? 0.55 : 0.14) * bScale, 0, 0.9).toFixed(2)}`
  );
  root.style.setProperty(
    '--bevel-knob',
    `${clamp((isLightHardware ? 0.62 : 0.18) * bScale, 0, 0.95).toFixed(2)}`
  );
  root.style.setProperty('--glow-scale', `${gScale.toFixed(2)}`);
  root.style.setProperty('--chassis-radius', `${chassisRad}px`);
  root.style.setProperty('--module-radius', `${moduleRad}px`);
  root.style.setProperty('--noise-opacity', `${(noiseOp * 0.3).toFixed(3)}`);
  root.style.setProperty('--brushed-opacity', `${brushedOp.toFixed(3)}`);
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function frequencyToNote(hz: number): string {
  if (hz <= 0) return 'C0';
  const midi = Math.round(12 * Math.log2(hz / 440) + 69);
  const noteIdx = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[noteIdx]}${octave}`;
}

export function formatFilterFreq(hz: number): string {
  if (hz >= 1000) {
    const khz = hz / 1000;
    return `${khz >= 10 ? khz.toFixed(0) : khz.toFixed(1)} kHz`;
  }
  return `${Math.round(hz)} Hz`;
}

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
