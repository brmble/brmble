import { useState, useRef, useEffect, useCallback, useId, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import './Select.css';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}

export function Select({ value, onChange, options, disabled, className, placeholder }: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>({});

  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const highlightedIndexRef = useRef(highlightedIndex);
  highlightedIndexRef.current = highlightedIndex;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const listboxId = useId();
  const triggerId = useId();

  const selectedOption = options.find(o => o.value === value);
  const displayLabel = selectedOption?.label ?? placeholder ?? '';
  const isPlaceholder = !selectedOption && !!placeholder;

  const updatePosition = useCallback(() => {
    if (!triggerRef.current || !dropdownRef.current) return;
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const dropdownRect = dropdownRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - triggerRect.bottom - 8;
    const fitsBelow = spaceBelow >= Math.min(dropdownRect.height, 240);

    setDropdownStyle({
      left: triggerRect.left,
      width: triggerRect.width,
      ...(fitsBelow
        ? { top: triggerRect.bottom + 4 }
        : { top: triggerRect.top - dropdownRect.height - 4 }),
    });
  }, []);

  const open = useCallback(() => {
    if (disabled || options.length === 0) return;
    setIsOpen(true);
    const idx = options.findIndex(o => o.value === value);
    setHighlightedIndex(idx >= 0 ? idx : 0);
  }, [disabled, options, value]);

  const close = useCallback(() => {
    setIsOpen(false);
    setHighlightedIndex(-1);
    triggerRef.current?.focus();
  }, []);

  const selectOption = useCallback((optionValue: string) => {
    onChange(optionValue);
    close();
  }, [onChange, close]);

  useEffect(() => {
    if (!isOpen) return;
    requestAnimationFrame(updatePosition);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, updatePosition]);

  useEffect(() => {
    if (isOpen && highlightedIndex >= 0) {
      optionRefs.current[highlightedIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [isOpen, highlightedIndex]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        close();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, close]);

  useEffect(() => {
    optionRefs.current.length = options.length;
  }, [options.length]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const opts = optionsRef.current;
      if (opts.length === 0) {
        if (e.key === 'Escape') { e.preventDefault(); close(); }
        return;
      }
      const hi = highlightedIndexRef.current;
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          close();
          break;
        case 'Tab':
          close();
          break;
        case 'ArrowDown':
          e.preventDefault();
          setHighlightedIndex(i => (i + 1) % opts.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setHighlightedIndex(i => (i - 1 + opts.length) % opts.length);
          break;
        case 'Home':
          e.preventDefault();
          setHighlightedIndex(0);
          break;
        case 'End':
          e.preventDefault();
          setHighlightedIndex(opts.length - 1);
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (hi >= 0 && hi < opts.length) {
            selectOption(opts[hi].value);
          }
          break;
        default:
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
            const char = e.key.toLowerCase();
            const idx = opts.findIndex(o => o.label.toLowerCase().startsWith(char));
            if (idx >= 0) setHighlightedIndex(idx);
          }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, close, selectOption]);

  const handleTriggerKeyDown = (e: ReactKeyboardEvent) => {
    if (!isOpen && (e.key === 'ArrowDown' || e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      open();
    }
  };

  const activeDescendant = isOpen && highlightedIndex >= 0
    ? `${listboxId}-option-${highlightedIndex}`
    : undefined;

  return (
    <div className={`brmble-select${isOpen ? ' brmble-select--open' : ''}${className ? ` ${className}` : ''}`}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-activedescendant={activeDescendant}
        className={`brmble-select-trigger${isOpen ? ' brmble-select-trigger--open' : ''}`}
        disabled={disabled}
        onClick={() => isOpen ? close() : open()}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className={isPlaceholder ? 'brmble-select-placeholder' : undefined}>
          {displayLabel}
        </span>
      </button>

      {isOpen && createPortal(
        <div
          ref={dropdownRef}
          id={listboxId}
          role="listbox"
          aria-labelledby={triggerId}
          className="brmble-select-dropdown"
          style={dropdownStyle}
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isHighlighted = index === highlightedIndex;
            let cls = 'brmble-select-option';
            if (isSelected) cls += ' brmble-select-option--selected';
            if (isHighlighted) cls += ' brmble-select-option--highlighted';
            return (
              <button
                key={option.value}
                ref={el => { optionRefs.current[index] = el; }}
                id={`${listboxId}-option-${index}`}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={cls}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => selectOption(option.value)}
              >
                {option.label}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}
