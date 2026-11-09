// 「書き方を相談する」: ペット（道具を使うエージェント）に書き方を相談する。したこと（作業ログ）を 1 行ずつ出す。書き換えの案は差分のカードで出し、押したときだけ用紙に入れる。
import { useLayoutEffect, useRef, useState, type Dispatch, type FormEvent, type KeyboardEvent, type SetStateAction } from 'react'
import { api } from '../lib/api.ts'
import { PetIcon, PetMessage } from './PetVisuals.tsx'
import { cardAction, historyFor, sentenceChanges, type ChatEntry, type ProposalCard } from './petChat.ts'

interface Props {
  documentId: string | undefined
  entries: ChatEntry[]
  setEntries: Dispatch<SetStateAction<ChatEntry[]>>
  /** 用紙の今の値（画面で直したばかりの値を含む） */
  current: Record<string, unknown>
  onSet: (key: string, value: string | null, mode: 'edit' | 'revert') => void
  /** 用紙のその欄へ移る。移れない書類では undefined */
  onJump?: (key: string) => void
}

let nextId = 1

function DiffLines({ before, after }: { before: string | null, after: string }) {
  const { del, ins } = sentenceChanges(before, after)
  return (
    <>
      {del.map((t, i) => <p key={`d${i}`} className="assistant-chat-del"><span aria-label="消える文">−</span>{t}</p>)}
      {ins.map((t, i) => <p key={`i${i}`} className="assistant-chat-ins"><span aria-label="足す文">＋</span>{t}</p>)}
    </>
  )
}

export function PetChat({ documentId, entries, setEntries, current, onSet, onJump }: Props) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [stale, setStale] = useState<Set<string>>(new Set())
  const root = useRef<HTMLDivElement>(null)
  const activeDoc = useRef(documentId)
  activeDoc.current = documentId

  // 送ったとき・答えが来たときは、ペット欄をいちばん下まで送る（入力欄は下に固定なので、最新の吹き出しがその上に見える）。
  // scrollIntoView は外側の枠まで動かし、吹き出しが入力欄の裏に隠れるので使わない
  useLayoutEffect(() => {
    const box = root.current?.closest('.assistant-body')
    if (box) box.scrollTop = box.scrollHeight
  }, [entries.length, busy, error])

  const send = async (e?: FormEvent) => {
    e?.preventDefault()
    const question = text.trim()
    if (!question || busy || !documentId) return
    const asked: ChatEntry = { id: nextId++, role: 'user', text: question }
    const history = historyFor([...entries, asked])
    setEntries((prev) => [...prev, asked])
    setText('')
    setError('')
    setBusy(true)
    try {
      const r = await api.chat(documentId, history)
      if (activeDoc.current !== documentId) return
      setEntries((prev) => [...prev, { id: nextId++, role: 'pet', text: r.reply, steps: r.steps, proposals: r.proposals.map((p) => ({ ...p, state: 'ready' })) }])
    } catch {
      if (activeDoc.current !== documentId) return
      // 送れなかった相談は入力欄に戻す
      setEntries((prev) => prev.filter((x) => x.id !== asked.id))
      setText(question)
      setError('ペットに相談できませんでした。少し待ってから、もう一度送ってください。')
    } finally {
      if (activeDoc.current === documentId) setBusy(false)
    }
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // 日本語の変換中の Enter は送らない。送るのは Ctrl／⌘＋Enter
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) void send()
  }

  const press = (entryId: number, card: ProposalCard) => {
    const id = `${entryId}:${card.key}`
    const a = cardAction(card, current[card.key])
    if (a.kind === 'stale') {
      setStale((prev) => new Set(prev).add(id))
      return
    }
    onSet(card.key, a.value, card.state === 'ready' ? 'edit' : 'revert')
    setStale((prev) => { const next = new Set(prev); next.delete(id); return next })
    setEntries((prev) => prev.map((x) => (x.id !== entryId ? x : { ...x, proposals: x.proposals?.map((p) => (p.key === card.key ? { ...p, state: a.next } : p)) })))
  }

  return (
    <div ref={root} className="assistant-chat">
      <PetMessage>用紙の書き方や、文章の表現を相談できます。<br />直してほしいときは「相談内容を短くして」のように書いてください。</PetMessage>
      <ol className="assistant-chat-log" aria-live="polite">
        {entries.map((m) => (
          <li key={m.id} className={`assistant-chat-row assistant-chat-${m.role}`}>
            {!!m.steps?.length && (
              <ul className="assistant-chat-steps" aria-label="ペットがしたこと">
                {m.steps.map((s, i) => <li key={i}><PetIcon name="check2" />{s}</li>)}
              </ul>
            )}
            <p className="assistant-chat-bubble">{m.text}</p>
            {m.proposals?.map((card) => {
              const id = `${m.id}:${card.key}`
              return (
                <div key={card.key} className="assistant-chat-card" data-state={card.state}>
                  {onJump
                    ? <button type="button" className="assistant-chat-field" onClick={() => onJump(card.key)}>{card.label}<PetIcon name="chevron-right" /></button>
                    : <strong className="assistant-chat-field">{card.label}</strong>}
                  <DiffLines before={card.before} after={card.after} />
                  <div className="assistant-chat-actions">
                    {card.state === 'ready'
                      ? <button type="button" className="assistant-chat-apply" onClick={() => press(m.id, card)}><PetIcon name="pencil" />用紙に入れる</button>
                      : <>
                        <span className="assistant-chat-done"><PetIcon name="check2" />入れました</span>
                        <button type="button" className="assistant-chat-undo" onClick={() => press(m.id, card)}>戻す</button>
                      </>}
                  </div>
                  {stale.has(id) && <p className="assistant-error" role="alert">{card.state === 'ready' ? '案を出したあとに、この欄が直されています。もう一度相談してください。' : '入れたあとに、この欄が直されているので戻せません。用紙で直してください。'}</p>}
                </div>
              )
            })}
          </li>
        ))}
        {busy && <li className="assistant-chat-row assistant-chat-pet"><p className="assistant-chat-bubble assistant-chat-thinking"><span className="assistant-spinner" aria-hidden="true" />考えています…</p></li>}
      </ol>
      {error && <p className="assistant-error" role="alert">{error}</p>}
      <form className="assistant-chat-form" onSubmit={send}>
        <textarea className="assistant-revision" aria-label="相談内容" placeholder={documentId ? '相談したい内容を入力…（Ctrl＋Enter で送る）' : '用紙を開くと相談できます'}
          value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} disabled={!documentId} maxLength={4000} rows={3} />
        <button type="submit" className="assistant-primary" disabled={!documentId || busy || !text.trim()}>送る</button>
      </form>
    </div>
  )
}
