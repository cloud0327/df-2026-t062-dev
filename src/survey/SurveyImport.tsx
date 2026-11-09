import { useEffect, useRef, useState } from 'react'
import { fieldLabel } from '../components/petAssessment.ts'
import { PetIcon, PetMessage } from '../components/PetVisuals.tsx'
import type { SurveyPreview, SurveyStep } from './readSurvey.ts'

const documents = [
  { kind: 'survey', title: '認定調査票', description: '生活動作や介助の状況を記録した書類', icon: 'file-earmark-text' },
  { kind: 'opinion', title: '主治医意見書', description: '傷病の経過や医学的な注意点を記録した書類', icon: 'stethoscope' },
  { kind: 'nursing', title: '看護サマリー・退院時情報', description: '入院中の経過や医療処置などを引き継ぐ書類', icon: 'bed-double' },
] as const

const steps = [
  { id: 'prepare', label: 'ファイルの準備' },
  { id: 'read', label: '書類の読み取り' },
  { id: 'map', label: 'アセスメントへの候補生成' },
  { id: 'complete', label: '取り込み結果の確認' },
] as const

type ImportState =
  | { status: 'select' }
  | { status: 'reading', step: SurveyStep }
  | { status: 'complete', count: number, preview: SurveyPreview }
  | { status: 'failed', message: string }

interface Props {
  active: boolean
  available: boolean
  clientName: string
  onPreview: (preview: SurveyPreview) => number
  onIdentity: (sha256: string, confirmed: boolean) => void
  verifiedSources: ReadonlySet<string>
}

