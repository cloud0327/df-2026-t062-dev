// README と設計書の中の相対リンクが、リポジトリの中のファイルを指しているか（設計書を直したときのリンク切れを防ぐ）
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DOCS = ['README.md', ...readdirSync(join(ROOT, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`)]

test('README と docs/ の相対リンクは、どれもあるファイルを指す', () => {
  const broken: string[] = []
  for (const doc of DOCS) {
    const text = readFileSync(join(ROOT, doc), 'utf8')
    for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const href = m[1]
      if (/^[a-z]+:/i.test(href) || href.startsWith('#')) continue
      const path = decodeURIComponent(href.split('#')[0])
      if (!existsSync(join(ROOT, dirname(doc), path))) broken.push(`${doc} → ${href}`)
    }
  }
  assert.deepEqual(broken, [])
})
