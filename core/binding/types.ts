
export type Values = Record<string, unknown>
export interface Change { key: string, value: unknown }
export type Scalar = string | number | boolean

/** 値の中の場所。文字は項目、数は行の番号、match は中身で引く行（nth 番目）、flag は印の付いた行 */
export type Step = string | number | { match: Record<string, Scalar>, nth?: number } | { flag: string }
export interface Ref { key: string, path?: Step[] }

export type Test =
  | { eq: Scalar } | { in: Scalar[] } | { notIn: Scalar[] }
  | { has: Scalar } | { hasOther: Scalar[] }
  | { nonEmpty: true } | { empty: true }
  | { startsWith: string }
  | { rowWhere: Record<string, Test> }
  | { not: Test }

/** 条件。ref がなければ、対応の ref の値を見る */
export type Cond = { ref?: Ref, is: Test } | { all: Cond[] } | { any: Cond[] }

/** 丸・✓ を付けた・外したときの動き。set は（ref がなければ対応の ref に）値を入れる。null は消す */
export type Action = { set: { ref?: Ref, value: unknown }[] } | { refuse: string }

export type EraShort = 'M' | 'T' | 'S' | 'H' | 'R'

export type Binding =
  | { op: 'text@1', ui: 'text' | 'area', ref: Ref, or?: (Ref | { concat: Ref[] })[], prefix?: { text: string, flag: string }, when?: Cond }
  | { op: 'option@1', ui: 'circle' | 'check', ref: Ref, is?: Test, if?: Cond, when?: Cond, edit?: { on: Action, off: Action } }
  | { op: 'symbol@1', ui: 'cell' | 'text', ref: Ref, options: { text: string, value: Scalar }[], when?: Cond }
  | { op: 'date@1', ui: 'text', ref: Ref, part: 'y' | 'm' | 'd', year?: 'short' | 'number' | 'nameUnlessMTS', yearFrom?: Ref[], when?: Cond }
  | { op: 'era@1', ui: 'circle', ref: Ref, era: EraShort }
  | { op: 'rhythm@1', ui: 'text', ref: Ref, marks: string, text: string }
  | { op: 'ageAt@1', ui: 'text', ref: Ref, birth: Ref, at: Ref[] }
  | { op: 'join@1', ui: 'text' | 'area', ref: Ref, where: Record<string, Test>, show?: string, label?: { of: string, map?: Record<string, string>, strip?: string }, sep: string }

export type Bindings = Record<string, Binding>
export type EditResult = { changes: Change[] } | { reason: string }
