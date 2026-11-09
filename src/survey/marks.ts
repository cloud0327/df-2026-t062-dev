interface Box { x: number, y: number, w: number, h: number }

export function readRowMarks(image: ImageData, baseline: number, scale: number) {
  const gray = (x: number, y: number) => {
    const i = 4 * (y * image.width + x)
    return (image.data[i] + image.data[i + 1] + image.data[i + 2]) / 3
  }
  const dark = (x: number, y: number) => gray(x, y) < 100
  const xStart = Math.floor(image.width * 0.14)
  const xEnd = Math.floor(image.width * 0.46)
  const boxes: Box[] = []

  // Find the four printed squares in the row rather than assuming the PDF's coordinates.
  for (let y = Math.round(baseline - 13 * scale); y <= baseline - 7 * scale; y++) {
    for (let x = xStart; x < xEnd;) {
      if (!dark(x, y)) { x++; continue }
      const left = x
      while (x < xEnd && dark(x, y)) x++
      const w = x - left
      if (w < 10 * scale || w > 14 * scale || boxes.some((b) => Math.abs(b.x - left) < 3 * scale)) continue
      for (let h = Math.round(12 * scale); h <= 16 * scale; h++) {
        const right = x - 1
        if (dark(left + Math.round(w / 2), y + h) &&
            [0.25, 0.5, 0.75].every((at) => {
              const mid = y + Math.round(at * h)
              return dark(left, mid) && dark(right, mid)
            })) {
          boxes.push({ x: left, y, w, h })
          break
        }
      }
    }
  }

  if (boxes.length !== 4) throw new Error('選択欄の位置を確認できません。対応する様式のPDFを選んでください。')
  return boxes.sort((a, b) => a.x - b.x).map((b) => {
    const pad = Math.ceil(scale * 1.6)
    let total = 0
    let ink = 0
    let strong = 0
    for (let y = b.y + pad; y < b.y + b.h - pad; y++) {
      for (let x = b.x + pad; x < b.x + b.w - pad; x++) {
        const v = gray(x, y)
        total++
        if (v < 232) ink++
        if (v < 140) strong++
      }
    }
    if (strong / total > 0.055) return 'clear'
    return ink / total > 0.016 ? 'faint' : 'empty'
  })
}
