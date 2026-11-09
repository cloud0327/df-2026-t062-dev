import { useEffect, useRef, useState } from 'react'
import { SurveyImport } from '../survey/SurveyImport.tsx'
import type { SurveyPreview } from '../survey/readSurvey.ts'
import { PetIcon, PetMessage } from './PetVisuals.tsx'
import { fieldLabel, type availableTopics, type ReviewItem } from './petAssessment.ts'
import './PetHelper.css'

const menus = [
  { id: 'documents', icon: 'file-earmark-arrow-down', title: '書類を取り込む' },
  { id: 'review', icon: 'check2-circle', title: '確認する' },
  { id: 'interview', icon: 'stars', title: '相談する' },
] as const

type Menu = typeof menus[number]['id']

interface Props {
  available: boolean
  clientName: string
  review: ReviewItem[]
  topics: ReturnType<typeof availableTopics>
  onJump: (key: string) => boolean
  onPreview: (preview: SurveyPreview) => number
  onIdentity: (sha256: string, confirmed: boolean) => void
  verifiedSources: ReadonlySet<string>
}

export function PetHelper({ available, clientName, review, topics, onJump, onPreview, onIdentity, verifiedSources }: Props) {
  const [menu, setMenu] = useState<Menu | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState('')
  const body = useRef<HTMLDivElement>(null)
  const back = useRef<HTMLButtonElement>(null)
  const previousMenu = useRef<Menu | null>(null)
  const menuButtons = useRef<Partial<Record<Menu, HTMLButtonElement | null>>>({})
  const pending = review.filter((item) => !item.confirmed).length

  useEffect(() => {
    body.current?.scrollTo(0, 0)
    if (menu) back.current?.focus({ preventScroll: true })
    else if (previousMenu.current) menuButtons.current[previousMenu.current]?.focus({ preventScroll: true })
  }, [menu])

  const open = (next: Menu | null) => {
    if (menu) previousMenu.current = menu
    setMenu(next)
    setError('')
    setConfirmed(false)
  }
  const jump = (key: string) => setError(onJump(key) ? '' : '用紙に対応する入力欄が見つかりませんでした。')

  return (
    <aside className="assistant-panel" aria-labelledby="assistant-title">
      <div ref={body} className={`assistant-body${menu ? '' : ' assistant-home'}`}>
        {menu && (
          <header className="assistant-header">
            <button ref={back} type="button" aria-label="メニューに戻る" onClick={() => open(null)}><PetIcon name="arrow-left" /></button>
            <h2 id="assistant-title">{menu === 'interview' ? '面談のヒント' : menus.find(({ id }) => id === menu)?.title}</h2>
          </header>
        )}
        {!menu && (
          <>
            <PetMessage home>今日は何から<br />一緒に進めましょうか？</PetMessage>
            <div className="assistant-stack assistant-menu">
              {menus.map(({ id, icon, title }) => (
                <button key={id} ref={(node) => { menuButtons.current[id] = node }} type="button" className="assistant-card" onClick={() => open(id)}>
                  <PetIcon name={icon} />
                  <span><strong>{title}</strong>{id === 'review' && <small>（未確認 {pending}件）</small>}</span>
                  <PetIcon name="chevron-right" />
                </button>
              ))}
            </div>
          </>
        )}
        <SurveyImport active={menu === 'documents'} available={available} clientName={clientName} onPreview={onPreview} onIdentity={onIdentity} verifiedSources={verifiedSources} />
        {menu === 'review' && (
          <>
            <PetMessage>未確認の項目が{pending}件あります。<br />項目を選ぶと、用紙の該当欄に移動します。</PetMessage>
            <div className="assistant-review-tabs" role="group" aria-label="確認状態">
              <button type="button" aria-pressed={!confirmed} onClick={() => { setConfirmed(false); setError('') }}>未確認（{pending}件）</button>
              <button type="button" aria-pressed={confirmed} onClick={() => { setConfirmed(true); setError('') }}><PetIcon name="check2" />確認済み（{review.length - pending}件）</button>
            </div>
            <ul className="assistant-stack">
              {review.filter((item) => item.confirmed === confirmed).map(({ key, value, reason }) => (
                <li key={key}><button type="button" className="assistant-card assistant-review-card" onClick={() => jump(key)}>
                  {confirmed ? <PetIcon name="check2" /> : <span className="assistant-review-dot" />}
                  <strong>{fieldLabel(key)}</strong>
                  <span>{value}{reason && <small>{reason}</small>}</span><PetIcon name="chevron-right" />
                </button></li>
              ))}
            </ul>
            {!review.some((item) => item.confirmed === confirmed) && <p className="assistant-empty">{confirmed ? '確認済みの項目はありません。' : '未確認の項目はありません。'}</p>}
          </>
        )}
        {menu === 'interview' && (
          <>
            <PetMessage>空白の項目を埋めるために、<br />面談で確認するとよい話題の例を提案します。</PetMessage>
            <ul className="assistant-stack">
              {topics.map(({ title, icon, description, keys }) => (
                <li key={title}>
                  <div className="assistant-card assistant-topic">
                    <PetIcon name={icon} /><div><h3>{title}</h3><small>{description}</small></div>
                  </div>
                  <ul className="assistant-topic-targets" aria-label={`${title}の入力欄`}>
                    {keys.map((key) => <li key={key}><button type="button" onClick={() => jump(key)}>{fieldLabel(key)}<PetIcon name="chevron-right" /></button></li>)}
                  </ul>
                </li>
              ))}
            </ul>
            {!topics.length && <p className="assistant-empty">{available ? '面談のヒントに対応する空欄はありません。' : 'アセスメントを開くと面談のヒントを表示します。'}</p>}
          </>
        )}
        {error && <p className="assistant-error" role="alert">{error}</p>}
      </div>
    </aside>
  )
}
