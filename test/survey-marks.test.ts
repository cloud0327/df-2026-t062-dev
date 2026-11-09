import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readBoxMarks } from '../src/survey/marks.ts'
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

test('原本の枠を照合し、選択肢の順序で濃い印と薄い印を区別する', () => {
  const boxes = [[90, 10], [140, 10], [190, 10], [240, 10]] as const
  assert.deepEqual(readBoxMarks(row([null, 220, null, 0]), boxes, 1, 11, 14), ['empty', 'faint', 'empty', 'clear'])
  assert.deepEqual(readBoxMarks(row([0, null, 0]), [boxes[2], boxes[0]], 1, 11, 14), ['clear', 'clear'])
  assert.throws(() => readBoxMarks(row([null, 0, null]), boxes, 1, 11, 14), /選択欄の位置/)
})

test('複数回答は選択肢順で返し、「ない」と他の選択肢の併用を拒否する', () => {
  assert.equal(SURVEY_IMPORT_KEYS.length, 55)
  assert.deepEqual(surveyChoice('survey.1_1', [4, 2]), ['左上肢', '左下肢'])
  assert.deepEqual(surveyChoice('survey.1_1', [1]), ['ない'])
  assert.equal(surveyChoice('survey.1_1', [1, 2]), undefined)
  assert.equal(surveyChoice('survey.1_1', [2, 2]), undefined)
  assert.equal(surveyChoice('survey.2_3', 4), undefined)
  assert.equal(surveyChoice('survey.2_3', [1, 2]), undefined)
})
