// SheetWriter: 2 層改（作り話を抑えた 2 層）の TypeScript 版。もとは design/runner/pipelines.py の run_two_strict。
//   1 回目: 記録の全部から、23 項目のまとまりごとに欄を書く（表の列の決まりつき）→ 読み直し（根拠のない単位を落とす）→ 全体のまとめ → 読み直し
//   2 回目から: 今の値と新しい記録だけで直す（新しい記録を根拠に挙げた直しだけ入れる）→ 直した欄だけ読み直し
//   どの回も、書類から写す欄は、書類の記録がないときは書かせない
// トークンを減らす工夫: 項目をまとまり（bundles.ts）にして呼ぶ回数を減らし、指示文の先頭を記録にそろえてキャッシュに当てる。
// 同じ記録を使う呼び出しは、最初の 1 回を済ませてから残りを並べて呼ぶ（同時に送ると、どれもキャッシュに当たらない）。
// 1 つの呼び出しが失敗しても（やり直しのあと）全体は止めず、そのまとまりの id を failed に入れる。ログに中身は出さない。
import { isDeepStrictEqual } from 'node:util'
import type { Person, SheetWriter, Visit, WriterResult } from '../types.ts'
import * as P from './prompts.ts'
import { SUMMARY, bundleItems, groupByBundle } from './bundles.ts'
import {
  DOC_SCENE_KINDS, acceptUpdate, atoms, candidateFields, dropAtoms, item23Names, mergeFields, needsDocument,
  validateValue, valueSchema, type Rec, type Spec,
} from './common.ts'
import type { Llm } from './gemini.ts'

const SPECS = candidateFields()
const BY_KEY = new Map(SPECS.map((s) => [s.key, s]))
const ITEM23 = item23Names()

const TYPE_JA: Record<string, string> = {
  enum: '1 つ選ぶ', multi: 'いくつか選ぶ', bool: 'はい・いいえ', number: '数', date: '日付（YYYY-MM-DD）',
  text: '短い文字', longtext: '文章（longtext）', object: 'まとまり（中の項目ごとに書く）',
  list: '表（1 行が 1 つのまとまり。行ごとに中の項目を書く）',
}

// ================================================================ 書式（pipelines.py の fmt_*）

/** 記録の 1 回分。演習シナリオの原本.json は title・by・entries の kind も持つ（なくても読める） */
type Entry = Visit['scenes'][number]['entries'][number] & { kind?: string }
type Scene = Omit<Visit['scenes'][number], 'entries'> & { title?: string, by?: string, entries: Entry[] }
type LooseVisit = Omit<Visit, 'scenes'> & { title?: string, scenes: Scene[] }

const SCENE_ENTRY_KIND: Record<string, string> = { 会話: 'ト書き', 経過: '経過', 観察: '観察', 書類: '書類' }

const fmtPeople = (people: Person[]) => people.map((p) => `- ${p.label}: ${p.role}${p.relation ? `（${p.relation}）` : ''}`).join('\n')

function entryLine(scene: Scene, e: Entry): string {
  if (e.speaker) return `[${e.id}] ${e.speaker}: ${e.text}`
  const kind = e.kind ?? SCENE_ENTRY_KIND[scene.kind] ?? scene.kind
  const label = kind === '経過' ? '経過の記録' : kind === '観察' ? `${scene.by ?? ''}の観察の記録` : kind
  return `[${e.id}]（${label}）${e.text}`
}

const visitHead = (v: LooseVisit) => [v.date, v.title].filter(Boolean).join(' ')

function fmtScene(v: LooseVisit, s: Scene): string {
  const head = `### ${visitHead(v)} ／ 場面 ${s.id}: ${s.title ?? ''}（${s.kind}）`
  return [head, ...s.entries.map((e) => entryLine(s, e))].join('\n')
}

export const fmtRecord = (visits: LooseVisit[]) => visits.flatMap((v) => v.scenes.map((s) => fmtScene(v, s))).join('\n\n')

