/** 「書類を作る」に出す書類。available が false のものは「後日公開」と出して押せなくする。 */
export const COMING_SOON_LABEL = '後日公開'

export type NewDocMenuItem = { label: string; available: boolean }

export const newDocMenu: readonly NewDocMenuItem[] = [
  { label: 'モニタリング', available: false },
  { label: 'デイの体験用紙', available: false },
]
