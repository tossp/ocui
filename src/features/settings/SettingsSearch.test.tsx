import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SettingsSearch } from './SettingsSearch'
import type { SettingsSearchItem } from './settingsSearchCatalog'

const items: SettingsSearchItem[] = [
  { id: 'appearance:color', tab: 'appearance', label: 'Color Mode', tabLabel: 'Appearance', targetLabel: 'Color Mode' },
  { id: 'workspace:wide', tab: 'workspace', label: 'Wide Mode', tabLabel: 'Workspace', targetLabel: 'Wide Mode' },
]

describe('SettingsSearch', () => {
  it('selects results with the keyboard', () => {
    const onSelect = vi.fn()
    render(
      <SettingsSearch
        items={items}
        placeholder="Search settings"
        clearLabel="Clear settings search"
        noResultsLabel="No matching settings"
        onSelect={onSelect}
      />,
    )

    const input = screen.getByRole('combobox', { name: 'Search settings' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'mode' } })
    expect(screen.getAllByRole('option')).toHaveLength(2)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onSelect).toHaveBeenCalledWith(items[1])
    expect(input).toHaveValue('')
  })

  it('shows an empty result and clears the query', () => {
    render(
      <SettingsSearch
        items={items}
        placeholder="Search settings"
        clearLabel="Clear settings search"
        noResultsLabel="No matching settings"
        onSelect={vi.fn()}
      />,
    )

    const input = screen.getByRole('combobox', { name: 'Search settings' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'missing' } })
    expect(screen.getByRole('status')).toHaveTextContent('No matching settings')
    fireEvent.click(screen.getByRole('button', { name: 'Clear settings search' }))
    expect(input).toHaveValue('')
  })

  it('clears with Escape without bubbling to the dialog', () => {
    const onKeyDown = vi.fn()
    render(
      <div onKeyDown={onKeyDown}>
        <SettingsSearch
          items={items}
          placeholder="Search settings"
          clearLabel="Clear settings search"
          noResultsLabel="No matching settings"
          onSelect={vi.fn()}
        />
      </div>,
    )

    const input = screen.getByRole('combobox', { name: 'Search settings' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'mode' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input).toHaveValue('')
    expect(onKeyDown).not.toHaveBeenCalled()

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onKeyDown).toHaveBeenCalledTimes(1)
  })

  it('closes results when focus leaves the search', () => {
    render(
      <SettingsSearch
        items={items}
        placeholder="Search settings"
        clearLabel="Clear settings search"
        noResultsLabel="No matching settings"
        onSelect={vi.fn()}
      />,
    )

    const input = screen.getByRole('combobox', { name: 'Search settings' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'mode' } })
    expect(screen.getAllByRole('option')).toHaveLength(2)
    fireEvent.blur(input, { relatedTarget: document.body })
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    expect(input).toHaveValue('mode')
  })
})
