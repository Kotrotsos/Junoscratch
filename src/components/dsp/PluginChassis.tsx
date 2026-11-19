import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Check,
  FolderPlus,
  Palette,
  Pencil,
  Plus,
  Redo2,
  RotateCcw,
  Search,
  Settings,
  Shuffle,
  Square,
  Trash2,
  Undo2,
  Volume2,
  X,
} from 'lucide-react';
import { audioEngine } from '../../audioEngine';
import { cn } from '../../utils';
import { clamp } from './tokens';
import { MidiLearnOverlayTag, useMidiLearnTarget } from './MidiLearnContext';

export const BUILTIN_PRESET_CATEGORIES = [
  'Classic',
  'Growl',
  'Kick',
  'Experimental',
  'User',
] as const;

export type BuiltInPresetCategory = (typeof BUILTIN_PRESET_CATEGORIES)[number];
export type PresetCategory = BuiltInPresetCategory | (string & {});

export function isBuiltInPresetCategory(cat: string): cat is BuiltInPresetCategory {
  return (BUILTIN_PRESET_CATEGORIES as readonly string[]).includes(cat);
}

export interface PresetMenuItem {
  name: string;
  category: PresetCategory;
  subtitle?: string;
  isUser?: boolean;
}

const NEW_CATEGORY_SENTINEL = '__NEW_CUSTOM_CATEGORY__';

