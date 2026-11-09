import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readRowMarks } from '../src/survey/marks.ts'
import { SURVEY_IMPORT_KEYS, surveyChoice } from '../core/survey-import.ts'

// NodeにはImageDataがないため、検出器が使う画素配列と寸法だけを用意する。
function row(shades: (number | null)[]) {
  const width = 600
  const height = 50
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  const pixel = (x: number, y: number, gray: number) => {
    const offset = (y * width + x) * 4
    data[offset] = data[offset + 1] = data[offset + 2] = gray
  }
  shades.forEach((shade, i) => {
    const left = 90 + i * 50
    for (let y = 10; y <= 24; y++) {
      for (let x = left; x < left + 12; x++) {
        const border = x === left || x === left + 11 || y === 10 || y === 24
        pixel(x, y, border ? 0 : shade ?? 255)
      }
    }
  })
  return { width, height, data } as ImageData
}

test('3択と4択の印を位置順に読み、薄い印と複数の印を区別できる', () => {
  assert.deepEqual(readRowMarks(row([null, 0, null]), 23, 1, 3), ['empty', 'clear', 'empty'])
  assert.deepEqual(readRowMarks(row([null, 220, null, 0]), 23, 1, 4), ['empty', 'faint', 'empty', 'clear'])
  assert.deepEqual(readRowMarks(row([0, null, 0]), 23, 1, 3), ['clear', 'empty', 'clear'])
  assert.throws(() => readRowMarks(row([null, 0, null]), 23, 1, 4), /選択欄の位置/)
  assert.throws(() => readRowMarks(row([null, 0, null, null]), 23, 1, 3), /選択欄の位置/)
})

test('取り込み対象は第2群12項目で、3択の4番目は受け付けない', () => {
  assert.deepEqual(SURVEY_IMPORT_KEYS, Array.from({ length: 12 }, (_, i) => `survey.2_${i + 1}`))
  for (const key of ['survey.2_3', 'survey.2_7', 'survey.2_8', 'survey.2_9', 'survey.2_12'] as const) {
    assert.notEqual(surveyChoice(key, 3), undefined, key)
    assert.equal(surveyChoice(key, 4), undefined, key)
  }
})
