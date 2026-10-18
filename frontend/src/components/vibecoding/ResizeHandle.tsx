import React from 'react';

interface ResizeHandleProps {
  type: 'vertical' | 'horizontal';
  onMouseDown: (e: React.MouseEvent) => void;
  onDoubleClick?: () => void;
}

const ResizeHandle: React.FC<ResizeHandleProps> = ({ type, onMouseDown, onDoubleClick }) => {
  const isVertical = type === 'vertical';

  return (
    <div
      className={`${
        isVertical ? 'w-[10px] cursor-col-resize' : 'h-[3px] cursor-row-resize'
      } flex-shrink-0 group relative transition-all duration-200 ease-in-out`}
      style={{ backgroundColor: isVertical ? 'transparent' : 'var(--ide-border)' }}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
    >
      {/* Center grip dots */}
      <div
        className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 ${
          isVertical ? 'w-[3px] h-8' : 'h-[3px] w-8'
        }`}
        style={{ backgroundColor: 'var(--ide-accent)' }}
      >
        {/* Grip dots pattern */}
        <div className={`flex ${isVertical ? 'flex-col' : 'flex-row'} items-center justify-center gap-[2px] h-full w-full`}>
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className="rounded-full"
              style={{
                width: '2px',
                height: '2px',
                backgroundColor: 'var(--ide-accent)',
              }}
            />
          ))}
        </div>
      </div>

      {/* Hover highlight line */}
      <div
        className={`absolute transition-all duration-200 ${
          isVertical
            ? 'left-1/2 -translate-x-1/2 top-0 bottom-0 w-[2px] rounded-full group-hover:w-[3px] opacity-0 group-hover:opacity-100'
            : 'top-0 left-0 right-0 h-[3px] group-hover:h-[3px] opacity-0 group-hover:opacity-100'
        }`}
        style={{ backgroundColor: 'var(--ide-accent)' }}
      />

      {/* Expand hit area for easier grabbing */}
      <div
        className={`absolute ${
          isVertical ? 'inset-y-0 -left-2 -right-2' : 'inset-x-0 -top-2 -bottom-2'
        }`}
      />
    </div>
  );
};

export default ResizeHandle;