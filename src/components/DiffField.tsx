// 差分のふきだし（キャンバスの部品 DiffField を React に移したもの）。
// AI が書いた長い文章の欄で、保存した文から変わったところに緑の下線を引く。押すとふきだしで前の文と今の文を並べ、
// その 1 か所を保存するか、前の文に戻す。欄はそのまま手入力できる（印は後ろの層に描くので、日本語の変換が切れない）。
import { useMemo, useRef, useState, type CSSProperties } from 'react'
import { revertHunk, sentenceDiff, type Hunk } from '../../core/diff.ts'
import { scaled, useFitScale } from '../form/fit.ts'

interface Props {
  before: string
  after: string
  /** 最後に AI が書いた文（直した文かどうかの見分けに使う） */
  ai: string
  label: string
  batch: string
  fontSize: string
  lineHeight: number
  padding: string
  fill?: boolean
  touch?: boolean
  disabled?: boolean
  onChange: (text: string) => void
  onRevert: (text: string) => void
  onSaveHunk: (index: number) => void
  onOpenChange?: (open: boolean) => void
}

function sentence(t: string, s: number, e: number) {
  const start = s > 0 ? t.lastIndexOf('。', s - 1) + 1 : 0
  let end: number
  if (e > s && t[e - 1] === '。') end = e
  else {
    const k = t.indexOf('。', e)
    end = k < 0 ? t.length : k + 1
  }
  return { before: t.slice(start, s), after: t.slice(e, end) }
}

const SANS = "'Noto Sans JP',sans-serif"
const SERIF = "'Noto Serif JP','Hiragino Mincho ProN','Yu Mincho',serif"