function MidiDinIcon({ size = 13, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.25" />
      <circle cx="5" cy="9.2" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="6.2" cy="6.6" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="8" cy="5.6" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="9.8" cy="6.6" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="11" cy="9.2" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

function dbToVuNorm(db: number): number {
  const c = clamp(db, -60, 6);
  if (c <= -36) return ((c + 60) / 24) * 0.18;
  if (c <= -18) return 0.18 + ((c + 36) / 18) * 0.24;
  if (c <= -6) return 0.42 + ((c + 18) / 12) * 0.28;
  if (c <= 0) return 0.7 + ((c + 6) / 6) * 0.2;
  return 0.9 + (c / 6) * 0.1;
}

function vuNormToDb(norm: number): number {
  const n = clamp(norm, 0, 1);
  if (n <= 0.18) return -60 + (n / 0.18) * 24;
  if (n <= 0.42) return -36 + ((n - 0.18) / 0.24) * 18;
  if (n <= 0.7) return -18 + ((n - 0.42) / 0.28) * 12;
  if (n <= 0.9) return -6 + ((n - 0.7) / 0.2) * 6;
  return ((n - 0.9) / 0.1) * 6;
}

const VU_SCALE_MARKS = [-36, -24, -12, -6, -3, 0] as const;

const GlobalMasterVuMeter = React.memo(function GlobalMasterVuMeter() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const peakReadoutRef = useRef<HTMLSpanElement>(null);
  const clipButtonRef = useRef<HTMLButtonElement>(null);

  const handleClearClip = () => {
    audioEngine.clearMasterClip();
    if (peakReadoutRef.current) {
      peakReadoutRef.current.textContent = '-∞ dB';
      peakReadoutRef.current.style.color = '#8F98AD';
    }
    if (clipButtonRef.current) {
      clipButtonRef.current.textContent = 'CLIP OK';
      clipButtonRef.current.style.backgroundColor = '#151923';
      clipButtonRef.current.style.borderColor = 'rgba(255,255,255,0.14)';
      clipButtonRef.current.style.color = '#8E97AD';
      clipButtonRef.current.style.boxShadow = 'none';
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let cssW = 480;
    let cssH = 18;
    let dpr = Math.min(2, window.devicePixelRatio || 1);

    const syncSize = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width > 16 && rect.height > 6) {
        cssW = rect.width;
        cssH = rect.height;
        dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    };

    syncSize();
    const ro = new ResizeObserver(syncSize);
    ro.observe(canvas);

    let rafId = 0;
    let lastTextMs = 0;
    let prevClipUi: boolean | null = null;

    const segmentColor = (segDb: number, alpha: number): string => {
      if (segDb >= -0.05) return `rgba(251, 113, 133, ${alpha})`; // >= 0 dBFS clip crimson
      if (segDb >= -6.0) return `rgba(251, 191, 36, ${alpha})`; // -6..0 dBFS headroom amber
      if (segDb >= -14.0) return `rgba(52, 211, 153, ${alpha})`; // -14..-6 dBFS sweet-spot emerald
      return `rgba(34, 211, 238, ${alpha})`; // < -14 dBFS clean cyan-emerald
    };

    const renderFrame = (now: number) => {
      rafId = requestAnimationFrame(renderFrame);
      if (reducedMotion && now - lastTextMs < 90) return;

      const snap = audioEngine.sampleMasterVu();

      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = '#080A10';
      ctx.fillRect(0, 0, cssW, cssH);

      const clipCapW = 6;
      const meterGap = 3;
      const meterW = Math.max(40, cssW - clipCapW - meterGap - 2);
      const laneH = Math.max(5, Math.floor((cssH - 4) / 2));
      const topY = 1.5;
      const botY = cssH - 1.5 - laneH;

      const segStep = 4;
      const segW = 3;
      const segCount = Math.max(12, Math.floor(meterW / segStep));

      const rmsNormL = dbToVuNorm(snap.rmsDbL);
      const rmsNormR = dbToVuNorm(snap.rmsDbR);
      const peakNormL = dbToVuNorm(snap.peakDbL);
      const peakNormR = dbToVuNorm(snap.peakDbR);
      const holdNormL = dbToVuNorm(snap.holdDbL);
      const holdNormR = dbToVuNorm(snap.holdDbR);

      for (let i = 0; i < segCount; i++) {
        const segNorm = (i + 0.5) / segCount;
        const segDb = vuNormToDb(segNorm);
        const x = 1 + i * segStep;

        // Unlit recessed segment cells
        ctx.fillStyle =
          segDb >= -0.05 ? 'rgba(244, 63, 94, 0.13)' : 'rgba(255, 255, 255, 0.055)';
        ctx.fillRect(x, topY, segW, laneH);
        ctx.fillRect(x, botY, segW, laneH);

        // Left Channel: Ballistic RMS core + Fast Peak trail
        if (segNorm <= rmsNormL && snap.rmsDbL > -59.5) {
          ctx.fillStyle = segmentColor(segDb, 0.96);
          ctx.fillRect(x, topY, segW, laneH);
        } else if (segNorm <= peakNormL && snap.peakDbL > -59.5) {
          ctx.fillStyle = segmentColor(segDb, 0.45);
          ctx.fillRect(x, topY, segW, laneH);
        }

        // Right Channel: Ballistic RMS core + Fast Peak trail
        if (segNorm <= rmsNormR && snap.rmsDbR > -59.5) {
          ctx.fillStyle = segmentColor(segDb, 0.96);
          ctx.fillRect(x, botY, segW, laneH);
        } else if (segNorm <= peakNormR && snap.peakDbR > -59.5) {
          ctx.fillStyle = segmentColor(segDb, 0.45);
          ctx.fillRect(x, botY, segW, laneH);
        }
      }

      // Calibrated Scale Hairlines (-36, -24, -12, -6, -3, and full-height 0 dBFS ceiling marker)
      for (const markDb of VU_SCALE_MARKS) {
        const mx = Math.round(1 + dbToVuNorm(markDb) * (segCount * segStep)) + 0.5;
        if (markDb === 0) {
          ctx.fillStyle = 'rgba(251, 113, 133, 0.75)';
          ctx.fillRect(mx - 0.5, 0, 1.2, cssH);
        } else {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
          ctx.fillRect(mx, topY + laneH, 1, botY - (topY + laneH));
        }
      }

      // Peak-Hold Needles (L & R)
      const effectiveW = segCount * segStep;
      if (snap.holdDbL > -59) {
        const hx = clamp(1 + holdNormL * effectiveW, 1, effectiveW - 1.5);
        ctx.fillStyle = snap.holdDbL >= -0.05 ? '#FFE4E6' : '#F8FAFC';
        ctx.fillRect(hx, topY, 1.8, laneH);
      }
      if (snap.holdDbR > -59) {
        const hx = clamp(1 + holdNormR * effectiveW, 1, effectiveW - 1.5);
        ctx.fillStyle = snap.holdDbR >= -0.05 ? '#FFE4E6' : '#F8FAFC';
        ctx.fillRect(hx, botY, 1.8, laneH);
      }

      // Dedicated Right-Edge Sticky Clip Cells (L top, R bottom)
      const capX = cssW - clipCapW - 1;
      ctx.fillStyle = snap.clipLatchedL ? '#F43F5E' : 'rgba(244, 63, 94, 0.14)';
      ctx.fillRect(capX, topY, clipCapW, laneH);
      ctx.fillStyle = snap.clipLatchedR ? '#F43F5E' : 'rgba(244, 63, 94, 0.14)';
      ctx.fillRect(capX, botY, clipCapW, laneH);

      // Throttled Tabular Readout & Clip Status Button DOM Updates (zero React re-renders)
      if (now - lastTextMs >= 60) {
        lastTextMs = now;
        const isClipped = snap.clipLatchedL || snap.clipLatchedR || snap.clipNow;
        const shownDb = isClipped
          ? Math.max(0, snap.maxPeakDb, snap.holdDbL, snap.holdDbR)
          : Math.max(snap.holdDbL, snap.holdDbR);

        if (peakReadoutRef.current) {
          if (!isClipped && !snap.isActive && shownDb <= -59.2) {
            peakReadoutRef.current.textContent = '-∞ dB';
            peakReadoutRef.current.style.color = '#8F98AD';
          } else {
            const sign = shownDb > 0 ? '+' : '';
            peakReadoutRef.current.textContent = `${sign}${shownDb.toFixed(1)} dB`;
            peakReadoutRef.current.style.color =
              shownDb >= -0.05 ? '#FDA4AF' : shownDb >= -6 ? '#FCD34D' : '#CBD5E1';
          }
        }

        if (clipButtonRef.current && prevClipUi !== isClipped) {
          prevClipUi = isClipped;
          if (isClipped) {
            clipButtonRef.current.textContent = '▲ CLIP';
            clipButtonRef.current.style.backgroundColor = '#4C0519';
            clipButtonRef.current.style.borderColor = 'rgba(251, 113, 133, 0.85)';
            clipButtonRef.current.style.color = '#FFE4E6';
            clipButtonRef.current.style.boxShadow = '0 0 12px rgba(244, 63, 94, 0.42)';
          } else {
            clipButtonRef.current.textContent = 'CLIP OK';
            clipButtonRef.current.style.backgroundColor = '#151923';
            clipButtonRef.current.style.borderColor = 'rgba(255, 255, 255, 0.14)';
            clipButtonRef.current.style.color = '#8E97AD';
            clipButtonRef.current.style.boxShadow = 'none';
          }
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
      role="region"
      aria-label="Global Master Output Stereo VU and Clipping Meter"
      className="w-full h-[28px] px-2.5 rounded-xl bg-[#161922]/90 border border-white/14 shadow-[inset_0_1px_3px_rgba(0,0,0,0.65),0_2px_8px_rgba(0,0,0,0.2)] flex items-center gap-2.5 min-w-0"
    >
      {/* Left Instrument Label + L/R Channel Key */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="font-display text-[9.5px] font-semibold tracking-[0.11em] uppercase text-[#AEB6CA] whitespace-nowrap">
          Master Out
        </span>
        <div
          aria-hidden="true"
          className="hidden sm:flex flex-col justify-between h-[15px] font-mono text-[7px] leading-none text-[#6E778C] select-none"
        >
          <span>L</span>
          <span>R</span>
        </div>
      </div>

      {/* Stereo Segmented VU + Peak-Hold Bargraph Canvas */}
      <div
        onClick={handleClearClip}
        title="Stereo Master Output VU & Peak Meter (-60 to +6 dBFS) — Click to reset peak hold & clip latch"
        className="flex-1 min-w-[100px] h-[18px] rounded-[5px] overflow-hidden border border-white/10 bg-[#080A10] cursor-pointer relative"
      >
        <canvas ref={canvasRef} className="w-full h-full block" />
      </div>

      {/* Calibrated Scale Legend on Wide Screens */}
      <div
        aria-hidden="true"
        className="hidden lg:flex items-center gap-1.5 font-mono text-[8.5px] tabular-nums text-[#6F788E] shrink-0"
      >
        <span>-24</span>
        <span>·</span>
        <span>-12</span>
        <span>·</span>
        <span className="text-[#D97706]">-6</span>
        <span>·</span>
        <span className="text-[#FB7185]">0dB</span>
      </div>

      {/* Live Peak dBFS Readout + Interactive Clip Latch Reset */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span
          ref={peakReadoutRef}
          onClick={handleClearClip}
          title="Held Master Peak Level (dBFS) — Click to reset"
          className="font-mono text-[10px] tabular-nums w-[54px] text-right whitespace-nowrap cursor-pointer"
          style={{ color: '#8F98AD' }}
        >
          -∞ dB
        </span>
        <button
          ref={clipButtonRef}
          type="button"
          onClick={handleClearClip}
          title="Master Output Clip Detector — Lights when output hits 0.0 dBFS. Click to clear latch & held peak."
          className="h-[19px] px-2 rounded-md border font-mono text-[9px] font-semibold tracking-[0.06em] uppercase whitespace-nowrap shrink-0 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FB7185]"
          style={{
            backgroundColor: '#151923',
            borderColor: 'rgba(255,255,255,0.14)',
            color: '#8E97AD',
          }}
        >
          CLIP OK
        </button>
      </div>
    </div>
  );
});

export interface PluginTopBarProps {
  brandLabel?: string;
  presetName: string;
  presets?: string[];
  presetItems?: PresetMenuItem[];
  customCategories?: string[];
  activeCategoryFilter?: 'All' | PresetCategory;
  onChangeCategoryFilter?: (category: 'All' | PresetCategory) => void;
  onAddCustomCategory?: (category: string) => string | void;
  onRenameCustomCategory?: (oldCategory: string, nextCategory: string) => string | void;
  onDeleteCustomCategory?: (category: string) => void;
  onSelectPreset?: (name: string) => void;
  onPreviewPreset?: (name: string) => void;
  onStopPreviewPreset?: () => void;
  previewingPresetName?: string | null;
  onSaveUserPreset?: (name: string, category: PresetCategory) => void;
  onChangeUserPresetCategory?: (presetName: string, nextCategory: PresetCategory) => void;
  onDeleteUserPreset?: (name: string) => void;
  onPrevPreset?: () => void;
  onNextPreset?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  undoCount?: number;
  redoCount?: number;
  maxHistory?: number;
  onInit?: () => void;
  onRandomize?: () => void;
  onUploadAction?: () => void;
  onSaveAction?: () => void;
  onMidiLearnAction?: () => void;
  onThemeAction?: () => void;
  onSettingsAction?: () => void;
  uploadTooltip?: string;
  saveTooltip?: string;
  midiLearnActive?: boolean;
  midiMappedCount?: number;
  themeActive?: boolean;
  settingsActive?: boolean;
  className?: string;
}

export function StylizedBrandMark({ text = 'IN THE MIX' }: { text?: string }) {
  if (text === 'IN THE MIX') {
    return (
      <div
        className="flex items-center gap-[0.38em] font-display font-semibold text-[15px] tracking-[0.14em] select-none"
        style={{ color: 'var(--topbar-text)' }}
      >
        <span>IN</span>
        <span className="inline-flex items-center">
          TH
          <span className="inline-flex flex-col justify-between h-[10.5px] w-[9px] ml-[1.5px] py-[0.5px]">
            <span
              className="block h-[1.7px] w-full rounded-full"
              style={{ backgroundColor: 'var(--topbar-text)' }}
            />
            <span
              className="block h-[1.7px] w-full rounded-full"
              style={{ backgroundColor: 'var(--topbar-text)' }}
            />
            <span
              className="block h-[1.7px] w-full rounded-full"
              style={{ backgroundColor: 'var(--topbar-text)' }}
            />
          </span>
        </span>
        <span>MIX</span>
      </div>
    );
  }

  return (
    <div
      className="font-display font-semibold text-[15px] tracking-[0.14em] uppercase select-none whitespace-nowrap"
      style={{ color: 'var(--topbar-text)' }}
    >
      {text}
    </div>
  );
}

export function PluginTopBar({
  brandLabel = 'IN THE MIX',
  presetName,
  presets = [],
  presetItems,
  customCategories = [],
  activeCategoryFilter,
  onChangeCategoryFilter,
  onAddCustomCategory,
  onRenameCustomCategory,
  onDeleteCustomCategory,
  onSelectPreset,
  onPreviewPreset,
  onStopPreviewPreset,
  previewingPresetName = null,
  onSaveUserPreset,
  onChangeUserPresetCategory,
  onDeleteUserPreset,
  onPrevPreset,
  onNextPreset,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  undoCount = 0,
  redoCount = 0,
  maxHistory = 10,
  onInit,
  onRandomize,
  onUploadAction,
  onSaveAction,
  onMidiLearnAction,
  onThemeAction,
  onSettingsAction,
  uploadTooltip = 'Load / Import Preset or Audio',
  saveTooltip = 'Export Current State',
  midiLearnActive = false,
  midiMappedCount = 0,
  themeActive = false,
  settingsActive = false,
  className,
}: PluginTopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [internalCategory, setInternalCategory] = useState<'All' | PresetCategory>('All');
  const [searchQuery, setSearchQuery] = useState('');

  // Save Preset inline state
  const [isSavingUser, setIsSavingUser] = useState(false);
  const [draftPresetName, setDraftPresetName] = useState('');
  const [draftPresetCategory, setDraftPresetCategory] = useState<PresetCategory>('User');
  const [isCreatingCategoryInSave, setIsCreatingCategoryInSave] = useState(false);
  const [draftInlineCategoryName, setDraftInlineCategoryName] = useState('');

  // Create / Rename Custom Category inline state
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCategoryInput, setNewCategoryInput] = useState('');
  const [renamingCategory, setRenamingCategory] = useState<string | null>(null);
  const [renameCategoryInput, setRenameCategoryInput] = useState('');

  const dropdownRef = useRef<HTMLDivElement>(null);
  const saveInputRef = useRef<HTMLInputElement>(null);
  const newCategoryInputRef = useRef<HTMLInputElement>(null);
  const renameCategoryInputRef = useRef<HTMLInputElement>(null);

  const selectedCategory = activeCategoryFilter ?? internalCategory;
  const setSelectedCategory = (next: 'All' | PresetCategory) => {
    if (onChangeCategoryFilter) {
      onChangeCategoryFilter(next);
    } else {
      setInternalCategory(next);
    }
  };

  const prevPresetMidi = useMidiLearnTarget('action.prevPreset', 'Previous Preset');
  const nextPresetMidi = useMidiLearnTarget('action.nextPreset', 'Next Preset');
  const undoMidi = useMidiLearnTarget('action.undo', 'Undo Synth State');
  const redoMidi = useMidiLearnTarget('action.redo', 'Redo Synth State');
  const initMidi = useMidiLearnTarget('action.init', 'Init Patch');
  const randomizeMidi = useMidiLearnTarget('action.randomize', 'Randomize Synth');

  const hasCategorizedItems = Boolean(presetItems && presetItems.length > 0);
  const hasAnyPresets = hasCategorizedItems || presets.length > 0;

  // Merge built-in categories + registered custom categories + any custom categories present on items
  const allCategories = useMemo<PresetCategory[]>(() => {
    const seen = new Set<string>(BUILTIN_PRESET_CATEGORIES);
    const mergedCustom: string[] = [];

    const registerCustom = (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;
      const lower = trimmed.toLowerCase();
      const alreadyExists = Array.from(seen).some((c) => c.toLowerCase() === lower);
      if (!alreadyExists) {
        seen.add(trimmed);
        mergedCustom.push(trimmed);
      }
    };

    customCategories.forEach(registerCustom);
    presetItems?.forEach((item) => {
      if (!isBuiltInPresetCategory(item.category)) {
        registerCustom(item.category);
      }
    });

    return [...BUILTIN_PRESET_CATEGORIES, ...mergedCustom];
  }, [customCategories, presetItems]);

  const customCategorySet = useMemo(() => {
    const set = new Set<string>();
    allCategories.forEach((cat) => {
      if (!isBuiltInPresetCategory(cat)) {
        set.add(cat);
      }
    });
    return set;
  }, [allCategories]);

  // If selectedCategory is a custom category that was removed, fall back cleanly to 'All'
  useEffect(() => {
    if (
      selectedCategory !== 'All' &&
      !allCategories.some((c) => c === selectedCategory)
    ) {
      setSelectedCategory('All');
    }
  }, [allCategories, selectedCategory]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    allCategories.forEach((cat) => counts.set(cat, 0));
    presetItems?.forEach((item) => {
      counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    });
    return counts;
  }, [allCategories, presetItems]);

  const activeItem = useMemo(
    () => presetItems?.find((item) => item.name === presetName),
    [presetItems, presetName]
  );

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const groupedSections = useMemo(() => {
    if (!presetItems || presetItems.length === 0) return [];
    const categoriesToShow =
      selectedCategory === 'All' ? allCategories : [selectedCategory];

    return categoriesToShow
      .map((category) => {
        const items = presetItems.filter((item) => {
          if (item.category !== category) return false;
          if (!normalizedQuery) return true;
          return (
            item.name.toLowerCase().includes(normalizedQuery) ||
            item.category.toLowerCase().includes(normalizedQuery) ||
            (item.subtitle && item.subtitle.toLowerCase().includes(normalizedQuery))
          );
        });
        return {
          category,
          isCustom: customCategorySet.has(category),
          items,
        };
      })
      .filter((group) => {
        if (selectedCategory !== 'All') return true;
        if (normalizedQuery) return group.items.length > 0;
        // In 'All' view without search, show populated categories AND custom user categories so users see their folders
        return group.items.length > 0 || group.isCustom;
      });
  }, [presetItems, selectedCategory, allCategories, normalizedQuery, customCategorySet]);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setIsSavingUser(false);
        setIsAddingCategory(false);
        setRenamingCategory(null);
        onStopPreviewPreset?.();
      }
    };
    if (menuOpen) {
      window.addEventListener('mousedown', handleOutside);
    }
    return () => window.removeEventListener('mousedown', handleOutside);
  }, [menuOpen, onStopPreviewPreset]);

  useEffect(() => {
    if (isSavingUser) {
      saveInputRef.current?.focus();
      saveInputRef.current?.select();
    }
  }, [isSavingUser]);

  useEffect(() => {
    if (isAddingCategory) {
      newCategoryInputRef.current?.focus();
    }
  }, [isAddingCategory]);

  useEffect(() => {
    if (renamingCategory) {
      renameCategoryInputRef.current?.focus();
      renameCategoryInputRef.current?.select();
    }
  }, [renamingCategory]);

  const openSaveDialog = (preferredCategory?: PresetCategory) => {
    const targetCat =
      preferredCategory ??
      (selectedCategory !== 'All' ? selectedCategory : activeItem?.isUser ? activeItem.category : 'User');
    setDraftPresetName(activeItem?.isUser ? presetName : `${presetName} Copy`);
    setDraftPresetCategory(targetCat);
    setIsCreatingCategoryInSave(false);
    setDraftInlineCategoryName('');
    setIsAddingCategory(false);
    setRenamingCategory(null);
    setIsSavingUser(true);
  };

  const handleConfirmSaveUser = () => {
    const trimmedName = draftPresetName.trim();
    if (!trimmedName || !onSaveUserPreset) return;

    let finalCategory: PresetCategory = draftPresetCategory;
    if (isCreatingCategoryInSave) {
      const customTrimmed = draftInlineCategoryName.trim();
      if (!customTrimmed) return;
      const resolved = onAddCustomCategory?.(customTrimmed);
      finalCategory = typeof resolved === 'string' && resolved ? resolved : customTrimmed;
    }

    onSaveUserPreset(trimmedName, finalCategory);
    setDraftPresetName('');
    setDraftInlineCategoryName('');
    setIsCreatingCategoryInSave(false);
    setIsSavingUser(false);
    setSelectedCategory(finalCategory);
  };

  const handleConfirmAddCategory = () => {
    const trimmed = newCategoryInput.trim();
    if (!trimmed) return;
    const resolved = onAddCustomCategory?.(trimmed);
    const targetCat = typeof resolved === 'string' && resolved ? resolved : trimmed;
    setNewCategoryInput('');
    setIsAddingCategory(false);
    setSelectedCategory(targetCat);
  };

  const handleConfirmRenameCategory = () => {
    if (!renamingCategory) return;
    const trimmed = renameCategoryInput.trim();
    if (!trimmed || trimmed === renamingCategory) {
      setRenamingCategory(null);
      return;
    }
    const resolved = onRenameCustomCategory?.(renamingCategory, trimmed);
    const nextCat = typeof resolved === 'string' && resolved ? resolved : trimmed;
    if (selectedCategory === renamingCategory) {
      setSelectedCategory(nextCat);
    }
    setRenamingCategory(null);
    setRenameCategoryInput('');
  };

  return (
    <div
      className={cn(
        'w-full flex flex-col gap-2 px-3 mb-3 select-none relative z-50',
        className
      )}
    >
      {/* Top Real-Time Global Stereo Master VU & Clipping Bridge */}
      <GlobalMasterVuMeter />

      {/* Main Top Bar Controls Row */}
      <div className="w-full flex flex-wrap items-center justify-between gap-2.5">
        {/* Left Brand Mark */}
        <div className="w-auto xl:w-36 flex items-center shrink-0">
          <StylizedBrandMark text={brandLabel} />
        </div>

      {/* Center Preset Pill + Prev/Next Steppers + Undo/Redo History + Init + Randomize */}
      <div className="flex flex-wrap items-center justify-center gap-2" ref={dropdownRef}>
        <div className="relative z-50">
          {/* Pill Bar (kept separate from dropdown so backdrop-blur never traps dropdown stacking context) */}
          <div className="flex items-center justify-between h-[30px] w-[260px] sm:w-[324px] rounded-full border border-white/18 bg-[#22252F]/85 px-1.5 backdrop-blur-sm shadow-[inset_0_1px_2px_rgba(0,0,0,0.45),0_4px_12px_rgba(0,0,0,0.22)]">
            <button
              type="button"
              onClick={onUploadAction}
              title={uploadTooltip}
              aria-label={uploadTooltip}
              className="w-5 h-5 rounded-full border border-white/22 flex items-center justify-center text-[#A7AEBF] hover:text-white hover:border-white/45 transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-blue)]"
            >
              <ArrowUp size={11} strokeWidth={2} />
            </button>

            <button
              type="button"
              onClick={() => {
                if (!hasAnyPresets) return;
                setMenuOpen((wasOpen) => {
                  if (wasOpen) {
                    onStopPreviewPreset?.();
                  }
                  return !wasOpen;
                });
              }}
              aria-expanded={menuOpen}
              aria-haspopup="listbox"
              className="flex-1 px-2 text-center font-sans text-[12px] font-medium tracking-[0.02em] text-[#B3BACB] hover:text-white transition-colors truncate cursor-pointer focus-visible:outline-none flex items-center justify-center gap-1.5 min-w-0"
            >
              {selectedCategory !== 'All' ? (
                <>
                  <span
                    className="text-[10.5px] font-semibold shrink-0"
                    style={{ color: 'var(--accent-cyan-bright)' }}
                    title={`Filtered to category: ${selectedCategory}`}
                  >
                    {selectedCategory}
                  </span>
                  <span aria-hidden="true" className="text-[#5C6477] shrink-0">
                    /
                  </span>
                </>
              ) : (
                activeItem && (
                  <>
                    <span className="text-[10.5px] text-[#7F879A] shrink-0">
                      {activeItem.category}
                    </span>
                    <span aria-hidden="true" className="text-[#5C6477] shrink-0">
                      ·
                    </span>
                  </>
                )
              )}
              <span className="truncate text-[#D7DDEA]">{presetName}</span>
            </button>

            {selectedCategory !== 'All' && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedCategory('All');
                }}
                title={`Clear "${selectedCategory}" category filter`}
                aria-label={`Clear ${selectedCategory} category filter`}
                className="w-4 h-4 mr-1 rounded-full flex items-center justify-center text-[#8B93A7] hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
              >
                <X size={10} strokeWidth={2.2} />
              </button>
            )}

            <button
              type="button"
              onClick={onSaveAction}
              title={saveTooltip}
              aria-label={saveTooltip}
              className="w-5 h-5 rounded-full border border-white/22 flex items-center justify-center text-[#A7AEBF] hover:text-white hover:border-white/45 transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-blue)]"
            >
              <ArrowDown size={11} strokeWidth={2} />
            </button>
          </div>

          {/* Preset Dropdown Menu — floats cleanly above PluginChassis & SynthMasterScreen */}
          {menuOpen && hasCategorizedItems && presetItems && (
            <div
              role="listbox"
              aria-label="Synthesizer presets by category"
              className="absolute left-1/2 -translate-x-1/2 top-[36px] w-[352px] sm:w-[536px] max-w-[calc(100vw-24px)] z-[120] rounded-2xl bg-[#181B23] border border-white/15 shadow-[0_24px_48px_rgba(0,0,0,0.88),0_0_0_1px_rgba(0,0,0,0.9)] overflow-hidden"
            >
              {/* Top Category Filter Bar + Search + Save / New Category Actions */}
              <div className="px-3 pt-3 pb-2.5 border-b border-white/10 bg-[#14171F] flex flex-col gap-2">
                {/* Row 1: Search Input + New Category + Save Patch */}
                <div className="flex items-center justify-between gap-2">
                  <div className="relative flex-1 min-w-0">
                    <Search
                      size={11.5}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#6D7588] pointer-events-none"
                    />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Filter patches by name, style, or category..."
                      aria-label="Search presets"
                      className="w-full h-7 pl-7 pr-6 rounded-md bg-[#0E1016] border border-white/10 text-[11.5px] text-[#E2E8F0] placeholder-[#687083] focus:outline-none focus:border-white/28"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        aria-label="Clear search"
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-[#7D8599] hover:text-white cursor-pointer"
                      >
                        <X size={11} />
                      </button>
                    )}
                  </div>

                  {onAddCustomCategory && !isAddingCategory && !isSavingUser && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsAddingCategory(true);
                        setIsSavingUser(false);
                        setRenamingCategory(null);
                      }}
                      title="Create a custom preset category (e.g. Industrial, Techno, Krach)"
                      className="h-7 px-2.5 rounded-md bg-[#1C202C] hover:bg-[#252B3B] border border-white/12 text-[11px] font-medium text-[#C2CADB] hover:text-white flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <FolderPlus size={11.5} strokeWidth={2} />
                      <span>New Category</span>
                    </button>
                  )}

                  {onSaveUserPreset && !isSavingUser && !isAddingCategory && (
                    <button
                      type="button"
                      onClick={() => openSaveDialog()}
                      className="h-7 px-2.5 rounded-md bg-[#242B3D] hover:bg-[#2E374F] border border-white/14 text-[11px] font-medium text-[#DDE4F2] hover:text-white flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Plus size={11.5} strokeWidth={2.2} />
                      <span>Save Patch</span>
                    </button>
                  )}
                </div>

                {/* Row 2: Built-in + Custom User-Defined Category Filter Strip */}
                <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[#0E1017] border border-white/8 overflow-x-auto">
                  {(['All', ...allCategories] as const).map((cat) => {
                    const isSelected = selectedCategory === cat;
                    const isCustom = cat !== 'All' && customCategorySet.has(cat);
                    const count =
                      cat === 'All'
                        ? presetItems.length
                        : categoryCounts.get(cat) ?? 0;

                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setSelectedCategory(cat)}
                        className={cn(
                          'px-2 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1',
                          isSelected
                            ? 'bg-[#282F42] text-white shadow-sm'
                            : isCustom
                            ? 'text-[#A9B4CC] hover:text-white hover:bg-white/[0.04]'
                            : 'text-[#8B93A7] hover:text-[#D5DCEB] hover:bg-white/[0.03]'
                        )}
                      >
                        <span>{cat}</span>
                        <span
                          className={cn(
                            'font-mono text-[9.5px] tabular-nums',
                            isSelected ? 'text-[#93C5FD]' : 'text-[#5E6679]'
                          )}
                        >
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Inline New Custom Category Form */}
                {onAddCustomCategory && isAddingCategory && (
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <input
                      ref={newCategoryInputRef}
                      type="text"
                      value={newCategoryInput}
                      onChange={(e) => setNewCategoryInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleConfirmAddCategory();
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          setIsAddingCategory(false);
                          setNewCategoryInput('');
                        }
                      }}
                      placeholder="Category name (e.g. Hard Techno, Krach, Acid)..."
                      maxLength={24}
                      className="flex-1 min-w-0 h-7 px-2.5 rounded-md bg-[#0E1016] border border-white/18 text-xs text-white placeholder-[#697184] focus:outline-none focus:border-[var(--accent-cyan-bright)]"
                    />
                    <button
                      type="button"
                      onClick={handleConfirmAddCategory}
                      className="h-7 px-3 rounded-md bg-[#2E3852] hover:bg-[#384566] text-xs font-medium text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      Create
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsAddingCategory(false);
                        setNewCategoryInput('');
                      }}
                      className="h-7 px-2.5 rounded-md bg-[#202430] hover:bg-[#282D3C] text-xs font-medium text-[#9EA6BA] hover:text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* Inline Save Patch + Target Category Selector */}
                {onSaveUserPreset && isSavingUser && (
                  <div className="flex flex-col gap-1.5 pt-0.5">
                    <div className="flex flex-wrap sm:flex-nowrap items-center gap-1.5">
                      <input
                        ref={saveInputRef}
                        type="text"
                        value={draftPresetName}
                        onChange={(e) => setDraftPresetName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleConfirmSaveUser();
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            setIsSavingUser(false);
                          }
                        }}
                        placeholder="Patch name..."
                        maxLength={38}
                        className="flex-1 min-w-[140px] h-7 px-2.5 rounded-md bg-[#0E1016] border border-white/18 text-xs text-white placeholder-[#697184] focus:outline-none focus:border-[var(--accent-blue-bright)]"
                      />

                      <select
                        aria-label="Target preset category"
                        value={
                          isCreatingCategoryInSave ? NEW_CATEGORY_SENTINEL : draftPresetCategory
                        }
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === NEW_CATEGORY_SENTINEL) {
                            setIsCreatingCategoryInSave(true);
                          } else {
                            setIsCreatingCategoryInSave(false);
                            setDraftPresetCategory(val);
                          }
                        }}
                        className="h-7 px-2 rounded-md bg-[#0E1016] border border-white/18 text-[11.5px] text-[#DCE3F2] focus:outline-none focus:border-[var(--accent-blue-bright)] cursor-pointer shrink-0"
                      >
                        {allCategories.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                        {onAddCustomCategory && (
                          <option value={NEW_CATEGORY_SENTINEL}>+ New Category...</option>
                        )}
                      </select>

                      <button
                        type="button"
                        onClick={handleConfirmSaveUser}
                        className="h-7 px-3 rounded-md bg-[#2E3852] hover:bg-[#384566] text-xs font-medium text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsSavingUser(false)}
                        className="h-7 px-2.5 rounded-md bg-[#202430] hover:bg-[#282D3C] text-xs font-medium text-[#9EA6BA] hover:text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
                      >
                        Cancel
                      </button>
                    </div>

                    {isCreatingCategoryInSave && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-[#8B93A7] whitespace-nowrap shrink-0">
                          New Category:
                        </span>
                        <input
                          type="text"
                          value={draftInlineCategoryName}
                          onChange={(e) => setDraftInlineCategoryName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleConfirmSaveUser();
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              setIsCreatingCategoryInSave(false);
                            }
                          }}
                          placeholder="e.g. Industrial, Schranz, Dark Techno..."
                          maxLength={24}
                          autoFocus
                          className="flex-1 min-w-0 h-7 px-2.5 rounded-md bg-[#0E1016] border border-white/18 text-xs text-white placeholder-[#697184] focus:outline-none focus:border-[var(--accent-cyan-bright)]"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Categorized Scrollable Preset List */}
              <div className="max-h-[350px] overflow-y-auto py-1.5 divide-y divide-white/8">
                {groupedSections.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs text-[#7D8598]">
                    No patches match &ldquo;{searchQuery}&rdquo;.
                  </div>
                ) : (
                  groupedSections.map((group) => (
                    <div key={group.category} className="py-1.5 first:pt-0.5 last:pb-0.5">
                      <div className="px-4 py-1 flex items-center justify-between gap-2 text-[11px] text-[#7D8599]">
                        {renamingCategory === group.category ? (
                          <div className="flex items-center gap-1.5 flex-1 min-w-0">
                            <input
                              ref={renameCategoryInputRef}
                              type="text"
                              value={renameCategoryInput}
                              onChange={(e) => setRenameCategoryInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleConfirmRenameCategory();
                                } else if (e.key === 'Escape') {
                                  e.preventDefault();
                                  setRenamingCategory(null);
                                }
                              }}
                              maxLength={24}
                              className="h-6 px-2 rounded bg-[#0E1016] border border-white/20 text-[11px] text-white focus:outline-none focus:border-[var(--accent-cyan-bright)] min-w-0 flex-1 max-w-[180px]"
                            />
                            <button
                              type="button"
                              onClick={handleConfirmRenameCategory}
                              title="Save category name"
                              className="p-1 rounded text-[#93C5FD] hover:bg-white/8 cursor-pointer"
                            >
                              <Check size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setRenamingCategory(null)}
                              title="Cancel rename"
                              className="p-1 rounded text-[#8B93A7] hover:text-white hover:bg-white/8 cursor-pointer"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-semibold text-[#AEB6C9] truncate">
                              {group.category}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="tabular-nums shrink-0">
                              {group.items.length}{' '}
                              {group.items.length === 1 ? 'patch' : 'patches'}
                            </span>
                            {group.isCustom && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-[10.5px] text-[#6E778B] shrink-0">
                                  Custom
                                </span>
                              </>
                            )}
                          </div>
                        )}

                        <div className="flex items-center gap-1 shrink-0">
                          {group.category === 'Classic' && (
                            <span className="text-[10.5px] text-[#6E778B]">
                              Clean &amp; Growl-Ready
                            </span>
                          )}
                          {group.category === 'Kick' && (
                            <span className="text-[10.5px] text-[#6E778B]">
                              Industrial · Uptempo · Krach
                            </span>
                          )}
                          {group.isCustom && renamingCategory !== group.category && (
                            <div className="flex items-center gap-0.5">
                              {onSaveUserPreset && (
                                <button
                                  type="button"
                                  onClick={() => openSaveDialog(group.category)}
                                  title={`Save current patch into ${group.category}`}
                                  className="px-1.5 py-0.5 rounded text-[10.5px] text-[#8E98AE] hover:text-white hover:bg-white/6 transition-colors cursor-pointer whitespace-nowrap"
                                >
                                  + Save Here
                                </button>
                              )}
                              {onRenameCustomCategory && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRenamingCategory(group.category);
                                    setRenameCategoryInput(group.category);
                                  }}
                                  title={`Rename category ${group.category}`}
                                  aria-label={`Rename category ${group.category}`}
                                  className="p-1 rounded text-[#7D8599] hover:text-white hover:bg-white/6 transition-colors cursor-pointer"
                                >
                                  <Pencil size={11} />
                                </button>
                              )}
                              {onDeleteCustomCategory && (
                                <button
                                  type="button"
                                  onClick={() => onDeleteCustomCategory(group.category)}
                                  title={`Delete category ${group.category} (patches move safely to User)`}
                                  aria-label={`Delete category ${group.category}`}
                                  className="p-1 rounded text-[#7D8599] hover:text-[#FDA4AF] hover:bg-white/6 transition-colors cursor-pointer"
                                >
                                  <Trash2 size={11} />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {group.items.length === 0 ? (
                        <div className="px-4 py-2.5 flex items-center justify-between gap-2 text-xs text-[#7D8598]">
                          <span>
                            No patches in {group.category} yet. Save a patch or move any saved
                            patch here.
                          </span>
                          {onSaveUserPreset && (
                            <button
                              type="button"
                              onClick={() => openSaveDialog(group.category)}
                              className="px-2 py-1 rounded bg-[#222736] hover:bg-[#2C3347] text-[11px] font-medium text-[#D0D7E7] hover:text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
                            >
                              Save Current
                            </button>
                          )}
                        </div>
                      ) : (
                        group.items.map((item) => {
                          const isSelected = item.name === presetName;
                          const isPreviewing = previewingPresetName === item.name;
                          return (
                            <div
                              key={`${item.category}-${item.name}`}
                              className={cn(
                                'w-full px-4 py-1.5 transition-colors flex items-center justify-between gap-2',
                                isSelected
                                  ? 'bg-[#262B3A] text-white'
                                  : 'text-[#AEB6C8] hover:bg-[#202431] hover:text-white'
                              )}
                            >
                              <button
                                type="button"
                                role="option"
                                aria-selected={isSelected}
                                onClick={() => {
                                  onSelectPreset?.(item.name);
                                  setMenuOpen(false);
                                  setIsSavingUser(false);
                                }}
                                className="flex-1 min-w-0 text-left py-0.5 cursor-pointer flex items-center gap-2 focus-visible:outline-none"
                              >
                                <span className="text-xs font-medium truncate">{item.name}</span>
                                {item.subtitle && (
                                  <>
                                    <span
                                      aria-hidden="true"
                                      className="text-[#596173] text-xs shrink-0"
                                    >
                                      ·
                                    </span>
                                    <span className="text-[11px] text-[#7C8599] truncate">
                                      {item.subtitle}
                                    </span>
                                  </>
                                )}
                              </button>

                              <div className="flex items-center gap-1.5 shrink-0">
                                {isSelected && (
                                  <span
                                    className="text-[10px] font-mono tabular-nums"
                                    style={{ color: 'var(--accent-blue-bright)' }}
                                  >
                                    Active
                                  </span>
                                )}
                                {onPreviewPreset && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (isPreviewing) {
                                        onStopPreviewPreset?.();
                                      } else {
                                        onPreviewPreset(item.name);
                                      }
                                    }}
                                    aria-pressed={isPreviewing}
                                    aria-label={
                                      isPreviewing
                                        ? `Stop previewing ${item.name}`
                                        : `Preview ${item.name} for 2 seconds`
                                    }
                                    title={
                                      isPreviewing
                                        ? 'Stop 2-second audition'
                                        : 'Audition patch for 2 seconds without loading'
                                    }
                                    className={cn(
                                      'h-[22px] px-2 rounded border flex items-center gap-1 text-[10.5px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-cyan-bright)]',
                                      isPreviewing
                                        ? 'bg-[#13293B] border-[#38BDF8]/75 text-[#E0F2FE]'
                                        : 'bg-[#141822] border-white/12 text-[#9AA3B8] hover:text-white hover:border-white/28 hover:bg-[#1D2332]'
                                    )}
                                  >
                                    {isPreviewing ? (
                                      <>
                                        <Square
                                          size={8.5}
                                          fill="currentColor"
                                          className="text-[#38BDF8]"
                                        />
                                        <span>Stop</span>
                                      </>
                                    ) : (
                                      <>
                                        <Volume2
                                          size={11}
                                          strokeWidth={2}
                                          className="text-[#7DD3FC]"
                                        />
                                        <span>Preview</span>
                                      </>
                                    )}
                                  </button>
                                )}
                                {item.isUser && onChangeUserPresetCategory && (
                                  <select
                                    aria-label={`Category for ${item.name}`}
                                    title="Move patch to another category"
                                    value={item.category}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      onChangeUserPresetCategory(item.name, e.target.value);
                                    }}
                                    className="h-5 px-1.5 rounded bg-[#12151E] border border-white/12 hover:border-white/25 text-[10.5px] text-[#9BA4B8] hover:text-white focus:outline-none cursor-pointer max-w-[110px]"
                                  >
                                    {allCategories.map((cat) => (
                                      <option key={cat} value={cat}>
                                        {cat}
                                      </option>
                                    ))}
                                  </select>
                                )}
                                {item.isUser && onDeleteUserPreset && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onDeleteUserPreset(item.name);
                                    }}
                                    title={`Delete user preset ${item.name}`}
                                    aria-label={`Delete user preset ${item.name}`}
                                    className="p-1 rounded text-[#7D8599] hover:text-[#FDA4AF] hover:bg-white/6 transition-colors cursor-pointer"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Legacy Flat Preset Dropdown Fallback (for simple string[] callers) */}
          {menuOpen && !hasCategorizedItems && presets.length > 0 && (
            <div
              role="listbox"
              className="absolute left-0 right-0 top-[36px] z-[120] rounded-2xl bg-[#191C24] border border-white/15 shadow-[0_24px_48px_rgba(0,0,0,0.88),0_0_0_1px_rgba(0,0,0,0.9)] py-1.5 overflow-hidden"
            >
              {presets.map((p) => {
                const isPreviewing = previewingPresetName === p;
                return (
                  <div
                    key={p}
                    className={cn(
                      'w-full px-4 py-1.5 transition-colors flex items-center justify-between gap-2',
                      p === presetName
                        ? 'bg-[#282D3B] text-white'
                        : 'text-[#A2A9BA] hover:bg-[#222632] hover:text-white'
                    )}
                  >
                    <button
                      type="button"
                      role="option"
                      aria-selected={p === presetName}
                      onClick={() => {
                        onSelectPreset?.(p);
                        setMenuOpen(false);
                      }}
                      className="flex-1 min-w-0 text-left py-0.5 text-xs font-medium truncate cursor-pointer focus-visible:outline-none"
                    >
                      {p}
                    </button>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {p === presetName && (
                        <span
                          className="text-[10px] font-mono shrink-0"
                          style={{ color: 'var(--accent-blue-bright)' }}
                        >
                          Active
                        </span>
                      )}
                      {onPreviewPreset && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isPreviewing) {
                              onStopPreviewPreset?.();
                            } else {
                              onPreviewPreset(p);
                            }
                          }}
                          aria-pressed={isPreviewing}
                          className={cn(
                            'h-[22px] px-2 rounded border flex items-center gap-1 text-[10.5px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0',
                            isPreviewing
                              ? 'bg-[#13293B] border-[#38BDF8]/75 text-[#E0F2FE]'
                              : 'bg-[#141822] border-white/12 text-[#9AA3B8] hover:text-white hover:border-white/28'
                          )}
                        >
                          {isPreviewing ? (
                            <>
                              <Square size={8.5} fill="currentColor" className="text-[#38BDF8]" />
                              <span>Stop</span>
                            </>
                          ) : (
                            <>
                              <Volume2 size={11} strokeWidth={2} className="text-[#7DD3FC]" />
                              <span>Preview</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Prev / Next Circular Buttons */}
        <div className="flex items-center gap-1.5">
          <div className="relative" onContextMenu={prevPresetMidi.handleContextMenu}>
            <MidiLearnOverlayTag
              midiId="action.prevPreset"
              binding={prevPresetMidi.binding}
              isArmed={prevPresetMidi.isArmed}
              midiLearnMode={prevPresetMidi.midiLearnMode}
              onUnbind={prevPresetMidi.unbind}
              compact
            />
            <button
              type="button"
              onClick={(e) => {
                if (prevPresetMidi.interceptLearnEvent(e)) return;
                onPrevPreset?.();
              }}
              aria-label="Previous preset"
              title="Previous Preset"
              className={cn(
                'w-[24px] h-[24px] rounded-full border border-white/20 bg-[#22252F]/75 flex items-center justify-center text-[#A7AEBF] hover:text-white hover:border-white/45 active:scale-95 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-blue)]',
                prevPresetMidi.isArmed && 'ring-2 ring-[#FFB35C]',
                !prevPresetMidi.isArmed && prevPresetMidi.enabled && prevPresetMidi.binding && 'ring-2 ring-[#38BDF8]/85',
                !prevPresetMidi.isArmed && prevPresetMidi.enabled && !prevPresetMidi.binding && 'ring-1 ring-[#38BDF8]/45'
              )}
            >
              <ArrowLeft size={11} strokeWidth={2} />
            </button>
          </div>
          <div className="relative" onContextMenu={nextPresetMidi.handleContextMenu}>
            <MidiLearnOverlayTag
              midiId="action.nextPreset"
              binding={nextPresetMidi.binding}
              isArmed={nextPresetMidi.isArmed}
              midiLearnMode={nextPresetMidi.midiLearnMode}
              onUnbind={nextPresetMidi.unbind}
              compact
            />
            <button
              type="button"
              onClick={(e) => {
                if (nextPresetMidi.interceptLearnEvent(e)) return;
                onNextPreset?.();
              }}
              aria-label="Next preset"
              title="Next Preset"
              className={cn(
                'w-[24px] h-[24px] rounded-full border border-white/20 bg-[#22252F]/75 flex items-center justify-center text-[#A7AEBF] hover:text-white hover:border-white/45 active:scale-95 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-blue)]',
                nextPresetMidi.isArmed && 'ring-2 ring-[#FFB35C]',
                !nextPresetMidi.isArmed && nextPresetMidi.enabled && nextPresetMidi.binding && 'ring-2 ring-[#38BDF8]/85',
                !nextPresetMidi.isArmed && nextPresetMidi.enabled && !nextPresetMidi.binding && 'ring-1 ring-[#38BDF8]/45'
              )}
            >
              <ArrowRight size={11} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* Undo / Redo 10-Step SynthParams History Controls */}
        {(onUndo || onRedo) && (
          <div
            role="group"
            aria-label={`Parameter history (${undoCount} of ${maxHistory} undo steps)`}
            className="inline-flex items-center rounded-full border border-white/18 bg-[#191C26]/90 p-0.5 gap-0.5 shrink-0 shadow-[inset_0_1px_2px_rgba(0,0,0,0.45)]"
          >
            {onUndo && (
              <div className="relative" onContextMenu={undoMidi.handleContextMenu}>
                <MidiLearnOverlayTag
                  midiId="action.undo"
                  binding={undoMidi.binding}
                  isArmed={undoMidi.isArmed}
                  midiLearnMode={undoMidi.midiLearnMode}
                  onUnbind={undoMidi.unbind}
                  compact
                />
                <button
                  type="button"
                  disabled={!canUndo && !undoMidi.midiLearnMode}
                  aria-label={
                    canUndo
                      ? `Undo parameter change (${undoCount} of ${maxHistory} available)`
                      : 'Undo parameter change (nothing to undo)'
                  }
                  title={
                    canUndo
                      ? `Undo SynthParams change (${undoCount}/${maxHistory} in stack · Ctrl+Z)`
                      : `Undo SynthParams change (0/${maxHistory} · Ctrl+Z)`
                  }
                  onClick={(e) => {
                    if (undoMidi.interceptLearnEvent(e)) return;
                    if (!canUndo) return;
                    onUndo();
                  }}
                  className={cn(
                    'h-[24px] px-2.5 rounded-full flex items-center gap-1 font-display text-[10px] font-semibold tracking-[0.08em] uppercase transition-all whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-cyan)]',
                    canUndo || undoMidi.midiLearnMode
                      ? 'bg-[#252938] hover:bg-[#30364A] text-[#D3DAE8] hover:text-white active:scale-95 cursor-pointer'
                      : 'bg-transparent text-[#586074] cursor-not-allowed',
                    undoMidi.isArmed && 'ring-2 ring-[#FFB35C]',
                    !undoMidi.isArmed && undoMidi.enabled && undoMidi.binding && 'ring-2 ring-[#38BDF8]/85',
                    !undoMidi.isArmed && undoMidi.enabled && !undoMidi.binding && 'ring-1 ring-[#38BDF8]/45'
                  )}
                >
                  <Undo2
                    size={11}
                    strokeWidth={2.1}
                    className={canUndo ? 'text-[#7DD3FC]' : 'text-[#525A6E]'}
                  />
                  <span>Undo</span>
                  {undoCount > 0 && (
                    <span className="font-mono text-[9px] tabular-nums text-[#7DD3FC]">
                      {undoCount}
                    </span>
                  )}
                </button>
              </div>
            )}

            {onRedo && (
              <div className="relative" onContextMenu={redoMidi.handleContextMenu}>
                <MidiLearnOverlayTag
                  midiId="action.redo"
                  binding={redoMidi.binding}
                  isArmed={redoMidi.isArmed}
                  midiLearnMode={redoMidi.midiLearnMode}
                  onUnbind={redoMidi.unbind}
                  compact
                />
                <button
                  type="button"
                  disabled={!canRedo && !redoMidi.midiLearnMode}
                  aria-label={
                    canRedo
                      ? `Redo parameter change (${redoCount} available)`
                      : 'Redo parameter change (nothing to redo)'
                  }
                  title={
                    canRedo
                      ? `Redo SynthParams change (${redoCount} available · Ctrl+Shift+Z)`
                      : 'Redo SynthParams change (Ctrl+Shift+Z)'
                  }
                  onClick={(e) => {
                    if (redoMidi.interceptLearnEvent(e)) return;
                    if (!canRedo) return;
                    onRedo();
                  }}
                  className={cn(
                    'h-[24px] px-2.5 rounded-full flex items-center gap-1 font-display text-[10px] font-semibold tracking-[0.08em] uppercase transition-all whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-cyan)]',
                    canRedo || redoMidi.midiLearnMode
                      ? 'bg-[#252938] hover:bg-[#30364A] text-[#D3DAE8] hover:text-white active:scale-95 cursor-pointer'
                      : 'bg-transparent text-[#586074] cursor-not-allowed',
                    redoMidi.isArmed && 'ring-2 ring-[#FFB35C]',
                    !redoMidi.isArmed && redoMidi.enabled && redoMidi.binding && 'ring-2 ring-[#38BDF8]/85',
                    !redoMidi.isArmed && redoMidi.enabled && !redoMidi.binding && 'ring-1 ring-[#38BDF8]/45'
                  )}
                >
                  <Redo2
                    size={11}
                    strokeWidth={2.1}
                    className={canRedo ? 'text-[#7DD3FC]' : 'text-[#525A6E]'}
                  />
                  <span>Redo</span>
                  {redoCount > 0 && (
                    <span className="font-mono text-[9px] tabular-nums text-[#7DD3FC]">
                      {redoCount}
                    </span>
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Init Clean Default Button */}
        {onInit && (
          <div className="relative" onContextMenu={initMidi.handleContextMenu}>
            <MidiLearnOverlayTag
              midiId="action.init"
              binding={initMidi.binding}
              isArmed={initMidi.isArmed}
              midiLearnMode={initMidi.midiLearnMode}
              onUnbind={initMidi.unbind}
              compact
            />
            <button
              type="button"
              onClick={(e) => {
                if (initMidi.interceptLearnEvent(e)) return;
                onInit();
              }}
              title="Initialize synth to flat defaults (OSC only, no sample, no FX)"
              className={cn(
                'h-[28px] px-2.5 rounded-full border border-white/20 bg-[#22252F]/85 hover:bg-[#2E3342] hover:border-white/40 flex items-center gap-1.5 font-display text-[10.5px] font-semibold tracking-[0.1em] uppercase text-[#C4CBD9] hover:text-white active:scale-95 transition-all cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-cyan)]',
                initMidi.isArmed && 'ring-2 ring-[#FFB35C]',
                !initMidi.isArmed && initMidi.enabled && initMidi.binding && 'ring-2 ring-[#38BDF8]/85',
                !initMidi.isArmed && initMidi.enabled && !initMidi.binding && 'ring-1 ring-[#38BDF8]/45'
              )}
            >
              <RotateCcw size={10.5} strokeWidth={2.1} className="text-[#AEB6CA]" />
              <span>Init</span>
            </button>
          </div>
        )}

        {/* Randomize Experimental Inspiration Button */}
        {onRandomize && (
          <div className="relative" onContextMenu={randomizeMidi.handleContextMenu}>
            <MidiLearnOverlayTag
              midiId="action.randomize"
              binding={randomizeMidi.binding}
              isArmed={randomizeMidi.isArmed}
              midiLearnMode={randomizeMidi.midiLearnMode}
              onUnbind={randomizeMidi.unbind}
              compact
            />
            <button
              type="button"
              onClick={(e) => {
                if (randomizeMidi.interceptLearnEvent(e)) return;
                onRandomize();
              }}
              title="Randomize all synth parameters, envelopes, and modulations"
              className={cn(
                'h-[28px] px-3 rounded-full border border-white/20 bg-[#22252F]/85 hover:bg-[#2E3342] hover:border-[var(--accent-cyan-bright)]/55 flex items-center gap-1.5 font-display text-[10.5px] font-semibold tracking-[0.1em] uppercase text-[#C4CBD9] hover:text-white active:scale-95 transition-all cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-cyan)]',
                randomizeMidi.isArmed && 'ring-2 ring-[#FFB35C]',
                !randomizeMidi.isArmed && randomizeMidi.enabled && randomizeMidi.binding && 'ring-2 ring-[#38BDF8]/85',
                !randomizeMidi.isArmed && randomizeMidi.enabled && !randomizeMidi.binding && 'ring-1 ring-[#38BDF8]/45'
              )}
            >
              <Shuffle
                size={11}
                strokeWidth={2.1}
                style={{ color: 'var(--accent-cyan-bright)' }}
              />
              <span>Randomize</span>
            </button>
          </div>
        )}
      </div>

      {/* Right MIDI Learn, Schema, Theme & Audio Calibration Buttons */}
      <div className="w-auto flex items-center justify-end gap-1.5 shrink-0">
        {onMidiLearnAction && (
          <button
            type="button"
            onClick={onMidiLearnAction}
            aria-pressed={midiLearnActive}
            aria-label="Toggle MIDI Learn mode"
            title="MIDI Learn Mode — Click any knob or button to bind incoming hardware MIDI CC"
            className={cn(
              'h-[28px] px-2.5 rounded-full border flex items-center gap-1.5 font-display text-[10px] font-semibold tracking-[0.09em] uppercase transition-all cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#38BDF8]',
              midiLearnActive
                ? 'bg-[#13293B] border-[#38BDF8] text-[#E0F2FE] shadow-[0_0_14px_rgba(56,189,248,0.28)]'
                : 'bg-[#22252F]/80 border-white/18 text-[#B5BDD0] hover:text-white hover:border-white/35'
            )}
          >
            <MidiDinIcon
              size={13}
              className={midiLearnActive ? 'text-[#38BDF8]' : 'text-[#7DD3FC]'}
            />
            <span>MIDI Learn</span>
            {midiMappedCount > 0 && (
              <span className="font-mono text-[9.5px] tabular-nums text-[#7DD3FC]">
                · {midiMappedCount}
              </span>
            )}
          </button>
        )}

        {onThemeAction && (
          <button
            type="button"
            onClick={onThemeAction}
            aria-pressed={themeActive}
            aria-label="Theme colours and shadow settings"
            title="Theme Colours & Shadow Settings"
            className={cn(
              'h-[28px] px-2.5 rounded-full border flex items-center gap-1.5 font-display text-[10px] font-semibold tracking-[0.09em] uppercase transition-all cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-blue)]',
              themeActive
                ? 'bg-[#2B3040] border-white/35 text-white shadow-sm'
                : 'bg-[#22252F]/80 border-white/18 text-[#B5BDD0] hover:text-white hover:border-white/35'
            )}
          >
            <Palette
              size={12}
              strokeWidth={1.9}
              style={{ color: themeActive ? 'var(--accent-amber-bright)' : 'var(--accent-blue-bright)' }}
            />
            <span>Theme</span>
          </button>
        )}

        <button
          type="button"
          onClick={onSettingsAction}
          aria-pressed={settingsActive}
          aria-label="Audio sample and buffer settings"
          title="Audio Sample & Buffer Settings"
          className={cn(
            'w-7 h-7 rounded-full border flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-blue)]',
            settingsActive
              ? 'bg-[#2B3040] border-white/35 text-white'
              : 'bg-[#22252F]/75 border-white/16 text-[#A7AEBF] hover:text-white hover:border-white/35'
          )}
        >
          <Settings size={14} strokeWidth={1.85} />
        </button>
      </div>
      </div>
    </div>
  );
}

export interface PluginChassisProps {
  children: React.ReactNode;
  topBar?: React.ReactNode;
  className?: string;
}

export function PluginChassis({ children, topBar, className }: PluginChassisProps) {
  return (
    <div className="w-full max-w-[1340px] mx-auto flex flex-col min-w-0">
      {topBar}
      <div
        className={cn(
          'dsp-chassis p-4 sm:p-[18px] select-none relative z-10 min-w-0 overflow-x-clip',
          className
        )}
      >
        <div className="relative z-10 flex flex-col min-w-0">{children}</div>
      </div>
    </div>
  );
}
