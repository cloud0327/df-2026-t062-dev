// iPad ②③ 用紙（キャンバス PadWork・PadRec）と、録音から用紙へ書く流れ A〜E（PadFlow1〜5）。
// iPad でできることは 2 つだけ: 録音するかしないか、用紙を書き換えるか。
import { useEffect, useRef, useState } from 'react'
import { FieldConflicts } from '../form/FieldConflicts.tsx'
import { FormPage } from '../form/FormPage.tsx'
import { useClient } from '../form/useClient.ts'
import { useDocument } from '../form/useDocument.ts'
import { useRecorder } from '../form/useRecorder.ts'
import { api } from '../lib/api.ts'
import { linkProps } from '../lib/router.tsx'
import { incompleteFieldNames } from '../lib/jobStatus.ts'
import { countText } from '../components/Chrome.tsx'
import { SyncDifferences } from '../components/SyncDifferences.tsx'

export function PadWork({ clientId }: { clientId: string }) {
  const [tab, setTab] = useState<'assessment' | 'admission'>('assessment')
  const reloadDoc = useRef<() => void>(() => {})
  const { client, jobs, reload: reloadClient, poll } = useClient(clientId, () => reloadDoc.current())
  const docId = client?.documents.find((d) => d.kind === tab)?.id
  const state = useDocument(docId)
  reloadDoc.current = () => { void state.reload(); void reloadClient() }
  const recorder = useRecorder(clientId, () => void poll())
  const [docOpen, setDocOpen] = useState(false)
  const [tocOpen, setTocOpen] = useState(false)
  const [cur, setCur] = useState(0)
  const [saved, setSaved] = useState(false)
  const [savedPages, setSavedPages] = useState<Set<number>>(new Set())
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const scroller = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => { setSaved(false); setSavedPages(new Set()); setCur(0) }, [docId])
  useEffect(() => { if (state.pendingCount) setSaved(false) }, [state.pendingCount])

  const isAdm = tab === 'admission'
  const pages = state.pages
  const doc = state.doc
  const job = jobs[0]
  const incompleteNames = job && (job.status === 'partial' || job.status === 'failed') ? incompleteFieldNames(job.incompleteFields) : []
  const running = job && (job.status === 'queued' || job.status === 'processing')
  const phase = recorder.phase === 'rec' ? 'rec'
    : recorder.phase === 'upload' ? 'upload'
      : running ? (job.step === 'apply' ? 'writing' : 'trans')
        : job && (job.status === 'succeeded' || job.status === 'partial') && !dismissed.has(job.id) && Date.now() - Date.parse(job.updatedAt) < 15 * 60 * 1000 ? 'done'
          : 'idle'
  const etaMin = job?.etaSeconds ? Math.max(1, Math.round((job.etaSeconds - (Date.now() - Date.parse(job.createdAt)) / 1000) / 60)) : 4

  const openDoc = async (form: 'assessment' | 'admission') => {
    setDocOpen(false)
    setTocOpen(false)
    if (form === 'admission' && !client?.documents.some((d) => d.kind === 'admission')) {
      await api.createAdmission(clientId)
      await reloadClient()
    }
    setTab(form)
  }

  const onScroll = () => {
    const el = scroller.current
    if (!el || isAdm) return
    const y = el.scrollTop + el.clientHeight * 0.3
    let idx = 0
    pageRefs.current.forEach((p, i) => { if (p && p.offsetTop - el.offsetTop <= y) idx = i })
    if (idx !== cur) setCur(idx)
  }
  const jump = (i: number) => {
    setTocOpen(false)
    const el = scroller.current, p = pageRefs.current[i]
    if (el && p) el.scrollTo({ top: p.offsetTop - el.offsetTop - 4 })
  }

  const menuItem = (on: boolean) => `toc${on ? ' toc-on' : ''}`
  const copied = doc?.batches.find((b) => b.kind === 'copy')?.changes ?? 0
  const batchLabel = doc?.batches[0]?.label ?? 'AI 書き込み'

  return (
    <div className="pad" style={{ width: '100%', height: '100dvh', boxSizing: 'border-box', overflow: 'hidden', fontFamily: "'Noto Sans JP',system-ui,sans-serif", color: '#1F2430', background: '#E9EBEF', fontSize: 16, lineHeight: 1.6, display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <header style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: '#FFFFFF', borderBottom: '1px solid #E1E4EA', position: 'relative', zIndex: 10 }}>
        <a className="tb" {...linkProps('/')} style={{ border: 0, padding: '10px 6px', color: '#2453C4', fontWeight: 500 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>利用者
        </a>
        <div style={{ fontSize: 19, fontWeight: 700, whiteSpace: 'nowrap' }}>{client ? `${client.name} さん` : ''}</div>
        <button type="button" onClick={() => { setDocOpen(!docOpen); setTocOpen(false) }} aria-expanded={docOpen} style={{ font: 'inherit', fontSize: 16, fontWeight: 700, minHeight: 46, padding: '6px 14px', border: '1px solid #CBD1DA', borderRadius: 10, background: '#F2F5FB', color: '#1F2430', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /></svg>
          {isAdm ? '入院時情報提供書' : 'アセスメント'}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
        </button>
        {!isAdm && (
          <button type="button" onClick={() => { setTocOpen(!tocOpen); setDocOpen(false) }} aria-expanded={tocOpen} style={{ font: 'inherit', fontSize: 16, fontWeight: 700, minHeight: 46, padding: '6px 14px', border: '1px solid #CBD1DA', borderRadius: 10, background: '#FFFFFF', color: '#1F2430', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
            <span style={{ color: '#5A6270', fontWeight: 500 }}>{cur + 1} / {pages.length || 11}</span>{pages[cur]?.title}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
          </button>
        )}
        {docOpen && (
          <div role="menu" style={{ position: 'absolute', left: 150, top: 64, width: 380, background: '#FFFFFF', borderRadius: 16, boxShadow: '0 12px 36px rgba(20,24,32,0.28)', padding: 8, display: 'flex', flexDirection: 'column', zIndex: 20 }}>
            <button className={menuItem(!isAdm)} role="menuitem" type="button" onClick={() => void openDoc('assessment')}>アセスメント</button>
            <button className={menuItem(isAdm)} role="menuitem" type="button" onClick={() => void openDoc('admission')}>入院時情報提供書</button>
            <div style={{ height: 1, background: '#E1E4EA', margin: '6px 8px' }} />
            <div style={{ fontSize: 13, color: '#5A6270', padding: '4px 14px' }}>書類を作る（{client?.name}さんの今の情報から AI が書き込みます）</div>
            {['モニタリング', 'デイの体験用紙'].map((t) => (
              <button key={t} className="toc" role="menuitem" type="button" onClick={() => setDocOpen(false)} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 0 }}>＋ {t}<span style={{ fontSize: 13, color: '#5A6270' }}>様式を登録すると作れます</span></button>
            ))}
          </div>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {saved && <span role="status" style={{ fontSize: 15, fontWeight: 500, color: '#1F49B0' }}>保存しました</span>}
          <button type="button" onClick={async () => { const ok = await state.saveDocument(); setSaved(ok); if (ok) setSavedPages(new Set(pages.map((p) => p.no))) }} disabled={phase === 'writing'} style={{ fontFamily: "'Noto Sans JP',sans-serif", fontSize: 16, fontWeight: 700, borderRadius: 12, padding: '0 18px', minHeight: 48, cursor: 'pointer', border: '1px solid #1C2229', background: '#1C2229', color: '#FFFFFF', whiteSpace: 'nowrap' }}>書類を保存</button>
        </div>
        {tocOpen && (
          <nav aria-label="ページ" style={{ position: 'absolute', left: 150, top: 64, width: 360, background: '#FFFFFF', borderRadius: 16, boxShadow: '0 12px 36px rgba(20,24,32,0.28)', padding: 8, display: 'flex', flexDirection: 'column' }}>
            {pages.map((p, i) => (
              <button key={p.no} type="button" className={menuItem(i === cur)} aria-current={i === cur} onClick={() => jump(i)}><span style={{ width: 26, color: '#5A6270', fontSize: 15 }}>{p.no}</span>{p.title}</button>
            ))}
          </nav>
        )}
      </header>

      {phase === 'rec' && (
        <div role="status" className="strip" style={{ justifyContent: 'center', padding: '6px 16px', background: '#D93A2B', color: '#FFFFFF', fontWeight: 700 }}><span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', background: '#FFFFFF' }} />録音中</div>
      )}
      {phase === 'upload' && (
        <div role="status" className="strip" style={{ background: '#8A4B00', color: '#FFFFFF' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: '0 0 auto' }}><path d="M12 16V4" /><path d="M7 9l5-5 5 5" /><path d="M5 20h14" /></svg>
          <div style={{ flex: '1 1 auto', minWidth: 0 }}><strong>録音を送っています　{recorder.pct}%</strong>　送り終わるまで、iPad を閉じないでください<div style={{ fontSize: 13, opacity: 0.9 }}>用紙はこのまま書けます</div></div>
          <div aria-hidden="true" style={{ flex: '0 0 120px', height: 8, borderRadius: 999, background: 'rgba(255,255,255,0.3)', overflow: 'hidden' }}><div style={{ height: 8, background: '#FFFFFF', width: `${recorder.pct}%` }} /></div>
        </div>
      )}
      {phase === 'trans' && (
        <div role="status" className="strip" style={{ background: '#2E3A55', color: '#FFFFFF' }}>
          <span className="spin" aria-hidden="true" />
          <div style={{ flex: '1 1 auto', minWidth: 0 }}><strong>文字起こしをしています（あと {etaMin} 分ほど）</strong>　iPad を閉じても大丈夫です<div style={{ fontSize: 13, opacity: 0.9 }}>用紙はこのまま書けます。あなたが書いたところは、AI が上書きしません</div></div>
        </div>
      )}
      {phase === 'done' && job && (
        <div role="status" className="strip" style={{ background: '#FFF4E5', borderBottom: '1px solid #F0C78A' }}>
          <span aria-hidden="true" style={{ flex: '0 0 auto', width: 28, height: 28, borderRadius: '50%', background: '#E8912D', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-10" /></svg></span>
          <div style={{ flex: '1 1 auto', minWidth: 0, fontSize: 16 }}><strong>{job.status === 'partial' ? `一部を処理できませんでした。用紙の ${job.batch?.changes ?? 0} か所を書きました。` : `録音から、用紙の ${job.batch?.changes ?? 0} か所を書きました。`}</strong><br /><span style={{ fontSize: 15, color: '#5C3A00' }}>{incompleteNames.length ? `AIが反映できなかった欄は赤枠です: ${incompleteNames.join('、')}` : job.status === 'partial' ? 'AI が反映できなかった欄があります。用紙を確認してください。' : `橙色が AI の書いたところです。${job.batch?.kept ? `あなたが先に書いた ${job.batch.kept} か所（黄色）は、そのままにしています。` : ''}`}</span></div>
          <button type="button" onClick={() => setDismissed((s) => new Set(s).add(job.id))} style={{ flex: '0 0 auto', font: 'inherit', fontSize: 15, fontWeight: 700, border: 0, background: 'transparent', color: '#874600', cursor: 'pointer', minHeight: 44, padding: '0 6px' }}>OK</button>
        </div>
      )}
      {job?.status === 'failed' && !dismissed.has(job.id) && (
        <div role="alert" className="strip" style={{ background: '#FDE8E7', color: '#A3261C' }}>
          <div style={{ flex: '1 1 auto' }}>{incompleteNames.length ? `AIが反映できなかった欄は赤枠です: ${incompleteNames.join('、')}。録音し直せます。` : 'AI 処理を完了できませんでした。録音は保存されています。担当者に確認してください。'}</div>
          <button type="button" onClick={() => setDismissed((s) => new Set(s).add(job.id))}>閉じる</button>
        </div>
      )}
      {recorder.phase === 'error' && (
        <div role="alert" className="strip" style={{ background: '#FDE8E7', color: '#A3261C' }}>
          <div style={{ flex: '1 1 auto' }}>{recorder.error}。録音は iPad に残っています。通信状態を確認して再試行してください。</div>
          <button type="button" onClick={recorder.retry} disabled={recorder.busy} className="tb">再試行</button>
          <button type="button" onClick={recorder.reset} style={{ font: 'inherit', fontSize: 15, fontWeight: 700, border: 0, background: 'transparent', color: '#A3261C', minHeight: 44 }}>閉じる</button>
        </div>
      )}

      <FieldConflicts state={state} />
      {state.error && <div role="alert" className="strip" style={{ background: '#FDE8E7', color: '#A3261C' }}>うまく送れませんでした（{state.error}）。</div>}
      {recorder.phase === 'rec' && recorder.storageWarning && (
        <div role="alert" className="strip" style={{ background: '#FFF4E5' }}>録音を端末に保存できていません。録音を止めるまで、この画面を開いたままにしてください。</div>
      )}
      <div ref={scroller} onScroll={onScroll} style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: '16px 16px 150px', position: 'relative' }}>
        {client?.documents.find((d) => d.kind === 'admission') && (
          <SyncDifferences targetId={client.documents.find((d) => d.kind === 'admission')!.id} refreshKey={state.doc} hasLocalEdits={state.hasLocalEdits} onApplied={() => { void state.reload(); setSaved(false) }} />
        )}
        {isAdm && doc && (
          <div role="status" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: '#FFF4E5', border: '1px solid #F0C78A', borderRadius: 12, padding: '12px 14px', fontSize: 15, lineHeight: 1.5, marginBottom: 12 }}>
            <span aria-hidden="true" style={{ flex: '0 0 auto', width: 24, height: 24, borderRadius: 7, background: '#1F2430', color: '#FFFFFF', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>AI</span>
            <div><strong>アセスメントから {copied} 欄を写しました（橙）。</strong>氏名・住所などはアセスメントと同じ値です。どちらかで直すと、もう片方にも入ります。</div>
          </div>
        )}
        {doc && pages.map((p, i) => {
          const c = state.counts.get(p.no) ?? { ai: 0, hand: 0 }
          const dirty = !!(c.ai || c.hand)
          return (
            <div key={`${doc.id}-${p.no}`} className="pwrap" ref={(el) => { pageRefs.current[i] = el }}>
              <div className="plabel" style={{ justifyContent: 'space-between', gap: 8 }}>
                <span>{isAdm ? p.title : `${p.no} ・ ${p.title}`}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14, color: '#5B6672' }}>{dirty ? countText(c) : savedPages.has(p.no) ? '保存しました' : ''}</span>
                  <button type="button" className="pgsave" disabled={!dirty || phase === 'writing'} onClick={async () => { if (!await state.savePage(p.no)) return; setSavedPages((s) => new Set(s).add(p.no)) }} style={dirty ? undefined : { opacity: 0.35, cursor: 'default' }}>このページを保存</button>
                </span>
              </div>
              <FormPage page={p} state={state} touch disabled={phase === 'writing'} batchLabel={batchLabel} glow={phase === 'done'} incompleteFields={incompleteNames.length ? job?.incompleteFields : undefined} />
            </div>
          )
        })}
        {phase === 'writing' && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 4, background: 'rgba(255,255,255,0.72)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '26vh' }}>
            <div role="status" style={{ width: 460, maxWidth: '88%', background: '#FFFFFF', borderRadius: 18, boxShadow: '0 12px 36px rgba(20,24,32,0.22)', padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 12, position: 'sticky', top: '26vh' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><span className="spin spin-b" aria-hidden="true" /><span style={{ fontSize: 19, fontWeight: 700 }}>AI が用紙に書き込んでいます</span></div>
              <div aria-hidden="true" style={{ height: 6, borderRadius: 999, background: '#E3E8F4', overflow: 'hidden' }}><div style={{ width: '40%', height: 6, borderRadius: 999, background: '#2453C4', animation: 'bar 1.4s ease-in-out infinite' }} /></div>
              <div style={{ fontSize: 15, color: '#3F4652' }}>30 秒ほどで終わります。終わるまで、用紙は書けません。iPad を閉じても大丈夫です。</div>
            </div>
          </div>
        )}
      </div>

      {state.notice && (
        <div role="status" style={{ position: 'absolute', left: '50%', bottom: state.sync ? 170 : 118, transform: 'translateX(-50%)', zIndex: 8, display: 'inline-flex', alignItems: 'center', gap: 8, background: '#1F2430', color: '#FFFFFF', borderRadius: 999, padding: '10px 18px', fontSize: 15, boxShadow: '0 8px 24px rgba(20,24,32,0.25)', maxWidth: '90%' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>{state.notice}
        </div>
      )}
      {state.sync && (
        <div role="status" style={{ position: 'absolute', left: '50%', bottom: 118, transform: 'translateX(-50%)', zIndex: 8, display: 'inline-flex', alignItems: 'center', gap: 8, background: '#1F2430', color: '#FFFFFF', borderRadius: 999, padding: '10px 18px', fontSize: 15, boxShadow: '0 8px 24px rgba(20,24,32,0.25)', whiteSpace: 'nowrap' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>{state.sync}にも反映しました
        </div>
      )}

      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, pointerEvents: 'none' }}>
        {phase === 'rec' ? (
          <>
            <span className="hint"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /></svg>止めると、AI がこの用紙に書きます</span>
            <button type="button" onClick={() => void recorder.stop()} className="pill" style={{ pointerEvents: 'auto', border: 0, background: '#D93A2B', color: '#FFFFFF', cursor: 'pointer', boxShadow: '0 8px 24px rgba(217,58,43,0.35)' }}><span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: 3, background: '#FFFFFF' }} />止める<span style={{ fontWeight: 500, fontSize: 18, opacity: 0.9 }}>{recorder.elapsed}</span></button>
          </>
        ) : phase === 'idle' || phase === 'done' ? (
          <button type="button" onClick={() => { void recorder.start(); setTab('assessment') }} disabled={!docId} className="pill" style={{ pointerEvents: 'auto', border: '1px solid #CBD1DA', background: '#FFFFFF', color: '#1F2430', cursor: 'pointer', boxShadow: '0 8px 24px rgba(20,24,32,0.20)' }}><span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: '50%', background: '#E5483A' }} />録音する</button>
        ) : null}
      </div>
    </div>
  )
}
