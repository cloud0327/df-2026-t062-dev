// 「書き方を相談する」のエージェント。AI（Gemini の関数呼び出し）が道具を選んで使い、ケアマネの相談に答える。
// 道具: 用紙を読む（read_form）、足りない欄（missing_fields）、録音を探す（search_records）、書き換えの案（propose_edit）。
// 案は返すだけで、用紙は変えない（ケアマネが画面で「用紙に入れる」を押したときに PATCH /fields で入る）。
// 保存・PDF・外に送る道具は持たせない。指示文・答え・用紙の値はログに出さない。
import { BY_KEY, FIELD_LIST, type FieldSpec } from '../core/fields.ts'
import type { FormKind } from '../core/form.ts'
import { missingRequiredKeys } from '../core/required.ts'
import { validValue } from '../core/schema.ts'
import { PLACEMENT_RULES } from '../worker/vertex/prompts.ts'

export interface ChatMessage { role: 'user' | 'pet', text: string }
export interface ChatProposal { key: string, label: string, before: string | null, after: string }
/** steps は AI が使った道具の作業ログ（1 行ずつ） */
export interface ChatReply { reply: string, steps: string[], proposals: ChatProposal[] }

/** 道具が読む書類の中身（DocumentView の一部） */
export interface ChatDocument { kind: FormKind, fields: Record<string, { value: unknown, by: string }> }
export interface ChatRecording { recordedAt: string, utterances: { id: string, speaker: string, person?: string | null, text: string }[] }

// Gemini の会話の形（@google/genai の Content・Part の一部）。モデルの部品は thoughtSignature ごと次の呼び出しに返す
export interface Part {
  text?: string
  thought?: boolean
  thoughtSignature?: string
  functionCall?: { id?: string, name?: string, args?: Record<string, unknown> }
  functionResponse?: { id?: string, name: string, response: Record<string, unknown> }
}
export interface Content { role: 'user' | 'model', parts: Part[] }
export interface ToolDecl { name: string, description: string, parametersJsonSchema: unknown }
/** 1 回の呼び出し。答えの部品（文か道具の呼び出し）を返す。テストと fake では差し替える */
export type ChatModel = (req: { system: string, contents: Content[], tools: ToolDecl[] }) => Promise<Part[]>

/** 1 回の相談で Gemini を呼ぶ上限（道具を呼び続けたら止める） */
export const MAX_CALLS = 6

const FORM_KEY: Record<FormKind, string> = { assessment: 'assess', admission: 'adm' }
const TEXT_TYPES = new Set(['text', 'longtext'])
const MAX_HITS = 40

const formFields = (kind: FormKind) => FIELD_LIST.filter((f) => f.forms?.[FORM_KEY[kind]])
const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
const terms = (q: unknown) => String(q ?? '').split(/[\s、,，]+/).map((t) => t.trim()).filter(Boolean)
const matches = (text: string, ts: string[]) => ts.some((t) => text.includes(t))

export const TOOLS: ToolDecl[] = [
  {
    name: 'read_form',
    description: '開いている書類の用紙を読む。値のある欄（key・名前・型・値）と、まだ空の文章の欄を返す。query に語を入れると、欄の名前か key にその語を含む欄だけにする（空白で区切るとどれか）',
    parametersJsonSchema: { type: 'object', properties: { query: { type: 'string', description: '欄の名前の一部（例: 入浴、相談内容）。全部読むときは空' } } },
  },
  {
    name: 'missing_fields',
    description: 'この書類の必須の欄のうち、まだ空の欄を返す。how は埋め方（面談で聞く／書類から）',
    parametersJsonSchema: { type: 'object', properties: {} },
  },
  {
    name: 'search_records',
    description: 'この利用者の録音の文字起こしから、語を含む発言を探す（空白で区切るとどれか）。発言の id・日付・話した人・文を返す',
    parametersJsonSchema: { type: 'object', properties: { query: { type: 'string', description: '探す語（例: 畑 浴室）' } }, required: ['query'] },
  },
  {
    name: 'propose_edit',
    description: '文章の欄の書き換えの案を、ケアマネに出す。用紙には入らない（ケアマネが画面で「用紙に入れる」を押すと入る）。value はその欄の新しい文章の全体。通らない案は ok:false と理由を返す',
    parametersJsonSchema: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' } }, required: ['key', 'value'] },
  },
]

