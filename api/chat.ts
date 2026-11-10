// 「書き方を相談する」のエージェント。AI（Gemini の関数呼び出し）が道具を選んで使い、ケアマネの相談に答える。
// 道具: 用紙を読む（read_form）、足りない欄（missing_fields）、録音を探す（search_records）、書き換えの案（propose_edit）。
// 案は返すだけで、用紙は変えない（ケアマネが画面で「用紙に入れる」を押したときに PATCH /fields で入る）。
// 保存・PDF・外に送る道具は持たせない。指示文・答え・用紙の値はログに出さない。
import type { Binding } from '../core/binding.ts'
import { BY_KEY, choicesOf, FIELD_LIST, subFieldsOf, type FieldSpec } from '../core/fields.ts'
import type { FormKind } from '../core/form.ts'
import { sameValue } from '../core/apply-batch.ts'
import { compactValue } from '../core/normalize.ts'
import { missingRequiredKeys } from '../core/required.ts'
import { validValue } from '../core/schema.ts'
import { PLACEMENT_RULES } from '../worker/vertex/prompts.ts'
import ASSESSMENT_BINDINGS from '../forms/seed/assessment/bindings.json' with { type: 'json' }
import ADMISSION_BINDINGS from '../forms/seed/admission/bindings.json' with { type: 'json' }

export interface ChatMessage { role: 'user' | 'pet', text: string }
/** before・after は欄の値（文章の欄は文、まとまりの欄は object や行の配列） */
export interface ChatProposal { key: string, label: string, before: unknown, after: unknown }
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
/** 1 回の呼び出し。答えの部品（文か道具の呼び出し）を返す。final なら道具を使わせず、文で答えさせる。テストと fake では差し替える */
export type ChatModel = (req: { system: string, contents: Content[], tools: ToolDecl[], final?: boolean }) => Promise<Part[]>

/** 1 回の相談で Gemini を呼ぶ上限。最後の 1 回は道具なしで、そこまでのことを文で答えさせる */
export const MAX_CALLS = 8

const FORM_KEY: Record<FormKind, string> = { assessment: 'assess', admission: 'adm' }
const FORM_NAME: Record<FormKind, string> = { assessment: 'アセスメント', admission: '入院時情報提供書' }
const TEXT_TYPES = new Set(['text', 'longtext'])
/** 値を文字のまま受ける欄。ほかの欄（まとまり・数・はい／いいえ・複数選ぶ）は JSON で受ける */
const PLAIN_TYPES = new Set(['text', 'longtext', 'enum', 'date'])
const MAX_HITS = 40
/** 空の欄の形を返す長さの上限（字）。入院時情報提供書は収まり、アセスメントは収まらないので語で絞らせる */
const SHAPE_BUDGET = 8000

const formFields = (kind: FormKind) => FIELD_LIST.filter((f) => f.forms?.[FORM_KEY[kind]])
const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
const terms = (q: unknown) => String(q ?? '').split(/[\s、,，]+/).map((t) => t.trim()).filter(Boolean)
const matches = (text: string, ts: string[]) => ts.some((t) => text.includes(t))

export const TOOLS: ToolDecl[] = [
  {
    name: 'read_form',
    description: '書類の用紙を読む（document を省くと開いている書類。同じ利用者のほかの書類は document にその種類を入れる。ほかの書類は値のある欄だけ）。値のある欄（key・名前・型・値）と、まだ空の文章の欄を返す。printed は用紙に印字するときの決まり（値に入っていない印など）。query に語を入れると、欄の名前か key にその語を含む欄だけにし、まとまりの欄の形（shape: 中の項目と選択肢）と、空のまとまりの欄（empty）も返す（空白で区切るとどれか）',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '欄の名前の一部（例: 入浴、相談内容）。全部読むときは空' },
        document: { type: 'string', description: '読む書類の種類（assessment: アセスメント、admission: 入院時情報提供書）。省くと開いている書類' },
      },
    },
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
    description: '欄の書き換えの案を、ケアマネに出す。用紙には入らない（ケアマネが画面で「用紙に入れる」を押すと入る）。value はその欄の新しい値の全体（一部だけにしない）。文章・選択肢 1 つ・日付の欄は値の文字のまま。まとまり（object・list）・複数選ぶ・数・はい／いいえの欄は、read_form の値と同じ形の JSON の文字列（今の値をもとに、変えるところだけ直す）。通らない案は ok:false と理由と欄の形（shape）を返す',
    parametersJsonSchema: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' } }, required: ['key', 'value'] },
  },
]

