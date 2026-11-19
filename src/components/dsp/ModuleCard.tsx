import React from 'react';
import { DspAccent } from './tokens';
import { MacroRandomizeButton } from './HardwareButtons';
import { cn } from '../../utils';

export interface ModuleCardProps {
  title: string;
  headerActions?: React.ReactNode;
  onRandomize?: () => void;
  randomizeAccent?: DspAccent;
  randomizeLabel?: string;
  randomizeMidiId?: string;
  active?: boolean;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function ModuleCard({
  title,
  headerActions,
  onRandomize,
  randomizeAccent = 'cyan',
  randomizeLabel,
  randomizeMidiId,
  active = true,
  children,
  className,
  bodyClassName,
}: ModuleCardProps) {
  return (
    <div
      className={cn(
        'dsp-module p-4 min-w-0 flex flex-col justify-between relative transition-opacity duration-150',
        className
      )}
    >
      {/* Header Row */}
      <div className="relative z-10 flex items-center justify-between gap-1.5 mb-2.5 min-w-0">
        <h3
          className="font-display font-semibold text-[14.5px] tracking-[0.07em] uppercase transition-colors whitespace-nowrap truncate min-w-0"
          style={{ color: active ? 'var(--hw-title)' : 'var(--hw-title-inactive)' }}
        >
          {title}
        </h3>
        {(onRandomize || headerActions) && (
          <div className="flex items-center gap-1 shrink-0">
            {onRandomize && (
              <MacroRandomizeButton
                onRandomize={onRandomize}
                accent={randomizeAccent}
                label={randomizeLabel || `Macro Randomize ${title}`}
                midiId={randomizeMidiId}
              />
            )}
            {headerActions}
          </div>
        )}
      </div>

      {/* Module Body */}
      <div
        className={cn(
          'relative z-10 flex-1 min-w-0 flex flex-col transition-opacity duration-150',
          !active && 'opacity-45',
          bodyClassName
        )}
      >
        {children}
      </div>
    </div>
  );
}
