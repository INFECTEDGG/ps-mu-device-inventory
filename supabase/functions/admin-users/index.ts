import { createClient } from 'npm:@supabase/supabase-js@2.118.0'
import { createAdminHandler } from './handler.ts'

// Server secrets only. Never configure these as VITE_* variables.
const url = Deno.env.get('SUPABASE_URL')!
const publicKey = Deno.env.get('SUPABASE_ANON_KEY')!
const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const origins = (Deno.env.get('ADMIN_ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(url, secret, options)
const auth = createClient(url, publicKey, options)

Deno.serve(
  createAdminHandler(
    {
      async authenticate(token) {
        const { data, error } = await auth.auth.getUser(token)
        return !error && !!data.user && !data.user.is_anonymous
      },
      async rpc(token, name, args) {
        // Calls keep the caller's JWT so SQL can authorise auth.uid() and the actual session.
        const caller = createClient(url, publicKey, {
          ...options,
          global: { headers: { Authorization: `Bearer ${token}` } },
        })
        const { data, error } = await caller.rpc(name, args)
        return { data, error }
      },
      async create(command) {
        const { data, error } = await admin.auth.admin.createUser({
          email: command.email,
          password: command.password,
          // Provisioned by an administrator; no public signup or email invitation.
          email_confirm: true,
          user_metadata: {
            first_name: command.first_name,
            last_name: command.last_name,
          },
        })
        return { id: data.user?.id ?? null, code: error?.code }
      },
      async ban(id) {
        const { error } = await admin.auth.admin.updateUserById(id, {
          ban_duration: '876000h',
        })
        return !error
      },
    },
    origins,
  ),
)
