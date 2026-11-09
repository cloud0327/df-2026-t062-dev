// 認定調査票の基本調査、第1〜5群。アセスメント固有の追加欄は含めない。
import { choicesOf, spec } from './fields.ts'

const GROUP_COUNTS = [13, 12, 9, 15, 6] as const
export type SurveyImportKey = `survey.${1 | 2 | 3 | 4 | 5}_${number}`
export const SURVEY_IMPORT_KEYS = GROUP_COUNTS.flatMap((count, group) =>
  Array.from({ length: count }, (_, index) => `survey.${group + 1}_${index + 1}` as SurveyImportKey),
)

export type SurveySelection = number | number[]

export interface SurveySource {
  kind: 'survey-import'
  fileName: string
  sha256: string
  recordedOn: string | null
  page: 1 | 2
  choice: SurveySelection
}

export const surveyPage = (key: SurveyImportKey): 1 | 2 => key.startsWith('survey.1_') ? 1 : 2

export function surveyChoice(key: SurveyImportKey, choice: SurveySelection): string | string[] | undefined {
  const field = spec(key)
  if (!field) return undefined
  const choices = choicesOf(field)
  if (field.type !== 'multi') return typeof choice === 'number' ? choices[choice - 1] : undefined
  if (!Array.isArray(choice) || !choice.length || new Set(choice).size !== choice.length ||
      (choice.length > 1 && choice.includes(1))) return undefined
  const values = [...choice].sort((a, b) => a - b).map((index) => choices[index - 1])
  return values.every((value) => value !== undefined) ? values : undefined
}
