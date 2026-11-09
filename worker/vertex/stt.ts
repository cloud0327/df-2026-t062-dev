// Stt: Cloud Speech-to-Text v2 の BatchRecognize（Chirp 3、日本語、話者分離）。gs:// の録音を、長い処理（operation）として頼む。
// operation の名前はすぐ onOperation で残す（止まっても、同じ処理を続きから待てる）。ログに中身（文字）は出さない。
import { v2 } from '@google-cloud/speech'
import type { SttResult, Stt, Utterance } from '../types.ts'

const MODEL = 'chirp_3'

interface Duration { seconds?: number | string | { toString(): string } | null, nanos?: number | null }
interface Word { word?: string | null, startOffset?: Duration | null, endOffset?: Duration | null, speakerLabel?: string | null }
export interface SttResultRow { alternatives?: { transcript?: string | null, words?: Word[] | null }[] | null, resultEndOffset?: Duration | null }

const ms = (d?: Duration | null): number | null => d ? Math.round(Number(String(d.seconds ?? 0)) * 1000 + (d.nanos ?? 0) / 1e6) : null

const ASCII_WORD = /[A-Za-z0-9]/

/** 単語をつなぐ（日本語はそのまま、英数字どうしが並ぶときだけ空白を入れる） */
function joinWords(words: string[]): string {
  let out = ''
  for (const w of words) {
    if (out && ASCII_WORD.test(out.slice(-1)) && ASCII_WORD.test(w.slice(0, 1))) out += ' '
    out += w
  }
  return out.trim()
}

/** 認識結果を、話者が続くかたまりごとの発言にする。id は r<録音の番号>-0001… */
export function toUtterances(results: SttResultRow[], sequence: number): Utterance[] {
  type Chunk = { speaker: string, words: string[], start: number | null, end: number | null }
  const chunks: Chunk[] = []
  let lastSpeaker = 'speaker_1'
  let cursor: number | null = 0   // 単語に時刻がない結果は、前の結果の終わりから
  for (const r of results) {
    const alt = r.alternatives?.[0]
    if (!alt) continue
    const words = (alt.words ?? []).filter((w) => w.word)
    if (words.length) {
      for (const w of words) {
        const speaker = w.speakerLabel ? `speaker_${w.speakerLabel}` : lastSpeaker
        lastSpeaker = speaker
        const last = chunks[chunks.length - 1]
        if (last?.speaker === speaker) {
          last.words.push(w.word!)
          last.end = ms(w.endOffset) ?? last.end
        } else chunks.push({ speaker, words: [w.word!], start: ms(w.startOffset), end: ms(w.endOffset) })
      }
    } else if (alt.transcript?.trim()) {
      // 単語がないとき（話者分離が効かなかったとき）は、結果 1 つを 1 つの発言にする
      const end = ms(r.resultEndOffset)
      const last = chunks[chunks.length - 1]
      if (last?.speaker === lastSpeaker) { last.words.push(alt.transcript); last.end = end ?? last.end } else chunks.push({ speaker: lastSpeaker, words: [alt.transcript], start: cursor, end })
    }
    cursor = ms(r.resultEndOffset) ?? cursor
  }
  return chunks
    .map((c) => ({ ...c, text: joinWords(c.words) }))
    .filter((c) => c.text)
    .map((c, i) => ({ id: `r${sequence}-${String(i + 1).padStart(4, '0')}`, startMs: c.start, endMs: c.end, speaker: c.speaker, text: c.text }))
}

/** Speech のクライアントのうち使う部分（テストで差し替える） */
export interface SpeechApi {
  batchRecognize(request: Record<string, unknown>): Promise<[{ name?: string | null }, ...unknown[]]>
  checkBatchRecognizeProgress(name: string): Promise<{ done?: boolean, result?: unknown, error?: { code?: number } | null }>
}

export interface SttOptions {
  client?: SpeechApi
  /** 状況を聞く間隔（ミリ秒）と、待つ上限（ミリ秒。超えたら止めて、あとで続きから） */
  pollMs?: number
  maxWaitMs?: number
}

export function vertexStt(env: NodeJS.ProcessEnv, opts: SttOptions = {}): Stt {
  const project = env.GOOGLE_CLOUD_PROJECT
  const location = env.STT_LOCATION ?? 'asia-northeast1'
  const pollMs = opts.pollMs ?? 10_000
  const maxWaitMs = opts.maxWaitMs ?? Number(env.STT_MAX_WAIT_MS ?? 25 * 60_000)
  let client = opts.client
  const api = () => (client ??= new v2.SpeechClient({ apiEndpoint: `${location}-speech.googleapis.com` }) as unknown as SpeechApi)

  return {
    async transcribe({ uri, sequence, resumeOperation, onOperation }): Promise<SttResult> {
      let name = resumeOperation
      if (!name) {
        const [op] = await api().batchRecognize({
          recognizer: `projects/${project}/locations/${location}/recognizers/_`,
          config: {
            autoDecodingConfig: {},
            model: MODEL,
            languageCodes: ['ja-JP'],
            features: { diarizationConfig: {}, enableWordTimeOffsets: true, enableAutomaticPunctuation: true },
          },
          files: [{ uri }],
          recognitionOutputConfig: { inlineResponseConfig: {} },
        })
        if (!op.name) throw new Error('stt: operation name missing')
        name = op.name
        await onOperation?.(name)   // すぐ残す（止まっても続きから待てる）
      }
      const t0 = Date.now()
      for (;;) {
        const op = await api().checkBatchRecognizeProgress(name)
        if (op.done) {
          if (op.error) throw Object.assign(new Error('stt: operation failed'), { name: 'SttOperationError', code: op.error.code })
          return toResult(op.result as BatchResponse, uri, sequence)
        }
        if (Date.now() - t0 > maxWaitMs) throw Object.assign(new Error('stt: wait limit exceeded'), { name: 'SttTimeout' })
        await new Promise<void>((r) => setTimeout(r, pollMs))
      }
    },
  }
}

interface BatchResponse {
  results?: Record<string, { error?: { code?: number } | null, transcript?: { results?: SttResultRow[] | null } | null, metadata?: { totalBilledDuration?: Duration | null } | null }> | null
  totalBilledDuration?: Duration | null
}

function toResult(resp: BatchResponse, uri: string, sequence: number): SttResult {
  const files = resp?.results ?? {}
  const file = files[uri] ?? Object.values(files)[0]
  if (!file) throw Object.assign(new Error('stt: no result'), { name: 'SttEmpty' })
  if (file.error?.code) throw Object.assign(new Error('stt: file failed'), { name: 'SttFileError', code: file.error.code })
  const seconds = ms(file.metadata?.totalBilledDuration) ?? ms(resp.totalBilledDuration)
  return {
    utterances: toUtterances(file.transcript?.results ?? [], sequence),
    model: MODEL,
    ...(seconds !== null ? { audioSeconds: seconds / 1000 } : {}),
  }
}
