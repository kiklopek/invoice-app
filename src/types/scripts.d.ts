declare module "../../scripts/validate-production-env.mjs" {
  export function validateProductionEnv(env?: Record<string, string | undefined>): string[];
  export function assertProductionEnv(env?: Record<string, string | undefined>): void;
}