export function fmtField(s: Spec): string {
  const lines = [`### ${s.key}（${s.label}）`, `- 型: ${TYPE_JA[s.type]}`, `- 用紙の場所: ${s.where}`]
  if (s.choices?.length) lines.push(`- 選択肢: ${s.choices.join(' ／ ')}`)
  if (s.subs?.length) {
    const subs = s.subs.map((x) => `${x.key}（${x.label}、${TYPE_JA[x.type]}${x.choices?.length ? `：${x.choices.join('／')}` : ''}）`)
    lines.push(`- 中の項目: ${subs.join('、')}`)
  }
  if (s.note) lines.push(`- 注: ${s.note}`)
  return lines.join('\n')
}

/** Python の json.dumps(ensure_ascii=False) と同じ区切り（", " と ": "）で出す */
function pyJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(pyJson).join(', ')}]`
  if (v !== null && typeof v === 'object') return `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${pyJson(x)}`).join(', ')}}`
  return JSON.stringify(v)
}
const fmtValue = (v: unknown) => (v === null || v === undefined ? '（空）' : pyJson(v))

function fmtSheet(fields: Record<string, Rec>): string {
  const lines = Object.entries(fields).filter(([k, r]) => BY_KEY.has(k) && r.value !== null && r.value !== undefined)
    .map(([k, r]) => `- ${BY_KEY.get(k)!.label}（${k}）: ${fmtValue(r.value)}`)
  return lines.join('\n') || '（まだ何も書いていない）'
}

// ================================================================ 道具

const isRecord = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)

/** 欄ごとに {value, from} を返させる JSON Schema（id は自由な文字列） */
export function fieldSchema(specs: Spec[], citeKey = 'from') {
  const props = Object.fromEntries(specs.map((s) => [s.key, {
    type: 'object',
    properties: { value: valueSchema(s), [citeKey]: { type: 'array', items: { type: 'string' } } },
    required: ['value', citeKey],
  }]))
  return { type: 'object', properties: props, required: specs.map((s) => s.key) }
}

/** 2 回目の直しの答えの形。直す欄の名前を changed に並べさせる（欄ごとに changed を持たせると、形が大きくなり Gemini が受け付けない） */
export function updateSchema(specs: Spec[]) {
  const props: Record<string, unknown> = { changed: { type: 'array', items: { type: 'string', enum: specs.map((s) => s.key) } } }
  for (const s of specs) {
    props[s.key] = { type: 'object', properties: { value: valueSchema(s), from: { type: 'array', items: { type: 'string' } } }, required: ['value', 'from'] }
  }
  return { type: 'object', properties: props, required: ['changed'] }
}

/** 同時に動かす数を絞って、順番どおりに結果を返す */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return out
}

/** 最初の 1 つを済ませてから、残りを mapLimit で呼ぶ（同じ前置きを先にキャッシュに載せる）。順番どおりに返す */
export async function warmThenMap<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  if (items.length <= 1) return mapLimit(items, limit, fn)
  const head = await fn(items[0])
  return [head, ...await mapLimit(items.slice(1), limit, fn)]
}

type Settled<T> = { ok: true, value: T } | { ok: false }
const settle = async <T>(p: Promise<T>): Promise<Settled<T>> => p.then((value) => ({ ok: true as const, value }), () => ({ ok: false as const }))

// ================================================================ 本体

interface Ctx {
  llm: Llm
  people: Person[]
  limit: number
  /** 落とした・入れなかった数（中身は残さない） */
  stats: Record<string, number>
  failed: Set<string>
  incompleteFields: Set<string>
}

function markFailed(ctx: Ctx, group: string, specs: Spec[], prefix = '') {
  ctx.failed.add(`${prefix}${group}`)
  for (const spec of specs) ctx.incompleteFields.add(spec.key)
}
const bump = (ctx: Ctx, k: string, n = 1) => { ctx.stats[k] = (ctx.stats[k] ?? 0) + n }

/** Gemini の答えから、欄の値を確かめて取り出す。→ {key: {value, cite}}（値がある欄だけ） */
function takeValues(ctx: Ctx, specs: Spec[], r: unknown, allowed: Set<string>): Record<string, Rec> {
  const out: Record<string, Rec> = {}
  for (const s of specs) {
    const rec = isRecord(r) && isRecord(r[s.key]) ? r[s.key] as Record<string, unknown> : {}
    const [v, problems] = validateValue(s, rec.value)
    if (problems.length) { bump(ctx, '値の問題'); ctx.incompleteFields.add(s.key) }
    const cite = (Array.isArray(rec.from) ? rec.from : []).filter((i): i is string => typeof i === 'string' && allowed.has(i))
    if (v !== null) {
      if (!cite.length) bump(ctx, '根拠のない値')
      out[s.key] = { value: v, cite }
    }
  }
  return out
}

