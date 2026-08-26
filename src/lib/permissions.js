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

export const PERM_ACTIONS = ['view', 'add', 'edit', 'delete']

export const ACTION_LABELS = {
  view: 'View',
  add: 'Add',
  edit: 'Edit',
  delete: 'Delete',
}

// The page catalogue - drives the Role Access matrix and the sidebar gating.
// `delete` on the users page means "deactivate".
export const PERMISSION_PAGES = [
  { key: 'dashboard', label: 'Dashboard', group: 'Overview', actions: ['view'] },
  { key: 'clients', label: 'Clients', group: 'Records', actions: ['view', 'add', 'edit', 'delete'] },
  { key: 'customers', label: 'Customer', group: 'Records', actions: ['view', 'add', 'edit', 'delete'] },
  { key: 'users', label: 'User Management', group: 'Administration', actions: ['view', 'add', 'edit', 'delete'] },
  { key: 'roles', label: 'Role Access', group: 'Administration', actions: ['view', 'edit'] },
]

export const PERMISSION_GROUPS = [...new Set(PERMISSION_PAGES.map((p) => p.group))].map(
  (group) => ({ group, pages: PERMISSION_PAGES.filter((p) => p.group === group) }),
)
