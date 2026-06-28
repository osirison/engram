/**
 * @engram/config
 * Environment configuration and validation for ENGRAM
 */

export { envSchema, validateEnv, type Env } from './env.schema';
export {
  DeploymentProfile,
  resolveCapabilities,
  coerceDeploymentProfile,
  type ProfileCapabilities,
} from './profile';
