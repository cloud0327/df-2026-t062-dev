// 広島市版の先行検証。番号はアセスメントの fields.json と対応する。
import { choicesOf, spec } from './fields.ts'

export const SURVEY_IMPORT_KEYS = ['survey.2_2', 'survey.2_4', 'survey.2_5'] as const
export type SurveyImportKey = typeof SURVEY_IMPORT_KEYS[number]

export interface SurveySource {
  kind: 'survey-import'
  fileName: string
  sha256: string
  recordedOn: string | null
  page: 2
  choice: number
}

export function surveyChoice(key: SurveyImportKey, choice: number): string | undefined {
  const field = spec(key)
  return field && choicesOf(field)[choice - 1]
}
