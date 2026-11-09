// 用紙の 1 ページ。ページの画像の上に、欄（文字・丸・✓・表のマス・差分の欄）を重ねる（キャンバスの Main・PadWork と同じ作り）。
//   橙: 今回 AI が書いて未保存　黄: 直して未保存　青: 入力できる欄
import { Fragment, memo, useRef, useState, type CSSProperties } from 'react'
import { scaled, useFitScale } from './fit.ts'
import { DiffField } from '../components/DiffField.tsx'
import type { DocState } from './useDocument.ts'
import { fsz, pc, pos, W, H, type PageLayout, type SlotView } from './layout.ts'

const ORANGE: CSSProperties = {
  background: 'rgba(240,160,64,0.18)',
  outline: '1px solid rgba(232,145,45,0.7)',
  outlineOffset: '-1px',
}
const YELLOW: CSSProperties = {
  background: 'rgba(255,196,0,0.35)',
  outline: '2px solid #B77900',
  outlineOffset: '-2px',
}

const BLUE: CSSProperties = { background: 'rgba(36,83,196,0.07)', boxShadow: 'inset 0 0 0 1px rgba(36,83,196,0.3)' }
const changeStatus = (mark: string | undefined) => {
  if (mark === 'ai') return 'AIが入力した欄'
  if (mark === 'cm') return '手動で修正した欄'
  return '通常の入力欄'
}

interface Props {
  page: PageLayout
  state: DocState
  touch: boolean
  disabled: boolean
  /** 差分の欄の「AI 書き込み 1・1/21 …」 */
  batchLabel: string
  /** 何も書かれていない新しい用紙（画像を薄くする） */
  dim?: boolean
  /** 書き終わったところを光らせる（iPad の流れ E） */
  glow?: boolean
  petFocus?: string
  provisional?: ReadonlyMap<string, unknown>
  adoptingKey?: string
  onAdopt?: (slot: string) => void
  onEditChoice?: (field: string) => void
}

