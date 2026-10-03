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
