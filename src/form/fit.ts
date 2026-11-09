// 長い文章が欄に入りきらないとき、欄に収まるまで文字を小さくする（PDF の印字と同じ考え。pdfme の dynamicFontSize）
import { useLayoutEffect, useState, type RefObject } from 'react'

export function useFitScale(ref: RefObject<HTMLElement | null>, base: string, text: string, min = 0.55): number {
  const [scale, setScale] = useState(1)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !el.clientHeight) return
    let s = 1
    el.style.fontSize = base
    while (s > min && el.scrollHeight > el.clientHeight + 1) {
      s = Math.round((s - 0.05) * 100) / 100
      el.style.fontSize = `calc(${base} * ${s})`
    }
    // React が付ける値と同じにしておく（値が変わらないと React は書き直さないため）
    el.style.fontSize = scaled(base, s)
    setScale(s)
  }, [ref, base, text, min])
  return scale
}

export const scaled = (base: string, s: number) => (s >= 1 ? base : `calc(${base} * ${s})`)
