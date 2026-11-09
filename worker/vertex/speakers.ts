// SpeakerAssigner: STT が振った話者の記号（speaker_1…）を、知っている人（people の label）か新しい人に結びつける。
// 呼びかけ方（「○○さん」）と話の中身から決め、決められないときは null。Gemini は 1 回だけ呼ぶ。
import type { Person, SpeakerAssigner, Utterance } from '../types.ts'
import type { Llm } from './gemini.ts'

const ROLES: Person['role'][] = ['本人', '家族', '専門職', 'ケアマネ', '不明']
// 1 回の指示に入れる文字数の上限（長い録音でも費用が膨らまないように。発言ごとにも切る）
const MAX_CHARS = 60_000
const MAX_LINE = 160

const PROMPT = `ケアマネジャーの面談の録音を文字にしたものです。話者の記号（speaker_1 など）が、誰の発言かを決めてください。

決め方:
- 呼びかけ方（「○○さん」「お母さん」など）と、話の中身（病状の説明、介護の苦労、制度の説明など）から決める。
- 「知っている人」にあてはまるときは、person にその label をそのまま入れる。
- 知っている人にいない人なら、person に名前か呼び方（「長女」「看護師」など）を入れ、role と relation を答える。role は 本人／家族／専門職／ケアマネ／不明 のどれか。relation は続柄や職種（分からなければ null）。
- 根拠が足りず決められない記号は、person を null にする。当てずっぽうで決めない。
- 発言のない記号は答えなくてよい。

知っている人（label: 立場（続柄））:
{people}

話者の記号:
{speakers}

発言（記号: 内容）:
{lines}
`

export function speakerAssigner(newLlm: () => Llm): SpeakerAssigner {
  return {
    async assign({ utterances, people }) {
      const llm = newLlm()
      const labels = [...new Set(utterances.map((u) => u.speaker))]
      const map: Record<string, string | null> = Object.fromEntries(labels.map((l) => [l, null]))
      if (!labels.length) return { map, newPeople: [], usage: llm.usage() }

      const schema = {
        type: 'object',
        properties: {
          speakers: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                speaker: { type: 'string', enum: labels },
                person: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                role: { anyOf: [{ type: 'string', enum: ROLES }, { type: 'null' }] },
                relation: { anyOf: [{ type: 'string' }, { type: 'null' }] },
              },
              required: ['speaker', 'person', 'role', 'relation'],
            },
          },
        },
        required: ['speakers'],
      }
      const r = await llm.ask(buildPrompt(utterances, people, labels), schema, { step: '話した人' })
      const known = new Map(people.map((p) => [p.label, p]))
      const newPeople: Person[] = []
      const rows = (r as { speakers?: unknown } | null)?.speakers
      for (const row of Array.isArray(rows) ? rows : []) {
        const sp = row?.speaker
        if (typeof sp !== 'string' || !(sp in map)) continue
        const label = typeof row.person === 'string' ? row.person.trim() : ''
        if (!label) continue
        map[sp] = label
        if (!known.has(label)) {
          const p: Person = {
            label,
            role: ROLES.includes(row.role) ? row.role : '不明',
            relation: typeof row.relation === 'string' && row.relation.trim() ? row.relation.trim() : null,
          }
          known.set(label, p)
          newPeople.push(p)
        }
      }
      return { map, newPeople, usage: llm.usage() }
    },
  }
}

export function buildPrompt(utterances: Utterance[], people: Person[], labels: string[]): string {
  let total = 0
  const lines: string[] = []
  for (const u of utterances) {
    const line = `${u.speaker}: ${u.text.length > MAX_LINE ? `${u.text.slice(0, MAX_LINE)}…` : u.text}`
    total += line.length + 1
    if (total > MAX_CHARS) break
    lines.push(line)
  }
  return PROMPT
    .replace('{people}', () => people.map((p) => `- ${p.label}: ${p.role}${p.relation ? `（${p.relation}）` : ''}`).join('\n') || '（まだいない）')
    .replace('{speakers}', () => labels.join('、'))
    .replace('{lines}', () => lines.join('\n'))
}
