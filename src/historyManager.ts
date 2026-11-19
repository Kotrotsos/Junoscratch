import { useState, useRef, useEffect, useCallback } from 'react';
import { EnvelopeData, FxSlotItem, SynthParams } from './types';

export const MAX_SYNTH_HISTORY = 10;

export interface SynthHistorySnapshot {
  params: SynthParams;
  speedEnv: EnvelopeData;
  pitchEnv: EnvelopeData;
  presetLabel: string;
}

export interface SynthHistoryState {
  past: SynthHistorySnapshot[];
  future: SynthHistorySnapshot[];
}

const GESTURE_COALESCE_MS = 380;

export function cloneFxSlot(slot: FxSlotItem): FxSlotItem {
  return { ...slot };
}

export function cloneSynthParams(params: SynthParams): SynthParams {
  return {
    ...params,
    fxChain: params.fxChain ? params.fxChain.map(cloneFxSlot) : [],
  };
}

export function cloneEnvelope(env: EnvelopeData): EnvelopeData {
  return {
    points: env.points.map((pt) => ({ x: pt.x, y: pt.y })),
  };
}

export function cloneHistorySnapshot(snap: SynthHistorySnapshot): SynthHistorySnapshot {
  return {
    params: cloneSynthParams(snap.params),
    speedEnv: cloneEnvelope(snap.speedEnv),
    pitchEnv: cloneEnvelope(snap.pitchEnv),
    presetLabel: snap.presetLabel,
  };
}

function areFxSlotsEqual(a: FxSlotItem, b: FxSlotItem): boolean {
  const keys = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const va = (a as unknown as Record<string, unknown>)[k];
    const vb = (b as unknown as Record<string, unknown>)[k];
    if (!Object.is(va, vb)) return false;
  }
  return true;
}

export function areFxChainsEqual(a?: FxSlotItem[], b?: FxSlotItem[]): boolean {
  const listA = a ?? [];
  const listB = b ?? [];
  if (listA.length !== listB.length) return false;
  for (let i = 0; i < listA.length; i++) {
    if (!areFxSlotsEqual(listA[i], listB[i])) return false;
  }
  return true;
}

/**
 * Determines whether an FX Chain update is a structural/discrete action
 * (hooking in, unhooking, reordering, bypassing, or switching device mode)
 * vs. dragging a continuous knob on an existing FX unit.
 */
export function isFxChainDiscreteChange(prev?: FxSlotItem[], next?: FxSlotItem[]): boolean {
  const listA = prev ?? [];
  const listB = next ?? [];
  if (listA.length !== listB.length) return true;
  for (let i = 0; i < listA.length; i++) {
    const a = listA[i];
    const b = listB[i];
    if (
      a.id !== b.id ||
      a.type !== b.type ||
      a.enabled !== b.enabled ||
      a.satMode !== b.satMode ||
      a.distMode !== b.distMode ||
      a.distTightCut !== b.distTightCut ||
      a.delayMode !== b.delayMode ||
      a.revMode !== b.revMode
    ) {
      return true;
    }
  }
  return false;
}

export function areSynthParamsEqual(a: SynthParams, b: SynthParams): boolean {
  const keys = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (k === 'fxChain') continue;
    const va = (a as unknown as Record<string, unknown>)[k];
    const vb = (b as unknown as Record<string, unknown>)[k];
    if (!Object.is(va, vb)) return false;
  }
  return areFxChainsEqual(a.fxChain, b.fxChain);
}

export function pushHistorySnapshot(
  state: SynthHistoryState,
  snapshot: SynthHistorySnapshot,
  maxEntries: number = MAX_SYNTH_HISTORY
): SynthHistoryState {
  const cloned = cloneHistorySnapshot(snapshot);
  const topPast = state.past.length > 0 ? state.past[state.past.length - 1] : null;

  if (topPast && areSynthParamsEqual(topPast.params, cloned.params)) {
    return state.future.length === 0 ? state : { past: state.past, future: [] };
  }

  const nextPast = [...state.past, cloned].slice(-maxEntries);
  return {
    past: nextPast,
    future: [],
  };
}

export function performUndo(
  state: SynthHistoryState,
  current: SynthHistorySnapshot,
  maxEntries: number = MAX_SYNTH_HISTORY
): { nextState: SynthHistoryState; restored: SynthHistorySnapshot | null } {
  if (state.past.length === 0) {
    return { nextState: state, restored: null };
  }
  const restored = cloneHistorySnapshot(state.past[state.past.length - 1]);
  const nextPast = state.past.slice(0, -1);
  const nextFuture = [...state.future, cloneHistorySnapshot(current)].slice(-maxEntries);

  return {
    nextState: {
      past: nextPast,
      future: nextFuture,
    },
    restored,
  };
}

