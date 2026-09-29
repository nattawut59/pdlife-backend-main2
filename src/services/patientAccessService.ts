import { ApiError } from "../utils/ApiError";
import type { JwtPayload } from "../utils/jwt";
import { findActiveLink } from "../repositories/patientCaregiverRepository";

const STAFF_ROLES: ReadonlySet<string> = new Set(["nurse", "doctor", "admin"]);

export interface AccessOptions {
  /** Require the caregiver link to have can_answer = true — writing data on the patient's behalf. */
  requireAnswerPermission?: boolean;
}

/**
 * Central RBAC check for every patient-scoped resource (profile, prescriptions, medication
 * logs, and — in a later step — rounds/responses). Backend uses the Supabase service-role key
 * (bypasses RLS), so this is the actual authorization boundary, not a convenience check.
 */
export async function assertCanAccessPatient(
  user: JwtPayload,
  patientId: string,
  options: AccessOptions = {}
): Promise<void> {
  if (STAFF_ROLES.has(user.role)) {
    return;
  }

  if (user.role === "patient") {
    if (user.sub !== patientId) {
      throw new ApiError(403, "Patients can only access their own data");
    }
    return;
  }

  if (user.role === "caregiver") {
    const link = await findActiveLink(patientId, user.sub);
    if (!link) {
      throw new ApiError(403, "No active caregiver link to this patient");
    }
    if (options.requireAnswerPermission && !link.can_answer) {
      throw new ApiError(403, "This caregiver link is view-only");
    }
    return;
  }

  throw new ApiError(403, "Not authorized to access this patient's data");
}
