import {
  Activity,
  Database,
  LayoutDashboard,
  Settings,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  description: string;
  /** Match exactly (true) or by prefix (false) for active-route highlighting. */
  exact?: boolean;
}

export const navItems: NavItem[] = [
  {
    title: 'Overview',
    href: '/',
    icon: LayoutDashboard,
    description: 'At-a-glance summary',
    exact: true,
  },
  {
    title: 'Memories',
    href: '/memories',
    icon: Database,
    description: 'Browse, search, and manage memories',
  },
  {
    title: 'Insights',
    href: '/insights',
    icon: Sparkles,
    description: 'Synthesised insights and usage analytics',
  },
  {
    title: 'Health',
    href: '/health',
    icon: Activity,
    description: 'Live system and dependency health',
  },
  {
    title: 'Settings',
    href: '/settings',
    icon: Settings,
    description: 'Connection and session details',
  },
];

/** True when `pathname` should mark `item` as the active route. */
export function isActiveRoute(item: NavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
