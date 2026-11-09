import { sameValue } from './apply-batch.ts'

export type SyncStatus = 'review' | 'pending' | 'different'

/** 書類間の差異と、元書類の前回確認以降の変更を分ける。 */
export function syncStatus(source: unknown, target: unknown, reviewedSource: unknown, sourceSaved: unknown): SyncStatus | null {
  if (sameValue(source, target)) return null
  if (sameValue(source, reviewedSource)) return 'different'
  return sameValue(source, sourceSaved) ? 'review' : 'pending'
}