/** 指示文の先頭（話した人と記録）。同じ記録を使う呼び出しでは、文字まで同じになる */
const contextOf = (ctx: Ctx, title: string, record: string) => P.fill(P.CONTEXT, { people: fmtPeople(ctx.people), title, entries: record })

/** まとまりの名前（指示文に入れる）。例: 23 項目の 11 ADL・16 排尿・排便 */
function bundleName(id: string): string {
  const items = bundleItems(id)
  return items.every((no) => no === 0) ? ITEM23[0] : `23 項目の ${items.map((no) => `${no} ${ITEM23[no]}`).join('・')}`
}

async function direct(ctx: Ctx, id: string, specs: Spec[], head: string) {
  const prompt = head + P.fill(P.DIRECT, {
    rules: P.WRITE_RULES, extra_rules: P.COLUMN_RULES, name: bundleName(id), fields: specs.map(fmtField).join('\n\n'),
  })
  return ctx.llm.ask(prompt, fieldSchema(specs), { step: '欄の値', group: id })
}

const CHECK_VERDICTS = ['ok', 'no_source', 'inferred', 'not_now', 'judgment']

/** 工夫 2 読み直し: 書いた値を確かめる単位に分け、1 つずつ記録と照らさせる。挙げた根拠を先に見て、なければ記録の全部から探す */
async function check(ctx: Ctx, id: string, specs: Spec[], written: Record<string, Rec>, head: string): Promise<[unknown, number]> {
  const blocks: string[] = []
  const ids: string[] = []
  for (const s of specs) {
    const rec = written[s.key]
    const ats = atoms(s, rec.value)
    if (!ats.length) continue
    const cited = rec.cite.join(', ') || '（挙げていない）'
    const items = ats.map((a) => `- [${s.key}${a.path}] ${a.label}: ${a.text}`).join('\n')
    blocks.push(`${fmtField(s)}\n- 書いた係が挙げた根拠: ${cited}\n- 確かめるもの:\n${items}`)
    ids.push(...ats.map((a) => s.key + a.path))
  }
  if (!ids.length) return [{}, 0]
  const schema = {
    type: 'object',
    properties: {
      checks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', enum: ids }, verdict: { type: 'string', enum: CHECK_VERDICTS },
            from: { type: 'array', items: { type: 'string' } }, why: { type: 'string' },
          },
          required: ['id', 'verdict', 'from'],
        },
      },
    },
    required: ['checks'],
  }
  const prompt = head + P.fill(P.CHECK, { column_rules: P.COLUMN_RULES, name: bundleName(id), materials: blocks.join('\n\n') })
  return [await ctx.llm.ask(prompt, schema, { step: '読み直し', group: id }), ids.length]
}

/** 読み直しの答えで、ok でない単位を落とし、ok の単位に見つけた根拠を欄の根拠に足す。答えのない単位は残す */
function applyChecks(ctx: Ctx, specs: Spec[], written: Record<string, Rec>, r: unknown, known: Set<string>): Record<string, Rec> {
  const verdicts = new Map<unknown, Record<string, unknown>>()
  if (isRecord(r) && Array.isArray(r.checks)) for (const c of r.checks) if (isRecord(c)) verdicts.set(c.id, c)
  const out: Record<string, Rec> = {}
  for (const s of specs) {
    const rec = written[s.key]
    const drop = new Set<string>()
    const found: string[] = []
    for (const a of atoms(s, rec.value)) {
      const c = verdicts.get(s.key + a.path)
      if (!c) { bump(ctx, '読み直しの答えがない'); ctx.incompleteFields.add(s.key) }
      else if (c.verdict !== 'ok') { drop.add(a.path); ctx.incompleteFields.add(s.key); bump(ctx, `落とした:${String(c.verdict)}`) }
      else found.push(...(Array.isArray(c.from) ? c.from : []).filter((i): i is string => typeof i === 'string' && known.has(i)))
    }
    out[s.key] = { value: dropAtoms(s, rec.value, drop), cite: [...new Set([...rec.cite, ...found])] }
  }
  return out
}

