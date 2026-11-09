// 1 つの書類の値を持ち、直しを api に送る。
//   - 直しはその場で画面に出し、少し待ってからまとめて送る（AI が見るのはサーバーの用紙なので、早めに送る）
//   - 印は「保存した値」と「今の値」の違いで出す（橙＝AI、黄＝ケアマネ）
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FORMS, slotPages } from '../../forms/index.ts'
import { sentenceDiff } from '../../core/diff.ts'
import { applyChanges, editSlot, renderSlots, slotMarks, type Change, type Values, type Who } from '../../core/slots.ts'
import { api, type DocumentView } from '../lib/api.ts'
import { pagesOf, type SlotView } from './layout.ts'

interface Pending { value: unknown, mode?: 'edit' | 'revert' }

export interface PageCount { ai: number, hand: number }

export function useDocument(docId: string | undefined) {
  const [doc, setDoc] = useState<DocumentView | null>(null)
  const [pending, setPending] = useState<Map<string, Pending>>(new Map())
  const [sync, setSync] = useState('')
  const [error, setError] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const inflight = useRef<Promise<void> | null>(null)
  const pendingRef = useRef(pending)
  pendingRef.current = pending

  const load = useCallback(async () => {
    if (!docId) return
    try {
      const r = await api.document(docId)
      setDoc(r.document)
    } catch (e) {
      setError(String((e as Error).message))
    }
  }, [docId])

  useEffect(() => {
    setDoc(null)
    setPending(new Map())
    void load()
  }, [load])

  const form = doc ? FORMS[doc.form] : null

  const current = useMemo<Values>(() => {
    if (!doc) return {}
    const base = Object.fromEntries(Object.entries(doc.fields).map(([k, f]) => [k, f.value]))
    return applyChanges(base, [...pending].map(([key, p]) => ({ key, value: p.value })))
  }, [doc, pending])

  const saved = useMemo<Values>(() => (doc ? Object.fromEntries(Object.entries(doc.saved).map(([k, s]) => [k, s.value])) : {}), [doc])

  const byOf = useCallback((key: string): Who | undefined => {
    const p = pending.get(key)
    if (p && p.mode !== 'revert') return 'cm'
    return doc?.fields[key]?.by ?? doc?.saved[key]?.by
  }, [doc, pending])

  const rendered = useMemo(() => (form ? renderSlots(form, current) : {}), [form, current])
  const renderedSaved = useMemo(() => (form ? renderSlots(form, saved) : {}), [form, saved])
  const marks = useMemo(() => (form ? slotMarks(form, current, saved, byOf) : new Map<string, Who>()), [form, current, saved, byOf])

  const flush = useCallback(async () => {
    if (!docId) return
    if (timer.current) { clearTimeout(timer.current); timer.current = undefined }
    while (inflight.current) await inflight.current
    const batch = [...pendingRef.current]
    if (!batch.length) return
    const run = (async () => {
      try {
        const r = await api.patch(docId, batch.map(([key, p]) => ({ key, value: p.value ?? null, mode: p.mode })))
        setDoc(r.document)
        // 送っている間に打った直しは残す
        setPending((prev) => {
          const next = new Map(prev)
          for (const [k, p] of batch) if (next.get(k) === p) next.delete(k)
          return next
        })
        if (r.syncedTo.length) {
          setSync(r.syncedTo.join('・'))
          setTimeout(() => setSync(''), 3000)
        }
        setError('')
      } catch (e) {
        setError(String((e as Error).message))
      }
    })()
    inflight.current = run
    await run
    inflight.current = null
  }, [docId])

  const queue = useCallback((changes: Change[], mode?: 'edit' | 'revert') => {
    if (!changes.length) return
    setPending((prev) => {
      const next = new Map(prev)
      for (const c of changes) next.set(c.key, { value: c.value, mode })
      return next
    })
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), 600)
  }, [flush])

  /** 印字欄を直した */
  const edit = useCallback((slot: string, text: string) => {
    if (!form) return
    queue(editSlot(form, current, slot, text))
  }, [form, current, queue])

  /** 欄の値をそのまま変える（差分の欄） */
  const setValue = useCallback((key: string, value: unknown, mode: 'edit' | 'revert' = 'edit') => {
    queue([{ key, value }], mode)
  }, [queue])

  const doSave = useCallback(async (body: Parameters<typeof api.save>[1]) => {
    if (!docId) return
    await flush()
    try {
      const r = await api.save(docId, body)
      setDoc(r.document)
    } catch (e) {
      setError(String((e as Error).message))
    }
  }, [docId, flush])

  // 印字欄 → ページ、ページごとの未保存の数
  const pages = useMemo(() => (doc ? pagesOf(doc.form) : []), [doc])
  const slotPage = useMemo(() => (form ? slotPages(form) : new Map<string, number>()), [form])

  /** 差分の欄として出す、AI が書いた長い文章の欄か */
  const diffOf = useCallback((s: SlotView): { key: string, before: string, after: string, ai: string } | null => {
    if (s.kind !== 'area' || s.entry?.kind !== 'text' || s.entry.path.length) return null
    const key = s.entry.key
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
    doc, form, pages, slotPage, current, saved, rendered, renderedSaved, marks, counts, total, updates, updatedFields, sync, error,
    pendingCount: pending.size,
    edit, setValue, flush, reload: load, diffOf,
    savePage: (no: number) => doSave({ scope: 'page', page: no }),
    saveDocument: () => doSave({ scope: 'document' }),
    saveHunk: (key: string, hunkIndex: number) => doSave({ scope: 'hunk', key, hunkIndex }),
  }
}

export type DocState = ReturnType<typeof useDocument>
