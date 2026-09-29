import { z } from "zod";

export const acceptConsentSchema = z.object({ version: z.string().min(1).max(50) });
