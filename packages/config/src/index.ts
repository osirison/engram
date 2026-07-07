/**
 * @engram/config
 * Environment configuration and validation for ENGRAM
 */

export { envSchema, baseSchema, validateEnv, type Env } from './env.schema';
export {
  DeploymentProfile,
  resolveCapabilities,
  coerceDeploymentProfile,
  usesPgVector,
  usesQdrant,
  DEFAULT_VECTOR_BACKEND,
  type ProfileCapabilities,
} from './profile';
