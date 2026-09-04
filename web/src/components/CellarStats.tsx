import { useState } from 'react'
import type { AppSettings, WineEntry } from '@shared/types'

interface Props {
  /** Already filtered to the Cellar tab (tag_cellar = true) by the caller. */
  wines: WineEntry[]
  settings: AppSettings
  onCapacityChange: (cellar_capacity: number | null) => Promise<void>
}

const COLOR_LABELS: Record<'red' | 'white' | 'rosé' | 'unknown', string> = {
  red: 'Red',
  white: 'White',
  rosé: 'Rosé',
  unknown: 'Unknown',
}

/**
 * Phase 10.5 — Cellar tab stat tile + region allocation bars. Neither existed
 * in the shipped app before this (only the design-canvas mockup had them) —
 * see docs/specs/2026-09-03-phase-10-v2-backend-gap-analysis.md §2.2/2.3.
 * Grouped by `region`, not `appellation` — appellation is a dead schema
 * column nothing populates; region is NOT NULL and always real.
 */
export function CellarStats({ wines, settings, onCapacityChange }: Props) {
  const [editingCapacity, setEditingCapacity] = useState(false)
  const [capacityInput, setCapacityInput] = useState(String(settings.cellar_capacity ?? ''))
  const [saving, setSaving] = useState(false)

  const totalBottles = wines.reduce((sum, w) => sum + w.cellar_quantity, 0)
  const capacity = settings.cellar_capacity
  const percentUsed = capacity && capacity > 0 ? Math.round((totalBottles / capacity) * 100) : null

  async function saveCapacity() {
    const parsed = capacityInput.trim() === '' ? null : Number(capacityInput)
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) return
    setSaving(true)
    try {
      await onCapacityChange(parsed)
      setEditingCapacity(false)
    } finally {
      setSaving(false)
    }
  }

  const byRegion = new Map<string, Record<'red' | 'white' | 'rosé' | 'unknown', number>>()
  for (const w of wines) {
    const region = w.region ?? 'Unspecified'
    const color = w.wine_color ?? 'unknown'
    if (!byRegion.has(region)) byRegion.set(region, { red: 0, white: 0, rosé: 0, unknown: 0 })
    byRegion.get(region)![color] += w.cellar_quantity
  }
  const regionRows = [...byRegion.entries()]
    .map(([region, counts]) => ({ region, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) }))
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total)

  if (wines.length === 0) return null

  return (
    <div className="cellar-stats">
      <div className="cellar-stat-tile">
        <div className="cellar-stat-tile-main">
          <span className="cellar-stat-value">{totalBottles}</span>
          <span className="cellar-stat-label">bottles in cellar</span>
        </div>
        {editingCapacity ? (
          <div className="cellar-capacity-edit">
            <input
              type="number"
              min={0}
              className="cellar-capacity-input"
              value={capacityInput}
              onChange={(e) => setCapacityInput(e.target.value)}
              placeholder="Total slots"
              aria-label="Cellar capacity"
            />
            <button className="btn-text" onClick={saveCapacity} disabled={saving}>Save</button>
            <button
              className="btn-text"
              onClick={() => { setEditingCapacity(false); setCapacityInput(String(settings.cellar_capacity ?? '')) }}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
        ) : percentUsed !== null ? (
          <button className="btn-link-inline cellar-capacity-display" onClick={() => setEditingCapacity(true)}>
            Capacity used: {percentUsed}%
          </button>
        ) : (
          <button className="btn-link-inline cellar-capacity-display" onClick={() => setEditingCapacity(true)}>
            Set cellar capacity
          </button>
        )}
      </div>

      {regionRows.length > 0 && (
        <div className="cellar-allocation">
          <h3 className="cellar-allocation-title">By region</h3>
          {regionRows.map(({ region, counts, total }) => (
            <div key={region} className="cellar-allocation-row">
              <span className="cellar-allocation-region">{region}</span>
              <div className="cellar-allocation-bar" role="img" aria-label={`${region}: ${total} bottles`}>
                {(['red', 'white', 'rosé', 'unknown'] as const).map((color) =>
                  counts[color] > 0 ? (
                    <span
                      key={color}
                      className={`cellar-allocation-segment cellar-allocation-segment--${color}`}
                      style={{ width: `${(counts[color] / total) * 100}%` }}
                      title={`${COLOR_LABELS[color]}: ${counts[color]}`}
                    />
                  ) : null
                )}
              </div>
              <span className="cellar-allocation-count">{total}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
