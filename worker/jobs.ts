// 録音 1 本の処理（決まった流れ）: 文字にする → 話した人 → 2 層改で欄の値 → 型の確かめ → applyBatch。
// 段ごとに結果を jobs.steps に残し、やり直しでは済んだ段を飛ばす（STT と Gemini の費用を 2 回払わない）。
// ログには中身（話・値）を出さない。出すのは、ジョブの id・段・時間・エラーの種類・使った量だけ。
import { validValue } from '../core/schema.ts'
import type { Db } from '../db/pool.ts'
import { applyBatch } from '../db/repo.ts'
import type { Storage } from '../api/storage.ts'
import type { Person, Providers, Usage, Utterance, Visit } from './types.ts'

export interface WorkerDeps {
  db: () => Promise<Db>
  storage: () => Storage
  providers: () => Promise<Providers>
}

const log = (rec: Record<string, unknown>) => console.log(JSON.stringify({ severity: 'INFO', ...rec }))

async function setStep(db: Db, jobId: string, step: string, patch: Record<string, unknown> = {}) {
  await db.query(
    "UPDATE jobs SET step = $2, steps = steps || $3::jsonb, updated_at = now(), lease_until = now() + interval '30 minutes' WHERE id = $1",
    [jobId, step, JSON.stringify(patch)],
  )
}