export function performRedo(
  state: SynthHistoryState,
  current: SynthHistorySnapshot,
  maxEntries: number = MAX_SYNTH_HISTORY
): { nextState: SynthHistoryState; restored: SynthHistorySnapshot | null } {
  if (state.future.length === 0) {
    return { nextState: state, restored: null };
  }
  const restored = cloneHistorySnapshot(state.future[state.future.length - 1]);
  const nextFuture = state.future.slice(0, -1);
  const nextPast = [...state.past, cloneHistorySnapshot(current)].slice(-maxEntries);

  return {
    nextState: {
      past: nextPast,
      future: nextFuture,
    },
    restored,
  };
}

export function useSynthHistoryManager(maxEntries: number = MAX_SYNTH_HISTORY) {
  const [historyState, setHistoryState] = useState<SynthHistoryState>({
    past: [],
    future: [],
  });

  const historyRef = useRef<SynthHistoryState>(historyState);
  const isPointerDownRef = useRef<boolean>(false);
  const activeGestureKeyRef = useRef<string | null>(null);
  const idleTimerRef = useRef<number | null>(null);

  const clearGestureLock = useCallback(() => {
    activeGestureKeyRef.current = null;
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const onPointerDown = () => {
      isPointerDownRef.current = true;
    };
    const onPointerEnd = () => {
      isPointerDownRef.current = false;
      clearGestureLock();
    };

    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointerup', onPointerEnd, { passive: true });
    window.addEventListener('pointercancel', onPointerEnd, { passive: true });
    window.addEventListener('blur', onPointerEnd);

    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerEnd);
      window.removeEventListener('pointercancel', onPointerEnd);
      window.removeEventListener('blur', onPointerEnd);
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
      }
    };
  }, [clearGestureLock]);

  const commitNextHistory = useCallback((next: SynthHistoryState) => {
    historyRef.current = next;
    setHistoryState(next);
  }, []);

  const recordDiscreteChange = useCallback(
    (beforeSnapshot: SynthHistorySnapshot) => {
      clearGestureLock();
      const next = pushHistorySnapshot(historyRef.current, beforeSnapshot, maxEntries);
      if (next !== historyRef.current) {
        commitNextHistory(next);
      }
    },
    [clearGestureLock, commitNextHistory, maxEntries]
  );

  const recordParamGesture = useCallback(
    (gestureKey: string, beforeSnapshot: SynthHistorySnapshot, isDiscreteValue = false) => {
      if (isDiscreteValue) {
        recordDiscreteChange(beforeSnapshot);
        return;
      }

      if (activeGestureKeyRef.current !== gestureKey) {
        const next = pushHistorySnapshot(historyRef.current, beforeSnapshot, maxEntries);
        if (next !== historyRef.current) {
          commitNextHistory(next);
        }
        activeGestureKeyRef.current = gestureKey;
      }

      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }

      if (!isPointerDownRef.current) {
        idleTimerRef.current = window.setTimeout(() => {
          idleTimerRef.current = null;
          activeGestureKeyRef.current = null;
        }, GESTURE_COALESCE_MS);
      }
    },
    [commitNextHistory, maxEntries, recordDiscreteChange]
  );

  const undo = useCallback(
    (currentSnapshot: SynthHistorySnapshot): SynthHistorySnapshot | null => {
      clearGestureLock();
      const { nextState, restored } = performUndo(historyRef.current, currentSnapshot, maxEntries);
      if (restored) {
        commitNextHistory(nextState);
      }
      return restored;
    },
    [clearGestureLock, commitNextHistory, maxEntries]
  );

  const redo = useCallback(
    (currentSnapshot: SynthHistorySnapshot): SynthHistorySnapshot | null => {
      clearGestureLock();
      const { nextState, restored } = performRedo(historyRef.current, currentSnapshot, maxEntries);
      if (restored) {
        commitNextHistory(nextState);
      }
      return restored;
    },
    [clearGestureLock, commitNextHistory, maxEntries]
  );

  return {
    canUndo: historyState.past.length > 0,
    canRedo: historyState.future.length > 0,
    undoCount: historyState.past.length,
    redoCount: historyState.future.length,
    maxHistory: maxEntries,
    recordDiscreteChange,
    recordParamGesture,
    undo,
    redo,
  };
}
