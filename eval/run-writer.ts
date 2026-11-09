// SheetWriter（2 層改）だけを、演習シナリオ（eval/scenario/原本.json、公開・架空）で動かし、bench の提出の形で書き出す。
// 使い方: node eval/run-writer.ts --out <フォルダ> [--dry]
//   --dry: Gemini を呼ばない（答えを空にして、指示文の量だけ数える。費用の見積もりと流れの確かめ用）
// 本物の Gemini を呼ぶときは GOOGLE_CLOUD_PROJECT が要る（費用がかかる）。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { candidateFields } from '../worker/vertex/common.ts'
import { geminiFactory, type Llm } from '../worker/vertex/gemini.ts'
import { sheetWriter } from '../worker/vertex/writer.ts'
import { ZERO_USAGE, type Person, type Usage, type Visit } from '../worker/types.ts'

const { values: args } = parseArgs({ options: { out: { type: 'string' }, dry: { type: 'boolean', default: false } } })
if (!args.out) {
  console.error('使い方: node eval/run-writer.ts --out <フォルダ> [--dry]')
  process.exit(2)
}
const out = args.out

const genpon = JSON.parse(readFileSync(new URL('./scenario/原本.json', import.meta.url), 'utf8')) as {
  people: Record<string, { role: Person['role'], relation?: string }>
  visits: Visit[]
}
const people: Person[] = Object.entries(genpon.people).map(([label, p]) => ({ label, role: p.role, relation: p.relation ?? null }))
const byKey = new Map(candidateFields().map((s) => [s.key, s]))

let dryChars = 0
const dryFactory = (): Llm => ({
  ask: async (prompt) => { dryChars += prompt.length; return {} },
  usage: () => ({ ...ZERO_USAGE }),
})
const newLlm = args.dry ? dryFactory : geminiFactory(process.env)
const writer = sheetWriter(newLlm, { concurrency: Number(process.env.GEMINI_CONCURRENCY) || 4 })

const write = (path: string, data: unknown) => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(data, null, 1) + '\n')
}

const total: Usage = { ...ZERO_USAGE }
const perVisit: Record<string, unknown> = {}
let current: Record<string, unknown> = {}

for (const [i, visit] of genpon.visits.entries()) {
  const t = visit.id
  const t0 = Date.now()
  const r = await writer.write({ visits: genpon.visits.slice(0, i + 1), newVisitId: t, current, people, first: i === 0 })
  // 2 回目以降は、直した欄だけが返る。シートは、前の値に重ねたもの（bench は時点ごとのシート全体を採点する）
  const prev = i === 0 ? {} : JSON.parse(readFileSync(join(out, genpon.visits[i - 1].id, 'sheet.json'), 'utf8')).fields as Record<string, { value: unknown, cite?: string[] }>
  const merged: Record<string, { value: unknown, cite: string[] }> = {}
  for (const [k, v] of Object.entries(prev)) merged[k] = { value: v.value, cite: v.cite ?? [] }
  for (const [k, v] of Object.entries(r.values)) merged[k] = { value: v.value, cite: v.cite ?? [] }

  // 2 層の根拠は、欄ごとに「根拠の発言」を 1 件の事実の形にして、bench の根拠の確かめに使う（common.py の pseudo_facts）
  const facts: unknown[] = []
  const fields: Record<string, unknown> = {}
  Object.keys(merged).sort().forEach((k, j) => {
    const rec = merged[k]
    if (rec.value === null || rec.value === undefined) return
    const fid = `e${t.slice(1)}-${String(j + 1).padStart(3, '0')}`
    facts.push({ id: fid, text: `${byKey.get(k)?.label ?? k}の根拠`, item23: byKey.get(k)?.item23 ?? null, who: null, kind: 'said', from: rec.cite })
    fields[k] = { value: rec.value, by: 'ai', facts: [fid], cite: rec.cite }
  })
  write(join(out, t, 'sheet.json'), { fields, unplaced: [] })
  write(join(out, t, 'facts.json'), { facts })
  write(join(out, t, 'questions.json'), { questions: [] })

  current = Object.fromEntries(Object.entries(merged).map(([k, v]) => [k, v.value]))
  perVisit[t] = { seconds: (Date.now() - t0) / 1000, fields: Object.keys(fields).length, returned: Object.keys(r.values).length, failed: r.failed, usage: r.usage }
  total.calls += r.usage.calls
  total.promptTokens += r.usage.promptTokens
  total.cachedTokens += r.usage.cachedTokens
  total.outputTokens += r.usage.outputTokens
  total.thinkingTokens += r.usage.thinkingTokens
  total.yen += r.usage.yen
  console.log(`${t}: 欄 ${Object.keys(fields).length}、呼び出し ${r.usage.calls}、入力 ${r.usage.promptTokens}（キャッシュ ${r.usage.cachedTokens}）、思考 ${r.usage.thinkingTokens}、失敗 [${r.failed.join(', ')}]、${Math.round(r.usage.yen)} 円`)
}

write(join(out, 'usage.json'), { model: process.env.GEMINI_MODEL ?? 'gemini-3.8-flash', dry: args.dry, ...(args.dry ? { dryPromptChars: dryChars } : {}), total, visits: perVisit })
console.log(`合計: ${total.calls} 回、${Math.round(total.yen)} 円${args.dry ? `（dry: 指示文 ${dryChars} 字）` : ''}`)
