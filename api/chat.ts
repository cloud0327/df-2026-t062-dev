// 「書き方を相談する」のチャット。ケアマネの相談に、今の用紙の値と録音の文字起こしを読んで答える。
// 書き換えの案は返すだけで、用紙は変えない（ケアマネが画面で「用紙に入れる」を押したときに PATCH /fields で入る）。
// 指示文・答え・用紙の値はログに出さない（Gemini の呼び出しのログは段・回数・トークン数だけ）。
import { BY_KEY, FIELD_LIST, type FieldSpec } from '../core/fields.ts'
import type { FormKind } from '../core/form.ts'
import { validValue } from '../core/schema.ts'
import { PLACEMENT_RULES } from '../worker/vertex/prompts.ts'

export interface ChatMessage { role: 'user' | 'pet', text: string }
export interface ChatProposal { key: string, label: string, before: string | null, after: string }
export interface ChatReply { reply: string, proposals: ChatProposal[] }

/** 指示文に使う書類の中身（DocumentView の一部） */
export interface ChatDocument { kind: FormKind, fields: Record<string, { value: unknown, by: string }> }
export interface ChatRecording { recordedAt: string, utterances: { id: string, speaker: string, person?: string | null, text: string }[] }

export interface ChatInput { document: ChatDocument, recordings: ChatRecording[], messages: ChatMessage[] }
/** Gemini への 1 回の問い（JSON で答える）。fake は input を見て決まった答えを返す */
export type ChatAsk = (prompt: string, schema: unknown, input: ChatInput) => Promise<unknown>

const FORM_KEY: Record<FormKind, string> = { assessment: 'assess', admission: 'adm' }
const TEXT_TYPES = new Set(['text', 'longtext'])
/** 文字起こしは新しい録音から、この文字数まで入れる（1 回の費用を抑える。約 13 万トークン） */
const RECORD_CHARS = 200_000

const formFields = (kind: FormKind) => FIELD_LIST.filter((f) => f.forms?.[FORM_KEY[kind]])
const writable = (f: FieldSpec | undefined, kind: FormKind): f is FieldSpec => !!f && TEXT_TYPES.has(f.type) && !!f.forms?.[FORM_KEY[kind]]
const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
const show = (v: unknown) => (typeof v === 'string' ? v.replace(/\n/g, ' ') : JSON.stringify(v))

function fmtSheet(doc: ChatDocument): string {
  const filled: string[] = []
  const empty: string[] = []
  for (const f of formFields(doc.kind)) {
    const v = doc.fields[f.key]?.value
    if (!isEmpty(v)) filled.push(`- ${f.key}（${f.label}）: ${show(v)}`)
    else if (TEXT_TYPES.has(f.type)) empty.push(`- ${f.key}（${f.label}）${f.note ? ` 注: ${f.note}` : ''}`)
  }
  return [
    '### 値のある欄',
    filled.length ? filled.join('\n') : '（まだありません）',
    '### 空の文章の欄（書き換えの案で書ける）',
    empty.length ? empty.join('\n') : '（ありません）',
  ].join('\n')
}

function fmtRecord(recordings: ChatRecording[]): string {
  const blocks: string[] = []
  let left = RECORD_CHARS
  for (let i = recordings.length - 1; i >= 0 && left > 0; i--) {
    const r = recordings[i]
    const lines = r.utterances.map((u) => `[${u.id}] ${u.person ?? u.speaker}: ${u.text}`)
    const text = [`### ${r.recordedAt.slice(0, 10)} の録音`, ...lines].join('\n')
    blocks.unshift(text.length > left ? text.slice(text.length - left) : text)
    left -= text.length
  }
  return blocks.length ? blocks.join('\n\n') : '（録音はまだありません）'
}

const fmtMessages = (messages: ChatMessage[]) => messages.map((m) => `${m.role === 'user' ? 'ケアマネ' : 'ペット'}: ${m.text}`).join('\n')

