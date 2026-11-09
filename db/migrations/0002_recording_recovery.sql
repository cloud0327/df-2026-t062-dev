ALTER TABLE recordings
  ADD COLUMN device_recording_id uuid,
  ADD COLUMN upload_url text,
  ADD CONSTRAINT recordings_device_id_unique UNIQUE (office_id, client_id, device_recording_id);

ALTER TABLE jobs ADD COLUMN initial_enqueued_at timestamptz;