export function chatSystem(kind: FormKind, others: FormKind[] = []): string {
  const form = FORM_NAME[kind]
  const otherDocs = others.length
    ? `\nこの利用者のほかの書類: ${others.map((k) => `${FORM_NAME[k]}（document: "${k}"）`).join('、')}。read_form の document で読める。\n`
    : ''
  return `あなたは、ケアマネジャーが${form}の用紙を書くのを手伝う係（画面の「ペット」）です。道具を使って調べてから、短く、やさしい言葉で答えてください。
${otherDocs}
## 道具の使い方
1. 利用者のことや用紙の中身を聞かれたら、read_form（用紙）や search_records（録音）で確かめてから答える。道具で見つからないことは「用紙にも録音にも出ていません」と答え、推測で埋めない。
2. 欄を書いて・直して・短くしてなどと頼まれたら、read_form（欄の名前の語で絞る）でその欄の今の値と形を読み、必要なら search_records で根拠を探してから、propose_edit で案を出す。文章の欄だけでなく、相談者・家族の表などのまとまりの欄や選択肢の欄にも案を出せる。value はその欄の新しい値の全体（まとまりの欄は今の値をもとにした JSON）。頼まれていないのに案を出さない。
3. 用紙に見えている文字が値にないときは、read_form の printed（印字するときだけ付く印などの様式の決まり）を確かめる。印の意味を説明し、それでも消したいと言われたら、印のもとになる項目を変える案を出す。
4. 足りないところ・埋まっていない欄を聞かれたら、missing_fields を使う。埋め方（面談で聞く／書類から）ごとにまとめて答える。
5. 読むときは、要る呼び出しを 1 回の答えにまとめて並べる（read_form を語ごとに何回にも分けない）。呼べる回数には限りがある。
6. ほかの書類から流用して・写してと頼まれたら、read_form（document なし）でこの書類の空の欄を確かめ、read_form（document にほかの書類）で中身を読んでから、この書類の空の欄に合うものを propose_edit で出す（案は何件でもよい。同じ道具の呼び出しは 1 回の答えにまとめて並べてよい）。同じ key の欄はそのまま写し、違う欄はほかの書類の中身からこの欄に合うように要約する。ほかの書類に書いていないことは書かない。案を出せるのは、開いている書類の欄だけ。
7. 録音がない（recordings: 0）と分かったら、もう search_records を使わない。同じ道具を同じ語で何度も呼ばない。案を出したら、それ以上調べずに答えを書く。
8. あなたは用紙に直接は書けない。出した案は、ケアマネが画面の「用紙に入れる」を押したときに入る。保存・PDF・外に送ることもできないので、頼まれたら画面のボタンで行うよう伝える。

## 書き方
- 文章は、要点を短い文にして「。」でつなぐ。本人・家族の思いや専門職の見立てなど、誰の話かで意味が変わるものは、誰の話か分かるように書く（例:「左側に残渣あり（ST）」）。
- 答えは 300 字くらいまで。案を出したときは、何をどう変えたかを 1〜2 文で書く。

## 欄の置き場所の決まり
${PLACEMENT_RULES}`
}

const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v))

type Shape = { type: string, choices?: string[], format?: string, fields?: Shape[] } & { key?: string, label?: string }

/** 欄の形（AI が値を組み立てるための、中の項目・選択肢・日付の書き方） */
function shapeOf(f: FieldSpec): Shape {
  const c = choicesOf(f)
  if (f.type === 'object' || f.type === 'list') {
    return { type: f.type, fields: subFieldsOf(f).map((s) => ({ key: s.key, label: s.label, ...shapeOf(s) })) }
  }
  if (f.type === 'date') return { type: f.type, format: 'YYYY-MM-DD（年だけ・年月だけも可）' }
  return { type: f.type, ...(c.length ? { choices: c } : {}) }
}

const BINDINGS: Record<FormKind, Record<string, Binding>> = {
  assessment: ASSESSMENT_BINDINGS as unknown as Record<string, Binding>,
  admission: ADMISSION_BINDINGS as unknown as Record<string, Binding>,
}

