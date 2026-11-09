export type Checkbox = readonly [x: number, top: number]
export type Mark = 'empty' | 'faint' | 'clear'

/** 既知の様式の枠を照合してから、枠の内側だけの濃さを測る。 */
export function readBoxMarks(image: ImageData, boxes: readonly Checkbox[], scale: number, width: number, height: number): Mark[] {
  const gray = (x: number, y: number) => {
    const i = 4 * (y * image.width + x)
    return (image.data[i] + image.data[i + 1] + image.data[i + 2]) / 3
  }
  const hasLine = (x: number, y: number, horizontal: boolean) => {
    const distance = Math.ceil(1.3 * scale)
    for (let delta = -distance; delta <= distance; delta++) {
      if (gray(x + (horizontal ? 0 : delta), y + (horizontal ? delta : 0)) < 155) return true
    }
    return false
  }
  return boxes.map(([x, top]) => {
    const left = Math.round(x * scale)
    const right = Math.round((x + width) * scale)
    const y0 = Math.round(top * scale)
    const y1 = Math.round((top + height) * scale)
    if (![0.25, 0.5, 0.75].every((part) => {
      const col = Math.round(left + (right - left) * part)
      const row = Math.round(y0 + (y1 - y0) * part)
      return hasLine(col, y0, true) && hasLine(col, y1, true) &&
        hasLine(left, row, false) && hasLine(right, row, false)
    })) throw new Error('選択欄の位置を確認できません。対応する広島市版のPDFを選んでください。')

    const pad = Math.ceil(1.7 * scale)
    let total = 0
    let ink = 0
    let strong = 0
    for (let y = y0 + pad; y < y1 - pad; y++) {
      for (let px = left + pad; px < right - pad; px++) {
        const value = gray(px, y)
        total++
        if (value < 232) ink++
        if (value < 140) strong++
      }
    }
    if (strong / total > 0.055) return 'clear'
    return ink / total > 0.016 ? 'faint' : 'empty'
  })
}
