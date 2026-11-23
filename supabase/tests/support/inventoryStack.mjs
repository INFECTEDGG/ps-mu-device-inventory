// Gemeinsames Test-Setup für die Datenbanktests der Kernprozesse.
//
// Baut eine PGlite-Datenbank aus der Schema-Nachbildung
// (tests/fixtures/inventory-schema.sql) auf und spielt danach die echten
// Migrationen und Proposals in der Produktionsreihenfolge ein. Jede Testdatei
// erzeugt die Datenbank einmal als Vorlage (`before`) und jeder Test arbeitet auf
// einer eigenen Kopie (`clone()`), sodass sich Tests nicht gegenseitig beeinflussen.
//
// Grenzen: siehe Kopfkommentar der Schema-Nachbildung. Supabase Auth und PostgREST
// werden nur über die Datenbankrollen anon/authenticated/service_role und die
// Claims in request.jwt.claims nachgestellt.

import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { after, before } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const supabaseRoot = new URL('../../', import.meta.url)
const fixturesUrl = new URL('../fixtures/', import.meta.url)

export const readSql = (relativePath) => readFile(new URL(relativePath, supabaseRoot), 'utf8')

// Produktionsreihenfolge laut Spezifikation (Migrationen, danach Proposals).
const BASE_SCRIPTS = [
  'migrations/20261025200000_employee_profiles_for_new_auth_users.sql',
  'migrations/20261026080000_auth_profile_read_policies.sql',
  'migrations/20261026120000_server_session_inactivity.sql',
  'proposals/20261027090000_user_management.sql',
  'proposals/20261028102000_superadmin_role_permissions.sql',
  'proposals/20261028114500_hide_deactivated_users_from_list.sql',
  'proposals/20261028131000_list_disabled_user_accounts.sql',
  'proposals/20261115_device_status_and_admin_only_edits.sql',
  'proposals/20261115_issue_10_assign_device.sql',
  'proposals/20261115_issue_11_return_and_assignment_overview.sql',
  // Sicherheitskorrektur für inventory_admin_assign_role (current_role-Variable).
  'proposals/20261123_fix_admin_assign_role_guard.sql',
]

export const AUDIT_PROPOSAL = 'proposals/20261123_pbi_15_audit_log.sql'
export const HISTORY_PROPOSAL = 'proposals/20261123_pbi_12_device_history.sql'
export const AUDIT_CHECK = 'checks/pbi-15-audit-log-preflight.sql'
export const HISTORY_CHECK = 'checks/pbi-12-device-history-preflight.sql'

// Nie gemergte Audit-Migrationen aus dem Branch Guillermo (Stand vor PBI-15).
export const LEGACY_AUDIT_SCRIPTS = [
  'tests/fixtures/legacy/20261024120000_audit_logging.sql',
  'tests/fixtures/legacy/20261024130000_audit_log_read_access.sql',
]

const sessionIdFor = (id) => id.replace(/^0/, '1')

function user(id, role, firstName, lastName, email) {
  return Object.freeze({ id, sessionId: sessionIdFor(id), role, firstName, lastName, email, name: `${firstName} ${lastName}` })
}

export const users = Object.freeze({
  superAdmin: user('00000000-0000-4000-8000-000000000001', 'super_admin', 'Sara', 'Super', 'superadmin@example.invalid'),
  admin: user('00000000-0000-4000-8000-000000000002', 'admin', 'Ada', 'Admin', 'admin@example.invalid'),
  manager: user('00000000-0000-4000-8000-000000000003', 'device_manager', 'Max', 'Manager', 'manager@example.invalid'),
  employee: user('00000000-0000-4000-8000-000000000004', 'employee', 'Erika', 'Muster', 'erika@example.invalid'),
  employee2: user('00000000-0000-4000-8000-000000000005', 'employee', 'Emil', 'Beispiel', 'emil@example.invalid'),
})

// PostgreSQL-Fehlercodes, damit Tests nicht von Constraint-Namen abhängen.
export const errorCodes = Object.freeze({
  insufficientPrivilege: '42501',
  invalidParameter: '22023',
  notFound: 'P0002',
  uniqueViolation: '23505',
  checkViolation: '23514',
  foreignKeyViolation: '23503',
})

