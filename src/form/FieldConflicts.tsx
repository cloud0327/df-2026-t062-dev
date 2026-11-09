import { spec } from '../../core/fields.ts'
import type { DocState } from './useDocument.ts'

function valueText(value: unknown) {
  if (value == null || value === '') return '（空欄）'
  return typeof value === 'string' ? value : JSON.stringify(value)
}

export function FieldConflicts({ state }: { state: DocState }) {
  if (!state.conflicts.size || !state.doc) return null
  return (
    <section aria-label="入力の競合" style={{ flex: '0 0 auto', maxHeight: '34vh', overflow: 'auto', padding: '12px 16px', background: '#FFF4E5', borderBottom: '1px solid #F0C78A' }}>
      <div role="status">{state.conflicts.size} 欄で入力が重なりました。残してある入力を再適用するか、破棄してください。</div>
      {[...state.conflicts].map(([key, draft]) => {
        const label = spec(key)?.label ?? key
        return (
          <div key={key} role="group" aria-label={label} style={{ marginTop: 12, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
            <strong>{label}</strong>
            <div>サーバーの値：{valueText(state.doc?.fields[key]?.value)}</div>
            <div>あなたの入力：{valueText(draft.value)}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <button type="button" aria-label={`${label}の入力を再適用`} onClick={() => state.resolveConflict(key, true)}>再適用</button>
              <button type="button" aria-label={`${label}の入力を破棄`} onClick={() => state.resolveConflict(key, false)}>破棄</button>
            </div>
          </div>
        )
      })}
    </section>
  )
}
