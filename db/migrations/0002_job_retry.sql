-- 同じジョブの古い実行を識別し、録音の反映を一度だけにする。
ALTER TABLE jobs ADD COLUMN run_token uuid;
CREATE UNIQUE INDEX batches_recording_job_once ON batches (job_id)
  WHERE kind = 'recording' AND job_id IS NOT NULL;
