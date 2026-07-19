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
  type ProfileCapabilities,
} from './profile';
