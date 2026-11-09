// 保存した版から、様式の PDF を作る（pdfme）。AI が書いただけで保存していない値は出ない。
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { FORMS, type FormId } from '../forms/index.ts'
import { renderSlots } from '../core/slots.ts'

/** 様式の元の PDF がない（公開リポジトリには入れていない。forms/scripts/fetch.mjs） */
export class FormUnavailable extends Error {}

// アセスメントは全社協が公開している PDF。手元になければ公式の URL から取る（中身はハッシュで確かめる）
const OFFICIAL: Partial<Record<FormId, { url: string, sha256: string }>> = {
  assessment: { url: 'https://www.shakyo.or.jp/download/careplanGL/assess.pdf', sha256: '9a8b35b1199bd205e46f2448463dc47001398411142c1d55d07478125a95e7e9' },
}

async function loadBase(formId: FormId, file: URL): Promise<Uint8Array<ArrayBuffer>> {
  try {
    const b = await readFile(file)
    return new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer)
  } catch {
    const o = OFFICIAL[formId]
    if (!o) throw new FormUnavailable(formId)
    const res = await fetch(o.url)
    const buf = new Uint8Array(await res.arrayBuffer())
    if (!res.ok || createHash('sha256').update(buf).digest('hex') !== o.sha256) throw new FormUnavailable(formId)
    return buf
  }
}

const ROOT = new URL('../forms/', import.meta.url)
let font: Promise<Uint8Array<ArrayBuffer>> | undefined
const bases = new Map<FormId, Promise<Uint8Array<ArrayBuffer>>>()

export async function makePdf(formId: FormId, values: Record<string, unknown>): Promise<Uint8Array<ArrayBuffer>> {
  const [{ generate }, { text, circleMark }] = await Promise.all([import('@pdfme/generator'), import('@pdfme/schemas')])
  const form = FORMS[formId]
  font ??= readFile(new URL('fonts/BIZUDPGothic-Regular.ttf', ROOT)).then((b) => new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer))
  if (!bases.has(formId)) {
    const p = loadBase(formId, new URL(`templates/${formId}/${form.template.basePdf}`, ROOT))
    p.catch(() => bases.delete(formId))
    bases.set(formId, p)
  }
  const template = { ...form.template, basePdf: await bases.get(formId)! }
  const inputs = renderSlots(form, values)
  const pdf = await generate({
    template: template as never,
    inputs: [inputs],
    plugins: { text, circleMark } as never,
    options: { font: { BIZUDPGothic: { data: await font, fallback: true, subset: true } } },
  })
  return pdf as Uint8Array<ArrayBuffer>
}
