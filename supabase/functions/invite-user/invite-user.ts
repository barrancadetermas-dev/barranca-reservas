// supabase/functions/invite-user/index.ts
// Edge Function para gestión de usuarios desde el panel admin
// Acciones: invite | reset_password | generate_link

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const url    = Deno.env.get('SUPABASE_URL')!
    const anon   = Deno.env.get('SUPABASE_ANON_KEY')!
    const svcKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Cliente admin (service role) — puede todo
    const admin = createClient(url, svcKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Verificar que quien llama es admin del hotel
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Sin autorización' }, 401)

    const caller = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user: callerUser } } = await caller.auth.getUser()
    if (!callerUser) return json({ error: 'Sesión inválida' }, 401)

    const { action, email, role, hotel_id, user_id } = await req.json()

    // Verificar rol del caller en ese hotel
    const { data: callerHU } = await admin
      .from('hotel_users')
      .select('role')
      .eq('user_id', callerUser.id)
      .eq('hotel_id', hotel_id)
      .single()

    if (!['admin', 'owner'].includes(callerHU?.role ?? '')) {
      return json({ error: 'Solo los administradores pueden gestionar usuarios' }, 403)
    }

    // ── INVITE ──────────────────────────────────────
    if (action === 'invite') {
      if (!email) return json({ error: 'Email requerido' }, 400)

      const origin = req.headers.get('origin') ?? 'https://barranca-reservas.vercel.app'

      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${origin}/index.html`,
        data: { hotel_id, role: role ?? 'staff' },
      })

      if (error) return json({ error: error.message }, 400)

      const newUser = data.user
      if (newUser) {
        // Crear hotel_users
        await admin.from('hotel_users').upsert(
          { hotel_id, user_id: newUser.id, role: role ?? 'staff' },
          { onConflict: 'hotel_id,user_id' }
        )
        // Crear user_profile
        await admin.from('user_profiles').upsert(
          { id: newUser.id, hotel_id, nombre: email.split('@')[0], avatar_id: 1, avatar_color: '#6366f1' },
          { onConflict: 'id' }
        )
      }

      return json({ success: true, message: `Invitación enviada a ${email}` })
    }

    // ── RESET PASSWORD (genera link) ─────────────────
    if (action === 'reset_password') {
      if (!email) return json({ error: 'Email requerido' }, 400)

      const { data, error } = await admin.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: {
          redirectTo: `${req.headers.get('origin') ?? 'https://barranca-reservas.vercel.app'}/index.html`,
        },
      })

      if (error) return json({ error: error.message }, 400)

      return json({
        success: true,
        link: data?.properties?.action_link ?? null,
        message: 'Link generado. Copialo y enviáselo al usuario.',
      })
    }

    // ── TOGGLE BAN ───────────────────────────────────
    if (action === 'toggle_ban') {
      if (!user_id) return json({ error: 'user_id requerido' }, 400)

      // Obtener estado actual
      const { data: u } = await admin.auth.admin.getUserById(user_id)
      const isBanned = !!u?.user?.banned_until

      const { error } = await admin.auth.admin.updateUserById(user_id, {
        ban_duration: isBanned ? 'none' : '876600h', // ~100 años = efectivamente baneado
      })

      if (error) return json({ error: error.message }, 400)
      return json({ success: true, banned: !isBanned })
    }

    return json({ error: 'Acción no reconocida' }, 400)

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return json({ error: msg }, 500)
  }
})
