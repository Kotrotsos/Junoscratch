import React, { useRef, useState, useEffect } from 'react';
import { cn } from '../utils';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (val: number) => void;
  colorStrip?: string; // Optional colored bottom strip indicator
  formatValue?: (val: number) => string;
}

export function JunoSlider({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  colorStrip = "#D92E1E",
  formatValue = (v) => v.toFixed(2)
}: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const getValFromEvent = (e: MouseEvent | TouchEvent | React.MouseEvent | React.TouchEvent) => {
    if (!trackRef.current) return value;
    const rect = trackRef.current.getBoundingClientRect();
    
    let clientY;
    if ('touches' in e && e.touches.length > 0) {
      clientY = e.touches[0].clientY;
    } else {
      clientY = (e as MouseEvent).clientY;
    }

    // Invert Y: bottom is 0, top is height
    let normalValue = 1 - (clientY - rect.top) / rect.height;
    normalValue = Math.max(0, Math.min(1, normalValue));

    const rawVal = min + normalValue * (max - min);
    // Snap to step
    const steppedVal = Math.round(rawVal / step) * step;
    return Math.max(min, Math.min(max, steppedVal));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
    onChange(getValFromEvent(e));
  };

  useEffect(() => {
    const handleGlobalPointerMove = (e: globalThis.MouseEvent | globalThis.TouchEvent) => {
      if (!isDragging) return;
      e.preventDefault();
      onChange(getValFromEvent(e));
    };

    const handleGlobalPointerUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleGlobalPointerMove, { passive: false });
      window.addEventListener('mouseup', handleGlobalPointerUp);
      window.addEventListener('touchmove', handleGlobalPointerMove, { passive: false });
      window.addEventListener('touchend', handleGlobalPointerUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleGlobalPointerMove);
      window.removeEventListener('mouseup', handleGlobalPointerUp);
      window.removeEventListener('touchmove', handleGlobalPointerMove);
      window.removeEventListener('touchend', handleGlobalPointerUp);
    };
  }, [isDragging, min, max, step, onChange]);

  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className="flex flex-col items-center select-none w-14">
      {/* Label */}
      <span className="text-[10px] font-mono text-neutral-400 mb-2 h-6 flex items-end text-center uppercase leading-tight tracking-tighter">
        {label}
      </span>
      
      {/* Slider Container */}
      <div className="relative h-48 w-10 flex justify-center py-2 bg-[#2a2a2a] rounded-sm shadow-inner group">
        {/* Track Slot */}
        <div 
          ref={trackRef}
          className="absolute top-2 bottom-2 w-2 rounded-full cursor-pointer z-0 touch-none shadow-[inset_0px_1px_5px_rgba(0,0,0,0.8)] border border-[#111]"
          style={{ background: 'linear-gradient(90deg, #181818 0%, #111 80%, #050505 100%)' }}
          onPointerDown={handlePointerDown}
        />
        
        {/* Value Track Highlights */}
        <div className="absolute top-2 bottom-2 w-2 rounded-full pointer-events-none opacity-40 mix-blend-screen"
             style={{
                 bottom: '8px', 
                 height: `calc(${percentage}% - 4px)`, 
                 marginBottom: 0,
                 background: `linear-gradient(0deg, ${colorStrip} 0%, transparent 100%)`
             }} 
        />
        
        {/* Thumb */}
        <div 
          className={cn(
            "absolute w-8 h-10 -ml-4 bg-[#111] rounded shadow-lg border-2 border-[#333] z-10 cursor-grab transform-gpu touch-none pointer-events-none flex flex-col items-center justify-between py-[2px] transition-transform duration-75",
            isDragging && "scale-[1.02] border-[#555] cursor-grabbing shadow-xl"
          )}
          style={{ 
            bottom: `calc(${percentage}% - 20px + 8px)`, 
            left: '50%'
          }}
        >
            <div className="w-full h-[1px] bg-white opacity-40 mt-1" />
            <div className="w-full h-1 bg-white shadow-[0_0_8px_rgba(255,255,255,0.4)]" />
            <div className="w-full h-[1px] bg-white opacity-40 mb-1" />
        </div>
      </div>
      
      {/* Color Strip Indicator */}
      <div 
        className="w-full h-1.5 mt-2 rounded shadow-sm opacity-90"
        style={{ backgroundColor: colorStrip }}
      />
      
      {/* Value Display */}
      <div className="mt-1 font-mono text-[9px] text-neutral-500 bg-neutral-900 px-1 py-0.5 rounded text-center w-full min-h-[16px]">
        {formatValue(value)}
      </div>
    </div>
  );
}