/**
 * Baut eine vollständige Testdatenbank.
 * @param {object} [options]
 * @param {boolean} [options.legacyAudit=false] alte Audit-Migrationen vor allen anderen Skripten einspielen
 * @param {boolean} [options.auditLog=true] Proposal PBI-15 (Audit-Log) installieren
 * @param {boolean} [options.deviceHistory=true] Proposal PBI-12 (Gerätehistorie) installieren
 * @param {boolean} [options.sessions=true] für alle Testbenutzer eine aktive Serversitzung starten
 */
export async function buildInventoryDatabase({
  legacyAudit = false,
  auditLog = true,
  deviceHistory = true,
  sessions = true,
} = {}) {
  const db = new PGlite()
  try {
    await db.exec(await readFile(new URL('inventory-schema.sql', fixturesUrl), 'utf8'))

    // Bestehende Konten liegen vor dem Auth-Trigger bereits vor (wie in Produktion).
    for (const account of Object.values(users)) {
      await db.query('insert into auth.users (id, email) values ($1, $2)', [account.id, account.email])
      const baseRole = account.role === 'super_admin' ? 'admin' : account.role
      await db.query(
        `insert into public.profiles (id, role_id, first_name, last_name)
         values ($1, (select id from public.roles where name = $2), $3, $4)`,
        [account.id, baseRole, account.firstName, account.lastName],
      )
    }

    if (legacyAudit) {
      for (const script of LEGACY_AUDIT_SCRIPTS) await db.exec(await readSql(script))
    }

    for (const script of BASE_SCRIPTS) {
      await db.exec(await readSql(script))
      if (script.endsWith('20261028102000_superadmin_role_permissions.sql')) {
        // Manueller Bootstrap des ersten SuperAdmins (nicht Teil des Proposals).
        await db.query(
          "update public.profiles set role_id = (select id from public.roles where name = 'super_admin') where id = $1",
          [users.superAdmin.id],
        )
      }
    }

    if (auditLog) await db.exec(await readSql(AUDIT_PROPOSAL))
    if (deviceHistory) await db.exec(await readSql(HISTORY_PROPOSAL))

    if (sessions) {
      for (const account of Object.values(users)) {
        await db.query('insert into auth.sessions (id, user_id) values ($1, $2)', [account.sessionId, account.id])
        await startSession(db, account)
      }
    }
    return db
  } catch (error) {
    await db.close()
    throw error
  }
}

// Vorlage einmal pro Testdatei, Kopie pro Test.
export function useInventoryStack(options) {
  let template

  before(async () => {
    template = await buildInventoryDatabase(options)
  })

  after(async () => {
    await template?.close()
  })

  return async function createDatabase(t) {
    const db = await template.clone()
    t.after(() => db.close())
    return db
  }
}

// Baut eine eigene Datenbank für Sonderfälle (z. B. Altbestand) und schließt sie nach dem Test.
export async function freshDatabase(t, options) {
  const db = await buildInventoryDatabase(options)
  t.after(() => db.close())
  return db
}

function claimsFor(account, role = 'authenticated') {
  return JSON.stringify({ sub: account.id, session_id: account.sessionId, role })
}

// Mehrere Anweisungen in EINER Transaktion als angemeldeter Benutzer (wie PostgREST).
export async function withUser(db, account, operation) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [claimsFor(account)])
    await tx.exec('set local role authenticated')
    return operation(tx)
  })
}

// Entspricht einer Anfrage über die Supabase-API mit angemeldetem Benutzer.
export async function asUser(db, account, sql, params = []) {
  return withUser(db, account, (tx) => tx.query(sql, params))
}

// Entspricht einer Anfrage über die Supabase-API ohne Anmeldung.
export async function asAnon(db, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: 'anon' })])
    await tx.exec('set local role anon')
    return tx.query(sql, params)
  })
}

// Entspricht einem Backend mit Service-Key ohne Benutzersitzung (z. B. Edge Function).
export async function asService(db, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: 'service_role' })])
    await tx.exec('set local role service_role')
    return tx.query(sql, params)
  })
}

