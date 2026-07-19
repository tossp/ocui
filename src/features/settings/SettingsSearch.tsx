import { useMemo, useRef, useState } from 'react'
import { CloseIcon, SearchIcon } from '../../components/Icons'
import { filterSettingsSearchItems, type SettingsSearchItem } from './settingsSearchCatalog'

interface SettingsSearchProps {
  items: SettingsSearchItem[]
  placeholder: string
  clearLabel: string
  noResultsLabel: string
  onSelect: (item: SettingsSearchItem) => void
}

export function SettingsSearch({ items, placeholder, clearLabel, noResultsLabel, onSelect }: SettingsSearchProps) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [hasFocus, setHasFocus] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const results = useMemo(() => filterSettingsSearchItems(items, query).slice(0, 10), [items, query])
  const open = hasFocus && query.trim().length > 0
  const listboxId = 'settings-search-results'

  const select = (item: SettingsSearchItem) => {
    setQuery('')
    setActiveIndex(0)
    inputRef.current?.blur()
    onSelect(item)
  }

  return (
    <div
      className="relative z-30"
      onFocusCapture={() => setHasFocus(true)}
      onBlurCapture={event => {
        const nextTarget = event.relatedTarget
        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) setHasFocus(false)
      }}
      onKeyDownCapture={event => {
        if (event.key !== 'Escape' || !open) return
        event.preventDefault()
        event.stopPropagation()
        setQuery('')
        setActiveIndex(0)
        inputRef.current?.focus()
      }}
    >
      <SearchIcon
        size={14}
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-400"
      />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={placeholder}
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open && results.length > 0 ? `settings-search-result-${activeIndex}` : undefined}
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={event => {
          setQuery(event.target.value)
          setActiveIndex(0)
        }}
        onKeyDown={event => {
          if (results.length === 0) return
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            const direction = event.key === 'ArrowDown' ? 1 : -1
            setActiveIndex(index => (index + direction + results.length) % results.length)
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            select(results[Math.min(activeIndex, results.length - 1)])
          }
        }}
        placeholder={placeholder}
        className="h-8 w-full rounded-md border border-border-200 bg-transparent pl-8 pr-8 text-[length:var(--fs-sm)] text-text-100 outline-none placeholder:text-text-400 transition-colors hover:border-border-300 focus-visible:border-accent-main-100 focus-visible:ring-1 focus-visible:ring-accent-main-100/30"
      />
      {query && (
        <button
          type="button"
          onClick={() => {
            setQuery('')
            setActiveIndex(0)
            inputRef.current?.focus()
          }}
          aria-label={clearLabel}
          className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-text-400 hover:bg-bg-200/60 hover:text-text-100"
        >
          <CloseIcon size={12} />
        </button>
      )}

      {open && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+6px)] max-h-72 min-w-[260px] overflow-y-auto rounded-md border border-border-200 bg-bg-000/95 p-1 shadow-xl backdrop-blur-xl custom-scrollbar"
        >
          {results.length === 0 ? (
            <div className="px-2.5 py-3 text-[length:var(--fs-xs)] text-text-400" role="status">
              {noResultsLabel}
            </div>
          ) : (
            results.map((item, index) => (
              <button
                key={item.id}
                id={`settings-search-result-${index}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={event => event.preventDefault()}
                onClick={() => select(item)}
                className={`flex w-full min-w-0 items-center justify-between gap-3 rounded px-2.5 py-2 text-left transition-colors ${
                  index === activeIndex ? 'bg-bg-200/80' : 'hover:bg-bg-200/50'
                }`}
              >
                <span className="min-w-0 truncate text-[length:var(--fs-sm)] text-text-100">{item.label}</span>
                <span className="max-w-[48%] shrink-0 truncate text-[length:var(--fs-xs)] text-text-400" title={item.tabLabel}>
                  {item.tabLabel}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
