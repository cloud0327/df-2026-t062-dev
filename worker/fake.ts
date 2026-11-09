// AI_PROVIDER=fake: 費用をかけずに流れを試すための中身。
// 何本目の録音かで、演習シナリオ（eval/scenario、公開・架空）の 1 回目・2 回目の記録と正解を返す。
import { readFileSync } from 'node:fs'
import { ZERO_USAGE, type Person, type SheetWriter, type SpeakerAssigner, type Stt, type Utterance } from './types.ts'

const ROOT = new URL('../eval/scenario/', import.meta.url)
const load = (p: string) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8'))

interface GenponEntry { id: string, speaker?: string, text: string }
interface Genpon { people: Record<string, { role: string, relation?: string }>, visits: { id: string, date: string, scenes: { entries: GenponEntry[] }[] }[] }

export class FakeStt implements Stt {
  async transcribe({ recordingId, sequence }: { recordingId: string, sequence: number }) {
    const g: Genpon = load('原本.json')
    const visit = g.visits[Math.min(sequence, g.visits.length) - 1]
    const utterances: Utterance[] = visit.scenes.flatMap((s) => s.entries).map((e, i) => ({
      id: `r${sequence}-${String(i + 1).padStart(4, '0')}`,
      startMs: i * 8000,
      endMs: i * 8000 + 7000,
      speaker: e.speaker ?? '記録',
      person: e.speaker ?? null,
      text: e.text,
    }))
    return { utterances, model: `fake:${recordingId.slice(0, 8)}`, audioSeconds: utterances.length * 8 }
  }
}

export class FakeSpeakers implements SpeakerAssigner {
  async assign({ utterances, people }: { utterances: Utterance[], people: Person[] }) {
    const g: Genpon = load('原本.json')
    const known = new Set(people.map((p) => p.label))
    const map: Record<string, string | null> = {}
    const newPeople: Person[] = []
    for (const u of utterances) {
      map[u.speaker] = u.person ?? null
      const label = u.person
      if (label && !known.has(label) && g.people[label]) {
        known.add(label)
        newPeople.push({ label, role: (g.people[label].role as Person['role']) ?? '不明', relation: g.people[label].relation ?? null })
      }
    }
    return { map, newPeople, usage: ZERO_USAGE }
  }
}

export class FakeWriter implements SheetWriter {
  async write({ first }: { first: boolean }) {
    const raw = load(`gold/用紙/アセスメント_${first ? 'v1' : 'v2'}.json`)
    delete raw._comment
    const values = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, { value: v, cite: [] as string[] }]))
    return { values, usage: ZERO_USAGE, failed: [], incompleteFields: [] }
  }
}