export function chatSystem(kind: FormKind): string {
  const form = kind === 'admission' ? '入院時情報提供書' : 'アセスメント'
  return `あなたは、ケアマネジャーが${form}の用紙を書くのを手伝う係（画面の「ペット」）です。道具を使って調べてから、短く、やさしい言葉で答えてください。

## 道具の使い方
1. 利用者のことや用紙の中身を聞かれたら、read_form（用紙）や search_records（録音）で確かめてから答える。道具で見つからないことは「用紙にも録音にも出ていません」と答え、推測で埋めない。
2. 欄を書いて・直して・短くしてなどと頼まれたら、read_form でその欄の今の値を読み、必要なら search_records で根拠を探してから、propose_edit で案を出す。value はその欄の新しい文章の全体（一部だけにしない）。頼まれていないのに案を出さない。
3. 足りないところ・埋まっていない欄を聞かれたら、missing_fields を使う。埋め方（面談で聞く／書類から）ごとにまとめて答える。
4. あなたは用紙に直接は書けない。出した案は、ケアマネが画面の「用紙に入れる」を押したときに入る。保存・PDF・外に送ることもできないので、頼まれたら画面のボタンで行うよう伝える。

## 書き方
- 文章は、要点を短い文にして「。」でつなぐ。本人・家族の思いや専門職の見立てなど、誰の話かで意味が変わるものは、誰の話か分かるように書く（例:「左側に残渣あり（ST）」）。
- 答えは 300 字くらいまで。案を出したときは、何をどう変えたかを 1〜2 文で書く。

## 欄の置き場所の決まり
${PLACEMENT_RULES}`
}

const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v))

function readForm(doc: ChatDocument, query: unknown) {
  const ts = terms(query)
  const pick = (f: FieldSpec) => !ts.length || matches(`${f.label} ${f.key}`, ts)
  const filled: { key: string, label: string, type: string, value: string }[] = []
  const emptyText: { key: string, label: string, note?: string }[] = []
  for (const f of formFields(doc.kind)) {
    if (!pick(f)) continue
    const v = doc.fields[f.key]?.value
    if (!isEmpty(v)) filled.push({ key: f.key, label: f.label, type: f.type, value: show(v) })
    else if (TEXT_TYPES.has(f.type)) emptyText.push({ key: f.key, label: f.label, ...(f.note ? { note: f.note } : {}) })
  }
  return { filled, emptyText }
}

function missingFields(doc: ChatDocument) {
  if (doc.kind !== 'assessment') return { missing: [] }
  const values = Object.fromEntries(Object.entries(doc.fields).map(([k, f]) => [k, f.value]))
  const missing = missingRequiredKeys(values)
  return {
    missing: formFields(doc.kind).filter((f) => missing.has(f.key)).map((f) => {
      const src = f.source ?? []
      return { key: f.key, label: f.label, how: src.length && src.every((s) => s.startsWith('doc')) ? '書類から' : '面談で聞く' }
    }),
  }
}

function searchRecords(recordings: ChatRecording[], query: unknown) {
  if (!recordings.length) return { recordings: 0, hits: [] }
  const ts = terms(query)
  const all = recordings.flatMap((r) => r.utterances.map((u) => ({ id: u.id, date: r.recordedAt.slice(0, 10), speaker: u.person ?? u.speaker, text: u.text })))
  const found = ts.length ? all.filter((u) => matches(u.text, ts)) : []
  return { recordings: recordings.length, total: found.length, hits: found.slice(0, MAX_HITS) }
}

/** 書き換えの案を確かめる。通れば案、通らなければ理由（欄の名前つき） */
function checkProposal(doc: ChatDocument, key: unknown, value: unknown): ChatProposal | string {
  const f = typeof key === 'string' ? BY_KEY.get(key) : undefined
  if (!f) return `${String(key)}（その欄はありません）`
  if (!f.forms?.[FORM_KEY[doc.kind]]) return `${f.label}（この書類にない欄です）`
  if (!TEXT_TYPES.has(f.type)) return `${f.label}（文章の欄ではありません）`
  const after = typeof value === 'string' ? value.trim() : ''
  if (!after || !validValue(f.key, after)) return `${f.label}（文が空です）`
  const cur = doc.fields[f.key]?.value ?? null
  if (cur !== null && typeof cur !== 'string') return `${f.label}（今の値が文章ではありません）`
  if (cur === after) return `${f.label}（今の値と同じです）`
  return { key: f.key, label: f.label, before: cur, after }
}

