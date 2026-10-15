import { assertProductionEnv } from './validate-production-env.mjs';
/** @param {string} command @param {Record<string, string | undefined>} input */
export function prepareNextEnv(command,input=process.env) {
  const env={...input};
  if(command==='build' || command==='start')env.NODE_ENV='production';
  else if(command==='dev')env.NODE_ENV='development';
  assertProductionEnv(env);
  delete env.DEBUG;delete env.NEXT_TEST_MODE;delete env.__NEXT_TEST_MODE;
  return env;
}

// Validate loaded file settings, but let Next load those files itself. Passing
// them as inherited variables freezes their values across development reloads.
export function prepareNextChildEnv(command, inherited, loaded) {
  const validated = prepareNextEnv(command, loaded);
  const env = { ...inherited, NODE_ENV: validated.NODE_ENV };
  delete env.__NEXT_PROCESSED_ENV;
  delete env.DEBUG;delete env.NEXT_TEST_MODE;delete env.__NEXT_TEST_MODE;
  return env;
}
