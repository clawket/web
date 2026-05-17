import { useState, useEffect, useCallback, useRef } from 'react';

export interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  action: () => void;
}

interface CommandPaletteProps {
  commands: CommandItem[];
  open: boolean;
  onClose: () => void;
}

export default function CommandPalette({ commands, open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  // React docs: "Adjusting some state when a prop changes" pattern — store
  // previous prop in state and compare during render. Cheaper than useEffect
  // and avoids cascading renders.
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevQuery, setPrevQuery] = useState(query);
  const [prevOpen, setPrevOpen] = useState(open);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = query.trim()
    ? commands.filter(c =>
        c.label.toLowerCase().includes(query.toLowerCase()) ||
        c.description?.toLowerCase().includes(query.toLowerCase())
      )
    : commands;

  if (query !== prevQuery) {
    setPrevQuery(query);
    setActiveIdx(0);
  }

  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setQuery('');
      setActiveIdx(0);
    }
  }

  // DOM side effect: focus the input shortly after opening so the dialog
  // animation does not steal focus.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  const run = useCallback((cmd: CommandItem) => {
    cmd.action();
    onClose();
  }, [onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[activeIdx]) run(filtered[activeIdx]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  }, [filtered, activeIdx, run, onClose]);

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-overlay z-[8000]"
        onClick={onClose}
      />
      {/* Palette */}
      <div
        className="fixed top-[15%] left-1/2 -translate-x-1/2 z-[8001] w-full max-w-lg bg-surface border border-border rounded-xl shadow-2xl overflow-hidden"
        role="dialog"
        aria-label="Command Palette"
        aria-modal="true"
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <span className="text-muted text-sm">⌘</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search commands…"
            className="flex-1 bg-transparent text-foreground text-sm outline-none placeholder:text-muted"
          />
          <kbd className="text-[10px] text-muted bg-surface-high px-1.5 py-0.5 rounded border border-border">ESC</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-72 overflow-y-auto py-1" role="listbox">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted">No results for "{query}"</div>
          ) : (
            filtered.map((cmd, idx) => (
              <button
                key={cmd.id}
                data-idx={idx}
                role="option"
                aria-selected={idx === activeIdx}
                onClick={() => run(cmd)}
                className={`w-full text-left flex items-center gap-3 px-4 py-2.5 text-sm transition-colors cursor-pointer ${
                  idx === activeIdx ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-surface-hover'
                }`}
              >
                {cmd.icon && <span className="w-5 text-center text-base">{cmd.icon}</span>}
                <span className="flex-1">
                  <span className="font-medium">{cmd.label}</span>
                  {cmd.description && (
                    <span className="ml-2 text-xs text-muted">{cmd.description}</span>
                  )}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </>
  );
}