export function SurveyImport({ active, available, clientName, onPreview, onIdentity, verifiedSources }: Props) {
  const [files, setFiles] = useState<Partial<Record<typeof documents[number]['kind'], File>>>({})
  const [state, setState] = useState<ImportState>({ status: 'select' })
  const [sources, setSources] = useState<SurveyPreview[]>([])
  const surveyPicker = useRef<HTMLInputElement>(null)
  const request = useRef<AbortController | null>(null)
  const latestPreview = useRef(onPreview)
  latestPreview.current = onPreview
  useEffect(() => () => request.current?.abort(), [])
  useEffect(() => {
    if (available || !request.current) return
    request.current.abort()
    request.current = null
    setState({ status: 'select' })
  }, [available])

  const start = async () => {
    const file = files.survey
    if (!file || !available || request.current) return
    const controller = new AbortController()
    request.current = controller
    setState({ status: 'reading', step: 'prepare' })
    try {
      const { readSurvey } = await import('./readSurvey.ts')
      const preview = await readSurvey(file, controller.signal, (step) => setState({ status: 'reading', step }))
      controller.signal.throwIfAborted()
      const count = latestPreview.current(preview)
      setSources((previous) => [...previous.filter(({ sha256 }) => sha256 !== preview.sha256), preview])
      setState({ status: 'complete', count, preview })
    } catch (error) {
      if (!controller.signal.aborted) setState({ status: 'failed', message: error instanceof Error ? error.message : 'PDFを読み取れませんでした。' })
    } finally {
      if (request.current === controller) request.current = null
    }
  }

  const cancel = () => {
    request.current?.abort()
    request.current = null
    setState({ status: 'select' })
  }

  const selecting = state.status === 'select' || state.status === 'failed'
  if (selecting) return (
    <div hidden={!active} className="assistant-import">
      <PetMessage>アセスメントに反映する書類を取り込みましょう。</PetMessage>
      <div className="assistant-stack">
        {documents.map(({ kind, title, description, icon }) => {
          const selected = files[kind]
          const action = selected ? '選び直す' : 'ファイルを選択'
          return (
            <div className="assistant-file-card" key={kind} data-selected={!!selected}>
              <span className="assistant-icon-tile"><PetIcon name={icon} library={kind === 'survey' ? 'icons' : 'lucide'} /></span>
              <div>
                <strong>{kind === 'nursing' ? <>看護サマリー・<br />退院時情報</> : title}</strong>
                <small>{description}</small>
                {kind === 'survey' && <div className="assistant-file-selection" role="status">
                  {selected && <small className="assistant-file-status"><PetIcon name="check-circle-fill" />選択済み</small>}
                  {selected && <small className="assistant-filename" title={selected.name}>{selected.name}</small>}
                </div>}
              </div>
              <div className="assistant-file-actions">
                <label className="assistant-file-picker">
                  <input ref={kind === 'survey' ? surveyPicker : undefined} type="file" aria-label={`${title}のファイルを${selected ? '選び直す' : '選択'}`}
                    accept=".pdf,application/pdf" disabled={kind !== 'survey' || !available}
                    onChange={(e) => {
                      const file = e.currentTarget.files?.[0]
                      if (file) {
                        setFiles((previous) => ({ ...previous, [kind]: file }))
                        setState({ status: 'select' })
                      }
                      e.currentTarget.value = ''
                    }} />
                  <span aria-hidden="true"><PetIcon name="folder" />{action}</span>
                  {selected && <span className="assistant-file-picker-size" aria-hidden="true"><PetIcon name="folder" />ファイルを選択</span>}
                </label>
                {kind === 'survey' && <button type="button" className="assistant-file-clear" disabled={!selected} onClick={() => {
                  setFiles((previous) => ({ ...previous, [kind]: undefined }))
                  setState({ status: 'select' })
                  surveyPicker.current?.focus()
                }}>選択を解除</button>}
                {kind !== 'survey' && <small>準備中</small>}
              </div>
            </div>
          )
        })}
      </div>
      <div className="assistant-import-notes">
        <strong><PetIcon name="info-circle" />取り込みのポイント</strong>
        <p><PetIcon name="check2" />広島市版のテキスト付きPDF（10 MBまで）に対応しています</p>
      </div>
      {!available && <p>アセスメントを開くと取り込めます。</p>}
      {state.status === 'failed' && <p role="alert" className="assistant-error">{state.message}</p>}
      <button className="assistant-primary" type="button" disabled={!available || !files.survey} onClick={() => void start()}>
        <PetIcon name="upload" />読み取りを開始
      </button>
    </div>
  )

  const complete = state.status === 'complete'
  const index = complete ? steps.length : steps.findIndex(({ id }) => id === state.step)
  return (
    <div hidden={!active} className="assistant-import assistant-import-progress">
      <PetMessage>{complete ? '書類を読み取りました。黄色の候補は用紙で確認してください。' : <>書類を読み取っています。<br />完了までお待ちください。</>}</PetMessage>
      <div className="assistant-progress" aria-live="polite">
        <div className="assistant-progress-title">{complete ? <PetIcon name="check-circle-fill" /> : <span className="assistant-spinner" />}{complete ? '読み取りが完了しました' : '読み取り中…'}</div>
        {!complete && <progress aria-label="読み取りの進捗" />}
        <ol>
          {steps.map(({ id, label }, i) => (
            <li key={id} aria-current={i === index ? 'step' : undefined}>
              {i < index ? <PetIcon name="check-circle-fill" /> : <span className={i === index ? 'assistant-spinner' : 'assistant-step-waiting'} />}
              <strong>{label}</strong>
              {i < index ? <small>完了</small> : i === index ? <small>実行中</small> : null}
            </li>
          ))}
        </ol>
      </div>
      <div className="assistant-received">
        <strong>読み取り対象の書類</strong>
        <div className="assistant-received-row"><PetIcon name="file-earmark-text" /><strong>認定調査票</strong><small><PetIcon name="check2" />受け付け済み</small></div>
        {complete && [state.preview, ...sources.filter(({ sha256 }) => sha256 !== state.preview.sha256)].map((source) => (
          <details key={source.sha256} className="assistant-source">
            <summary>{source.fileName}</summary>
            <img src={source.identity} alt="認定調査票原本の調査日と対象者欄" />
            <p>調査日 {source.recordedOn ?? '不明'}</p>
            <label><input type="checkbox" checked={verifiedSources.has(source.sha256)}
              onChange={(e) => onIdentity(source.sha256, e.target.checked)} /> 原本が{clientName}さんのものだと確認した</label>
            {source.candidates.map(({ key, preview, note }) => (
              <details className="assistant-source-row" key={key}>
                <summary>{fieldLabel(key)}（原本 p.2）</summary>
                <img src={preview} alt={`${fieldLabel(key)}の選択欄`} />
                {note && <p>特記事項 p.3：{note}</p>}
              </details>
            ))}
            {source.sha256 === state.preview.sha256 && (
              <button className="assistant-new-import" type="button" onClick={() => { setFiles({}); setState({ status: 'select' }) }}>別の書類を選ぶ</button>
            )}
          </details>
        ))}
      </div>
      <div className="assistant-import-footer">
        {complete
          ? <p role="status"><PetIcon name="check-circle-fill" />取り込み完了（{state.count}か所を反映）</p>
          : <button type="button" onClick={cancel}><PetIcon name="x-lg" />取り込みを中止</button>}
      </div>
    </div>
  )
}