export function DiffField(p: Props) {
  const text = p.after
  const hunks = useMemo(() => sentenceDiff(p.before, text), [p.before, text])
  const aiHunks = useMemo(() => sentenceDiff(p.before, p.ai), [p.before, p.ai])
  const edited = (h: Hunk) => !aiHunks.some((a) => a.ins === h.ins && a.del === h.del)
  const [open, setOpenRaw] = useState(-1)
  const [closed, setClosed] = useState(-1)
  const [undo, setUndo] = useState<{ n: string, text: string, after: string } | null>(null)
  const [note, setNote] = useState('')
  const [focus, setFocus] = useState(false)
  const ta = useRef<HTMLTextAreaElement>(null)
  const fit = useFitScale(ta, p.fontSize, text)

  const setOpen = (i: number) => {
    setOpenRaw(i)
    p.onOpenChange?.(i >= 0 || !!undo || !!note)
  }
  const cur = open >= 0 && open < hunks.length ? open : -1

  const caret = (el: HTMLTextAreaElement, fromClick: boolean) => {
    const pos = el.selectionStart
    let hit = hunks.findIndex((h) => pos > h.s && pos < h.e)
    if (hit < 0 && fromClick) hit = hunks.findIndex((h) => pos >= h.s && pos <= h.e)
    if (hit >= 0) {
      if (fromClick || hit !== closed) { setOpen(hit); setClosed(-1) }
    } else if (cur >= 0) { setOpen(-1); setClosed(-1) }
  }

  const fill = !!p.fill
  const metrics: CSSProperties = {
    gridArea: '1/1', margin: 0, border: 0, boxSizing: 'border-box', minWidth: 0, padding: p.padding,
    fontFamily: "'BIZ UDPGothic','Noto Sans JP',sans-serif", fontSize: scaled(p.fontSize, fit), lineHeight: p.lineHeight,
    letterSpacing: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'normal',
  }
  const pendingBg = hunks.length ? (fill ? 'rgba(240,160,64,0.14)' : '#FDF0E1') : undefined
  const idle: CSSProperties = fill ? { background: 'rgba(36,83,196,0.07)', boxShadow: 'inset 0 0 0 1px rgba(36,83,196,0.3)' } : { background: '#FFFFFF' }

  // 印の層（緑の下線）
  const segs: { t: string, style?: CSSProperties }[] = []
  let at = 0
  hunks.forEach((h, i) => {
    const on = cur === i
    if (h.s > at) segs.push({ t: text.slice(at, h.s) })
    if (h.s === h.e) segs.push({ t: '​', style: { boxShadow: '-2px 0 0 #17703F' } })
    else segs.push({ t: text.slice(h.s, h.e), style: { background: on ? 'rgba(44,90,134,0.22)' : '#DCF2E4', borderBottom: `2px ${edited(h) ? 'dashed' : 'solid'} ${on ? '#2C5A86' : '#17703F'}` } })
    at = h.e
  })
  segs.push({ t: text.slice(at) + '​' })

  const t = !!p.touch
  const btn: CSSProperties = { fontFamily: SANS, borderRadius: t ? 8 : 4, cursor: 'pointer', lineHeight: 1.6, whiteSpace: 'nowrap', ...(t ? { fontSize: 16, padding: '8px 18px', minHeight: 46 } : { fontSize: 12, padding: '2px 10px' }) }
  const nav = (dis: boolean): CSSProperties => ({ fontFamily: SANS, ...(t ? { width: 44, height: 40, fontSize: 18 } : { width: 26, height: 24 }), border: '1px solid #D3D9DF', borderRadius: 4, background: '#FFFFFF', color: '#1C2229', cursor: dis ? 'default' : 'pointer', opacity: dis ? 0.35 : 1 })

  let pop: null | { h: Hunk, k: number, ctx: { before: string, after: string }, now: string, fixed: boolean } = null
  if (cur >= 0) {
    const h = hunks[cur]
    const now = text.slice(h.s, h.e)
    const ai = aiHunks.find((a) => a.del === h.del)
    pop = { h, k: cur, ctx: sentence(text, h.s, h.e), now, fixed: edited(h) && (!ai || now !== ai.ins) }
  }
  const hasBelow = !!pop || !!undo || !!note

  return (
    <div style={{ position: 'relative', fontFamily: "'Noto Sans JP',system-ui,sans-serif", color: '#1C2229', ...(fill ? { width: '100%', height: '100%' } : { width: '100%', display: 'flex', flexDirection: 'column', gap: 6 }) }}>
      <div style={fill ? { height: '100%' } : { display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', border: '1px solid #2B3138' }}>
        <div style={{ display: 'grid', position: 'relative', transition: 'background .2s', minWidth: 0, ...(fill ? { height: '100%', borderRadius: 2, overflow: 'hidden', gridTemplateRows: 'minmax(0, 1fr)' } : { minHeight: '5.6em' }), ...(pendingBg ? { background: pendingBg } : idle), ...(focus ? { boxShadow: 'inset 0 0 0 2px #2C5A86' } : {}) }}>
          <div aria-hidden="true" style={{ ...metrics, color: 'transparent', pointerEvents: 'none', overflow: 'hidden' }}>
            {segs.map((g, i) => <span key={i} style={g.style}>{g.t}</span>)}
          </div>
          <textarea
            ref={ta}
            aria-label={`${p.label}${hunks.length ? '（変更あり。変更箇所を選択すると比較できます）' : ''}`}
            value={text}
            disabled={p.disabled}
            onChange={(e) => { setUndo(null); setNote(''); p.onChange(e.target.value) }}
            onClick={(e) => caret(e.currentTarget, true)}
            onKeyUp={(e) => { if (/^(Arrow|Home|End)/.test(e.key)) caret(e.currentTarget, false) }}
            onFocus={() => setFocus(true)}
            onBlur={() => setFocus(false)}
            style={{ ...metrics, width: '100%', height: '100%', background: 'transparent', color: '#1A3FA0', caretColor: '#1A3FA0', resize: 'none', overflow: 'hidden', outline: 'none' }}
          />
        </div>
      </div>
      {hasBelow && (
        <div style={{ ...(fill ? { position: 'absolute', zIndex: 20, top: 'calc(100% + 8px)', left: 0, width: t ? 540 : 440, maxWidth: '90vw' } : {}), display: 'flex', flexDirection: 'column', gap: 6, lineHeight: 1.7, textAlign: 'left' }}>
          {pop && (
            <div role="dialog" aria-label="変更の中身" style={{ position: 'relative', border: '1px solid #D3D9DF', borderRadius: 8, background: '#FFFFFF', boxShadow: '0 6px 20px rgba(0,0,0,0.14)' }}>
              <div aria-hidden="true" style={{ position: 'absolute', top: -7, left: 44, width: 12, height: 12, background: '#FFFFFF', borderLeft: '1px solid #D3D9DF', borderTop: '1px solid #D3D9DF', transform: 'rotate(45deg)' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', color: '#5B6672', ...(t ? { fontSize: 15, padding: '10px 14px' } : { fontSize: 12, padding: '6px 10px' }) }}>
                <strong style={{ color: '#1C2229' }}>
  {edited(pop.h) ? '✎ 手動修正' : '↻ AI更新'}：{pop.h.n} {pop.h.kind}
</strong>
                <span>{p.batch}</span>
                <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <button type="button" aria-label="前の変更" disabled={pop.k <= 0} onClick={() => setOpen(pop!.k - 1)} style={nav(pop.k <= 0)}>‹</button>
                  <span>{pop.k + 1} / {hunks.length}</span>
                  <button type="button" aria-label="次の変更" disabled={pop.k >= hunks.length - 1} onClick={() => setOpen(pop!.k + 1)} style={nav(pop.k >= hunks.length - 1)}>›</button>
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', fontSize: t ? 17 : 13.5 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1.3em 6.2em minmax(0,1fr)', gap: 6, padding: '4px 10px', fontFamily: SERIF, background: '#FBE3E1', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  <span style={{ fontFamily: SANS, fontWeight: 700, color: '#B02A22' }}>−</span>
                  <span style={{ fontFamily: SANS, fontSize: 11, color: '#5B6672', paddingTop: 3 }}>前の文</span>
                  <span>{(pop.ctx.before + pop.h.del + pop.ctx.after).trim()
                    ? <><span>{pop.ctx.before}</span><span style={{ textDecoration: 'line-through', textDecorationThickness: 1, background: 'rgba(176,42,34,0.22)', color: '#B02A22' }}>{pop.h.del}</span><span>{pop.ctx.after}</span></>
                    : <span style={{ color: '#5B6672', fontFamily: SANS, fontSize: 12 }}>（なし）</span>}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1.3em 6.2em minmax(0,1fr)', gap: 6, padding: '4px 10px', fontFamily: SERIF, background: '#DCF2E4', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  <span style={{ fontFamily: SANS, fontWeight: 700, color: '#17703F' }}>＋</span>
                  <span style={{ fontFamily: SANS, fontSize: 11, color: '#5B6672', paddingTop: 3 }}>{pop.fixed ? '直した文' : 'AI の文'}</span>
                  <span>{(pop.ctx.before + pop.now + pop.ctx.after).trim()
                    ? <><span>{pop.ctx.before}</span><span style={{ background: 'rgba(23,112,63,0.22)', color: '#17703F' }}>{pop.now}</span><span>{pop.ctx.after}</span></>
                    : <span style={{ color: '#5B6672', fontFamily: SANS, fontSize: 12 }}>（なし）</span>}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: t ? 10 : 6, flexWrap: 'wrap', padding: t ? '12px 14px' : '8px 10px' }}>
                <button type="button" disabled={p.disabled} onClick={() => {
                  const h = pop!.h
                  setNote(`${h.n} を保存しました${edited(h) ? '（直した文で）' : ''}。`)
                  setUndo(null)
                  setOpen(hunks.length > 1 ? 0 : -1)
                  p.onSaveHunk(pop!.k)
                }} style={{ ...btn, border: '1px solid #1C2229', background: '#1C2229', color: '#FFFFFF' }}>保存</button>
                <button type="button" disabled={p.disabled} onClick={() => {
                  const h = pop!.h
                  const next = revertHunk(text, h)
                  setUndo({ n: h.n, text, after: next })
                  setNote('')
                  setOpen(hunks.length > 1 ? 0 : -1)
                  p.onRevert(next)
                }} style={{ ...btn, border: '1px solid #B02A22', background: '#FFFFFF', color: '#B02A22' }}>前の文に戻す</button>
                <button type="button" onClick={() => { setClosed(cur); setOpen(-1) }} style={{ ...btn, border: '1px solid #D3D9DF', background: '#FFFFFF', color: '#1C2229', marginLeft: 'auto' }}>閉じる</button>
              </div>
            </div>
          )}
          {undo && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, background: '#ECEFF3', borderRadius: 6, padding: '3px 10px', flexWrap: 'wrap' }}>
              <span>{undo.n} を前の文に戻しました</span>
              <button type="button" onClick={() => { if (text === undo.after) p.onRevert(undo.text); setUndo(null); p.onOpenChange?.(false) }} style={{ font: 'inherit', fontSize: 12, color: '#2C5A86', background: 'none', border: 0, padding: 0, cursor: 'pointer', textDecoration: 'underline' }}>取り消す</button>
            </div>
          )}
          {!undo && note && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, background: '#ECEFF3', borderRadius: 6, padding: '3px 10px' }}>
              <span>{note}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
