import { useEffect, useRef, useSyncExternalStore, type CSSProperties, type KeyboardEvent } from 'react'
import { MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BtwController } from './controller.js'

export interface BtwOverlayInjected {
  readonly controller: BtwController
}

const markdownLabels: MarkdownLabels = {
  code: { copyLabel: 'Copy', copiedLabel: 'Copied' },
  footnotes: 'Footnotes',
}

const dock: CSSProperties = {
  boxSizing: 'border-box',
  width: 'calc(100% - var(--dsh-composer-side-clearance, 16px) - var(--dsh-composer-side-clearance, 16px) - var(--dsh-composer-dock-inset, 8px) - var(--dsh-composer-dock-inset, 8px) - var(--dsh-composer-dock-inset, 8px) - var(--dsh-composer-dock-inset, 8px))',
  maxWidth: 'calc(var(--dsh-composer-card-max-width, 780px) - var(--dsh-composer-dock-inset, 8px) - var(--dsh-composer-dock-inset, 8px) - var(--dsh-composer-dock-inset, 8px) - var(--dsh-composer-dock-inset, 8px))',
  margin: '0 auto',
  flex: 'none',
}

const card: CSSProperties = {
  position: 'relative',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  width: '100%',
  maxHeight: 'min(440px, 55vh)',
  overflow: 'hidden',
  padding: '14px 16px',
  border: '1px solid var(--dsw-alias-border-l1, color-mix(in srgb, #d59d32 44%, transparent))',
  borderRadius: 12,
  background: 'var(--dsw-specific-tip, var(--color-surface, #171717))',
  boxShadow: '0 14px 36px rgba(0, 0, 0, .24)',
  color: 'var(--dsw-alias-label-primary, var(--color-text, inherit))',
  outline: 'none',
}

const header: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  minWidth: 0,
}

const label: CSSProperties = {
  color: 'var(--dsw-alias-state-warn-label, var(--color-warning, #d59d32))',
  fontWeight: 700,
  flex: '0 0 auto',
}

const questionStyle: CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  opacity: .72,
}

const body: CSSProperties = {
  overflow: 'auto',
  padding: '2px 2px 4px',
  lineHeight: 1.55,
}

const footer: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  fontSize: 12,
  opacity: .65,
}

const button: CSSProperties = {
  appearance: 'none',
  border: '1px solid color-mix(in srgb, currentColor 24%, transparent)',
  borderRadius: 7,
  padding: '3px 9px',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
}

export function BtwOverlay({ controller }: BtwOverlayInjected) {
  const state = useSyncExternalStore(
    listener => controller.state.subscribe(listener),
    () => controller.state.getSnapshot(),
  )
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (state.status !== 'closed') root.current?.focus()
  }, [state.status])
  useEffect(() => {
    if (state.status === 'closed') return
    const outside = (event: PointerEvent): void => {
      if (event.target instanceof Node && root.current?.contains(event.target)) return
      controller.dismiss()
    }
    document.addEventListener('pointerdown', outside, true)
    return () => { document.removeEventListener('pointerdown', outside, true) }
  }, [state.status, controller])
  if (state.status === 'closed') return null

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      controller.dismiss()
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      root.current?.querySelector<HTMLElement>('[data-btw-body]')?.scrollBy({ top: -90, behavior: 'smooth' })
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      root.current?.querySelector<HTMLElement>('[data-btw-body]')?.scrollBy({ top: 90, behavior: 'smooth' })
    }
  }

  return (
    <div style={dock} data-btw-dock>
      <div ref={root} style={card} tabIndex={-1} role="dialog" aria-label="BTW side question" onKeyDown={onKeyDown}>
        <div style={header}>
          <span style={label}>/btw</span>
          <span style={questionStyle} title={state.question}>{state.question}</span>
        </div>
        <div style={body} data-btw-body>
          {state.status === 'running' && (
            <div role="status" style={{ color: 'var(--dsw-alias-state-warn-label, var(--color-warning, #d59d32))' }}>Answering…</div>
          )}
          {state.status === 'error' && (
            <div role="alert" style={{ color: 'var(--dsw-alias-state-error-primary, var(--color-error, #e06c75))' }}>{state.error}</div>
          )}
          {state.status === 'success' && <MarkdownText text={state.response} labels={markdownLabels} />}
        </div>
        <div style={footer}>
          <span>{state.status === 'running' ? 'The main agent keeps running' : '↑/↓ scroll · Enter, Space, or Esc dismiss'}</span>
          <button type="button" style={button} onClick={() => { controller.dismiss() }}>
            {state.status === 'running' ? 'Cancel' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  )
}
