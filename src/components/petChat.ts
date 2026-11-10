// 「書き方を相談する」の決めごと（画面の部品から分けて、テストで確かめる）。
// やり取りは画面の中だけで持つ（開き直すと消える）。書き換えの案は、ケアマネが押したときだけ用紙に入れる。
import type { ChatMessage, ChatProposal } from '../../api/chat.ts'
import { splitSentences } from '../../core/diff.ts'
import { BY_KEY, subFieldsOf, type FieldSpec } from '../../core/fields.ts'
import { sameValue } from '../../core/apply-batch.ts'

/** ready: まだ入れていない／applied: 用紙に入れた（「戻す」ができる） */
export type CardState = 'ready' | 'applied'
export interface ProposalCard extends ChatProposal { state: CardState }
/** steps: ペットが使った道具の作業ログ（1 行ずつ） */
export interface ChatEntry { id: number, role: ChatMessage['role'], text: string, steps?: string[], proposals?: ProposalCard[] }

/** サーバーに送るやり取りの数（API の上限と同じ） */
export const MAX_HISTORY = 40

/**
 * カードのボタン（「用紙に入れる」／「戻す」）を押したときにすること。
 * 案を出したあと（入れたあと）にケアマネが欄を直していたら、上書きせずに知らせる。
 */
export function cardAction(card: ProposalCard, current: unknown): { kind: 'set', value: unknown, next: CardState } | { kind: 'stale' } {
  // まとまりの欄は、項目の並び（DB で並べ替わる）と空の項目を見ずに比べる
  if (card.state === 'ready') return sameValue(current, card.before) ? { kind: 'set', value: card.after, next: 'applied' } : { kind: 'stale' }
  return sameValue(current, card.after) ? { kind: 'set', value: card.before ?? null, next: 'ready' } : { kind: 'stale' }
}

/** サーバーに送るやり取り（文だけ、古い順、最後の MAX_HISTORY 件） */
export function historyFor(entries: ChatEntry[]): ChatMessage[] {
  return entries.slice(-MAX_HISTORY).map(({ role, text }) => ({ role, text: text.slice(0, 4000) }))
}

/** 案のカードに出す差分。文の途中で切らずに、前にだけある文（消える）と、新しい方にだけある文（足す）を出す */
export function sentenceChanges(before: string | null, after: string): { del: string[], ins: string[] } {
  const b = splitSentences(before ?? '').map((x) => x.trim()).filter(Boolean)
  const a = splitSentences(after).map((x) => x.trim()).filter(Boolean)
  return { del: b.filter((x) => !a.includes(x)), ins: a.filter((x) => !b.includes(x)) }
}

const blank = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)

function shown(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'はい' : 'いいえ'
  if (Array.isArray(v)) return v.map(shown).join('、')
  if (v && typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** まとまりの値を「項目の名前：値」の行にする（表は「n 行目」を前に付ける） */
function lines(f: FieldSpec, v: unknown): string[] {
  if (blank(v)) return []
  const subs = subFieldsOf(f)
  const row = (r: unknown, head: string) => subs.flatMap((s) => {
    const x = (r as Record<string, unknown> | null)?.[s.key]
    return blank(x) ? [] : [`${head}${s.label}：${shown(x)}`]
  })
  if (f.type === 'object') return row(v, '')
  if (f.type === 'list' && Array.isArray(v)) return v.flatMap((r, i) => row(r, `${i + 1} 行目 `))
  return [shown(v)]
}

/** 案のカードに出す差分。文章の欄は文ごと、ほかの欄は「項目の名前：値」の行ごとに、消えるものと足すものを出す */
export function proposalChanges(key: string, before: unknown, after: unknown): { del: string[], ins: string[] } {
  const f = BY_KEY.get(key)
  if (!f || f.type === 'text' || f.type === 'longtext') return sentenceChanges(typeof before === 'string' ? before : null, typeof after === 'string' ? after : '')
  const b = lines(f, before)
  const a = lines(f, after)
  return { del: b.filter((x) => !a.includes(x)), ins: a.filter((x) => !b.includes(x)) }
}
