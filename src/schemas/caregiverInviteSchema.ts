import { z } from "zod";

export const redeemCaregiverInviteSchema = z.object({
  relationship: z.string().min(1).optional(),
});
export type RedeemCaregiverInviteBody = z.infer<typeof redeemCaregiverInviteSchema>;
