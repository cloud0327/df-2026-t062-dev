// 用紙の 1 ページ。ページの画像の上に、欄（文字・丸・✓・表のマス・差分の欄）を重ねる（キャンバスの Main・PadWork と同じ作り）。
//   橙: 今回 AI が書いて未保存　黄: 直して未保存　青: 入力できる欄
import { memo, useRef, useState, type CSSProperties } from 'react'
import { scaled, useFitScale } from './fit.ts'
import { DiffField } from '../components/DiffField.tsx'
import type { DocState } from './useDocument.ts'
import { fsz, pc, pos, W, H, type PageLayout, type SlotView } from './layout.ts'

const ORANGE: CSSProperties = { background: 'rgba(240,160,64,0.18)', boxShadow: 'inset 0 0 0 1px rgba(232,145,45,0.6)' }
const YELLOW: CSSProperties = { background: 'rgba(255,196,0,0.35)', outline: '1.5px solid #E0A000' }
const BLUE: CSSProperties = { background: 'rgba(36,83,196,0.07)', boxShadow: 'inset 0 0 0 1px rgba(36,83,196,0.3)' }

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
}

function FormPageInner({ page, state, touch, disabled, batchLabel, dim, glow }: Props) {
  const [open, setOpen] = useState('')
  const [diffOpen, setDiffOpen] = useState('')
  // 様式の画像は非公開の置き場にある（期限つきの URL）。読めなければ 1 回だけ URL を取り直し、それでもだめなら白い紙に欄だけを出す
  const [noImage, setNoImage] = useState(false)
  const { marks, edit, display } = state
  const image = state.imageOf(page.no)

  const cell = open ? page.slots.find((s) => s.name === open && s.kind === 'cell') : undefined
  const freshCls = glow ? 'ov fresh glow' : 'ov fresh'

  const renderMark = (s: SlotView) => {
    const v = display(s.name)
    const on = s.kind === 'circle' ? v === 'true' : v === '✓'
    const m = marks.get(s.name)
    const pad = s.kind === 'check' ? (touch ? 1.2 : 1.0) : 0.2
    const box = pos(s.x, s.y, s.w, s.h)
    return (
      <span key={s.name}>
        {m === 'cm' && <span className="chg" style={box} />}
        {m === 'ai' && on && <span className={freshCls} style={box} />}
        {!m && !(m === 'ai' && on) && <span className="able" style={box} />}
        {m === 'ai' && !on && <span className="able" style={box} />}
        {on && s.kind === 'circle' && <span className="ring" style={box} />}
        {on && s.kind === 'check' && <span className="mark" style={{ ...box, fontSize: '2.1cqw' }}>✓</span>}
        <button
          className="hit" type="button" disabled={disabled}
          aria-label={`${s.label}${s.kind === 'circle' ? 'に丸を付ける' : 'に ✓ を付ける'}`} aria-pressed={on}
          onClick={() => edit(s.name, s.kind === 'circle' ? (on ? 'false' : 'true') : (on ? '' : '✓'))}
          style={pos(s.x - pad, s.y - 0.2, s.w + pad * 2, s.h + 0.4)}
        />
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
      </span>
    )
  }

  const renderText = (s: SlotView) => {
    const m = marks.get(s.name)
    const multi = s.kind === 'area'
    const d = multi ? state.diffOf(s) : null
    if (d) {
      return (
        <div key={s.name} style={{ position: 'absolute', ...pos(s.x, s.y, s.w, s.h), zIndex: diffOpen === s.name ? 8 : 3 }}>
          <DiffField
            before={d.before} after={d.after} ai={d.ai} label={s.label} batch={batchLabel}
            fontSize={fsz(s.pt)} lineHeight={s.lh} padding="0.4cqw 0.3cqw 0" fill touch={touch} disabled={disabled}
            onChange={(t) => state.setValue(d.key, t === '' ? null : t)}
            onRevert={(t) => state.setValue(d.key, t === '' ? null : t, 'revert')}
            onSaveHunk={(i) => void state.saveHunk(d.key, i)}
            onOpenChange={(o) => setDiffOpen(o ? s.name : '')}
          />
        </div>
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
          key={s.name} className="fx" type="text" aria-label={s.label} aria-invalid={!!reason} value={value} disabled={disabled}
          onChange={(e) => state.type(s.name, e.target.value)}
          onBlur={() => state.commit(s.name)}
          // 変換中の Enter は確定に使わない
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) state.commit(s.name) }}
          style={reason ? { ...style, outline: '1.5px solid #C2410C' } : style}
        />
      )
    if (!reason) return field
    return (
      <span key={s.name}>
        {field}
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
