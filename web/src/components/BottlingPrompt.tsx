import { useState } from 'react'
import type { BottlingChoice, BottlingOption, WineEntry } from '@shared/types'
import { SEPARATE_CUVEE_WORDS } from '@shared/utils/bottling-difference'
import { chooseBottling } from '../api'
import { tierResultLine } from '../utils/tierCopy'
import { Sheet } from './Sheet'

interface Props {
  wine: WineEntry
  onWineUpdated: (wine: WineEntry) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}

const fmt = (n: number) => `$${n.toFixed(0)}`

/** A name made only of "Vieilles Vignes"-type words is a cuvée; anything else is read as a vineyard. */
function kindOf(option: BottlingOption): 'vineyard' | 'cuvee' {
  return option.words.every((w) => SEPARATE_CUVEE_WORDS.has(w)) ? 'cuvee' : 'vineyard'
}

/**
 * "Listings name different bottlings — which is yours?" (Phase 12.2 WI-2.5): a
 * non-blocking banner on the detail card, opening a sheet. Answering re-scores
 * every stored listing and review page on the server with no network call and
 * returns the wine; the result line says what changed. Dismissing ("Not sure")
 * does not ask again until a refresh brings a modifier that was not here.
 *
 * Once answered — Plain, or a vineyard / cuvée the wine now records — the
 * banner gives way to a quiet "Bottling: Les Rugiens · Change" row (Phase 12.4
 * WI-4, the backend's `bottling_answer`); Change reopens the same sheet.
 */
export function BottlingBanner({ wine, onWineUpdated, open, onOpenChange }: Props) {
  const prompt = wine.bottling_prompt
  const answer = prompt ? null : wine.bottling_answer
  const [result, setResult] = useState<string | null>(null)

  if (!prompt && !answer && !result) return null
  return (
    <>
      {prompt && (
        <div className="bottling-banner" role="note" data-testid="bottling-banner">
          <span>
            Listings name different bottlings — which is yours?
            {!wine.vineyard && !wine.cuvee && ' The label may name a vineyard or special bottling — check the bottle.'}
          </span>{' '}
          <button type="button" className="btn-link-inline" onClick={() => onOpenChange(true)}>
            Choose
          </button>
        </div>
      )}
      {answer && (
        <p className="bottling-answer" data-testid="bottling-answer">
          Bottling: {answer.label} ·{' '}
          <button type="button" className="btn-link-inline" onClick={() => onOpenChange(true)}>
            Change
          </button>
        </p>
      )}
      {result && <p className="bottling-result" role="status">{result}</p>}
      {open && (prompt || answer) && (
        <BottlingSheet
          wine={wine}
          options={prompt?.options ?? answer?.options ?? []}
          onClose={() => onOpenChange(false)}
          onDone={(updated, line) => {
            onWineUpdated(updated)
            setResult(line)
            onOpenChange(false)
          }}
        />
      )}
    </>
  )
}

function BottlingSheet({
  wine,
  options,
  onClose,
  onDone,
}: {
  wine: WineEntry
  options: BottlingOption[]
  onClose: () => void
  onDone: (wine: WineEntry, line: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  const [typedKind, setTypedKind] = useState<'vineyard' | 'cuvee'>('vineyard')

  async function answer(choice: BottlingChoice) {
    setBusy(true)
    setError(null)
    try {
      const { wine: updated, result } = await chooseBottling(wine.id, choice)
      const line =
        choice.choice === 'not_sure'
          ? 'Left as it was. We’ll ask again only if a refresh brings other bottlings.'
          : tierResultLine(result.tier, result.scores, result.trusted_scores)
      const dup = result.duplicate && result.duplicate.kind !== 'none' ? ' This may match another wine in your cellar.' : ''
      onDone(updated, line + dup)
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^"|"$/g, '') : 'Could not save your answer')
      setBusy(false)
    }
  }

  return (
    <Sheet title="Which bottling is yours?" onClose={onClose}>
      <p className="sheet-lede">
        {wine.producer} {wine.denomination}
        {wine.vintage ? ` ${wine.vintage}` : ''}: the results name more than one bottling. Your answer re-scores what we
        already found. Nothing is searched again.
      </p>
      <ul className="bottling-options">
        {options.map((o) => (
          <li key={o.name} className="bottling-option">
            <div className="bottling-option-head">
              <strong>{o.name}</strong>
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => answer({ choice: kindOf(o), name: o.name })}>
                This one
              </button>
            </div>
            <div className="bottling-evidence">
              {o.retailers.length > 0 && <span>{o.retailers.join(', ')}</span>}
              {o.price_range && (
                <span>
                  {o.price_range.min === o.price_range.max ? fmt(o.price_range.min) : `${fmt(o.price_range.min)}–${fmt(o.price_range.max)}`}
                </span>
              )}
              {o.critics.length > 0 && <span>{o.critics.join(', ')}</span>}
            </div>
            <div className="bottling-links">
              {o.links.map((l) => (
                <a key={l.url} className="link" href={l.url} target="_blank" rel="noreferrer">
                  {l.name}
                </a>
              ))}
            </div>
          </li>
        ))}
        <li className="bottling-option">
          <div className="bottling-option-head">
            <strong>Plain / no special bottling</strong>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => answer({ choice: 'plain' })}>
              This one
            </button>
          </div>
        </li>
        <li className="bottling-option">
          <strong>Something else</strong>
          <div className="bottling-else">
            <label>
              <input type="radio" name="kind" checked={typedKind === 'vineyard'} onChange={() => setTypedKind('vineyard')} /> Vineyard
            </label>
            <label>
              <input type="radio" name="kind" checked={typedKind === 'cuvee'} onChange={() => setTypedKind('cuvee')} /> Cuvée
            </label>
            <input
              type="text"
              aria-label="Name"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Name on the label"
            />
            <button
              type="button"
              className="btn-secondary"
              disabled={busy || typed.trim().length < 2}
              onClick={() => answer({ choice: typedKind, name: typed.trim() })}
            >
              Use this
            </button>
          </div>
        </li>
      </ul>
      {error && <p className="error-text" role="alert">{error}</p>}
      <button type="button" className="btn-link-inline" disabled={busy} onClick={() => answer({ choice: 'not_sure' })}>
        Not sure
      </button>
    </Sheet>
  )
}
