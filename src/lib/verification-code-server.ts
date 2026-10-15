import "server-only";

import { randomInt } from "node:crypto";
import { VERIFICATION_CODE_ALPHABET, VERIFICATION_CODE_LENGTH, isVerificationCode } from "@/lib/verification-code";

export function generateVerificationCode() {
  for (;;) {
    const available = [...VERIFICATION_CODE_ALPHABET];
    let code = "";
    for (let index = 0; index < VERIFICATION_CODE_LENGTH; index++) {
      code += available.splice(randomInt(available.length), 1)[0];
    }
    if (isVerificationCode(code)) return code;
  }
}