// Startet die Serversitzung für die im Benutzerobjekt hinterlegte Auth-Sitzung.
export async function startSession(db, account) {
  const { rows } = await asUser(db, account, 'select public.inventory_session_start() as status')
  if (rows[0].status?.active !== true) {
    throw new Error(`Serversitzung für ${account.email} konnte nicht gestartet werden: ${JSON.stringify(rows[0].status)}`)
  }
  return rows[0].status
}

// Simuliert eine erneute Anmeldung: neue Auth-Sitzung plus Serversitzung.
export async function signInAgain(db, account) {
  const next = { ...account, sessionId: randomUUID() }
  await db.query('insert into auth.sessions (id, user_id) values ($1, $2)', [next.sessionId, next.id])
  await startSession(db, next)
  return next
}

// Legt ein Konto wie Supabase Auth an (der Auth-Trigger erzeugt das employee-Profil),
// setzt bei Bedarf eine andere Rolle und startet optional eine Serversitzung.
export async function createAccount(db, {
  email = null,
  firstName = null,
  lastName = null,
  role = 'employee',
  appMetadata = {},
  session = true,
} = {}) {
  const id = randomUUID()
  const userMetadata = {}
  if (firstName) userMetadata.first_name = firstName
  if (lastName) userMetadata.last_name = lastName
  await db.query(
    `insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
     values ($1, $2, $3::jsonb, $4::jsonb)`,
    [id, email, JSON.stringify(userMetadata), JSON.stringify(appMetadata)],
  )
  if (role !== 'employee') {
    await db.query(
      'update public.profiles set role_id = (select id from public.roles where name = $2) where id = $1',
      [id, role],
    )
  }
  const account = {
    id,
    sessionId: randomUUID(),
    role,
    firstName,
    lastName,
    email,
    name: [firstName, lastName].filter(Boolean).join(' ') || null,
  }
  if (session) {
    await db.query('insert into auth.sessions (id, user_id) values ($1, $2)', [account.sessionId, id])
    await startSession(db, account)
  }
  return account
}

const DEFAULT_DEVICE = Object.freeze({
  device_type: 'Laptop',
  manufacture: 'Lenovo',
  model: 'ThinkPad T14',
})

// Legt ein Gerät wie die Geräteverwaltung an (INSERT über die API, created_by = Akteur).
export async function createDevice(db, fields = {}, actor = users.admin) {
  const data = { asset_tag: 'IT-0001', ...DEFAULT_DEVICE, ...fields }
  if (!('serial_number' in data)) data.serial_number = `SN-${data.asset_tag}`
  if (!('created_by' in data)) data.created_by = actor.id
  const columns = Object.keys(data)
  const placeholders = columns.map((_, index) => `$${index + 1}`)
  const { rows } = await asUser(
    db,
    actor,
    `insert into public.devices (${columns.join(', ')}) values (${placeholders.join(', ')}) returning id`,
    columns.map((column) => data[column]),
  )
  return rows[0].id
}

export async function setStatus(db, deviceId, status, actor = users.manager) {
  await asUser(db, actor, 'select public.inventory_device_set_status($1, $2)', [deviceId, status])
}

// Weist über die echte RPC zu und liefert die ID der neuen aktiven Zuweisung.
export async function assign(db, deviceId, employee = users.employee, actor = users.manager) {
  await asUser(db, actor, 'select public.inventory_assign_device($1, $2)', [deviceId, employee.id])
  const { rows } = await db.query(
    'select id from public.assignments where device_id = $1 and returned_at is null',
    [deviceId],
  )
  return rows[0].id
}

export async function returnAssignment(db, assignmentId, actor = users.manager) {
  await asUser(db, actor, 'select public.inventory_return_device($1)', [assignmentId])
}

// Liest das Audit-Log ohne RLS (Superuser), älteste Einträge zuerst.
export async function readAudit(db, { action = null, entityId = null } = {}) {
  const { rows } = await db.query(
    `select id, user_id, action, entity_type, entity_id, entity_title, details, created_at
     from public.audit_logs
     where ($1::text is null or action = $1) and ($2::uuid is null or entity_id = $2)
     order by created_at, id`,
    [action, entityId],
  )
  return rows
}

// Liefert den Zeitpunkt der Datenbankuhr (für Zeitfenster-Prüfungen).
export async function databaseNow(db) {
  const { rows } = await db.query('select clock_timestamp() as now')
  return rows[0].now
}
