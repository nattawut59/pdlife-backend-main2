import { registerDevice, setPushEnabled, type RegisterDeviceInput } from "../repositories/deviceRepository";
import type { DeviceRow } from "../types/database";

export async function registerMyDevice(
  userId: string,
  input: Omit<RegisterDeviceInput, "user_id">
): Promise<DeviceRow> {
  return registerDevice({ user_id: userId, ...input });
}

export async function updatePushEnabled(
  userId: string,
  deviceId: string,
  pushEnabled: boolean
): Promise<DeviceRow> {
  return setPushEnabled(deviceId, userId, pushEnabled);
}
