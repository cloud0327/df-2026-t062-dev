// 保存した版から、様式の PDF を作る（pdfme）。AI が書いただけで保存していない値は出ない。
import { readFile } from 'node:fs/promises'
import { FORMS, type FormId } from '../forms/index.ts'
import { renderSlots } from '../core/slots.ts'

const ROOT = new URL('../forms/', import.meta.url)
let font: Promise<Uint8Array<ArrayBuffer>> | undefined
const bases = new Map<FormId, Promise<Uint8Array<ArrayBuffer>>>()

export async function makePdf(formId: FormId, values: Record<string, unknown>): Promise<Uint8Array<ArrayBuffer>> {
  const [{ generate }, { text, circleMark }] = await Promise.all([import('@pdfme/generator'), import('@pdfme/schemas')])
  const form = FORMS[formId]
  font ??= readFile(new URL('fonts/BIZUDPGothic-Regular.ttf', ROOT)).then((b) => new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer))
  if (!bases.has(formId)) bases.set(formId, readFile(new URL(`templates/${formId}/${form.template.basePdf}`, ROOT)).then((b) => new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer)))
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
