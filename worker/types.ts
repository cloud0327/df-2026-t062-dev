// worker の段の約束。中身（STT・Gemini）は差し替えられる（AI_PROVIDER=fake|vertex）。

/** 原本の発言 1 つ（id は録音をまたいでも重ならない: r<録音の番号>-<連番>） */
export interface Utterance {
  id: string
  startMs: number | null
  endMs: number | null
  /** STT が振った話者の記号（speaker_1 など） */
  speaker: string
  /** 決まった人（people の label）。決められなければ null */
  person?: string | null
  text: string
}

export interface Person {
  label: string
  role: '本人' | '家族' | '専門職' | 'ケアマネ' | '不明'
  relation?: string | null
}

/** 2 層改に渡す記録の 1 回分（演習シナリオの原本.json の visits と同じ形） */
export interface Visit {
  id: string
  date: string
  scenes: { id: string, kind: '会話' | '観察' | '経過' | '書類', entries: { id: string, speaker: string | null, text: string, date?: string }[] }[]
}

export interface Usage {
  calls: number
  promptTokens: number
  outputTokens: number
  thinkingTokens: number
  /** 円（見込みの単価で計算） */
  yen: number
}

export interface SttResult {
  utterances: Utterance[]
  model: string
  /** 長い処理を続きから聞くための名前（Cloud Speech の operation） */
  operation?: string
  audioSeconds?: number
}

export interface Stt {
  transcribe(input: { uri: string, mime: string, recordingId: string, sequence: number, resumeOperation?: string, onOperation?: (name: string) => Promise<void> }): Promise<SttResult>
}

export interface SpeakerAssigner {
  assign(input: { utterances: Utterance[], people: Person[] }): Promise<{ map: Record<string, string | null>, newPeople: Person[], usage: Usage }>
}

export interface ProposedValue {
  value: unknown
  /** 根拠の発言の id */
  cite?: string[]
}

export interface WriterResult {
  values: Record<string, ProposedValue>
  usage: Usage
  /** 書けなかった 23 項目の番号など（一部だけ書けたとき） */
  failed: string[]
}

export interface SheetWriter {
  /**
   * 1 回目（その書類に AI が書いた値がない）: 記録の全部から書く。
   * 2 回目から: 今の値と新しい記録だけで直す（2 層改の工夫 3）。
   */
  write(input: { visits: Visit[], newVisitId: string, current: Record<string, unknown>, people: Person[], first: boolean }): Promise<WriterResult>
}

export interface Providers {
  stt: Stt
  speakers: SpeakerAssigner
  writer: SheetWriter
}

export const ZERO_USAGE: Usage = { calls: 0, promptTokens: 0, outputTokens: 0, thinkingTokens: 0, yen: 0 }
