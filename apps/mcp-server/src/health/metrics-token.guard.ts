import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { constantTimeStringEqual } from '../security/admin-token.util';

/** Minimal request shape the guard needs — keeps it framework-adapter agnostic. */
interface MetricsRequest {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Guards `/health/metrics` with an optional scrape token (#206).
 *
 * The endpoint exposes process/runtime internals (heap, event loop, session
 * counts) but no tenant data. Default posture: when `METRICS_TOKEN` is unset
 * the endpoint stays open, matching the historical behaviour for
 * trusted-network deployments where Prometheus scrapes over an internal
 * interface. Set `METRICS_TOKEN` in any deployment where the port is
 * reachable beyond the scrape network; the scraper then presents it via
 * `Authorization: Bearer <token>` (Prometheus `authorization.credentials`)
 * or an `X-Metrics-Token` header. Comparison is constant-time.
 */
@Injectable()
export class MetricsTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.METRICS_TOKEN;
    if (!expected) {
      return true;
    }

    const request = context.switchToHttp().getRequest<MetricsRequest>();
    const supplied = MetricsTokenGuard.extractToken(request.headers);
    if (supplied !== null && constantTimeStringEqual(supplied, expected)) {
      return true;
    }

    throw new UnauthorizedException('A valid metrics scrape token is required');
  }

  /** Pull the token from `Authorization: Bearer …` or `X-Metrics-Token`. */
  private static extractToken(
    headers: MetricsRequest['headers'],
  ): string | null {
    const authorization = headers['authorization'];
    if (
      typeof authorization === 'string' &&
      authorization.toLowerCase().startsWith('bearer ')
    ) {
      const token = authorization.slice('bearer '.length).trim();
      if (token.length > 0) {
        return token;
      }
    }
    const direct = headers['x-metrics-token'];
    if (typeof direct === 'string' && direct.length > 0) {
      return direct;
    }
    return null;
  }
}