/** 用紙に印字するときだけ付く印（値には入らない）。様式の対応（bindings の prefix）から作る */
function printedNotes(kind: FormKind): Map<string, string> {
  const out = new Map<string, string>()
  for (const b of Object.values(BINDINGS[kind])) {
    if (b.op !== 'text@1' || !b.prefix) continue
    const f = BY_KEY.get(b.ref.key)
    if (!f || out.has(f.key)) continue
    const sub = (k: unknown) => subFieldsOf(f).find((s) => s.key === k)
    const flag = sub(b.prefix.flag)
    const target = sub(b.ref.path?.at(-1))
    out.set(f.key, `用紙では、${b.prefix.flag}（${flag?.label ?? b.prefix.flag}）が true の行の${target?.label ?? '文字'}の前に「${b.prefix.text}」を付けて印字する（様式の決まりの印。値には「${b.prefix.text}」は入っていない）`)
  }
  return out
}
const PRINTED: Record<FormKind, Map<string, string>> = { assessment: printedNotes('assessment'), admission: printedNotes('admission') }

function readForm(doc: ChatDocument, query: unknown, other = false) {
  const ts = terms(query)
  const pick = (f: FieldSpec) => !ts.length || matches(`${f.label} ${f.key}`, ts)
  const filled: { key: string, label: string, type: string, value: string, shape?: Shape, printed?: string }[] = []
  const emptyText: { key: string, label: string, note?: string }[] = []
  const empty: { key: string, label: string, type: string, shape?: Shape }[] = []
  for (const f of formFields(doc.kind)) {
    if (!pick(f)) continue
    const v = doc.fields[f.key]?.value
    const printed = PRINTED[doc.kind].get(f.key)
    // 形は語で絞ったときだけ（全部の欄の選択肢を返すと長くなる）
    const shape = ts.length && !TEXT_TYPES.has(f.type) ? shapeOf(f) : undefined
    if (!isEmpty(v)) filled.push({ key: f.key, label: f.label, type: f.type, value: show(v), ...(shape ? { shape } : {}), ...(printed ? { printed } : {}) })
    else if (TEXT_TYPES.has(f.type)) emptyText.push({ key: f.key, label: f.label, ...(f.note ? { note: f.note } : {}) })
    else if (f.type !== 'image') empty.push({ key: f.key, label: f.label, type: f.type, shape: shapeOf(f) })
  }
  // ほかの書類には案を出せないので、空の欄は返さない
  if (other) return { document: FORM_NAME[doc.kind], filled }
  // 空のまとまりの欄も、形つきで返す（1 回読めば案を組み立てられる）。長すぎるときは省き、語で絞らせる
  if (ts.length || JSON.stringify(empty).length <= SHAPE_BUDGET) return { document: FORM_NAME[doc.kind], filled, emptyText, empty }
  // 一覧だけでも長い（アセスメントで約 1 万字。会話のたびに送り直す）ので、空のまとまりの欄は返さない
  return { document: FORM_NAME[doc.kind], filled, emptyText, hint: '欄が多いので、空のまとまりの欄（選ぶ欄・表など）は省いた。query で欄の名前を絞って読むと、形つきで返す' }
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

/** 案の値を欄の型の値にする。文章・選択肢・日付は文字のまま、ほかは JSON。読めなければ理由 */
function parseValue(f: FieldSpec, raw: unknown): { value: unknown } | string {
  if (typeof raw !== 'string') return { value: raw ?? null }
  const t = raw.trim()
  if (TEXT_TYPES.has(f.type)) return t ? { value: t } : '文が空です'
  if (t === '' || t === 'null') return { value: null }
  if (PLAIN_TYPES.has(f.type)) return { value: t }
  try {
    return { value: JSON.parse(t) }
  } catch {
    return 'JSON として読めません'
  }
}

/** 書き換えの案を確かめる。通れば案、通らなければ理由（欄の名前つき） */
export function checkProposal(doc: ChatDocument, key: unknown, value: unknown): ChatProposal | string {
  const f = typeof key === 'string' ? BY_KEY.get(key) : undefined
  if (!f) return `${String(key)}（その欄はありません）`
  if (!f.forms?.[FORM_KEY[doc.kind]]) return `${f.label}（この書類にない欄です）`
  if (f.type === 'image') return `${f.label}（図の欄は案を出せません）`
  const parsed = parseValue(f, value)
  if (typeof parsed === 'string') return `${f.label}（${parsed}）`
  const after = f.type === 'object' || f.type === 'list' ? compactValue(parsed.value) : parsed.value
  if (!validValue(f.key, after)) return `${f.label}（入れられない値です）`
  const before = doc.fields[f.key]?.value ?? null
  if (sameValue(before, after)) return `${f.label}（今の値と同じです）`
  return { key: f.key, label: f.label, before, after }
}

const STOPPED = 'ごめんなさい、調べている途中で止まりました。聞きたいことを短くして、もう一度相談してください。'
const FINAL_ASK = '（道具はもう使えません。ここまでに分かったことと、出した案を、ケアマネに短く答えてください）'
const PROPOSED = '書き換えの案を出しました。下のカードを見て、よければ「用紙に入れる」を押してください。'
const FALLBACK = 'うまく答えられませんでした。言い方を変えて、もう一度聞いてください。'

export async function runChat({ model, document, others = [], recordings, messages, onStep }: {
  model: ChatModel, document: ChatDocument, recordings: ChatRecording[], messages: ChatMessage[]
  /** 同じ利用者のほかの書類（read_form の document で読む。案は出せない） */
  others?: ChatDocument[]
  /** 道具を使うたびに、作業ログの 1 行を知らせる（画面に少しずつ出す） */
  onStep?: (step: string) => void
}): Promise<ChatReply> {
  const byKind = new Map(others.filter((d) => d.kind !== document.kind).map((d) => [d.kind, d]))
  const system = chatSystem(document.kind, [...byKind.keys()])
  const contents: Content[] = messages.map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] }))
  const steps: string[] = []
  const step = (t: string) => { steps.push(t); onStep?.(t) }
  const proposals = new Map<string, ChatProposal>()
  const result = (reply: string): ChatReply => ({ reply, steps, proposals: [...proposals.values()] })

  for (let n = 0; n < MAX_CALLS; n++) {
    const final = n === MAX_CALLS - 1
    // 最後の 1 回は、道具を止めるだけでなく、答えるように文でも頼む
    if (final && n > 0) contents.at(-1)!.parts.push({ text: FINAL_ASK })
    const parts = await model({ system, contents, tools: TOOLS, final })
    // 最後の 1 回に道具を呼んできても、もう使わない
    const calls = final ? [] : parts.filter((p) => p.functionCall?.name)
    if (!calls.length) {
      const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim()
      return result(text || (proposals.size ? PROPOSED : final ? STOPPED : FALLBACK))
    }
    contents.push({ role: 'model', parts })
    const responses: Part[] = []
    for (const p of calls) {
      const { id, name, args = {} } = p.functionCall!
      let response: Record<string, unknown>
      if (name === 'read_form') {
        const kind = typeof args.document === 'string' && args.document ? args.document : document.kind
        const target = kind === document.kind ? document : byKind.get(kind as FormKind)
        const q = terms(args.query).length ? `「${String(args.query).trim()}」` : ''
        if (!target) {
          response = { error: `${kind} という書類は、この利用者にありません`, documents: [document.kind, ...byKind.keys()] }
          step(`用紙を読めませんでした：${kind}`)
        } else {
          response = readForm(target, args.query, target !== document)
          const head = target === document ? '' : FORM_NAME[target.kind]
          step(head || q ? `用紙を読みました（${head}${q}）` : '用紙を読みました')
        }
      } else if (name === 'missing_fields') {
        response = missingFields(document)
        step(`足りない欄を調べました（${(response.missing as unknown[]).length} 欄）`)
      } else if (name === 'search_records') {
        response = searchRecords(recordings, args.query)
        step(`録音を探しました「${String(args.query ?? '').trim()}」（${(response.total as number | undefined) ?? 0} 件）`)
      } else if (name === 'propose_edit') {
        const r = checkProposal(document, args.key, args.value)
        if (typeof r === 'string') {
          const f = typeof args.key === 'string' ? BY_KEY.get(args.key) : undefined
          // 欄はあるのに値が通らないときは、欄の形を返して組み立て直させる
          response = { ok: false, reason: r, ...(f?.forms?.[FORM_KEY[document.kind]] && f.type !== 'image' ? { shape: shapeOf(f) } : {}) }
          step(`案を作れませんでした：${r}`)
        } else {
          proposals.set(r.key, r)
          response = { ok: true, message: '案をケアマネの画面に出しました。まだ用紙には入っていません' }
          step(`書き換えの案を作りました：${r.label}`)
        }
      } else {
        response = { error: `${String(name)} という道具はありません` }
      }
      responses.push({ functionResponse: { ...(id ? { id } : {}), name: name!, response } })
    }
    contents.push({ role: 'user', parts: responses })
  }
  return result(proposals.size ? PROPOSED : STOPPED)
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
