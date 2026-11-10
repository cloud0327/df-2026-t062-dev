// 1 つの書類の値を持ち、直しを api に送る。
//   - 様式は書類が指す版を api から読む（版の中身は変わらないので覚えておく）。ページの画像は期限つきの URL
//   - 用紙の直しは「印字欄・打った文字」のまま送り、サーバーがその時点の値に当てる。画面は同じ仕組みで先に表示を変える
//   - 差分の欄（長い文章）は「key・値・元の値」で送る。元の値が変わっていれば 409 で、読み直す
//   - 数・日付・記号の欄は打ちかけ（下書き）を持ち、欄を離れる・Enter で確定する。確定できなければ欄の横に理由を出す
//   - 印は「保存した値」と「今の値」の違いで出す（橙＝AI、黄＝ケアマネ）
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getRef, parseYear, specOf, type Binding, type EraShort } from '../../core/binding.ts'
import { sameValue } from '../../core/apply-batch.ts'
import { sentenceDiff } from '../../core/diff.ts'
import { slotPages, toFormDef, type FormAssetsView, type FormDef } from '../../core/form.ts'
import { applyChanges, editSlot, renderSlots, slotMarks, type Values, type Who } from '../../core/slots.ts'
import { api, ApiError, type DocumentView, type SlotEdit } from '../lib/api.ts'
import { pagesOf, type SlotView } from './layout.ts'

interface FieldPending { value: unknown, base: unknown, mode?: 'edit' | 'revert' }
interface PendingSlot extends SlotEdit { form: FormDef }
interface PendingEdits {
  slots: PendingSlot[]
  fields: Map<string, FieldPending>
  conflicts: Map<string, FieldPending>
  timer?: ReturnType<typeof setTimeout>
  inflight?: Promise<boolean>
}

function newPending(): PendingEdits {
  return { slots: [], fields: new Map(), conflicts: new Map() }
}

export interface PageCount { ai: number, hand: number }

/** 元号の変わる年（月日がそろわないと元号が決まらない） */
const ERA_CHANGE_YEARS = new Set([1868, 1912, 1926, 1989, 2019])

/** 打っている途中の文字が値にならない欄（確定するまで下書きで持つ） */
function needsDraft(b: Binding | undefined): boolean {
  if (!b) return false
  switch (b.op) {
    case 'date@1': case 'ageAt@1': case 'join@1': return true
    case 'symbol@1': return b.ui !== 'cell'
    case 'text@1': {
      const s = specOf(b.ref)
      return !!s && !s.detail && (s.type === 'number' || s.type === 'enum')
    }
    default: return false
  }
}

/** 日付の組（同じ値の場所で、同じ条件の欄。入院時の申請日は「申請中」と「区分変更」で別の組） */
const groupOf = (b: Binding) => `${b.ref.key}${JSON.stringify(b.ref.path ?? [])}${JSON.stringify('when' in b ? b.when ?? null : null)}`
const docValues = (doc: DocumentView): Values => Object.fromEntries(Object.entries(doc.fields).map(([k, f]) => [k, f.value]))
const toHalf = (t: string) => t.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).trim()

