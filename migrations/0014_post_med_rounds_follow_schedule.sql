-- แบบประเมินหลังยาอ้างอิงเวลาตามตารางยา ไม่ใช่เวลาที่ผู้ใช้กด "ทานแล้ว"
-- ปรับเฉพาะรอบที่ยังไม่ได้ตอบ เพื่อไม่แก้ประวัติคำตอบที่เกิดขึ้นไปแล้ว
UPDATE pdlife.round_instances AS round
SET
  target_dose_at = log.planned_at,
  scheduled_at = log.planned_at + INTERVAL '30 minutes',
  activity_date = ((log.planned_at + INTERVAL '30 minutes') AT TIME ZONE 'Asia/Bangkok')::date,
  available_at = log.planned_at + INTERVAL '30 minutes',
  due_at = log.planned_at + INTERVAL '30 minutes',
  expires_at = log.planned_at + INTERVAL '60 minutes'
FROM pdlife.medication_logs AS log
WHERE round.medication_log_id = log.id
  AND round.template_code = 'POST_MED_MICRO'
  AND round.status = 'pending'
  AND round.completed_at IS NULL
  AND round.submitted_at IS NULL;