/**
 * 書いた・直した欄を、まとまりごとに読み直す。読み直しの呼び出しが失敗したまとまりの欄は、確かめられないので入れない（failed に check:<id>）。
 * warm: 同じ前置きの呼び出しをまだしていないとき（2 回目の処理）は、最初の 1 回を済ませてから残りを呼ぶ
 */
async function checkAll(ctx: Ctx, groups: Map<string, Spec[]>, written: Record<string, Rec>, head: string, known: Set<string>, warm = false): Promise<Record<string, Rec>> {
  const jobs = [...groups].map(([id, specs]) => [id, specs.filter((s) => s.key in written)] as const).filter(([, ss]) => ss.length)
  const run = warm ? warmThenMap : mapLimit
  const results = await run(jobs, ctx.limit, async ([id, specs]) => [id, specs, await settle(check(ctx, id, specs, written, head))] as const)
  const out: Record<string, Rec> = {}
  for (const [id, specs, r] of results) {
    if (!r.ok) { markFailed(ctx, id, specs, 'check:'); continue }
    bump(ctx, '確かめた単位', r.value[1])
    Object.assign(out, applyChecks(ctx, specs, written, r.value[0], known))
  }
  return out
}

/** 全体のまとめなど（番号 0 の欄）を、今の用紙と記録から書く */
async function final(ctx: Ctx, groups: Map<string, Spec[]>, fields: Record<string, Rec>, head: string, known: Set<string>): Promise<Record<string, Rec>> {
  const specs = groups.get(SUMMARY.id) ?? []
  if (!specs.length) return {}
  const prompt = head + P.fill(P.FINAL, {
    evidence: '発言・記録', rules: P.WRITE_RULES, extra_rules: P.COLUMN_RULES, fields: specs.map(fmtField).join('\n\n'), sheet: fmtSheet(fields),
  })
  const r = await settle(ctx.llm.ask(prompt, fieldSchema(specs), { step: '全体のまとめ', group: SUMMARY.id }))
  if (!r.ok) { markFailed(ctx, SUMMARY.id, specs); return {} }
  return takeValues(ctx, specs, r.value, known)
}

/** 工夫 3 2 回目は直すだけ: 今の値と新しい記録だけを見せて、新しい記録で変わる欄だけを直させる */
async function update(ctx: Ctx, id: string, specs: Spec[], fields: Record<string, Rec>, visit: LooseVisit, head: string) {
  const listing = specs.map((s) => {
    const cur = fields[s.key]
    let line = `${fmtField(s)}\n- 今の値: ${fmtValue(cur?.value)}`
    if (cur?.cite.length) line += `\n- 今の根拠: ${cur.cite.join(', ')}`
    return line
  })
  const prompt = head + P.fill(P.UPDATE, {
    visit: visitHead(visit), rules: P.WRITE_RULES, column_rules: P.COLUMN_RULES, name: bundleName(id), fields: listing.join('\n\n'),
  })
  return ctx.llm.ask(prompt, updateSchema(specs), { step: '2回目の直し', group: id })
}

export interface WriterOptions {
  /** Gemini を同時に呼ぶ数（既定 4。環境変数 GEMINI_CONCURRENCY） */
  concurrency?: number
}

