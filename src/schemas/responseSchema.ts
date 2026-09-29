import { z } from "zod";

export const submitResponseSchema = z
  .object({
    answer_value: z.record(z.unknown()).optional(),
    skipped: z.boolean().optional(),
    submitted_at: z.string().datetime().optional(),
  })
  .refine((val) => val.skipped === true || val.answer_value !== undefined, {
    message: "answer_value is required unless skipped = true",
    path: ["answer_value"],
  });
export type SubmitResponseBody = z.infer<typeof submitResponseSchema>;
