import type { Workspace } from '@cravecart/contracts';

export interface Session {
  workspace: Workspace;
  grants: Workspace[];
}
// A staff role does not imply access to every administrative dashboard.
export function workspaceHome(workspace: Workspace, permissions: readonly string[] = []) {
  if (workspace === 'seller') return '/seller/restaurants';
  if (workspace === 'rider') return '/rider/dashboard';
  if (workspace === 'customer') return '/profile';
  const destinations = [
    ['verifications:read', '/admin/dashboard'],
    ['support:read', '/admin/support'],
    ['reports:read', '/admin/reports'],
    ['finance:read', '/admin/finance'],
    ['audit:read', '/admin/audit'],
    ['dispatch:read', '/admin/delivery-operations'],
    ['users:read', '/admin/users'],
    ['zones:read', '/admin/zones'],
    ['promotions:read', '/admin/promotions'],
    ['staff:read', '/admin/team'],
    ['assistant:read', '/admin/assistant'],
  ] as const;
  return (
    destinations.find(([permission]) => permissions.includes(permission))?.[1] ?? '/workspaces'
  );
}
export function canEnter(session: Session | null, roles: string[]) {
  return (
    session !== null &&
    session.grants.includes(session.workspace) &&
    roles.includes(session.workspace)
  );
}
export function safeReturnPath(
  candidate: string | null | undefined,
  roles: string[],
): string | null {
  if (
    !candidate ||
    !candidate.startsWith('/') ||
    candidate.startsWith('//') ||
    candidate.includes('\\')
  )
    return null;
  try {
    const decoded = decodeURIComponent(candidate);
    if (decoded.startsWith('//') || decoded.includes('\\') || /[\r\n]/.test(decoded)) return null;
    const path = candidate.split(/[?#]/)[0]!;
    if (
      ['/login', '/signup', '/verify', '/admin/login', '/seller/login', '/rider/login'].includes(
        path,
      )
    )
      return null;
    for (const role of ['admin', 'seller', 'rider'])
      if (path.startsWith(`/${role}/`) && !path.endsWith('/onboarding') && !roles.includes(role))
        return null;
    return candidate;
  } catch {
    return null;
  }
}
