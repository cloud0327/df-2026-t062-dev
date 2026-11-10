// 書き方の相談の答え（1 行 1 つの JSON。api/app.ts の POST /api/documents/:id/chat）を読む。
// {type:'step'} は届いたらすぐ知らせ（作業ログを少しずつ出す）、{type:'done'} で答えを返す。
import type { ChatReply } from '../../api/chat.ts'

export async function readChatStream(body: ReadableStream<Uint8Array>, onStep: (step: string) => void): Promise<ChatReply> {
  const reader = body.getReader()
  // 日本語の 1 文字の途中で切れて届いても、stream: true で次と続けて読む
  const dec = new TextDecoder()
  let buf = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      buf += dec.decode(value, { stream: !done })
      for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!line) continue
        const ev = JSON.parse(line) as { type: string, text?: string } & Partial<ChatReply>
        if (ev.type === 'step') onStep(String(ev.text ?? ''))
        else if (ev.type === 'done') return { reply: ev.reply ?? '', steps: ev.steps ?? [], proposals: ev.proposals ?? [] }
        else if (ev.type === 'error') throw new Error('ペットの答えを作れませんでした')
      }
      if (done) throw new Error('答えが途中で切れました')
    }
  } finally {
    reader.cancel().catch(() => {})
  }
}
