// forms/seed/<種類>/ の様式のファイル（様式の情報 form.json・欄の位置 template.json・対応 bindings.json）を読む。
import { readFileSync } from 'node:fs'
import type { Bindings } from '../../core/binding.ts'
import { FORM_KINDS, type FormKind, type FormPage, type TemplateSlot } from '../../core/form.ts'
import type { VersionInput } from '../../db/forms.ts'

export const SEED_DIR = new URL('../seed/', import.meta.url)

export interface FormMeta {
  kind: FormKind
  name: string
  title: string
  publisher: string | null
  sourceUrl: string | null
  basePdfSha256: string
  pages: FormPage[]
}

const json = (u: URL) => JSON.parse(readFileSync(u, 'utf8'))

export function readMeta(kind: FormKind): FormMeta {
  return json(new URL(`${kind}/form.json`, SEED_DIR)) as FormMeta
}

/** 登録する版の中身（全事業所の様式） */
export function readSeed(kind: FormKind): VersionInput {
  const meta = readMeta(kind)
  const template = json(new URL(`${kind}/template.json`, SEED_DIR)) as { schemas: TemplateSlot[][] }
  const bindings = json(new URL(`${kind}/bindings.json`, SEED_DIR)) as Bindings
  return {
    kind, name: meta.name, title: meta.title, publisher: meta.publisher, sourceUrl: meta.sourceUrl, officeId: null,
    schemas: template.schemas, bindings, pages: meta.pages, basePdfSha256: meta.basePdfSha256,
  }
}

export const seedKinds = (): FormKind[] => FORM_KINDS
