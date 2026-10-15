export const VERIFICATION_CODE_LENGTH = 5;
export const VERIFICATION_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function normalizeVerificationCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isVerificationCode(value: string) {
  return value.length === VERIFICATION_CODE_LENGTH
    && [...value].every(character => VERIFICATION_CODE_ALPHABET.includes(character))
    && new Set(value).size === VERIFICATION_CODE_LENGTH
    && /[A-Z]/.test(value) && /[2-9]/.test(value);
}
