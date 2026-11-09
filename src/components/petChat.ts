// 「書き方を相談する」の決めごと（画面の部品から分けて、テストで確かめる）。
// やり取りは画面の中だけで持つ（開き直すと消える）。書き換えの案は、ケアマネが押したときだけ用紙に入れる。
import type { ChatMessage, ChatProposal } from '../../api/chat.ts'

/** ready: まだ入れていない／applied: 用紙に入れた（「戻す」ができる） */
export type CardState = 'ready' | 'applied'
export interface ProposalCard extends ChatProposal { state: CardState }
export interface ChatEntry { id: number, role: ChatMessage['role'], text: string, proposals?: ProposalCard[] }

/** サーバーに送るやり取りの数（API の上限と同じ） */
export const MAX_HISTORY = 40

const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null)

/**
 * カードのボタン（「用紙に入れる」／「戻す」）を押したときにすること。
 * 案を出したあと（入れたあと）にケアマネが欄を直していたら、上書きせずに知らせる。
 */
export function cardAction(card: ProposalCard, current: unknown): { kind: 'set', value: string | null, next: CardState } | { kind: 'stale' } {
  if (card.state === 'ready') return same(current, card.before) ? { kind: 'set', value: card.after, next: 'applied' } : { kind: 'stale' }
  return same(current, card.after) ? { kind: 'set', value: card.before, next: 'ready' } : { kind: 'stale' }
}

/** サーバーに送るやり取り（文だけ、古い順、最後の MAX_HISTORY 件） */
export function historyFor(entries: ChatEntry[]): ChatMessage[] {
  return entries.slice(-MAX_HISTORY).map(({ role, text }) => ({ role, text: text.slice(0, 4000) }))
}
