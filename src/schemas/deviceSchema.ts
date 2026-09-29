import { z } from "zod";
import { PLATFORM_TYPES } from "../config/constants";

export const registerDeviceSchema = z.object({
  expo_push_token: z.string().min(1),
  platform: z.enum(PLATFORM_TYPES),
  app_version: z.string().optional(),
});
export type RegisterDeviceBody = z.infer<typeof registerDeviceSchema>;

export const updateDeviceSchema = z.object({
  push_enabled: z.boolean(),
});
export type UpdateDeviceBody = z.infer<typeof updateDeviceSchema>;