function FormPageInner({ page, state, touch, disabled, batchLabel, dim, glow, petFocus, provisional, adoptingKey, onAdopt, onEditChoice }: Props) {
  const [open, setOpen] = useState('')
  const [diffOpen, setDiffOpen] = useState('')
  const [reviewSlot, setReviewSlot] = useState('')
  // 様式の画像は非公開の置き場にある（期限つきの URL）。読めなければ 1 回だけ URL を取り直し、それでもだめなら白い紙に欄だけを出す
  const [noImage, setNoImage] = useState(false)
  const { marks, edit, display } = state
  const image = state.imageOf(page.no)

  const cell = open ? page.slots.find((s) => s.name === open && s.kind === 'cell') : undefined
  const target = petFocus ? page.slots.find((s) => s.name === petFocus) : undefined
  const freshCls = glow ? 'ov fresh glow' : 'ov fresh'

  // AI が変更した欄は、文字・選択肢のどれでも変更前と現在値を確認できる。
  // 「変更前に戻す」は既存のslot編集経路を通すため、通常の保存・競合処理がそのまま働く。
  const compareButton = (s: SlotView) => marks.get(s.name) ? (
    <button
      type="button"
      aria-label={`${s.label}の変更前と変更後を比較`}
      title="変更前と変更後を比較"
      onClick={(event) => { event.stopPropagation(); setReviewSlot(s.name) }}
      style={{ position: 'absolute', zIndex: 10, ...pos(s.x + Math.max(0, s.w - 8), s.y - 3, 8, 4), minWidth: 20, minHeight: 18, padding: '0 3px', border: '1px solid #6B7280', borderRadius: 4, background: '#FFFFFF', color: '#303846', font: 'bold 10px sans-serif', cursor: 'pointer', lineHeight: 1 }}
    >差分</button>
  ) : null

  const renderMark = (s: SlotView) => {
    const v = display(s.name)
    const proposed = provisional?.has(s.name) ?? false
    const key = s.binding?.ref.key
    const on = proposed || (s.kind === 'circle' ? v === 'true' : v === '✓')
    const m = marks.get(s.name)
    const pad = s.kind === 'check' ? (touch ? 1.2 : 1.0) : 0.2
    const box = pos(s.x, s.y, s.w, s.h)
    return (
      <span key={s.name}>
        {(m === 'cm' || proposed) && <span className="chg" style={box} data-provisional={proposed || undefined} />}
        {m === 'ai' && on && <span className={freshCls} style={box} />}
        {!proposed && !m && <span className="able" style={box} />}
        {m === 'ai' && !on && <span className="able" style={box} />}
        {on && s.kind === 'circle' && <span className="ring" style={box} />}
        {on && s.kind === 'check' && <span className="mark" style={{ ...box, fontSize: '2.1cqw' }}>✓</span>}
        <button
          className="hit" type="button" disabled={disabled || (!!adoptingKey && adoptingKey === key)}
          aria-label={`${s.label}${proposed ? '（書類からの仮入力候補）' : s.kind === 'circle' ? 'に丸を付ける' : 'に ✓ を付ける'}`} aria-pressed={on}
          onClick={() => {
            if (proposed) onAdopt?.(s.name)
            else {
              if (key) onEditChoice?.(key)
              edit(s.name, s.kind === 'circle' ? (on ? 'false' : 'true') : (on ? '' : '✓'))
            }
          }}
          style={pos(s.x - pad, s.y - 0.2, s.w + pad * 2, s.h + 0.4)}
        />
        {compareButton(s)}
      </span>
    )
  }

  const renderCell = (s: SlotView) => {
    const v = display(s.name)
    const box = pos(s.x + 0.15, s.y + 0.15, Math.max(0.5, s.w - 0.3), Math.max(0.5, s.h - 0.3))
    const multi = (s.cellOptions?.length ?? 0) > 1
    const isOpen = open === s.name
    return (
      <span key={s.name}>
        {v && marks.get(s.name) === 'cm' && <span className="chg" style={box} />}
        {v && marks.get(s.name) === 'ai' && <span className={freshCls} style={box} />}
        {v && <span className="mark" style={{ ...box, fontSize: '2.3cqw' }}>{v}</span>}
        <button
          className={`hit${isOpen ? ' cell-open' : ''}`} type="button" disabled={disabled}
          aria-label={`${s.label}${multi ? '（印を選ぶ）' : '（押して ○ を付け外し）'}`} aria-haspopup={multi}
          onClick={() => (multi ? setOpen(isOpen ? '' : s.name) : edit(s.name, v ? '' : s.cellOptions![0].text))}
          style={box}
        />
        {compareButton(s)}
      </span>
    )
  }

  const renderText = (s: SlotView) => {
    const m = marks.get(s.name)
    const multi = s.kind === 'area'
    const d = multi ? state.diffOf(s) : null
    if (d) {
      return (
        <Fragment key={s.name}>
        <div style={{ position: 'absolute', ...pos(s.x, s.y, s.w, s.h), zIndex: diffOpen === s.name ? 8 : 3 }}>
          <DiffField
            before={d.before} after={d.after} ai={d.ai} label={s.label} batch={batchLabel}
            fontSize={fsz(s.pt)} lineHeight={s.lh} padding="0.4cqw 0.3cqw 0" fill touch={touch} disabled={disabled}
            onChange={(t) => state.setValue(d.key, t === '' ? null : t)}
            onRevert={(t) => state.setValue(d.key, t === '' ? null : t, 'revert')}
            onSaveHunk={(i) => void state.saveHunk(d.key, i)}
            onOpenChange={(o) => setDiffOpen(o ? s.name : '')}
          />
        </div>
        {compareButton(s)}
        </Fragment>
      )
    }
    const style: CSSProperties = {
      ...pos(s.x, s.y, s.w, s.h),
      fontSize: fsz(s.pt),
      lineHeight: multi ? s.lh : 1.15,
      textAlign: s.align,
      ...(m === 'cm' ? YELLOW : m === 'ai' ? ORANGE : BLUE),
    }
    const value = display(s.name)
    const reason = state.reasons.get(s.name)
    const field = multi
      ? <FitTextarea key={s.name} label={s.label} value={value} disabled={disabled} onChange={(t) => state.type(s.name, t)} onBlur={() => state.commit(s.name)} style={style} base={fsz(s.pt)} />
      : (
        <input
          key={s.name} className="fx" type="text" aria-label={`${s.label}（${changeStatus(m)}）`} aria-invalid={!!reason} value={value} disabled={disabled}
          onChange={(e) => state.type(s.name, e.target.value)}
          onBlur={() => state.commit(s.name)}
          // 変換中の Enter は確定に使わない
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) state.commit(s.name) }}
          style={reason ? { ...style, outline: '1.5px solid #C2410C' } : style}
        />
      )
    if (!reason) return <span key={s.name}>{field}{compareButton(s)}</span>
    return (
      <span key={s.name}>
        {field}
        {compareButton(s)}
        <span role="alert" style={{
          position: 'absolute', left: pc(s.x, W), top: pc(s.y + s.h + 0.6, H), zIndex: 6, maxWidth: touch ? 320 : 260,
          background: '#FFFFFF', color: '#9A3412', border: '1px solid #FDBA74', borderRadius: 8, padding: touch ? '6px 10px' : '4px 8px',
          fontSize: touch ? 13 : 11, lineHeight: 1.45, boxShadow: '0 4px 14px rgba(20,24,32,0.14)', pointerEvents: 'none',
        }}>{reason}</span>
      </span>
    )
  }

  return (
    <div className="pg">
      {noImage || !image
        ? <div className="pimg" role="img" aria-label={page.title} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '4%', color: '#8A919C', fontSize: 12 }}>{image === null && !noImage ? '様式の画像が置き場にありません（npm run forms:assets）' : ''}</div>
        : <img className="pimg" src={image} alt={`${page.title}`} style={dim ? { opacity: 0.55 } : undefined} draggable={false} onError={() => { if (!state.imageFailed()) setNoImage(true) }} />}
      {page.slots.map((s) => (s.kind === 'circle' || s.kind === 'check' ? renderMark(s) : s.kind === 'cell' ? renderCell(s) : renderText(s)))}
      {reviewSlot && (() => {
        const slot = page.slots.find((s) => s.name === reviewSlot)
        if (!slot) return null
        const before = state.renderedSaved[slot.name] ?? ''
        const after = state.display(slot.name)
        return (
          <div role="presentation" onKeyDown={(event) => { if (event.key === 'Escape') setReviewSlot('') }} onMouseDown={(event) => { if (event.target === event.currentTarget) setReviewSlot('') }} style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'grid', placeItems: 'center', padding: 20, background: 'rgba(16,24,40,0.48)' }}>
            <section role="dialog" aria-modal="true" aria-labelledby="slot-review-title" style={{ width: 'min(680px, 94vw)', maxHeight: '85vh', overflow: 'auto', background: '#FFFFFF', borderRadius: 14, boxShadow: '0 16px 48px rgba(0,0,0,.28)', padding: touch ? 20 : 16, color: '#1C2229' }}>
              <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <strong id="slot-review-title" style={{ fontSize: touch ? 19 : 16 }}>{slot.label}の変更</strong>
                <button type="button" autoFocus onClick={() => setReviewSlot('')} aria-label="比較を閉じる" style={{ marginLeft: 'auto', border: 0, background: 'transparent', fontSize: 22, cursor: 'pointer' }}>×</button>
              </header>
              <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ border: '1px solid #E5A29D', borderRadius: 8, padding: 12, background: '#FBE3E1' }}>
                  <strong style={{ display: 'block', color: '#9F2822', marginBottom: 6 }}>変更前</strong>
                  <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '28vh', overflow: 'auto' }}>{before || <span style={{ color: '#68717D' }}>（空欄）</span>}</div>
                </div>
                <div style={{ border: '1px solid #A6D3B5', borderRadius: 8, padding: 12, background: '#E6F5EB' }}>
                  <strong style={{ display: 'block', color: '#17633A', marginBottom: 6 }}>変更後（現在の値）</strong>
                  <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '28vh', overflow: 'auto' }}>{after || <span style={{ color: '#68717D' }}>（空欄）</span>}</div>
                </div>
              </div>
              <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
                <button type="button" disabled={disabled} onClick={() => { edit(slot.name, before); setReviewSlot('') }} style={{ minHeight: 40, padding: '7px 14px', border: '1px solid #B02A22', borderRadius: 6, background: '#FFFFFF', color: '#9F2822', font: 'inherit', cursor: disabled ? 'default' : 'pointer' }}>変更前に戻す</button>
                <button type="button" onClick={() => setReviewSlot('')} style={{ minHeight: 40, padding: '7px 14px', border: 0, borderRadius: 6, background: '#17633A', color: '#FFFFFF', font: 'inherit', fontWeight: 700, cursor: 'pointer' }}>変更後を維持</button>
              </footer>
            </section>
          </div>
        )
      })()}
      {target && <span className="pc-pet-field-focus" data-slot={target.name} style={pos(target.x, target.y, target.w, target.h)} aria-hidden="true" />}
      {cell && (
        <div role="dialog" aria-label={cell.label} style={{
          position: 'absolute', zIndex: 5, left: pc(Math.min(cell.x, touch ? 108 : 125), W), top: pc(cell.y + cell.h + 1.2, H),
          width: touch ? 340 : 280, background: '#FFFFFF', borderRadius: touch ? 16 : 12, boxShadow: touch ? '0 12px 36px rgba(20,24,32,0.28)' : '0 10px 30px rgba(20,24,32,0.25)',
          padding: touch ? 16 : 12, display: 'flex', flexDirection: 'column', gap: touch ? 10 : 6,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ fontSize: touch ? 15 : 13, fontWeight: 700, lineHeight: 1.4 }}>{cell.label}</div>
            <button type="button" onClick={() => setOpen('')} style={{ font: 'inherit', fontSize: touch ? 15 : 13, border: 0, background: 'transparent', color: '#2453C4', cursor: 'pointer', padding: touch ? '0 4px' : '2px 4px', minHeight: touch ? 40 : undefined, whiteSpace: 'nowrap' }}>閉じる</button>
          </div>
          {cell.cellOptions!.map((o) => {
            const sel = display(cell.name) === o.text
            return (
              <button key={o.text} type="button" className={`opt${sel ? ' opt-on' : ''}`} aria-pressed={sel} onClick={() => { edit(cell.name, o.text); setOpen('') }}>
                <span className="sym" aria-hidden="true">{o.text}</span>{o.label}
              </button>
            )
          })}
          <button type="button" className="opt" onClick={() => { edit(cell.name, ''); setOpen('') }}><span className="sym" aria-hidden="true" />印を消す</button>
        </div>
      )}
    </div>
  )
}

/** 長い文章の欄（入りきらなければ文字を小さくする） */
function FitTextarea({ label, value, disabled, onChange, onBlur, style, base }: { label: string, value: string, disabled: boolean, onChange: (t: string) => void, onBlur: () => void, style: CSSProperties, base: string }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const s = useFitScale(ref, base, value)
  return <textarea ref={ref} className="fx fxa" aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} style={{ ...style, fontSize: scaled(base, s) }} />
}

export const FormPage = memo(FormPageInner)
