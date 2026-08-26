import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Check, RotateCcw, Save, Search, Shield, User, Users, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import {
  MANAGED_ROLES,
  PERMISSION_GROUPS,
  PERMISSION_PAGES,
  PERM_ACTIONS,
  ROLE_LABELS,
} from '../lib/permissions'
import Avatar from '../components/Avatar'
import './RoleAccess.css'

const ROLES = ['super_admin', ...MANAGED_ROLES]

export default function RoleAccess() {
  const { isSuperAdmin, can } = useAuth()
  const canView = isSuperAdmin || can('roles', 'view')

  const [mode, setMode] = useState('roles')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [rolePerms, setRolePerms] = useState({}) // { role: { page: { action: bool } } }
  const [activeRole, setActiveRole] = useState('admin')

  const [users, setUsers] = useState([])
  const [userSearch, setUserSearch] = useState('')
  const [activeUserId, setActiveUserId] = useState(null)
  const [overrides, setOverrides] = useState({}) // { page: { action: bool } } (draft)

  const fetchRolePerms = useCallback(async () => {
    const { data } = await supabase.from('role_permissions').select('role, page, action, allowed')
    const map = {}
    for (const r of data ?? []) {
      ;((map[r.role] ??= {})[r.page] ??= {})[r.action] = r.allowed
    }
    setRolePerms(map)
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchRolePerms()
  }, [fetchRolePerms])

  useEffect(() => {
    if (mode !== 'users' || users.length) return
    supabase
      .from('profiles')
      .select('id, full_name, email, avatar_url, role')
      .order('full_name')
      .then(({ data }) => setUsers(data ?? []))
  }, [mode, users.length])

  const activeUser = users.find((u) => u.id === activeUserId) || null

  useEffect(() => {
    if (!activeUserId) return
    supabase
      .from('user_permissions')
      .select('page, action, allowed')
      .eq('user_id', activeUserId)
      .then(({ data }) => {
        const map = {}
        for (const r of data ?? []) (map[r.page] ??= {})[r.action] = r.allowed
        setOverrides(map)
      })
  }, [activeUserId])

  const selectUser = (id) => {
    setOverrides({})
    setActiveUserId(id)
  }

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase()
    if (!q) return users
    return users.filter(
      (u) => u.full_name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q),
    )
  }, [users, userSearch])

  // ── role mode ──────────────────────────────────────────────────────────
  const roleVal = (page, action) => rolePerms[activeRole]?.[page]?.[action] === true

  const toggleRole = (page, action) =>
    setRolePerms((prev) => ({
      ...prev,
      [activeRole]: {
        ...prev[activeRole],
        [page]: { ...prev[activeRole]?.[page], [action]: !roleVal(page, action) },
      },
    }))

  const toggleRolePage = (page) => {
    const def = PERMISSION_PAGES.find((p) => p.key === page)
    const allOn = def.actions.every((a) => roleVal(page, a))
    setRolePerms((prev) => ({
      ...prev,
      [activeRole]: {
        ...prev[activeRole],
        [page]: def.actions.reduce((acc, a) => ({ ...acc, [a]: !allOn }), {}),
      },
    }))
  }

  const toggleRoleColumn = (action) => {
    const pages = PERMISSION_PAGES.filter((p) => p.actions.includes(action))
    const allOn = pages.every((p) => roleVal(p.key, action))
    setRolePerms((prev) => {
      const next = { ...prev[activeRole] }
      pages.forEach((p) => {
        next[p.key] = { ...next[p.key], [action]: !allOn }
      })
      return { ...prev, [activeRole]: next }
    })
  }

  const saveRole = async () => {
    setSaving(true)
    const rows = []
    PERMISSION_PAGES.forEach((p) =>
      p.actions.forEach((a) =>
        rows.push({ role: activeRole, page: p.key, action: a, allowed: roleVal(p.key, a) }),
      ),
    )
    const { error } = await supabase
      .from('role_permissions')
      .upsert(rows, { onConflict: 'role,page,action' })
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success(`${ROLE_LABELS[activeRole]} permissions saved`)
  }

  // ── user mode ──────────────────────────────────────────────────────────
  const roleDefault = (page, action) =>
    activeUser ? rolePerms[activeUser.role]?.[page]?.[action] === true : false
  const isOverridden = (page, action) => overrides[page]?.[action] !== undefined
  const effective = (page, action) =>
    isOverridden(page, action) ? overrides[page][action] : roleDefault(page, action)

  const toggleOverride = (page, action) =>
    setOverrides((prev) => ({
      ...prev,
      [page]: { ...prev[page], [action]: !effective(page, action) },
    }))

  const resetPage = (page) =>
    setOverrides((prev) => {
      const next = { ...prev }
      delete next[page]
      return next
    })

  const overrideCount = Object.values(overrides).reduce(
    (n, actions) => n + Object.keys(actions).length,
    0,
  )

  const saveOverrides = async () => {
    if (!activeUser) return
    setSaving(true)
    const rows = []
    Object.entries(overrides).forEach(([page, actions]) =>
      Object.entries(actions).forEach(([action, allowed]) =>
        rows.push({ user_id: activeUser.id, page, action, allowed }),
      ),
    )
    const del = await supabase.from('user_permissions').delete().eq('user_id', activeUser.id)
    if (del.error) {
      setSaving(false)
      return toast.error(del.error.message)
    }
    if (rows.length) {
      const ins = await supabase.from('user_permissions').insert(rows)
      if (ins.error) {
        setSaving(false)
        return toast.error(ins.error.message)
      }
    }
    setSaving(false)
    toast.success(`${activeUser.full_name || 'User'} permissions saved`)
  }

  // ── shared grid ────────────────────────────────────────────────────────
  const readOnly =
    !isSuperAdmin ||
    (mode === 'roles' ? activeRole === 'super_admin' : activeUser?.role === 'super_admin')

  const getVal = (page, action) =>
    mode === 'roles' ? roleVal(page, action) : effective(page, action)
  const onToggle = (page, action) =>
    mode === 'roles' ? toggleRole(page, action) : toggleOverride(page, action)

  const grid = (
    <table className="ra-grid">
      <thead>
        <tr>
          <th>Page</th>
          {PERM_ACTIONS.map((action) => (
            <th
              key={action}
              className={mode === 'roles' && !readOnly ? 'clickable' : undefined}
              onClick={() => mode === 'roles' && !readOnly && toggleRoleColumn(action)}
              title={mode === 'roles' && !readOnly ? `Toggle all ${action}` : undefined}
            >
              {action}
            </th>
          ))}
          {mode === 'users' && <th />}
        </tr>
      </thead>
      <tbody>
        {PERMISSION_GROUPS.map((g) => (
          <Fragment key={g.group}>
            <tr className="ra-group-row">
              <td colSpan={PERM_ACTIONS.length + (mode === 'users' ? 2 : 1)}>{g.group}</td>
            </tr>
            {g.pages.map((p) => {
              const pageOverridden =
                mode === 'users' && p.actions.some((a) => isOverridden(p.key, a))
              const allOn = p.actions.every((a) => getVal(p.key, a))
              return (
                <tr key={p.key}>
                  <td>
                    <span className="ra-page-name">
                      {!readOnly && (
                        <span
                          className={`ra-page-dot${allOn ? ' all' : ''}`}
                          title="Toggle all for this page"
                          onClick={() =>
                            mode === 'roles'
                              ? toggleRolePage(p.key)
                              : p.actions.forEach((a) => toggleOverride(p.key, a))
                          }
                        />
                      )}
                      {p.label}
                      {pageOverridden && <span className="ra-custom-tag">Custom</span>}
                    </span>
                  </td>
                  {PERM_ACTIONS.map((action) => {
                    if (!p.actions.includes(action)) {
                      return (
                        <td key={action}>
                          <span className="ra-cell-dash">—</span>
                        </td>
                      )
                    }
                    const on = getVal(p.key, action)
                    return (
                      <td key={action}>
                        <button
                          type="button"
                          className={`ra-cell-btn${on ? ' on' : ''}${
                            mode === 'users' && isOverridden(p.key, action) ? ' overridden' : ''
                          }`}
                          disabled={readOnly}
                          onClick={() => onToggle(p.key, action)}
                        >
                          {on ? <Check size={13} /> : <X size={13} />}
                        </button>
                      </td>
                    )
                  })}
                  {mode === 'users' && (
                    <td>
                      {pageOverridden && !readOnly && (
                        <button
                          type="button"
                          className="ra-reset"
                          title="Reset to role default"
                          onClick={() => resetPage(p.key)}
                        >
                          <RotateCcw size={13} />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </Fragment>
        ))}
      </tbody>
    </table>
  )

  if (!canView) {
    return (
      <div className="page">
        <div className="card placeholder-card">
          <Shield size={28} color="var(--muted)" />
          <h2>No access</h2>
          <p>You don&rsquo;t have permission to view Role Access.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Role Access</h1>
          <p className="page-subtitle">
            {mode === 'roles'
              ? 'Default access for each role'
              : 'Override one person without changing their role'}
          </p>
        </div>
        <div className="page-actions">
          {isSuperAdmin && (
            <div className="ra-modeswitch">
              <button className={mode === 'roles' ? 'on' : ''} onClick={() => setMode('roles')}>
                <Users size={13} /> By Role
              </button>
              <button className={mode === 'users' ? 'on' : ''} onClick={() => setMode('users')}>
                <User size={13} /> By User
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="ra-layout">
        {/* left list */}
        {mode === 'roles' ? (
          <div className="ra-list">
            <div className="ra-list-head">Roles</div>
            {ROLES.map((role) => {
              const count = Object.values(rolePerms[role] ?? {}).filter((p) => p?.view).length
              return (
                <button
                  key={role}
                  className={`ra-list-item${activeRole === role ? ' on' : ''}`}
                  onClick={() => setActiveRole(role)}
                >
                  <span className="ra-name">
                    {ROLE_LABELS[role]}
                    <span className="ra-sub">
                      {' '}
                      · {role === 'super_admin' ? 'all pages' : `${count}/${PERMISSION_PAGES.length} pages`}
                    </span>
                  </span>
                  {activeRole === role && <Shield size={13} color="var(--accent)" />}
                </button>
              )
            })}
          </div>
        ) : (
          <div className="ra-list">
            <div className="ra-list-head">Users</div>
            <div className="ra-search">
              <label className="filter-search">
                <Search size={13} />
                <input
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Search name or email"
                />
              </label>
            </div>
            <div style={{ maxHeight: 460, overflowY: 'auto' }}>
              {filteredUsers.map((u) => (
                <button
                  key={u.id}
                  className={`ra-list-item${activeUserId === u.id ? ' on' : ''}`}
                  onClick={() => selectUser(u.id)}
                >
                  <Avatar name={u.full_name} email={u.email} url={u.avatar_url} size={26} />
                  <span className="ra-name">
                    {u.full_name || u.email}
                    <span className="ra-sub"> · {ROLE_LABELS[u.role] ?? u.role}</span>
                  </span>
                </button>
              ))}
              {filteredUsers.length === 0 && (
                <div style={{ padding: 16, fontSize: 12, color: 'var(--muted)' }}>No users</div>
              )}
            </div>
          </div>
        )}

        {/* right panel */}
        <div className="ra-panel">
          <div className="ra-panel-head">
            <div>
              <h3>
                {mode === 'roles'
                  ? `${ROLE_LABELS[activeRole]} permissions`
                  : activeUser
                    ? `${activeUser.full_name || activeUser.email}`
                    : 'Select a user'}
              </h3>
              <div className="sub">
                {mode === 'roles'
                  ? 'Click a column header to toggle all · click the row dot for the whole page'
                  : activeUser
                    ? `Role: ${ROLE_LABELS[activeUser.role] ?? activeUser.role}${
                        overrideCount ? ` · ${overrideCount} custom` : ''
                      }`
                    : 'Pick someone on the left'}
              </div>
            </div>
            {!readOnly && (mode === 'roles' || activeUser) && (
              <div style={{ display: 'flex', gap: 8 }}>
                {mode === 'users' && overrideCount > 0 && (
                  <button
                    className="btn btn-ghost btn-square btn-sm"
                    onClick={() => setOverrides({})}
                  >
                    <RotateCcw size={13} /> Reset all
                  </button>
                )}
                <button
                  className="btn btn-square btn-sm"
                  onClick={mode === 'roles' ? saveRole : saveOverrides}
                  disabled={saving}
                >
                  <Save size={13} /> {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            )}
          </div>

          {mode === 'roles' && activeRole === 'super_admin' && (
            <div className="ra-note">
              <Shield size={13} /> Super Admin always has full access.
            </div>
          )}
          {mode === 'users' && activeUser?.role === 'super_admin' && (
            <div className="ra-note">
              <Shield size={13} /> Super Admins always have full access — overrides don&rsquo;t apply.
            </div>
          )}

          {loading ? (
            <div style={{ padding: 28, fontSize: 13, color: 'var(--muted)' }}>Loading…</div>
          ) : mode === 'users' && !activeUser ? (
            <div style={{ padding: 28, fontSize: 13, color: 'var(--muted)' }}>
              Select a user on the left to view or override their access.
            </div>
          ) : (
            grid
          )}
        </div>
      </div>
    </div>
  )
}
