import { sameValue } from '../../core/apply-batch.ts'
import { isEmpty, renderSlot, type Values } from '../../core/binding.ts'
import { spec } from '../../core/fields.ts'
import { missingRequiredKeys } from '../../core/required.ts'
import { surveyChoice } from '../../core/survey-import.ts'
import type { PageLayout, SlotView } from '../form/layout.ts'
import type { DocumentView } from '../lib/api.ts'
import type { SurveyPreview } from '../survey/readSurvey.ts'

export const fieldLabel = (key: string) => spec(key)?.label ?? key

export function fieldTargets(pages: PageLayout[]) {
  const targets = new Map<string, { pageIndex: number, slots: SlotView[] }>()
  pages.forEach((page, pageIndex) => {
    for (const slot of page.slots) {
      const key = slot.binding?.ref.key
      if (!key || slot.binding?.op === 'ageAt@1') continue
      const target = targets.get(key)
      if (!target) targets.set(key, { pageIndex, slots: [slot] })
      else if (target.pageIndex === pageIndex) target.slots.push(slot)
    }
  })
  return targets
}

export const interviewTopics = [
  {
    title: '日常での様子の変化', icon: 'calendar-event',
    hints: [
      { key: 'person.lifeHistory', text: '以前と比べて変わった暮らし方や習慣' },
      { key: 'dailySchedule', text: '起床から就寝までの過ごし方' },
      { key: 'health.history', text: '病気やけがのあとに変わった日常の様子' },
    ],
  },
  {
    title: '困っている場面', icon: 'exclamation-triangle',
    hints: [
      { key: 'survey.2_2', text: '家の中を移動するときに手助けが必要な場面' },
      { key: 'survey.1_7', text: '歩くときにふらつきや不安を感じる場面' },
      { key: 'survey.2_5', text: '排尿のときに見守りや手助けが必要なこと' },
      { key: 'housing.toiletStyle', text: '普段使うトイレの形と使いづらさ' },
    ],
  },
  {
    title: 'ご本人の感じ方', icon: 'person',
    hints: [{ key: 'complaint.person', text: 'ご本人が困っていることや、これからも続けたいこと' }],
  },
  {
    title: 'ご家族の気づき', icon: 'people',
    hints: [{ key: 'family.members', text: '普段そばにいるご家族と、ご本人との関わり方' }],
  },
  {
    title: '場面ごとの具体例', icon: 'house',
    hints: [
      { key: 'survey.2_4', text: '食事で自分でできることと、手助けが必要なこと' },
      { key: 'survey.1_10', text: 'お風呂で自分で洗えるところと、手助けが必要なところ' },
      { key: 'survey.2_2', text: '居室から食卓やトイレへ移動する様子' },
      { key: 'survey.2_12', text: '普段どのくらい外出しているか' },
    ],
  },
]

export function availableTopics(values: Values, targets: ReturnType<typeof fieldTargets>) {
  const missing = missingRequiredKeys(values)
  return interviewTopics.flatMap((topic) => {
    const hints = topic.hints.filter(({ key }) => missing.has(key) && targets.has(key))
    return hints.length ? [{ ...topic, hints }] : []
  })
}

export interface SurveyDraft {
  candidate: SurveyPreview['candidates'][number]
  source: Omit<SurveyPreview, 'candidates'>
  value: string | undefined
  conflicts?: SurveyDraft[]
  baseline: unknown
  blocked: boolean
}

export function stageSurvey(preview: SurveyPreview, current: Values, saved: Values) {
  const { candidates, ...source } = preview
  return candidates.flatMap((candidate): SurveyDraft[] => {
    const { key, choice } = candidate
    const value = choice === null ? undefined : surveyChoice(key, choice)
    if (value !== undefined && sameValue(current[key], value)) return []
    return [{ candidate, source, value, baseline: current[key], blocked: !isEmpty(current[key]) || !isEmpty(saved[key]) }]
  })
}

export function mergeSurveyDrafts(previous: SurveyDraft[], incoming: SurveyDraft[]) {
  const merged = new Map(previous.map((draft) => [draft.candidate.key, draft]))
  for (const draft of incoming) {
    const key = draft.candidate.key
    const prior = merged.get(key)
    if (prior?.source.sha256 === draft.source.sha256 || prior?.conflicts?.some((other) => other.source.sha256 === draft.source.sha256)) continue
    if (prior && prior.value !== undefined && draft.value !== undefined && prior.value !== draft.value) {
      const { conflicts = [], ...earlier } = prior
      merged.set(key, { ...draft, blocked: true, conflicts: [...conflicts, earlier] })
    } else if (!prior || (prior.value === undefined && draft.value !== undefined)) {
      merged.set(key, draft)
    }
  }
  return [...merged.values()]
}

export function surveyOverlays(drafts: SurveyDraft[], current: Values, saved: Values, targets: ReturnType<typeof fieldTargets>) {
  const slots = new Map<string, SurveyDraft>()
  for (const draft of drafts) {
    const { key } = draft.candidate
    if (draft.blocked || draft.value === undefined || !isEmpty(current[key]) || !isEmpty(saved[key])) continue
    const values = { ...current, [key]: draft.value }
    const slot = targets.get(key)?.slots.find((s) => s.kind === 'circle' && s.binding && renderSlot(s.binding, values) === 'true')
    if (slot) slots.set(slot.name, draft)
  }
  return slots
}

export interface ReviewItem {
  key: string
  value: string
  confirmed: boolean
  reason?: string
}

export function reviewItems(doc: Pick<DocumentView, 'fields'> | null, current: Values, saved: Values, drafts: SurveyDraft[], targets: ReturnType<typeof fieldTargets>) {
  const items = new Map<string, ReviewItem>()
  for (const [key, field] of Object.entries(doc?.fields ?? {})) {
    if (!targets.has(key) || isEmpty(current[key]) || !(field.by === 'ai' || field.batchId || field.surveySource)) continue
    const value = current[key]
    items.set(key, { key, value: displayValue(value), confirmed: sameValue(value, saved[key]) })
  }
  const pendingSources: ReviewItem[] = []
  for (const { candidate, value, baseline, conflicts } of drafts) {
    const { key, reason } = candidate
    if (!targets.has(key)) continue
    const now = current[key]
    const confirmed = !isEmpty(now) && !sameValue(now, baseline) && sameValue(now, saved[key])
    const detail = confirmed ? undefined : conflicts?.length ? '読み取った書類同士で値が異なります'
      : reason ?? (!isEmpty(now) && !sameValue(now, value) ? `用紙の現在値：${displayValue(now)}` : undefined)
    const item = { key, value: confirmed ? displayValue(now) : value ?? (isEmpty(now) ? '' : `用紙：${displayValue(now)}`), confirmed, reason: detail }
    if (!confirmed && items.get(key)?.confirmed) pendingSources.push(item)
    else items.set(key, item)
  }
  return [...items.values(), ...pendingSources]
}

function displayValue(value: unknown): string {
  if (isEmpty(value)) return ''
  if (typeof value !== 'object') return String(value)
  return Object.values(value as Record<string, unknown>).map(displayValue).filter(Boolean).join('、')
}