/** 書き換えの案のうち、通るものだけを残す（同じ欄は先の案） */
export function acceptProposals(raw: unknown, doc: ChatDocument): ChatProposal[] {
  if (!Array.isArray(raw)) return []
  const out: ChatProposal[] = []
  for (const p of raw) {
    const r = checkProposal(doc, (p as { key?: unknown })?.key, (p as { value?: unknown })?.value)
    if (typeof r !== 'string' && !out.some((x) => x.key === r.key)) out.push(r)
  }
  return out
}

const STOPPED = 'ごめんなさい、調べている途中で止まりました。聞きたいことを短くして、もう一度相談してください。'
const FALLBACK = 'うまく答えられませんでした。言い方を変えて、もう一度聞いてください。'

export async function runChat({ model, document, recordings, messages }: {
  model: ChatModel, document: ChatDocument, recordings: ChatRecording[], messages: ChatMessage[]
}): Promise<ChatReply> {
  const system = chatSystem(document.kind)
  const contents: Content[] = messages.map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] }))
  const steps: string[] = []
  const proposals = new Map<string, ChatProposal>()
  const result = (reply: string): ChatReply => ({ reply, steps, proposals: [...proposals.values()] })

  for (let n = 0; n < MAX_CALLS; n++) {
    const parts = await model({ system, contents, tools: TOOLS })
    const calls = parts.filter((p) => p.functionCall?.name)
    if (!calls.length) {
      const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim()
      return result(text || FALLBACK)
    }
    contents.push({ role: 'model', parts })
    const responses: Part[] = []
    for (const p of calls) {
      const { id, name, args = {} } = p.functionCall!
      let response: Record<string, unknown>
      if (name === 'read_form') {
        response = readForm(document, args.query)
        steps.push(terms(args.query).length ? `用紙を読みました（「${String(args.query).trim()}」）` : '用紙を読みました')
      } else if (name === 'missing_fields') {
        response = missingFields(document)
        steps.push(`足りない欄を調べました（${(response.missing as unknown[]).length} 欄）`)
      } else if (name === 'search_records') {
        response = searchRecords(recordings, args.query)
        steps.push(`録音を探しました「${String(args.query ?? '').trim()}」（${(response.total as number | undefined) ?? 0} 件）`)
      } else if (name === 'propose_edit') {
        const r = checkProposal(document, args.key, args.value)
        if (typeof r === 'string') {
          response = { ok: false, reason: r }
          steps.push(`案を作れませんでした：${r}`)
        } else {
          proposals.set(r.key, r)
          response = { ok: true, message: '案をケアマネの画面に出しました。まだ用紙には入っていません' }
          steps.push(`書き換えの案を作りました：${r.label}`)
        }
      } else {
        response = { error: `${String(name)} という道具はありません` }
      }
      responses.push({ functionResponse: { ...(id ? { id } : {}), name: name!, response } })
    }
    contents.push({ role: 'user', parts: responses })
  }
  return result(STOPPED)
}

/** AI_PROVIDER=fake: 費用をかけずに画面を試す偽の Gemini。「直して」なら用紙を読んで案を出し、「足りない」なら足りない欄を調べる */
export const fakeModel: ChatModel = async ({ contents }) => {
  const last = contents.at(-1)!
  const res = last.parts.find((p) => p.functionResponse)?.functionResponse
  if (!res) {
    const text = last.parts.map((p) => p.text ?? '').join('')
    if (/直して|書き換え|書いて|短く/.test(text)) return [{ functionCall: { name: 'read_form', args: {} } }]
    if (/足りない/.test(text)) return [{ functionCall: { name: 'missing_fields', args: {} } }]
    return [{ text: '（試しの答えです）用紙の書き方について、聞きたい欄の名前を入れて相談してください。' }]
  }
  if (res.name === 'read_form') {
    const target = (res.response.filled as { key: string, type: string, value: string }[]).find((f) => f.type === 'longtext')
    if (!target) return [{ text: '（試しの答えです）書き換えられる文章の欄がまだありません。' }]
    return [{ functionCall: { name: 'propose_edit', args: { key: target.key, value: `${target.value.trim()}（試しの書き換え）` } } }]
  }
  if (res.name === 'missing_fields') return [{ text: `（試しの答えです）必須の空欄は ${(res.response.missing as unknown[]).length} 欄です。` }]
  return [{ text: '（試しの答えです）書き換えの案を出しました。' }]
}
