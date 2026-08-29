// Permission model: page x action, role-wise (role_permissions) with per-user
// overrides (user_permissions). super_admin bypasses every check.

export const ROLES = ['super_admin', 'admin', 'agent', 'ops']

export const ROLE_LABELS = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  agent: 'Agent',
  ops: 'Ops',
}

// Roles whose defaults live in role_permissions (super_admin is not stored).
export const MANAGED_ROLES = ['admin', 'agent', 'ops']

export const PERM_ACTIONS = ['view', 'add', 'edit', 'delete', 'confirm']

export const ACTION_LABELS = {
  view: 'View',
  add: 'Add',
  edit: 'Edit',
  delete: 'Delete',
  confirm: 'Confirm',
}

// The page catalogue - drives the Role Access matrix AND the sidebar gating.
// EVERY navigable page (except Profile, which is always available to its owner)
// must have an entry here. When you add a new page:
//   1. add it here,
//   2. seed `role_permissions` for it in the same migration,
//   3. gate the nav item + the page with `can('<key>', ...)`,
//   4. point its table RLS at `has_perm('<key>', ...)`.
// `delete` on the users page means "deactivate".
// `confirm` on the orders page means "mark the service availed" (locks commission).
export const PERMISSION_PAGES = [
  { key: 'dashboard', label: 'Dashboard', group: 'Overview', actions: ['view'] },
  { key: 'clients', label: 'Clients', group: 'Records', actions: ['view', 'add', 'edit', 'delete'] },
  { key: 'packages', label: 'Packages', group: 'Records', actions: ['view', 'add', 'edit', 'delete'] },
  { key: 'customers', label: 'Customer', group: 'Records', actions: ['view', 'add', 'edit', 'delete'] },
  { key: 'orders', label: 'Orders', group: 'Records', actions: ['view', 'add', 'edit', 'delete', 'confirm'] },
  { key: 'accounts', label: 'Accounts', group: 'Account', actions: ['view', 'add', 'edit', 'delete'] },
  { key: 'finance', label: 'Finance', group: 'Finance', actions: ['view', 'add', 'edit', 'delete'] },
  { key: 'users', label: 'User Management', group: 'Administration', actions: ['view', 'add', 'edit', 'delete'] },
  { key: 'roles', label: 'Role Access', group: 'Administration', actions: ['view', 'edit'] },
]

export const PERMISSION_GROUPS = [...new Set(PERMISSION_PAGES.map((p) => p.group))].map(
  (group) => ({ group, pages: PERMISSION_PAGES.filter((p) => p.group === group) }),
)
