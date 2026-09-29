import type { Request, Response } from "express";
import * as appUserService from "../services/appUserService";
import { ApiError } from "../utils/ApiError";
import type { ListStaffQuery } from "../schemas/appointmentSchema";
import type { LookupCaregiverQuery } from "../schemas/userSchema";

export async function listAppUsers(req: Request, res: Response) {
  if (!req.user) throw new ApiError(401, "Not authenticated");
  res.json(await appUserService.listAppUserActivity(req.user));
}

/**
 * รายชื่อบุคลากรตามบทบาท — ใช้ทำช่องเลือกแพทย์ตอนสร้างนัด
 *
 * คืนเฉพาะ id กับชื่อ ไม่ส่งเบอร์โทรหรือข้อมูลบัญชีอื่นออกไป เพราะหน้าจอต้องการแค่นี้
 */
export async function listStaff(req: Request, res: Response) {
  const query = req.query as ListStaffQuery;
  const staff = await appUserService.listStaffByRole(query.role);
  res.json({ staff });
}

export async function lookupCaregiver(req: Request, res: Response) {
  if (!req.user) throw new ApiError(401, "Not authenticated");
  const query = req.query as unknown as LookupCaregiverQuery;

  const caregiver = await appUserService.lookupCaregiverByPhone(query.phone);
  res.json({ caregiver });
}

export async function updateMyPreferences(req: Request, res: Response) {
  if (!req.user) throw new ApiError(401, "Not authenticated");
  const user = await appUserService.updateMyPreferences(req.user.sub, req.body.preferred_language);
  res.json({ user });
}
