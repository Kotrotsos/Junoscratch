import React, { useRef, useEffect, useState, MouseEvent } from 'react';
import { Point } from '../types';

export interface GraphEditorProps {
  label: string;
  points: Point[];
  onChange: (points: Point[]) => void;
  color?: string;
  minLabel?: string;
  maxLabel?: string;
  waveform?: Float32Array | null;
  playhead?: number;
}

export function GraphEditor({
  label,
  points,
  onChange,
  color = "#D92E1E", // Juno Red by default
  minLabel = "MIN",
  maxLabel = "MAX",
  waveform,
  playhead
}: GraphEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);

  // Sort point strictly by X before rendering
  const sortedPoints = [...points].sort((a, b) => a.x - b.x);

  const getCoordinates = (e: MouseEvent | React.TouchEvent | globalThis.MouseEvent): { x: number, y: number } | null => {
    if (!containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    
    let clientX, clientY;
    
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }

    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height)); // invert Y so 1 is up
    
    return { x, y };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const coords = getCoordinates(e);
    if (!coords) return;

    // Check if clicking near an existing point
    let clickedIdx = -1;
    let minDist = 0.05; // Hit box tolerance

    sortedPoints.forEach((p, idx) => {
      const dist = Math.sqrt(Math.pow(p.x - coords.x, 2) + Math.pow(p.y - coords.y, 2));
      if (dist < minDist) {
        minDist = dist;
        clickedIdx = idx;
      }
    });

    if (clickedIdx !== -1) {
       // Drag existing
       setDraggingIdx(clickedIdx);
    } else {
      // Add new point
      const newPoints = [...sortedPoints, coords].sort((a, b) => a.x - b.x);
      onChange(newPoints);
      // Automatically set the new point as dragging
      const newIdx = newPoints.findIndex(p => p.x === coords.x && p.y === coords.y);
      setDraggingIdx(newIdx);
    }
  };

  useEffect(() => {
    const handleGlobalPointerMove = (e: globalThis.MouseEvent) => {
      if (draggingIdx === null) return;
      const coords = getCoordinates(e);
      if (!coords) return;

      const newPoints = [...sortedPoints];
      
      // Keep endpoints constrained to edges if they are the first or last?
      // For general graphs, let's allow free movement but strictly sort after.
      newPoints[draggingIdx] = coords;
      
      // Re-sort and find the new index of our dragged point so we don't lose grip
      // Actually, if we re-sort, the index changes. To simplify, we enforce X bounds based on neighbors.
      const prevX = draggingIdx > 0 ? newPoints[draggingIdx - 1].x + 0.01 : 0;
      const nextX = draggingIdx < newPoints.length - 1 ? newPoints[draggingIdx + 1].x - 0.01 : 1;
      
      newPoints[draggingIdx].x = Math.max(prevX, Math.min(nextX, coords.x));

      onChange(newPoints);
    };

    const handleGlobalPointerUp = () => {
      if (draggingIdx !== null) {
        setDraggingIdx(null);
      }
    };

    if (draggingIdx !== null) {
      window.addEventListener('pointermove', handleGlobalPointerMove);
      window.addEventListener('pointerup', handleGlobalPointerUp);
    }

    return () => {
      window.removeEventListener('pointermove', handleGlobalPointerMove);
      window.removeEventListener('pointerup', handleGlobalPointerUp);
    };
  }, [draggingIdx, sortedPoints, onChange]);

  // Context menu to delete point
  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const coords = getCoordinates(e);
    if (!coords) return;

    let clickedIdx = -1;
    let minDist = 0.05;

    sortedPoints.forEach((p, idx) => {
      const dist = Math.sqrt(Math.pow(p.x - coords.x, 2) + Math.pow(p.y - coords.y, 2));
      if (dist < minDist) {
        minDist = dist;
        clickedIdx = idx;
      }
    });

    if (clickedIdx !== -1 && sortedPoints.length > 2) {
       // Only allow deleting if there are more than 2 points
       const newPoints = sortedPoints.filter((_, idx) => idx !== clickedIdx);
       onChange(newPoints);
    }
  };

  return (
    <div className="flex flex-col gap-2 w-full font-mono text-xs text-white select-none">
      <div className="flex justify-between uppercase tracking-wider text-neutral-400">
        <span>{label}</span>
        <span>[R-CLICK TO DEL]</span>
      </div>
      <div className="flex relative bg-neutral-900 border-2 border-neutral-800 rounded shadow-inner" style={{ height: '200px' }}>
        
        {/* Y Axis Labels */}
        <div className="absolute left-2 top-2 text-[10px] text-neutral-600 opacity-50 select-none z-0">{maxLabel}</div>
        <div className="absolute left-2 bottom-2 text-[10px] text-neutral-600 opacity-50 select-none z-0">{minLabel}</div>
        
        {/* Grid lines */}
        <div className="absolute inset-0 z-0 pointer-events-none opacity-20"
             style={{
               backgroundImage: `linear-gradient(to right, #444 1px, transparent 1px), linear-gradient(to bottom, #444 1px, transparent 1px)`,
               backgroundSize: '20px 20px',
               backgroundPosition: 'center center'
             }}
        />

        {/* Interactive Layer */}
        <div 
          ref={containerRef}
          className="w-full h-full relative cursor-crosshair z-10 touch-none overflow-hidden"
          onPointerDown={handlePointerDown}
          onContextMenu={handleContextMenu}
        >
          {/* Waveform */}
          {waveform && (
            <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-20" viewBox="0 0 100 100" preserveAspectRatio="none">
               <path 
                  d={`M ${Array.from(waveform).map((val, i) => `${(i / (waveform.length - 1)) * 100} ${50 - val * 45}`).join(' L ')} L 100 50 L ${Array.from(waveform).map((val, i) => `${((waveform.length - 1 - i) / (waveform.length - 1)) * 100} ${50 + val * 45}`).join(' L ')} Z`} 
                  fill="#ffffff"
               />
            </svg>
          )}

          {/* SVG Line */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
             <path 
                d={`M ${sortedPoints.map(p => `${p.x * 100} ${(1 - p.y) * 100}`).join(' L ')}`} 
                fill="none" 
                stroke={color} 
                strokeWidth="2.5" 
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                className="opacity-70"
             />
             <path 
                d={`M ${sortedPoints[0].x * 100} 100 L ${sortedPoints.map(p => `${p.x * 100} ${(1 - p.y) * 100}`).join(' L ')} L ${sortedPoints[sortedPoints.length - 1].x * 100} 100 Z`} 
                fill={color}
                className="opacity-10"
             />
          </svg>

          {/* Playhead */}
          {playhead !== undefined && playhead >= 0 && (
            <div 
               className="absolute top-0 bottom-0 w-[2px] bg-white z-0 shadow-[0_0_10px_rgba(255,255,255,1)] pointer-events-none mix-blend-screen opacity-80" 
               style={{ left: `${playhead * 100}%` }} 
            />
          )}

          {/* Points */}
          {sortedPoints.map((p, i) => (
            <div 
              key={i}
              className="absolute w-4 h-4 rounded-full -ml-2 -mt-2 bg-neutral-200 shadow-md transform-gpu hover:scale-150 transition-transform flex items-center justify-center cursor-pointer pointer-events-none"
              style={{ left: `${p.x * 100}%`, top: `${(1 - p.y) * 100}%`, border: `2px solid ${color}` }}
            >
              <div className="w-1 h-1 bg-black rounded-full opacity-50" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