export function sheetWriter(newLlm: () => Llm, opts: WriterOptions = {}): SheetWriter {
  const limit = Math.max(1, opts.concurrency ?? 4)
  return {
    async write({ visits, newVisitId, current, people, first }): Promise<WriterResult> {
      const llm = newLlm()
      const ctx: Ctx = { llm, people, limit, stats: {}, failed: new Set(), incompleteFields: new Set() }
      const idx = visits.findIndex((v) => v.id === newVisitId)
      const upto = (idx < 0 ? visits : visits.slice(0, idx + 1)) as LooseVisit[]
      const visit = upto[upto.length - 1]
      const known = new Set(upto.flatMap((v) => v.scenes.flatMap((s) => s.entries.map((e) => e.id))))
      const newIds = new Set(visit.scenes.flatMap((s) => s.entries.map((e) => e.id)))
      // 工夫 4: 書類から写す欄は、書類の記録がまだないときは書かせない
      const hasDocs = upto.some((v) => v.scenes.some((s) => DOC_SCENE_KINDS.has(s.kind)))
      const groups = groupByBundle(SPECS.filter((s) => hasDocs || !needsDocument(s)))
      // 読み直しは、書類の有無にかかわらず全部の欄を対象にする（pipelines.py の ctx.groups）
      const allGroups = groupByBundle(SPECS)
      const values: Record<string, Rec> = {}
      // 記録の全部を先頭に置いた前置き（1 回目の全部の呼び出しと、2 回目の読み直しで同じ）
      const fullHead = contextOf(ctx, '記録', fmtRecord(upto))

      if (first) {
        const jobs = [...groups].filter(([id]) => id !== SUMMARY.id)
        const results = await warmThenMap(jobs, limit, async ([id, specs]) => [id, specs, await settle(direct(ctx, id, specs, fullHead))] as const)
        const written: Record<string, Rec> = {}
        for (const [id, specs, r] of results) {
          if (!r.ok) { markFailed(ctx, id, specs); continue }
          Object.assign(written, takeValues(ctx, specs, r.value, known))
        }
        const checked = await checkAll(ctx, allGroups, written, fullHead, known)
        const fields: Record<string, Rec> = {}
        for (const [k, rec] of Object.entries(checked)) if (rec.value !== null) fields[k] = rec
        // 全体のまとめ（番号 0）は、読み直した用紙から書き、これも読み直す
        const finalWritten = await final(ctx, allGroups, fields, fullHead, known)
        const checked0 = await checkAll(ctx, allGroups, finalWritten, fullHead, known)
        for (const [k, rec] of Object.entries(checked0)) if (rec.value !== null) fields[k] = rec
        Object.assign(values, fields)
      } else {
        // 今の値（この様式の欄で、値のあるもの）
        const fields: Record<string, Rec> = {}
        for (const [k, v] of Object.entries(current)) if (BY_KEY.has(k) && v !== null && v !== undefined) fields[k] = { value: v, cite: [] }
        const newHead = contextOf(ctx, '新しい記録', fmtRecord([visit]))   // 直す係には、新しい記録だけを見せる
        const jobs = [...groups]   // 全体のまとめも、同じやり方で直す
        const results = await warmThenMap(jobs, limit, async ([id, specs]) => [id, specs, await settle(update(ctx, id, specs, fields, visit, newHead))] as const)
        const written: Record<string, Rec> = {}
        for (const [id, specs, r] of results) {
          if (!r.ok) { markFailed(ctx, id, specs); continue }
          const res = isRecord(r.value) ? r.value : {}
          const changed = new Set(Array.isArray(res.changed) ? res.changed : [])
          for (const s of specs) {
            const rec = { ...(isRecord(res[s.key]) ? res[s.key] as Record<string, unknown> : {}), changed: changed.has(s.key) }
            const cur = fields[s.key]
            const [v, cite, why] = acceptUpdate(s, rec, cur?.value ?? null, newIds, known)
            if (why) bump(ctx, '直しを入れなかった')
            if (v !== null) written[s.key] = { value: v, cite }
          }
        }
        const checked = await checkAll(ctx, allGroups, written, fullHead, known, true)   // 読み直す係には、記録の全部を見せる
        // 直しが読み直しで全部落ちたら、前の値を残す（AI は欄を空にしない）。返すのは直した欄だけ
        for (const [k, rec] of Object.entries(mergeFields({}, checked))) {
          if (!isDeepStrictEqual(rec.value, current[k])) values[k] = rec
        }
      }

      const usage = llm.usage()
      console.log(JSON.stringify({ severity: 'INFO', msg: 'writer done', first, values: Object.keys(values).length, failed: [...ctx.failed], stats: ctx.stats, calls: usage.calls, promptTokens: usage.promptTokens, cachedTokens: usage.cachedTokens, thinkingTokens: usage.thinkingTokens, yen: usage.yen }))
      return { values, usage, failed: [...ctx.failed], incompleteFields: [...ctx.incompleteFields] }
    },
  }
}