export function chatPrompt({ document, recordings, messages }: ChatInput): string {
  const form = document.kind === 'admission' ? '入院時情報提供書' : 'アセスメント'
  return `あなたは、ケアマネジャーが${form}の用紙を書くのを手伝う係（画面の「ペット」）です。ケアマネの相談に、短く、やさしい言葉で答えてください。

## 答え方
1. 用紙の書き方（どの欄に何を書くか、文章の表現）と、利用者の情報についての問いに答える。
2. 利用者のことは、下の「用紙の今の値」と「録音の文字起こし」に書いてあることだけを根拠にする。書いていないことは「録音には出ていません」と答え、推測で埋めない。
3. ケアマネが欄を書き換えてほしい・書いてほしいと頼んだときだけ、proposals に案を入れる。key は下の一覧にある文章の欄の key をそのまま使い、value にはその欄の新しい文章の全体を入れる（一部だけにしない）。頼まれていないときは proposals を空にする。
4. 文章は、要点を短い文にして「。」でつなぐ。本人・家族の思いや専門職の見立てなど、誰の話かで意味が変わるものは、誰の話か分かるように書く（例:「左側に残渣あり（ST）」）。
5. 用紙を保存する、PDF を出す、外に送ることはできない。頼まれたら、画面のボタンで行うよう伝える。
6. reply は 300 字くらいまで。案を出したときは、何をどう変えたかを reply に 1〜2 文で書く。

## 欄の置き場所の決まり
${PLACEMENT_RULES}

## 用紙の今の値
${fmtSheet(document)}

## 録音の文字起こし
${fmtRecord(recordings)}

## これまでのやり取り（最後がケアマネの今の相談）
${fmtMessages(messages)}

JSON で答えてください。`
}

export const CHAT_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    proposals: {
      type: 'array',
      items: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' } }, required: ['key', 'value'] },
    },
  },
  required: ['reply', 'proposals'],
}

/** 書き換えの案のうち、この書類の文章の欄で、値の形が合い、今の値と違うものだけを残す（同じ欄は先の案） */
export function acceptProposals(raw: unknown, doc: ChatDocument): ChatProposal[] {
  if (!Array.isArray(raw)) return []
  const out: ChatProposal[] = []
  const seen = new Set<string>()
  for (const p of raw) {
    const key = (p as { key?: unknown })?.key
    const value = (p as { value?: unknown })?.value
    if (typeof key !== 'string' || typeof value !== 'string' || seen.has(key)) continue
    const f = BY_KEY.get(key)
    if (!writable(f, doc.kind)) continue
    const after = value.trim()
    if (!after || !validValue(key, after)) continue
    const cur = doc.fields[key]?.value ?? null
    if (cur !== null && typeof cur !== 'string') continue
    if (cur === after) continue
    seen.add(key)
    out.push({ key, label: f.label, before: cur, after })
  }
  return out
}

const FALLBACK = 'うまく答えられませんでした。言い方を変えて、もう一度聞いてください。'

export async function answerChat({ ask, ...input }: ChatInput & { ask: ChatAsk }): Promise<ChatReply> {
  const raw = await ask(chatPrompt(input), CHAT_SCHEMA, input) as { reply?: unknown, proposals?: unknown } | null
  const reply = typeof raw?.reply === 'string' && raw.reply.trim() ? raw.reply.trim() : FALLBACK
  return { reply, proposals: acceptProposals(raw?.proposals, input.document) }
}

/** AI_PROVIDER=fake: 費用をかけずに画面を試す答え。「直して」「書き換え」と頼まれたら、値のある最初の文章の欄に案を出す */
export const fakeChat: ChatAsk = async (_prompt, _schema, { document, messages }) => {
  const last = messages[messages.length - 1]?.text ?? ''
  if (!/直して|書き換え|書いて/.test(last)) return { reply: '（試しの答えです）用紙の書き方について、聞きたい欄の名前を入れて相談してください。', proposals: [] }
  const target = formFields(document.kind).find((f) => f.type === 'longtext' && typeof document.fields[f.key]?.value === 'string' && document.fields[f.key]!.value)
  if (!target) return { reply: '（試しの答えです）書き換えられる文章の欄がまだありません。', proposals: [] }
  return {
    reply: `（試しの答えです）「${target.label}」の書き換えの案を出しました。`,
    proposals: [{ key: target.key, value: `${String(document.fields[target.key]!.value).trim()}（試しの書き換え）` }],
  }
}