const md = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`
/** 日本の日付（YYYY-MM-DD） */
const ymd = (d: Date) => new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10)

export async function runJob(deps: WorkerDeps, jobId: string): Promise<void> {
  const db = await deps.db()
  // 始める印を付ける（期限つき）。同じジョブが 2 回届いても、2 つ目は何もしない
  let job
  try {
    job = (await db.query(
      `UPDATE jobs SET status = 'processing', attempts = attempts + 1, lease_until = now() + interval '30 minutes', updated_at = now()
       WHERE id = $1 AND (status = 'queued' OR (status = 'processing' AND lease_until < now()))
       RETURNING id, office_id, client_id, document_id, recording_id, steps`,
      [jobId],
    )).rows[0]
  } catch (e) {
    // 同じ書類で別のジョブが処理中（一意の索引）。見回りがあとで積み直す
    if ((e as { code?: string }).code === '23505') return log({ msg: 'job waits for another job', jobId })
    throw e
  }
  if (!job) return log({ msg: 'job already taken or done', jobId })
  const steps = (job.steps ?? {}) as Record<string, Record<string, unknown>>
  const providers = await deps.providers()
  const t0 = Date.now()
  try {
    const rec = (await db.query('SELECT id, object_path, mime, recorded_at FROM recordings WHERE id = $1', [job.recording_id])).rows[0]
    const sequence = Number((await db.query(
      // 時刻は JS の Date にするとマイクロ秒が落ちるので、DB の中で比べる
      "SELECT count(*) AS n FROM recordings WHERE client_id = $1 AND status = 'uploaded' AND recorded_at <= (SELECT recorded_at FROM recordings WHERE id = $2)",
      [job.client_id, rec.id],
    )).rows[0].n) || 1

    // ① 文字にする
    let utterances: Utterance[]
    const existing = (await db.query('SELECT utterances FROM transcripts WHERE recording_id = $1', [rec.id])).rows[0]
    if (existing) utterances = existing.utterances
    else {
      await setStep(db, jobId, 'transcribe')
      const s0 = Date.now()
      const stt = await providers.stt.transcribe({
        uri: deps.storage().uri('source', rec.object_path), mime: rec.mime, recordingId: rec.id, sequence,
        resumeOperation: steps.transcribe?.operation as string | undefined,
        onOperation: (name) => setStep(db, jobId, 'transcribe', { transcribe: { operation: name } }),
      })
      utterances = stt.utterances
      await db.query(
        'INSERT INTO transcripts (recording_id, office_id, client_id, utterances, model) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (recording_id) DO NOTHING',
        [rec.id, job.office_id, job.client_id, JSON.stringify(utterances), stt.model],
      )
      await setStep(db, jobId, 'transcribe', { transcribe: { seconds: (Date.now() - s0) / 1000, utterances: utterances.length, audioSeconds: stt.audioSeconds ?? null, model: stt.model } })
    }

    // ② 話した人を決める
    const people: Person[] = (await db.query('SELECT label, role, relation FROM people WHERE client_id = $1', [job.client_id])).rows
    if (!steps.speakers) {
      await setStep(db, jobId, 'speakers')
      const r = await providers.speakers.assign({ utterances, people })
      for (const p of r.newPeople) {
        await db.query('INSERT INTO people (office_id, client_id, label, role, relation) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (client_id, label) DO NOTHING', [job.office_id, job.client_id, p.label, p.role, p.relation ?? null])
        people.push(p)
      }
      utterances = utterances.map((u) => ({ ...u, person: u.person ?? r.map[u.speaker] ?? null }))
      await db.query('UPDATE transcripts SET utterances = $2, speakers = $3 WHERE recording_id = $1', [rec.id, JSON.stringify(utterances), JSON.stringify(r.map)])
      await setStep(db, jobId, 'speakers', { speakers: { people: people.length, usage: r.usage } })
    }

    // ③ 2 層改で欄の値を作る（記録は、この利用者の録音の全部）
    await setStep(db, jobId, 'write')
    const all = (await db.query(
      `SELECT r.id, r.recorded_at, t.utterances FROM recordings r JOIN transcripts t ON t.recording_id = r.id
       WHERE r.client_id = $1 AND r.recorded_at <= (SELECT recorded_at FROM recordings WHERE id = $2) ORDER BY r.recorded_at`,
      [job.client_id, rec.id],
    )).rows
    const visits: Visit[] = all.map((r, i) => ({
      id: `r${i + 1}`,
      date: new Date(r.recorded_at).toISOString().slice(0, 10),
      scenes: [{ id: `r${i + 1}`, kind: '会話', entries: (r.utterances as Utterance[]).map((u) => ({ id: u.id, speaker: u.person ?? u.speaker, text: u.text })) }],
    }))
    const curRows = (await db.query('SELECT key, value, by FROM field_values WHERE client_id = $1 AND (document_id = $2 OR document_id IS NULL)', [job.client_id, job.document_id])).rows
    const current = Object.fromEntries(curRows.map((r) => [r.key, r.value]))
    const first = !(await db.query("SELECT 1 FROM jobs WHERE document_id = $1 AND status IN ('succeeded', 'partial') AND id <> $2 LIMIT 1", [job.document_id, jobId])).rows.length
    const w0 = Date.now()
    const written = await providers.writer.write({ visits, newVisitId: visits[visits.length - 1].id, current, people, first })

    // ④ 型の確かめ（fields.json から作った zod）。通らない値は落として数える
    const proposed: Record<string, { value: unknown, cite?: string[] }> = {}
    let dropped = 0
    for (const [k, v] of Object.entries(written.values)) {
      if (validValue(k, v.value)) proposed[k] = v
      else dropped++
    }
    await setStep(db, jobId, 'write', { write: { seconds: (Date.now() - w0) / 1000, values: Object.keys(proposed).length, dropped, failed: written.failed, usage: written.usage satisfies Usage, first } })

    // ⑤ 用紙に反映する（書類の行を止めるのは、ここの数秒だけ）
    await setStep(db, jobId, 'apply')
    const n = Number((await db.query("SELECT count(*) AS n FROM batches WHERE document_id = $1 AND kind = 'recording'", [job.document_id])).rows[0].n) + 1
    const { batchId, plan } = await applyBatch(db, {
      officeId: job.office_id, documentId: job.document_id, kind: 'recording', jobId,
      label: `AI 書き込み ${n}・${md(new Date(rec.recorded_at))} の録音`, proposed,
      // 1 回目の録音の日を、アセスメント実施日（初回）にする。2 回目からは更新の日
      system: first ? (current['assessment.initialDate'] ? {} : { 'assessment.initialDate': ymd(new Date(rec.recorded_at)) }) : { 'assessment.updateDate': ymd(new Date(rec.recorded_at)) },
    })
    const status = written.failed.length ? 'partial' : 'succeeded'
    await db.query(
      "UPDATE jobs SET status = $2, step = 'done', batch_id = $3, steps = steps || $4::jsonb, lease_until = NULL, updated_at = now() WHERE id = $1",
      [jobId, status, batchId, JSON.stringify({ apply: { changes: plan.changes.length, kept: plan.kept.length }, totalSeconds: (Date.now() - t0) / 1000 })],
    )
    log({ msg: 'job done', jobId, status, seconds: (Date.now() - t0) / 1000, changes: plan.changes.length, kept: plan.kept.length })
  } catch (e) {
    const kind = (e as Error)?.name ?? 'Error'
    await db.query("UPDATE jobs SET status = 'failed', error_kind = $2, lease_until = NULL, updated_at = now() WHERE id = $1", [jobId, kind])
    console.error(JSON.stringify({ severity: 'ERROR', msg: 'job failed', jobId, error: kind }))
    // 中身が入りうるので、ローカルで調べるときだけ出す
    if (process.env.DEBUG_JOBS) console.error(e)
    throw e
  }
}

/** 見回り: 積み損ね・止まった処理・待たされたジョブを積み直す（Cloud Scheduler が 5 分ごとに呼ぶ） */
export async function reconcile(deps: WorkerDeps, enqueue: (jobId: string) => Promise<void>): Promise<number> {
  const db = await deps.db()
  const r = await db.query(
    `SELECT id FROM jobs
     WHERE (status = 'queued' AND updated_at < now() - interval '2 minutes')
        OR (status = 'processing' AND lease_until < now())
     ORDER BY created_at LIMIT 20`,
  )
  for (const row of r.rows) await enqueue(row.id)
  return r.rows.length
}
