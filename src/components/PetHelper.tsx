import { useRef, useState, type ReactNode } from 'react'
import { SurveyImport, type SurveyImportProps } from '../survey/SurveyImport.tsx'
import './PetHelper.css'

const menus = {
  revise: {
    icon: 'pencil',
    title: '書き方を相談する',
    description: '用紙の書き方や、入力した文章の表現をペットに相談できます。',
  },
  documents: {
    icon: 'file-earmark-plus',
    title: '書類を追加する',
    description: '認定調査票から、アセスメントに反映する候補を確認できます。',
  },
  interview: {
    icon: 'calendar-plus',
    title: '次の面談の準備をする',
    description: '次の面談に向けて、確認すべき質問項目やチェックポイントを整理してもらえます。',
  },
} as const

type Menu = keyof typeof menus
const menuKeys = ['revise', 'documents', 'interview'] satisfies Menu[]

const sampleTopics = [
  '住環境の詳細（段差・手すりの有無など）',
  '健康状態の変化（直近の体調・受診予定など）',
  'ご家族の支援体制（同居・訪問の頻度など）',
]

function Icon({ name }: { name: string }) {
  return <span className="assistant-icon" aria-hidden="true" style={{ maskImage: `url(/assistant/icons/${name}.svg)` }} />
}

function Pet() {
  return <img className="assistant-pet" src="/assistant/pet-cat.jpg" alt="" />
}

function AssistantMessage({ children }: { children: ReactNode }) {
  return <div className="assistant-message"><Pet /><p>{children}</p></div>
}

function InterviewMock() {
  return (
    <>
      <AssistantMessage>現在のフェースシートの内容をもとに、次の面談で確認しておきたい話題を整理しました。</AssistantMessage>
      <ul className="assistant-topics">
        {sampleTopics.map((topic, i) => (
          <li key={topic}>
            <span role="checkbox" aria-checked={i < 2} aria-disabled="true"><Icon name={i < 2 ? 'check-square-fill' : 'square'} />{topic}</span>
          </li>
        ))}
      </ul>
      <p className="assistant-note"><Icon name="info-circle" />チェックのON/OFFで、作成する質問リストの内容が変わります。</p>
      <AssistantMessage>この内容で質問リストを作成しますか？</AssistantMessage>
      <div className="assistant-message assistant-user-message"><p>はい、お願いします！</p><span className="assistant-user"><Icon name="person" /></span></div>
      <AssistantMessage>承知しました！<br />次の面談で使える質問リストを作成しました。</AssistantMessage>
      <div className="assistant-attachment">
        <Icon name="file-earmark-text" />
        <strong>次回面談の質問リスト.pdf</strong>
        <button className="assistant-outline" type="button" disabled><Icon name="eye" />プレビュー</button>
        <button className="assistant-icon-button" type="button" aria-label="質問リストをダウンロード" disabled><Icon name="download" /></button>
      </div>
      <div className="assistant-actions">
        <button className="assistant-outline" type="button" disabled><Icon name="pencil" />質問リストを編集</button>
        <button className="assistant-outline" type="button" disabled><Icon name="plus-circle" />面談メモの<br />テンプレートを作る</button>
      </div>
    </>
  )
}

export function PetHelper({ survey }: { survey?: SurveyImportProps }) {
  const [menu, setMenu] = useState<Menu | null>(null)
  const selected = menu ? menus[menu] : null
  const lastMenu = useRef<Menu | null>(null)
  const goBack = () => {
    lastMenu.current = menu
    setMenu(null)
  }

  return (
    <aside className="assistant-panel" aria-labelledby="assistant-title">
      {selected && (
        <header className="assistant-header">
          {menu === 'interview' && <button className="assistant-icon-button" type="button" aria-label="メニューに戻る" autoFocus onClick={goBack}><Icon name="chevron-left" /></button>}
          {menu === 'interview' ? <Icon name={selected.icon} /> : <Pet />}
          <h2 id="assistant-title">{menu === 'interview' ? selected.title : 'ペットに相談'}</h2>
        </header>
      )}
      <div className={selected ? "assistant-body" : "assistant-body assistant-home"} key={menu}>
        {selected ? (
          <>
            {menu !== 'interview' && (
              <div className="assistant-detail">
                <button className="assistant-icon-button" type="button" aria-label="メニューに戻る" autoFocus onClick={goBack}><Icon name="chevron-left" /></button>
                <span className="assistant-icon-tile"><Icon name={selected.icon} /></span>
                <h3>{selected.title}</h3>
                <p>{selected.description}</p>
              </div>
            )}
            {menu === 'documents' && (survey ? <SurveyImport key={survey.document.id} {...survey} />
              : <p>アセスメントを開くと、認定調査票を読み取れます。</p>)}
            {menu === 'interview' && <InterviewMock />}
            {menu === 'revise' && <textarea className="assistant-revision" aria-label="相談内容" placeholder="相談したい内容を入力…" disabled />}
          </>
        ) : (
          <>
            <div className="assistant-intro">
              <Pet />
              <h2 id="assistant-title">こんにちは！今日は何から一緒に進めましょうか？</h2>
            </div>
            <div className="assistant-menu">
              {menuKeys.map((key) => {
                const item = menus[key]
                return (
                  <button key={key} type="button" className="assistant-card" ref={(button) => {
                    if (button && lastMenu.current === key) {
                      button.focus()
                      lastMenu.current = null
                    }
                  }} onClick={() => setMenu(key)}>
                    <span className="assistant-icon-tile"><Icon name={item.icon} /></span>
                    <strong>{item.title}</strong>
                    <Icon name="chevron-right" />
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
