import { Injectable } from '@nestjs/common';
import { PrismaService } from '@engram/database';

export interface AuthenticatedUser {
  id: string;
  email: string;
  organizationId: string | null;
}

/**
 * Resolves ENGRAM users for the auth layer. A successful OAuth login upserts a
 * user keyed by email; if the user belongs to exactly one organization that org
 * becomes their acting tenant for the session.
 */
@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  /** Upsert a user by email and resolve their default organization (if unambiguous). */
  async upsertByEmail(email: string): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.upsert({
      where: { email },
      create: { email },
      update: {},
      select: { id: true, email: true },
    });
    const organizationId = await this.resolveDefaultOrg(user.id);
    return { id: user.id, email: user.email, organizationId };
  }

  /**
   * A user with exactly one membership acts within that org by default. With
   * zero or multiple memberships we leave the org unset (callers may select one
   * explicitly later) to avoid silently picking a tenant.
   */
  private async resolveDefaultOrg(userId: string): Promise<string | null> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      select: { organizationId: true },
      take: 2,
    });
    return memberships.length === 1 && memberships[0]
      ? memberships[0].organizationId
      : null;
  }
}
