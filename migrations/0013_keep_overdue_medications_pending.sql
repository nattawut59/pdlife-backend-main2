-- Product rule: passing the planned time must never mean that a dose was
-- skipped. Keep it actionable so the patient can record the actual taken time.
-- This also repairs rows written by the retired automatic-skip behaviour.

UPDATE pdlife.medication_logs
SET status = 'pending'::pdlife.med_log_status
WHERE status = 'skipped'::pdlife.med_log_status;
