import { ApiError } from "../utils/ApiError";
import * as consentRepository from "../repositories/consentRepository";

export const CURRENT_PDPA_VERSION = "2026-01-v1";
const CONSENT_TYPE = "pdpa";

export async function getMyConsent(userId: string) {
  const consent = await consentRepository.latestAccepted(userId, CONSENT_TYPE);
  return { current_version: CURRENT_PDPA_VERSION, accepted_version: consent?.version ?? null };
}

export async function acceptMyConsent(userId: string, version: string, ipAddress: string | null) {
  if (version !== CURRENT_PDPA_VERSION) {
    throw new ApiError(409, "Consent document version is no longer current");
  }
  const existing = await consentRepository.latestAccepted(userId, CONSENT_TYPE);
  if (existing?.version === version) return existing;
  return consentRepository.create({ user_id: userId, consent_type: CONSENT_TYPE, version, accepted: true, ip_address: ipAddress });
}
