ฉันมีเอกสารสำหรับโปรเจกต์ PDLIFE ดังนี้

PDLIFE_Functional_Requirements.docx — ขอบเขตระบบ, actors, MVP features, business rules และ non-functional requirements

PDLIFE_Question_Bank_master_v1.xlsx — คลังคำถาม, templates, conditional logic และ response options

PD_Life_Schema_v3_Complete.pdf — database schema, tables, relationships, views และ backend logic

ให้ใช้เอกสารทั้ง 3 ฉบับเป็น source of truth

สร้าง Backend สำหรับระบบ PDLIFE โดยใช้ stack ต่อไปนี้

Node.js

TypeScript

Express.js

Supabase PostgreSQL

JWT Authentication

Zod validation

Repository + Service + Controller pattern

สิ่งที่ต้องสร้าง

Project structure ที่ production-ready

Database connection และ Supabase config

Authentication และ authorization ตาม roles: patient, caregiver, nurse, doctor, admin

Middleware: auth, RBAC, validation, error handler, audit logging

Modules ตาม schema: users, patient_profiles, patient_caregivers, medications, patient_medications, medication_logs, round_instances, responses, appointments, clinic_assessments, doctor_notes, notifications, red_flags

REST API endpoints พร้อม request/response examples

Zod schemas สำหรับ validation

Scheduler logic สำหรับ medication reminders และ round_instances ตามเอกสาร schema

Conditional question flow engine จาก Question Bank

Red flag detection และ notification flow

Dashboard query/views สำหรับ C1, C2, C3

RLS policy recommendations สำหรับ Supabase

Environment variables และ setup instructions

วิธีการทำงาน

เริ่มจากออกแบบ architecture และ folder structure ก่อน

จากนั้นสร้าง authentication module

ต่อด้วย patient module และ medication module

จากนั้นสร้าง round_instances และ responses module

ต่อด้วย scheduler และ notification service

สุดท้ายสร้าง dashboard queries และ testing examples

ข้อกำหนดสำคัญ

ห้ามเดา schema ใหม่ ให้ยึดตาม PD_Life_Schema_v3_Complete.pdf

Question flow ต้องอ่านจาก question_bank, checkin_templates และ template_questions

Responses ต้องเก็บ answer_value เป็น JSONB ตาม schema

รองรับ caregiver mode และ RBAC

รองรับ offline sync ด้วย submitted_at และ received_at

ห้ามลบข้อมูล ให้ใช้ active/status flags ตาม schema

ทุก endpoint ต้องมี validation และ standardized error response

ทุกไฟล์ต้องเป็น TypeScript และพร้อมใช้งานจริง

ให้ตอบเป็นลำดับขั้น

Architecture overview

Folder structure

Environment setup

Authentication module

Core modules

Scheduler service

Question flow engine

Notification service

Dashboard queries

Example API usage

เริ่มจากขั้นตอนที่ 1: Architecture overview และ folder structure ก่อน

อย่า generate ทั้งโปรเจกต์ในครั้งเดียว ให้สร้างทีละ module พร้อมอธิบายเหตุผล