// PC ② 作業画面（キャンバス Main）。新しい利用者は ③（PcNew）、2 回目からの書き換えのあとは ④（PcDiff）の印になる。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { countRequired } from '../../core/required.ts'
import { FormPage } from '../form/FormPage.tsx'
import { useClient } from '../form/useClient.ts'
import { useDocument } from '../form/useDocument.ts'
import { api } from '../lib/api.ts'
import { linkProps } from '../lib/router.tsx'
import { PetHelper } from '../components/PetHelper.tsx'
import { PcHeader, countText, downloadBlob } from '../components/Chrome.tsx'

export function PcWork({ clientId, staffName }: { clientId: string, staffName: string }) {
  const [tab, setTab] = useState<'assessment' | 'admission'>('assessment')
  const reloadDoc = useRef<() => void>(() => {})
  const { client, reload: reloadClient } = useClient(clientId, () => reloadDoc.current())
  const docId = client?.documents.find((d) => d.kind === tab)?.id
  const state = useDocument(docId)
  reloadDoc.current = () => { void state.reload(); void reloadClient() }
  const [zoom, setZoom] = useState(100)
  const [cur, setCur] = useState(0)
  const [newOpen, setNewOpen] = useState(false)
  const [docSaved, setDocSaved] = useState(false)
  const [savedPages, setSavedPages] = useState<Set<number>>(new Set())
  const scroller = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => { setDocSaved(false); setSavedPages(new Set()); setCur(0) }, [docId])
  useEffect(() => { if (state.pendingCount) setDocSaved(false) }, [state.pendingCount])

  const openAdmission = useCallback(async () => {
    setNewOpen(false)
    if (!client?.documents.some((d) => d.kind === 'admission')) {
      await api.createAdmission(clientId)
      await reloadClient()
    }
    setTab('admission')
  }, [client, clientId, reloadClient])

  const doc = state.doc
  const isAdm = tab === 'admission'
  const pages = state.pages
  const maxW = Math.round(820 * zoom / 100)
  const required = !isAdm && doc ? countRequired(state.current) : client?.required ?? { filled: 0, total: 84 }
  const latestBatch = doc?.batches[0]
  const batchLabel = latestBatch?.label ?? 'AI 書き込み'
  const empty = !!doc && !doc.batches.length && Object.keys(doc.fields).every((k) => k === 'person.name' || k === 'person.sex')
  const hasUpdates = state.updates.size > 0
  const copied = doc?.batches.find((b) => b.kind === 'copy')?.changes ?? 0

  const onScroll = () => {
    const el = scroller.current
    if (!el || isAdm) return
    const y = el.scrollTop + el.clientHeight * 0.3
    let idx = 0
    pageRefs.current.forEach((p, i) => { if (p && p.offsetTop - el.offsetTop <= y) idx = i })
    if (idx !== cur) setCur(idx)
  }
  const jump = (i: number) => {
    const el = scroller.current, p = pageRefs.current[i]
    if (el && p) el.scrollTo({ top: p.offsetTop - el.offsetTop - 4, behavior: 'smooth' })
  }

  const pet = useMemo(() => {
    if (empty) return { context: 'アセスメント作成中', message: `${client?.name ?? ''}さんのアセスメントを始めよう。\nこの順に進めると、面談で聞くことが少なくて済むよ。`, items: ['書類の写しを入れる', '初回の面談を録音する', '用紙を確かめて保存する'] }
    if (hasUpdates) return { context: 'アセスメント編集中', message: `今回の録音から、${state.updatedFields} 欄に書き足したよ。\n下線を押すと、前の文と比べられるよ。`, items: ['変わったところを順に見る', '今回の書き込みを元に戻す', '次の面談の準備'] }
    return { context: 'アセスメント編集中', message: '今は次の操作ができるよ。\nどれを進める？', items: ['未確認の項目を見る', '書類を追加する', '次の面談の準備'] }
  }, [empty, hasUpdates, client?.name, state.updatedFields])

  const exportPdf = async () => {
    if (!docId) return
    await state.flush()
    const blob = await api.pdf(docId)
    downloadBlob(blob, `${client?.name ?? ''}_${isAdm ? '入院時情報提供書' : 'アセスメント'}.pdf`)
  }

  const pageLabel = (no: number, title: string, i: number) => {
    const c = state.counts.get(no) ?? { ai: 0, hand: 0 }
    const dirty = !!(c.ai || c.hand)
    return (
      <div className="plabel" style={{ justifyContent: 'space-between', gap: 8 }}>
        <span>{isAdm ? title : `${no} ・ ${title}`}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: '#5B6672' }}>{dirty ? countText(c) : savedPages.has(no) ? '保存しました' : i === 0 && empty ? 'まだ何も書かれていません' : ''}</span>
          <button type="button" className="pgsave" disabled={!dirty} onClick={async () => { await state.savePage(no); setSavedPages((s) => new Set(s).add(no)) }} style={dirty ? undefined : { opacity: 0.35, cursor: 'default' }}>このページを保存</button>
        </span>
      </div>
    )
  }

  return (
    <div className="pc" style={{ fontFamily: "'Noto Sans JP',system-ui,sans-serif", color: '#1F2430', background: '#F4F5F7', height: '100vh', minHeight: 720, fontSize: 14, lineHeight: 1.6, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <PcHeader staffName={staffName} />

      <div style={{ flex: '0 0 auto', background: '#FFFFFF', borderBottom: '1px solid #E1E4EA', padding: '12px 24px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 28px' }}>
        <a {...linkProps('/')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, textDecoration: 'none' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>利用者一覧
        </a>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{client ? `${client.name} さん` : ' '}</h1>
          <span style={{ fontSize: 13, color: '#5A6270' }}>{isAdm ? '入院時情報提供書' : 'アセスメント'}</span>
        </div>
        <div style={{ flex: '1 1 360px', display: 'flex', alignItems: 'center', gap: 16, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '0 1 300px', minWidth: 220 }}>
            <div style={{ fontSize: 12, color: '#5A6270' }}>必須 {required.total} 欄のうち {required.filled} 欄が入っています</div>
            <div style={{ height: 8, borderRadius: 999, overflow: 'hidden', background: '#DCE0E6', marginTop: 4 }}>{required.filled > 0 && <div style={{ height: 8, background: '#2F5FD0', width: `${(required.filled / required.total * 100).toFixed(1)}%` }} />}</div>
          </div>
          <button className="btn" type="button" onClick={() => void exportPdf()} disabled={!docId}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11" /><path d="M7 10l5 5 5-5" /><path d="M5 20h14" /></svg>書類を出力
          </button>
        </div>
      </div>

      <div style={{ position: 'relative', flex: '1 1 auto', minHeight: 0, display: 'flex', gap: 16, padding: '16px 24px 20px', overflowX: 'auto' }}>
        <nav aria-label="ページ" style={{ flex: '0 0 210px', minHeight: 0, overflow: 'auto', background: '#FFFFFF', border: '1px solid #E1E4EA', borderRadius: 12, padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 2, boxSizing: 'border-box' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#5A6270', padding: '0 8px 6px' }}>{isAdm ? '入院時情報提供書' : 'アセスメント用紙'}</div>
          {pages.map((p, i) => {
            const n = state.updates.get(p.no) ?? 0
            return (
              <button key={p.no} type="button" className={`nav-i${i === cur ? ' nav-on' : ''}`} aria-current={i === cur} onClick={() => jump(i)}>
                <span className="no">{p.no}</span><span style={{ flex: '1 1 auto' }}>{p.title}</span>
                {n > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: '#17703F', background: '#DCF2E4', borderRadius: 999, padding: '0 7px' }}>{n}</span>}
              </button>
            )
          })}
        </nav>

        <section aria-label="書類" style={{ flex: '1 1 560px', minWidth: 480, minHeight: 0, background: '#FFFFFF', border: '1px solid #E1E4EA', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
          <div role="tablist" aria-label="書類" style={{ flex: '0 0 auto', display: 'flex', alignItems: 'flex-end', gap: 2, padding: '8px 12px 0', borderBottom: '1px solid #E1E4EA', background: '#F7F8FA', position: 'relative', zIndex: 6 }}>
            <button className={`dtab${!isAdm ? ' dtab-on' : ''}`} role="tab" aria-selected={!isAdm} type="button" onClick={() => { setTab('assessment'); setNewOpen(false) }}>アセスメント</button>
            <button className={`dtab${isAdm ? ' dtab-on' : ''}`} role="tab" aria-selected={isAdm} type="button" onClick={() => void openAdmission()}>入院時情報提供書</button>
            <button className="dtab dtab-add" type="button" aria-haspopup="true" aria-expanded={newOpen} onClick={() => setNewOpen(!newOpen)}>＋ 書類を作る</button>
            {newOpen && (
              <div role="menu" style={{ position: 'absolute', top: '100%', left: 250, marginTop: 4, width: 300, background: '#FFFFFF', border: '1px solid #E1E4EA', borderRadius: 12, boxShadow: '0 10px 30px rgba(20,24,32,0.18)', padding: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ fontSize: 12, color: '#5A6270', padding: '4px 8px 6px' }}>{client?.name}さんの今の情報から、AI が書き込みます</div>
                <button className="mi" role="menuitem" type="button" onClick={() => setNewOpen(false)}><span>モニタリング</span><span className="mi-s">様式を登録すると作れます</span></button>
                <button className="mi" role="menuitem" type="button" onClick={() => setNewOpen(false)}><span>デイの体験用紙</span><span className="mi-s">様式を登録すると作れます</span></button>
              </div>
            )}
          </div>
          <div style={{ flex: '0 0 auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 18px', padding: '10px 16px', borderBottom: '1px solid #EEF0F3' }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{isAdm ? '入院時情報提供書' : pages[cur]?.title}<span style={{ fontWeight: 400, color: '#5A6270', marginLeft: 8, fontSize: 12 }}>{isAdm ? '1 / 1 ページ' : `${cur + 1} / ${pages.length || 11} ページ`}</span></h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <span className="lg"><span aria-hidden="true" style={{ width: 14, height: 10, borderRadius: 2, background: 'rgba(36,83,196,0.1)', border: '1px solid rgba(36,83,196,0.45)' }} />入力できる欄</span>
              <span className="lg"><span aria-hidden="true" style={{ width: 14, height: 10, borderRadius: 2, background: 'rgba(240,160,64,0.3)', border: '1px solid rgba(232,145,45,0.7)' }} />今回の録音から</span>
              {hasUpdates
                ? <span className="lg"><span aria-hidden="true" style={{ width: 16, height: 10, background: '#DCF2E4', borderBottom: '2px solid #17703F' }} />変わったところ（押すと前の文）</span>
                : <span className="lg"><span aria-hidden="true" style={{ width: 14, height: 10, borderRadius: 2, background: 'rgba(255,196,0,0.5)', outline: '1.5px solid #E0A000' }} />直したところ</span>}
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div role="group" aria-label="拡大" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button className="btn btn-i" type="button" aria-label="小さくする" onClick={() => setZoom(Math.max(80, zoom - 20))}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /></svg></button>
                <span style={{ fontSize: 12, color: '#3F4652', minWidth: 40, textAlign: 'center' }}>{zoom}%</span>
                <button className="btn btn-i" type="button" aria-label="大きくする" onClick={() => setZoom(Math.min(160, zoom + 20))}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14" /><path d="M5 12h14" /></svg></button>
              </div>
              <span style={{ fontSize: 12, color: '#5B6672' }}>{empty ? 'まだ何も書かれていません' : countText(state.total) || 'すべて保存済み'}</span>
              {docSaved && <span role="status" style={{ fontSize: 13, fontWeight: 500, color: '#1F49B0' }}>保存しました</span>}
              <button type="button" className="savebtn" onClick={async () => { await state.saveDocument(); setDocSaved(true); setSavedPages(new Set(pages.map((p) => p.no))) }}>書類を保存</button>
            </div>
          </div>

          <div ref={scroller} onScroll={onScroll} style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto', background: '#E9EBEF', padding: 20 }}>
            {state.error && <div role="alert" style={{ margin: `0 auto 12px`, maxWidth: maxW, color: '#A3261C', fontSize: 13 }}>うまく送れませんでした（{state.error}）。少し待ってから、もう一度直してください。</div>}
            {isAdm && doc && (
              <div style={{ margin: '0 auto 14px', maxWidth: maxW }}>
                <div role="status" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: '#FFF4E5', border: '1px solid #F0C78A', borderRadius: 10, padding: '10px 14px', fontSize: 13, lineHeight: 1.5 }}>
                  <span aria-hidden="true" style={{ flex: '0 0 auto', width: 22, height: 22, borderRadius: 6, background: '#1F2430', color: '#FFFFFF', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>AI</span>
                  <div><strong>アセスメントから {copied} 欄を写しました（橙）。</strong>氏名・生年月日・住所・電話番号などは、アセスメントと同じ値です。どちらかで直すと、もう片方にも入ります。</div>
                </div>
              </div>
            )}
            {doc && pages.map((p, i) => (
              <div key={`${doc.id}-${p.no}`} ref={(el) => { pageRefs.current[i] = el }} style={{ margin: '0 auto 24px', maxWidth: maxW }}>
                {pageLabel(p.no, p.title, i)}
                <div style={{ position: 'relative' }}>
                  <FormPage page={p} state={state} touch={false} disabled={false} batchLabel={batchLabel} dim={empty && i === 0} />
                  {empty && i === 0 && (
                    <div style={{ position: 'absolute', left: '50%', top: '22%', transform: 'translateX(-50%)', width: 'min(420px,86%)', background: '#FFFFFF', borderRadius: 14, boxShadow: '0 8px 30px rgba(20,24,32,0.18)', padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'center', zIndex: 4, pointerEvents: 'none' }}>
                      <div style={{ fontWeight: 700, fontSize: 16 }}>録音や書類を入れると、AI がこの用紙に書きます</div>
                      <div style={{ fontSize: 13, color: '#5A6270' }}>右下のお手伝いの案内にそって進めてください。</div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          {state.notice && (
            <div role="status" style={{ position: 'absolute', left: '50%', bottom: state.sync ? 68 : 20, transform: 'translateX(-50%)', zIndex: 7, display: 'inline-flex', alignItems: 'center', gap: 8, background: '#1F2430', color: '#FFFFFF', borderRadius: 999, padding: '10px 18px', fontSize: 13, boxShadow: '0 8px 24px rgba(20,24,32,0.25)', maxWidth: '90%' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>{state.notice}
            </div>
          )}
          {state.sync && (
            <div role="status" style={{ position: 'absolute', left: '50%', bottom: 20, transform: 'translateX(-50%)', zIndex: 7, display: 'inline-flex', alignItems: 'center', gap: 8, background: '#1F2430', color: '#FFFFFF', borderRadius: 999, padding: '10px 18px', fontSize: 13, boxShadow: '0 8px 24px rgba(20,24,32,0.25)', whiteSpace: 'nowrap' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>{state.sync}にも反映しました
            </div>
          )}
        </section>

        <div style={{ position: 'absolute', right: 24, bottom: 20, zIndex: 30 }}>
          <PetHelper context={pet.context} message={pet.message} items={pet.items} />
        </div>
      </div>
    </div>
  )
}
