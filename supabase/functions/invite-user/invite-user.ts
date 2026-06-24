import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

const ok  = (d: unknown) => new Response(JSON.stringify(d), { headers: CORS })
const err = (msg: string, status = 400) =>
  new Response(JSON.stringify({ error: msg }), { status, headers: CORS })

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const anonKey     = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

  if (!serviceKey) return err('SERVICE_ROLE_KEY no configurada', 500)

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader) return err('Sin token de autorización', 401)

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: { user }, error: authErr } = await caller.auth.getUser()
  if (authErr || !user) return err('Sesión inválida: ' + (authErr?.message ?? 'sin usuario'), 401)

  let body: { action?: string; email?: string; role?: string; hotel_id?: string; user_id?: string }
  try { body = await req.json() }
  catch { return err('Body JSON inválido', 400) }

  const { action, email, role, hotel_id, user_id } = body
  if (!hotel_id) return err('hotel_id requerido', 400)

  const { data: callerRole, error: roleErr } = await admin
    .from('hotel_users')
    .select('role')
    .eq('user_id', user.id)
    .eq('hotel_id', hotel_id)
    .maybeSingle()

  if (roleErr) return err('Error verificando permisos: ' + roleErr.message, 500)
  if (!callerRole) return err('No sos miembro de este hotel', 403)
  if (!['admin', 'owner'].includes(callerRole.role)) {
    return err('Rol insuficiente: ' + callerRole.role, 403)
  }

  if (action === 'invite') {
    if (!email) return err('email requerido')
    const { data, error: invErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: 'https://barranca-reservas.vercel.app/index.html',
      data: { hotel_id, role: role ?? 'staff' },
    })
    if (invErr) return err('Error al invitar: ' + invErr.message)
    const newUser = data?.user
    if (newUser?.id) {
      await admin.from('hotel_users').upsert(
        { hotel_id, user_id: newUser.id, role: role ?? 'staff' },
        { onConflict: 'hotel_id,user_id' }
      )
      await admin.from('user_profiles').upsert(
        { id: newUser.id, hotel_id, nombre: email.split('@')[0], avatar_id: 1, avatar_color: '#6366f1' },
        { onConflict: 'id' }
      )
    }
    return ok({ success: true, message: `Invitación enviada a ${email}` })
  }

  if (action === 'reset_password') {
    if (!email) return err('email requerido')
    try {
      const { data, error: linkErr } = await admin.auth.admin.generateLink({
        type: 'recovery', email,
        options: { redirectTo: 'https://barranca-reservas.vercel.app/index.html' },
      })
      if (linkErr) throw linkErr
      return ok({ success: true, link: data?.properties?.action_link ?? null })
    } catch {
      const { error: e2 } = await admin.auth.resetPasswordForEmail(email, {
        redirectTo: 'https://barranca-reservas.vercel.app/index.html',
      })
      if (e2) return err('Error reset: ' + e2.message)
      return ok({ success: true, link: null })
    }
  }

  if (action === 'toggle_ban') {
    if (!user_id) return err('user_id requerido')
    const { data: u, error: getErr } = await admin.auth.admin.getUserById(user_id)
    if (getErr) return err('Error: ' + getErr.message)
    const isBanned = !!u?.user?.banned_until
    const { error: banErr } = await admin.auth.admin.updateUserById(user_id, {
      ban_duration: isBanned ? 'none' : '876600h',
    })
    if (banErr) return err('Error: ' + banErr.message)
    return ok({ success: true, banned: !isBanned })
  }

  return err('Acción no reconocida: ' + action)
})