export function useDocument(docId: string | undefined) {
  const [loadedDoc, setDoc] = useState<DocumentView | null>(null)
  const [loadedForm, setForm] = useState<FormDef | null>(null)
  const doc = loadedDoc?.id === docId ? loadedDoc : null
  const form = loadedForm?.id === doc?.formVersionId ? loadedForm : null
  const [assets, setAssets] = useState<FormAssetsView | null>(null)
  // The queue changes synchronously so a retry never reads a stale React render.
  const [queues] = useState(() => new Map<string | undefined, PendingEdits>())
  const pending = useMemo(() => {
    const queue = queues.get(docId) ?? newPending()
    queues.set(docId, queue)
    return queue
  }, [docId, queues])
  const [, redraw] = useState(0)
  const { slots: slotQueue, fields: fieldQueue, conflicts } = pending
  const [drafts, setDrafts] = useState<Map<string, string>>(new Map())
  const [eraDrafts, setEraDrafts] = useState<Map<string, EraShort>>(new Map())
  const [reasons, setReasons] = useState<Map<string, string>>(new Map())
  const [sync, setSync] = useState('')
  /** 直せなかった理由（数秒だけ出す） */
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const retried = useRef(false)
  const active = useRef(docId)
  active.current = docId
  const refs = useRef<{ doc: DocumentView | null, form: FormDef | null }>({ doc: null, form: null })

  const publish = useCallback((document: DocumentView) => {
    if (active.current !== document.id) return
    refs.current.doc = document
    setDoc(document)
  }, [])

  const showNotice = useCallback((text: string) => {
    setNotice(text)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(''), 4000)
  }, [])

  const loadAssets = useCallback(async (versionId: string) => {
    const result = await api.formAssets(versionId).catch(() => null)
    if (refs.current.doc?.id === active.current && refs.current.form?.id === versionId) setAssets(result)
  }, [])

  const load = useCallback(async () => {
    if (!docId) return
    try {
      const { document } = await api.document(docId)
      publish(document)
      if (active.current === docId && refs.current.form?.id !== document.formVersionId) {
        const v = await api.formVersion(document.formVersionId)
        if (active.current === docId && refs.current.doc?.formVersionId === v.id) {
          const def = toFormDef(v)
          refs.current.form = def
          setForm(def)
          setAssets(null)
          retried.current = false
          void loadAssets(v.id)
        }
      }
      return document
    } catch (e) {
      if (active.current === docId) setError(String((e as Error).message))
    }
  }, [docId, loadAssets, publish])

  useEffect(() => {
    setDoc(null)
    setError('')
    setDrafts(new Map())
    setEraDrafts(new Map())
    setReasons(new Map())
    void load()
  }, [load])

  // ---------- 今の値（サーバーの値に、まだ送っていない直しを当てたもの） ----------
  const local = useMemo(() => {
    if (!doc || !form) return { values: {} as Values, keys: new Set<string>(), revert: new Set<string>() }
    let values = applyChanges(docValues(doc), [...fieldQueue].map(([key, p]) => ({ key, value: p.value })))
    const keys = new Set<string>()
    const revert = new Set<string>()
    for (const [k, p] of fieldQueue) (p.mode === 'revert' ? revert : keys).add(k)
    for (const e of slotQueue) {
      const r = editSlot(form, values, e.slot, e.text)
      if ('reason' in r) continue
      values = applyChanges(values, r.changes)
      for (const c of r.changes) keys.add(c.key)
    }
    return { values, keys, revert }
  }, [doc, form, fieldQueue, slotQueue])
  const current = local.values

  const saved = useMemo<Values>(() => (doc ? Object.fromEntries(Object.entries(doc.saved).map(([k, s]) => [k, s.value])) : {}), [doc])

  const byOf = useCallback((key: string): Who | undefined => {
    if (local.keys.has(key)) return 'cm'
    return doc?.fields[key]?.by ?? doc?.saved[key]?.by
  }, [doc, local])

  const rendered = useMemo(() => (form ? renderSlots(form, current) : {}), [form, current])
  const renderedSaved = useMemo(() => (form ? renderSlots(form, saved) : {}), [form, saved])
  const marks = useMemo(() => (form ? slotMarks(form, current, saved, byOf) : new Map<string, Who>()), [form, current, saved, byOf])

  // ---------- 送る ----------
  const flush = useCallback(async (): Promise<boolean> => {
    if (!docId) return false
    if (pending.timer) { clearTimeout(pending.timer); pending.timer = undefined }
    while (pending.inflight) await pending.inflight
    const run = (async () => {
      const synced: string[] = []
      try {
        let fields = [...pending.fields]
        while (fields.length) {
          try {
            const r = await api.patch(docId, fields.map(([key, p]) => ({ key, value: p.value ?? null, base: p.base ?? null, mode: p.mode })))
            publish(r.document)
            synced.push(...r.syncedTo)
            const next = new Map(pending.fields)
            for (const [key, sent] of fields) {
              const queued = next.get(key)
              if (queued === sent) next.delete(key)
              // Typing during the request still uses the base from before that request.
              else if (queued && sameValue(queued.base, sent.base)) {
                next.set(key, { ...queued, base: r.document.fields[key]?.value ?? null })
              }
            }
            pending.fields = next
            redraw((n) => n + 1)
            break
          } catch (e) {
            if (!(e instanceof ApiError) || e.status !== 409) throw e
            const latest = await load()
            if (!latest) return false
            const next = new Map(pending.fields)
            const conflicts = new Map(pending.conflicts)
            const retry: typeof fields = []
            for (const [key, sent] of fields) {
              const queued = next.get(key)
              if (!queued || !sameValue(queued.base, sent.base)) continue
              const serverValue = latest.fields[key]?.value ?? null
              if (sameValue(serverValue, queued.base)) retry.push([key, queued])
              else {
                conflicts.set(key, queued)
                next.delete(key)
              }
            }
            // A retry must shrink the rejected batch. An unexplained 409 keeps all input.
            if (retry.length === fields.length) throw e
            pending.fields = next
            pending.conflicts = conflicts
            redraw((n) => n + 1)
            fields = retry
          }
        }

        const edits = [...pending.slots]
        if (edits.length) {
          const source = edits[0].form
          let target = refs.current.doc?.id === docId ? refs.current.form ?? source : source
          const send = () => {
            if (!edits.every(({ slot, form }) => sameValue(form.bindings[slot], target.bindings[slot]))) {
              throw new Error('様式が変わったため、用紙の入力を保留しています')
            }
            return api.edits(docId, target.id, edits.map(({ slot, text }) => ({ slot, text })))
          }
          let result
          try {
            result = await send()
          } catch (e) {
            if (!(e instanceof ApiError) || e.status !== 409) throw e
            const latest = await load()
            if (!latest) return false
            const updated = refs.current.form
            if (!updated || updated.id !== latest.formVersionId || updated.id === target.id) throw e
            target = updated
            result = await send()
          }
          publish(result.document)
          synced.push(...result.syncedTo)
          pending.slots = pending.slots.filter((edit) => !edits.includes(edit))
          redraw((n) => n + 1)
          const refused = result.results.find((x) => x.reason)
          if (refused?.reason && active.current === docId) showNotice(refused.reason)
        }
        if (active.current === docId) {
          if (synced.length) {
            setSync([...new Set(synced)].join('・'))
            setTimeout(() => setSync(''), 3000)
          }
          setError('')
        }
        return true
      } catch (e) {
        if (active.current === docId) setError(String((e as Error).message))
        return false
      }
    })()
    pending.inflight = run
    try { return await run }
    finally { pending.inflight = undefined }
  }, [docId, load, pending, publish, showNotice])

  const schedule = useCallback(() => {
    if (pending.timer) clearTimeout(pending.timer)
    pending.timer = setTimeout(() => void flush(), 600)
  }, [flush, pending])

  const queueEdits = useCallback((edits: SlotEdit[]) => {
    if (!edits.length || !form) return
    const next = [...pending.slots]
    for (const e of edits) {
      // 同じ欄を続けて打ったときは、最後の文字だけを送る
      if (next.length && next[next.length - 1].slot === e.slot) next[next.length - 1] = { ...e, form }
      else next.push({ ...e, form })
    }
    pending.slots = next
    redraw((n) => n + 1)
    schedule()
  }, [form, pending, schedule])

  const setReason = useCallback((slot: string, reason: string | null) => {
    setReasons((prev) => {
      if (reason === null && !prev.has(slot)) return prev
      const next = new Map(prev)
      if (reason === null) next.delete(slot)
      else next.set(slot, reason)
      return next
    })
  }, [])

  // ---------- 日付の組（年・月・日・元号の丸） ----------
  const dateGroups = useMemo(() => {
    type Group = { y?: string, m?: string, d?: string, eras: Map<EraShort, string> }
    const out = new Map<string, Group>()
    if (!form) return out
    for (const [slot, b] of Object.entries(form.bindings)) {
      if (b.op !== 'date@1' && b.op !== 'era@1') continue
      const g: Group = out.get(groupOf(b)) ?? { eras: new Map<EraShort, string>() }
      if (b.op === 'era@1') g.eras.set(b.era, slot)
      else g[b.part] = slot
      out.set(groupOf(b), g)
    }
    return out
  }, [form])

  const dropDrafts = useCallback((slots: (string | undefined)[], group?: string) => {
    setDrafts((prev) => { const next = new Map(prev); for (const s of slots) if (s) next.delete(s); return next })
    setReasons((prev) => { const next = new Map(prev); for (const s of slots) if (s) next.delete(s); return next })
    if (group) setEraDrafts((prev) => { if (!prev.has(group)) return prev; const next = new Map(prev); next.delete(group); return next })
  }, [])

  /** 日付の組の下書きを確定する。元号の変わる年は月日がそろうまで待つ */
  const commitDate = useCallback((group: string, draftsNow: Map<string, string>, era: EraShort | undefined) => {
    const g = dateGroups.get(group)
    if (!form || !g) return
    const parts = (['y', 'm', 'd'] as const).map((p) => ({ part: p, slot: g[p], text: g[p] ? draftsNow.get(g[p]!) : undefined }))
    const y = parts[0]
    if (y.text !== undefined && era && /^\d{1,2}$/.test(toHalf(y.text))) y.text = `${era}${toHalf(y.text)}`
    if (parts.every((p) => p.text === undefined)) return
    if (y.text !== undefined && toHalf(y.text) !== '') {
      const year = parseYear(y.text)
      const v = getRef(current, form.bindings[g.y!].ref)
      const cur = typeof v === 'string' ? v : ''
      const has = (p: 'm' | 'd', i: number) => (parts[i].text ?? '').trim() !== '' || (parts[i].text === undefined && cur.split('-').length > i)
      if (year !== null && ERA_CHANGE_YEARS.has(year) && g.m && g.d && !(has('m', 1) && has('d', 2))) {
        setReason(g.y!, '元号が変わる年なので、月と日を書くと確定します')
        return
      }
    }
    let values = current
    const edits: SlotEdit[] = []
    for (const p of parts) {
      if (!p.slot || p.text === undefined) continue
      const r = editSlot(form, values, p.slot, p.text)
      if ('reason' in r) { setReason(p.slot, r.reason); return }
      values = applyChanges(values, r.changes)
      edits.push({ slot: p.slot, text: p.text })
    }
    queueEdits(edits)
    dropDrafts(parts.map((p) => p.slot), group)
  }, [dateGroups, form, current, queueEdits, dropDrafts, setReason])

  // ---------- 用紙の直し ----------
  /** すぐに当てる直し（丸・✓・表のマス・ふつうの文字） */
  const edit = useCallback((slot: string, text: string) => {
    if (!form) return
    const b = form.bindings[slot]
    if (b?.op === 'era@1') {
      // 元号の丸: 日付があれば元号を付け替える。まだなければ下書きにして、年を書いたときに一緒に確定する
      const g = groupOf(b)
      const yDraft = dateGroups.get(g)?.y ? drafts.get(dateGroups.get(g)!.y!) : undefined
      const hasDate = typeof getRef(current, b.ref) === 'string'
      if (hasDate && yDraft === undefined) {
        const r = editSlot(form, current, slot, text)
        if ('reason' in r) showNotice(r.reason)
        else queueEdits([{ slot, text }])
        return
      }
      if (text !== 'true') return
      setEraDrafts((prev) => new Map(prev).set(g, b.era))
      if (yDraft !== undefined) commitDate(g, drafts, b.era)
      return
    }
    const r = editSlot(form, current, slot, text)
    if ('reason' in r) { showNotice(r.reason); return }
    queueEdits([{ slot, text }])
  }, [form, current, dateGroups, drafts, queueEdits, commitDate, showNotice])

  /** 打った文字。下書きの欄は確定するまで持つ */
  const type = useCallback((slot: string, text: string) => {
    if (!form) return
    if (!needsDraft(form.bindings[slot])) { edit(slot, text); return }
    setDrafts((prev) => new Map(prev).set(slot, text))
    setReason(slot, null)
  }, [form, edit, setReason])

  /** 欄を離れた・Enter。下書きを確定する */
  const commit = useCallback((slot: string) => {
    if (!form) return
    const b = form.bindings[slot]
    if (!b) return
    if (b.op === 'date@1') { commitDate(groupOf(b), drafts, eraDrafts.get(groupOf(b))); return }
    const t = drafts.get(slot)
    if (t === undefined) return
    if (t === (rendered[slot] ?? '')) { dropDrafts([slot]); return }
    const r = editSlot(form, current, slot, t)
    if ('reason' in r) { setReason(slot, r.reason); return }
    queueEdits([{ slot, text: t }])
    dropDrafts([slot])
  }, [form, drafts, eraDrafts, rendered, current, commitDate, queueEdits, dropDrafts, setReason])

  /** 欄に出す文字（下書きがあれば下書き。元号の丸は下書きの元号） */
  const display = useCallback((slot: string): string => {
    const b = form?.bindings[slot]
    if (b?.op === 'era@1') {
      const e = eraDrafts.get(groupOf(b))
      if (e) return e === b.era ? 'true' : 'false'
    }
    return drafts.get(slot) ?? rendered[slot] ?? ''
  }, [form, drafts, eraDrafts, rendered])

  /** 欄の値をそのまま変える（差分の欄）。元の値は、この欄を最初に直したときのサーバーの値 */
  const setValue = useCallback((key: string, value: unknown, mode: 'edit' | 'revert' = 'edit') => {
    const conflict = pending.conflicts.get(key)
    if (conflict) {
      pending.conflicts = new Map(pending.conflicts).set(key, { ...conflict, value, mode })
      redraw((n) => n + 1)
      return
    }
    const queued = pending.fields.get(key)
    const base = queued ? queued.base : refs.current.doc?.fields[key]?.value ?? null
    pending.fields = new Map(pending.fields).set(key, { value, base, mode })
    redraw((n) => n + 1)
    schedule()
  }, [pending, schedule])

  const resolveConflict = useCallback((key: string, reapply: boolean) => {
    const draft = pending.conflicts.get(key)
    if (!draft) return
    pending.conflicts = new Map(pending.conflicts)
    pending.conflicts.delete(key)
    if (reapply) {
      pending.fields = new Map(pending.fields).set(key, { ...draft, base: doc?.fields[key]?.value ?? null })
      schedule()
    }
    redraw((n) => n + 1)
  }, [doc, pending, schedule])

  const doSave = useCallback(async (body: Parameters<typeof api.save>[1]): Promise<boolean> => {
    if (!docId || !(await flush()) || pending.conflicts.size) return false
    try {
      const r = await api.save(docId, body)
      publish(r.document)
      return true
    } catch (e) {
      setError(String((e as Error).message))
      return false
    }
  }, [docId, flush, pending, publish])

  // ---------- ページ・画像 ----------
  const pages = useMemo(() => (form ? pagesOf(form) : []), [form])
  const slotPage = useMemo(() => (form ? slotPages(form) : new Map<string, number>()), [form])

  const imageOf = useCallback((no: number): string | null => assets?.pages.find((p) => p.no === no)?.url ?? null, [assets])
  /** 画像が読めなかった（URL の期限切れなど）。1 回だけ URL を取り直す */
  const imageFailed = useCallback(() => {
    if (retried.current || !form) return false
    retried.current = true
    void loadAssets(form.id)
    return true
  }, [form, loadAssets])

  /** AI が書いた、差分表示に対応する文章欄または単行欄か */
  const diffOf = useCallback((s: SlotView): { key: string, before: string, after: string, ai: string } | null => {
    if ((s.kind !== 'area' && s.kind !== 'text') || s.binding?.op !== 'text@1' || s.binding.ref.path?.length) return null
    const key = s.binding.ref.key
    const f = doc?.fields[key]
    const after = typeof current[key] === 'string' ? (current[key] as string) : ''
    const before = typeof saved[key] === 'string' ? (saved[key] as string) : ''
    if (!f || typeof f.aiValue !== 'string' || after === before) return null
    return { key, before, after, ai: f.aiValue }
  }, [doc, current, saved])

  const counts = useMemo(() => {
    const out = new Map<number, PageCount>()
    for (const p of pages) out.set(p.no, { ai: 0, hand: 0 })
    for (const p of pages) {
      const c = out.get(p.no)!
      for (const s of p.slots) {
        const d = diffOf(s)
        if (d) { c.ai += sentenceDiff(d.before, d.after).length; continue }
        const m = marks.get(s.name)
        if (m === 'ai') c.ai++
        else if (m === 'cm') c.hand++
      }
    }
    return out
  }, [pages, marks, diffOf])

  const total = useMemo(() => [...counts.values()].reduce((a, c) => ({ ai: a.ai + c.ai, hand: a.hand + c.hand }), { ai: 0, hand: 0 }), [counts])

  /** 2 回目からの AI の書き換え（前の文があるところ）がページにいくつあるか。updatedFields は書き換えた欄の数 */
  const { updates, updatedFields } = useMemo(() => {
    const out = new Map<number, number>()
    const keys = new Set<string>()
    for (const p of pages) {
      let n = 0
      for (const s of p.slots) {
        const d = diffOf(s)
        if (d && d.before) { n += sentenceDiff(d.before, d.after).length; keys.add(d.key) }
      }
      if (n) out.set(p.no, n)
    }
    return { updates: out, updatedFields: keys.size }
  }, [pages, diffOf])

  return {
    doc, form, pages, slotPage, current, saved, rendered, renderedSaved, marks, counts, total, updates, updatedFields, sync, notice, error,
    pendingCount: slotQueue.length + fieldQueue.size + conflicts.size,
    conflicts, resolveConflict,
    hasLocalEdits: slotQueue.length + fieldQueue.size + conflicts.size + drafts.size + eraDrafts.size > 0,
    hasPdf: assets?.hasPdf ?? false,
    edit, type, commit, display, reasons, setValue, flush, reload: load, diffOf, imageOf, imageFailed,
    adoptSurvey: async (body: Parameters<typeof api.importSurvey>[1]) => {
      if (!docId || active.current !== docId) throw new Error('用紙が切り替わりました。')
      const result = await api.importSurvey(docId, body)
      publish(result.document)
    },
    savePage: (no: number) => doSave({ scope: 'page', page: no }),
    saveDocument: () => doSave({ scope: 'document' }),
    saveHunk: (key: string, hunkIndex: number) => doSave({ scope: 'hunk', key, hunkIndex }),
  }
}

export type DocState = ReturnType<typeof useDocument>
