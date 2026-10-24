import { readdir, readFile } from 'node:fs/promises'
import { after, before } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const fixturesUrl = new URL('./fixtures/', import.meta.url)
const migrationsUrl = new URL('../migrations/', import.meta.url)

export const users = {
  admin: { id: '00000000-0000-4000-8000-000000000001', role: 'admin', firstName: 'Ada', lastName: 'Admin' },
  manager: { id: '00000000-0000-4000-8000-000000000002', role: 'device_manager', firstName: 'Max', lastName: 'Manager' },
  employee: { id: '00000000-0000-4000-8000-000000000003', role: 'employee', firstName: 'Erika', lastName: 'Muster' },
}

// Baut einmal pro Testdatei eine Datenbank mit Schema, Migrationen und Testbenutzern auf.
// Jeder Test erhält davon eine eigene Kopie, sodass sich Tests nicht gegenseitig beeinflussen.
export function useTestDatabase() {
  let template

  before(async () => {
    template = await createTemplateDatabase()
  })

  after(async () => {
    await template.close()
  })

  return async function createDatabase(t) {
    const db = await template.clone()
    t.after(() => db.close())
    return db
  }
}

async function createTemplateDatabase() {
  const db = new PGlite()
  await db.exec(await readFile(new URL('base-schema.sql', fixturesUrl), 'utf8'))

  await applyMigrations(db)

  for (const user of Object.values(users)) {
    await db.query('insert into auth.users (id) values ($1)', [user.id])
    await db.query(
      `insert into public.profiles (id, role_id, first_name, last_name)
       values ($1, (select id from public.roles where name = $2), $3, $4)`,
      [user.id, user.role, user.firstName, user.lastName],
    )
  }

  await clearAuditLog(db)
  return db
}

export async function applyMigrations(db) {
  const migrations = (await readdir(migrationsUrl)).filter((name) => name.endsWith('.sql')).sort()
  for (const migration of migrations) {
    await db.exec(await readFile(new URL(migration, migrationsUrl), 'utf8'))
  }
}

export async function clearAuditLog(db) {
  await db.exec('delete from public.audit_logs')
}

// Entspricht einer Anfrage über die Supabase-API mit angemeldetem Benutzer.
export async function asUser(db, user, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.exec('set local role authenticated')
    await tx.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: user.id, role: 'authenticated' }),
    ])
    return tx.query(sql, params)
  })
}

// Entspricht einer Anfrage über die Supabase-API ohne Anmeldung.
export async function asAnon(db, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.exec('set local role anon')
    return tx.query(sql, params)
  })
}

// Entspricht einem Backend, das mit dem Service-Key ohne Benutzersitzung schreibt.
export async function asService(db, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.exec('set local role service_role')
    return tx.query(sql, params)
  })
}

export async function createDevice(db, assetTag = 'NB-0001') {
  const { rows } = await asUser(
    db,
    users.manager,
    `insert into public.devices (asset_tag, serial_number, device_type, manufacture, model)
     values ($1, 'SN-123', 'Laptop', 'Lenovo', 'ThinkPad T14')
     returning id`,
    [assetTag],
  )
  return rows[0].id
}

export async function assignDevice(db, deviceId, employee = users.employee) {
  const { rows } = await asUser(
    db,
    users.manager,
    `insert into public.assignments (device_id, employee_id, assigned_by)
     values ($1, $2, $3)
     returning id`,
    [deviceId, employee.id, users.manager.id],
  )
  return rows[0].id
}

export async function returnDevice(db, assignmentId) {
  await asUser(
    db,
    users.manager,
    'update public.assignments set returned_at = now(), returned_by = $2 where id = $1',
    [assignmentId, users.manager.id],
  )
}

// Postgres-Fehlercodes, damit Tests nicht von Constraint-Namen in Supabase abhängen.
export const errorCodes = {
  uniqueViolation: '23505',
  checkViolation: '23514',
}
