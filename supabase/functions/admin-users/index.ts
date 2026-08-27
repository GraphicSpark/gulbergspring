// supabase/functions/admin-users/index.ts
// The ONLY place the service_role key is used. Deployed to project
// fmfbjpblhqgrwqeswztw. Supabase injects SUPABASE_URL / SUPABASE_ANON_KEY /
// SUPABASE_SERVICE_ROLE_KEY automatically - no secrets to configure.
//
// Every profile mutation for OTHER users goes through here (not the client),
// so RLS + the protect-profile trigger stay consistent and the permission
// check lives in one place.
//
// Actions (POST JSON { action, ... }):
//   create        { full_name, email, phone, role, password }   -> needs users.add
//   update        { user_id, full_name?, phone?, role?, commission_kind?,
//                   commission_value?, commission_active? }         -> needs users.edit
//   set_password  { user_id, password }                          -> needs users.edit
//   set_active    { user_ids: [], active: bool }                 -> users.edit (on) / users.delete (off)

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const VALID_ROLES = ['super_admin', 'admin', 'agent', 'ops']
const PRIVILEGED = ['super_admin', 'admin']
const MIN_PASSWORD = 8

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
  if (!jwt) return json({ error: 'Missing token' }, 401)

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: whoami, error: authErr } = await admin.auth.getUser(jwt)
  const caller = whoami?.user
  if (authErr || !caller) return json({ error: 'Invalid token' }, 401)

  const { data: callerProfile } = await admin
    .from('profiles')
    .select('role, is_active')
    .eq('id', caller.id)
    .single()
  if (!callerProfile || !callerProfile.is_active) {
    return json({ error: 'Your account is not active' }, 403)
  }

  const isSuper = callerProfile.role === 'super_admin'

  const can = async (page: string, action: string): Promise<boolean> => {
    if (isSuper) return true
    const { data: override } = await admin
      .from('user_permissions')
      .select('allowed')
      .eq('user_id', caller.id)
      .eq('page', page)
      .eq('action', action)
      .maybeSingle()
    if (override) return override.allowed === true
    const { data: rolePerm } = await admin
      .from('role_permissions')
      .select('allowed')
      .eq('role', callerProfile.role)
      .eq('page', page)
      .eq('action', action)
      .maybeSingle()
    return rolePerm?.allowed === true
  }

  const rolesOf = async (ids: string[]): Promise<string[]> => {
    if (ids.length === 0) return []
    const { data } = await admin.from('profiles').select('role').in('id', ids)
    return (data ?? []).map((r) => r.role)
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }
  const action = String(body.action ?? '')

  try {
    // ─────────────────────────────────────────────── create ──
    if (action === 'create') {
      if (!(await can('users', 'add'))) return json({ error: 'Not allowed' }, 403)

      const email = String(body.email ?? '').toLowerCase().trim()
      const password = String(body.password ?? '')
      const fullName = String(body.full_name ?? '').trim()
      const phone = body.phone ? String(body.phone).trim() : null
      const role = VALID_ROLES.includes(String(body.role)) ? String(body.role) : 'agent'

      if (!email) return json({ error: 'Email is required' }, 400)
      if (password.length < MIN_PASSWORD) {
        return json({ error: `Password must be at least ${MIN_PASSWORD} characters` }, 400)
      }
      if (!isSuper && PRIVILEGED.includes(role)) {
        return json({ error: 'Only a Super Admin can create Admin accounts' }, 403)
      }

      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      })
      if (cErr || !created?.user) {
        return json({ error: cErr?.message ?? 'Could not create the user' }, 400)
      }

      const newId = created.user.id
      const { error: pErr } = await admin
        .from('profiles')
        .update({ full_name: fullName, phone, role, is_active: true })
        .eq('id', newId)
      if (pErr) {
        await admin.auth.admin.deleteUser(newId) // no orphan auth users
        return json({ error: pErr.message }, 400)
      }
      return json({ ok: true, id: newId })
    }

    // ─────────────────────────────────────────────── update ──
    if (action === 'update') {
      if (!(await can('users', 'edit'))) return json({ error: 'Not allowed' }, 403)

      const userId = String(body.user_id ?? '')
      if (!userId) return json({ error: 'user_id is required' }, 400)

      const [targetRole] = await rolesOf([userId])
      if (!targetRole) return json({ error: 'User not found' }, 404)
      if (!isSuper && PRIVILEGED.includes(targetRole)) {
        return json({ error: 'Only a Super Admin can manage Admin accounts' }, 403)
      }

      const patch: Record<string, unknown> = {}
      if (typeof body.full_name === 'string') patch.full_name = body.full_name.trim()
      if ('phone' in body) patch.phone = body.phone ? String(body.phone).trim() : null

      if (body.commission_kind === 'fixed' || body.commission_kind === 'percent') {
        patch.commission_kind = body.commission_kind
      }
      if ('commission_value' in body) {
        const v = Number(body.commission_value)
        patch.commission_value = Number.isFinite(v) && v >= 0 ? v : 0
      }
      if (typeof body.commission_active === 'boolean') {
        patch.commission_active = body.commission_active
      }

      if (body.role) {
        const newRole = String(body.role)
        if (!VALID_ROLES.includes(newRole)) return json({ error: 'Invalid role' }, 400)
        if (userId === caller.id) return json({ error: 'You cannot change your own role' }, 400)
        if (!isSuper && PRIVILEGED.includes(newRole)) {
          return json({ error: 'Only a Super Admin can assign Admin roles' }, 403)
        }
        patch.role = newRole
      }

      if (Object.keys(patch).length === 0) return json({ ok: true })
      const { error } = await admin.from('profiles').update(patch).eq('id', userId)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    // ───────────────────────────────────────── set_password ──
    if (action === 'set_password') {
      if (!(await can('users', 'edit'))) return json({ error: 'Not allowed' }, 403)

      const userId = String(body.user_id ?? '')
      const password = String(body.password ?? '')
      if (!userId) return json({ error: 'user_id is required' }, 400)
      if (password.length < MIN_PASSWORD) {
        return json({ error: `Password must be at least ${MIN_PASSWORD} characters` }, 400)
      }

      const [targetRole] = await rolesOf([userId])
      if (!isSuper && PRIVILEGED.includes(targetRole)) {
        return json({ error: 'Only a Super Admin can change an Admin password' }, 403)
      }

      const { error } = await admin.auth.admin.updateUserById(userId, { password })
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    // ────────────────────────────────────────── set_active ──
    if (action === 'set_active') {
      const active = body.active === true
      if (!(await can('users', active ? 'edit' : 'delete'))) {
        return json({ error: 'Not allowed' }, 403)
      }

      const ids = Array.isArray(body.user_ids)
        ? body.user_ids.map(String)
        : body.user_id
          ? [String(body.user_id)]
          : []
      if (ids.length === 0) return json({ error: 'user_ids is required' }, 400)
      if (ids.includes(caller.id)) {
        return json({ error: 'You cannot change your own status' }, 400)
      }
      if (!isSuper && (await rolesOf(ids)).some((r) => PRIVILEGED.includes(r))) {
        return json({ error: 'Only a Super Admin can change an Admin account' }, 403)
      }

      const { error } = await admin.from('profiles').update({ is_active: active }).in('id', ids)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true, count: ids.length })
    }

    return json({ error: `Unknown action: ${action}` }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
