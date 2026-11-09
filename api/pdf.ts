// 保存した版から、様式の PDF を作る（pdfme）。AI が書いただけで保存していない値は出ない。
// 元の PDF は、その書類の版の様式のもの（非公開の置き場 forms の <様式の id>/v<版>/base.pdf。npm run forms:assets が入れる）。
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { renderAll } from '../core/binding.ts'
import { basePdfPath, type FormVersion } from '../db/forms.ts'
import type { Storage } from './storage.ts'

/** 様式の元の PDF が、まだ置き場にない（npm run forms:assets） */
export class FormUnavailable extends Error {}

const FONT = new URL('../forms/fonts/BIZUDPGothic-Regular.ttf', import.meta.url)
let font: Promise<Uint8Array<ArrayBuffer>> | undefined
const bases = new Map<string, Promise<Uint8Array<ArrayBuffer>>>()
const own = (b: Uint8Array) => new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer)

async function loadBase(storage: Storage, v: FormVersion): Promise<Uint8Array<ArrayBuffer>> {
  const buf = await storage.read('forms', basePdfPath(v)).catch(() => null)
  if (!buf || createHash('sha256').update(buf).digest('hex') !== v.basePdfSha256) throw new FormUnavailable(v.id)
  return own(buf)
}

export async function makePdf(storage: Storage, v: FormVersion, values: Record<string, unknown>): Promise<Uint8Array<ArrayBuffer>> {
  const [{ generate }, { text, circleMark }] = await Promise.all([import('@pdfme/generator'), import('@pdfme/schemas')])
  font ??= readFile(FONT).then(own)
  if (!bases.has(v.id)) {
    const p = loadBase(storage, v)
    p.catch(() => bases.delete(v.id))
    bases.set(v.id, p)
  }
  const template = { basePdf: await bases.get(v.id)!, schemas: v.schemas }
  const pdf = await generate({
    template: template as never,
    inputs: [renderAll(v.bindings, values)],
    plugins: { text, circleMark } as never,
    options: { font: { BIZUDPGothic: { data: await font, fallback: true, subset: true } } },
  })
  return pdf as Uint8Array<ArrayBuffer>
}
