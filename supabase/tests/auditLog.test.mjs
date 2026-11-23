// PBI-15: Audit-Log erstellen und anzeigen (FA-20, FA-21, NFA-06)
// Prüft supabase/proposals/20261123_pbi_15_audit_log.sql auf der Nachbildung des
// Produktionsschemas – über die echten RPCs, wo es sie gibt, sonst über direkte
// Tabellenzugriffe.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import {
  AUDIT_CHECK,
  AUDIT_PROPOSAL,
  asAnon,
  asService,
  asUser,
  assign,
  createAccount,
  createDevice,
  databaseNow,
  errorCodes,
  freshDatabase,
  readAudit,
  readSql,
  returnAssignment,
  setStatus,
  signInAgain,
  useInventoryStack,
  users,
} from './support/inventoryStack.mjs'

const createDatabase = useInventoryStack()

// PGlite misst clock_timestamp() nur millisekundengenau; kurze Pausen trennen
// Vorgänge, deren Reihenfolge geprüft wird.
const pause = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms))

const ITEM_KEYS = [
  'action', 'created_at', 'details', 'entity_id', 'entity_title', 'entity_type',
  'id', 'user_email', 'user_id', 'user_name',
]

const EDITABLE_ADMIN_PERMISSIONS = [
  'dashboard:view', 'devices:view_own', 'devices:view_all', 'devices:manage',
  'assignments:view_own', 'assignments:view_all', 'assignments:manage', 'audit:view', 'settings:view',
]

async function listAudit(db, account, {
  page = 0, action = null, entityType = null, entityId = null, search = null, from = null, to = null,
} = {}) {
  const { rows } = await asUser(
    db,
    account,
    'select public.inventory_audit_log_list($1, $2, $3, $4, $5, $6, $7) as result',
    [page, action, entityType, entityId, search, from, to],
  )
  return rows[0].result
}

const forbidden = { code: errorCodes.insufficientPrivilege }
const invalid = { code: errorCodes.invalidParameter }
const immutable = { code: errorCodes.insufficientPrivilege, message: 'Audit-Einträge sind unveränderlich.' }

test('protokolliert das Anlegen eines Gerätes mit Benutzer, Aktion, Objekt und Zeitpunkt (FA-20)', async (t) => {
  const db = await createDatabase(t)
  assert.deepEqual(await readAudit(db), [], 'die Vorlage startet mit leerem Audit-Log')

  const startedAt = await databaseNow(db)
  const deviceId = await createDevice(db, { asset_tag: 'IT-0100', name: 'Notebook Empfang', comments: null })
  const finishedAt = await databaseNow(db)

  const entries = await readAudit(db)
  assert.equal(entries.length, 1)
  const [created] = entries
  assert.equal(created.action, 'DEVICE_CREATED')
  assert.equal(created.user_id, users.admin.id)
  assert.equal(created.entity_type, 'device')
  assert.equal(created.entity_id, deviceId)
  assert.equal(created.entity_title, 'IT-0100')
  assert.ok(created.created_at >= startedAt && created.created_at <= finishedAt, 'Zeitpunkt liegt im Vorgang')
  assert.equal(created.details.model, 'ThinkPad T14')
  assert.equal(created.details.status, 'available')
  assert.equal(created.details.name, 'Notebook Empfang')
  for (const key of ['id', 'created_at', 'updated_at', 'comments', 'location']) {
    assert.ok(!(key in created.details), `${key} gehört nicht in die Details`)
  }
})

test('protokolliert Statuswechsel über die Status-RPC als eigene Aktion', async (t) => {
  const db = await createDatabase(t)
  const deviceId = await createDevice(db)

  await setStatus(db, deviceId, 'maintenance', users.manager)

  const [changed, ...rest] = await readAudit(db, { action: 'DEVICE_STATUS_CHANGED' })
  assert.equal(rest.length, 0)
  assert.equal(changed.user_id, users.manager.id)
  assert.equal(changed.entity_id, deviceId)
  assert.deepEqual(changed.details, { old_status: 'available', new_status: 'maintenance' })
  assert.equal((await readAudit(db, { action: 'DEVICE_UPDATED' })).length, 0)
})

test('protokolliert geänderte Stammdaten mit altem und neuem Wert, aber keine Änderungen ohne fachlichen Inhalt', async (t) => {
  const db = await createDatabase(t)
  const deviceId = await createDevice(db)
  const assignmentId = await assign(db, deviceId)
  const baseline = (await readAudit(db)).length

  await asUser(
    db,
    users.admin,
    "update public.devices set model = 'ThinkPad T16', location = 'Raum 1.01' where id = $1",
    [deviceId],
  )
  const [updated, ...rest] = await readAudit(db, { action: 'DEVICE_UPDATED' })
  assert.equal(rest.length, 0)
  assert.equal(updated.user_id, users.admin.id)
  assert.deepEqual(updated.details, {
    changes: {
      model: { old: 'ThinkPad T14', new: 'ThinkPad T16' },
      location: { old: null, new: 'Raum 1.01' },
    },
  })

  // Reine Zeitstempel und unveränderte Werte erzeugen keinen Eintrag.
  await db.query('update public.devices set updated_at = now() where id = $1', [deviceId])
  await asUser(db, users.admin, "update public.devices set model = 'ThinkPad T16' where id = $1", [deviceId])
  await db.query('update public.profiles set updated_at = now() where id = $1', [users.employee.id])
  await asUser(
    db,
    users.admin,
    'select public.inventory_admin_update_user($1, $2, $3)',
    [users.employee.id, users.employee.firstName, users.employee.lastName],
  )
  await asService(db, 'update public.assignments set employee_id = employee_id where id = $1', [assignmentId])

  assert.equal((await readAudit(db)).length, baseline + 1)
})

test('protokolliert Zuweisung und Rücknahme beim Gerät mit Mitarbeiternamen (FA-20)', async (t) => {
  const db = await createDatabase(t)
  const deviceId = await createDevice(db, { asset_tag: 'IT-0200' })
  await pause()
  const assignmentId = await assign(db, deviceId, users.employee, users.manager)
  await pause()
  await returnAssignment(db, assignmentId, users.admin)

  const actions = (await readAudit(db, { entityId: deviceId })).map((entry) => entry.action)
  assert.equal(actions[0], 'DEVICE_CREATED')
  assert.deepEqual(actions.slice(1, 3).sort(), ['DEVICE_ASSIGNED', 'DEVICE_STATUS_CHANGED'])
  assert.deepEqual(actions.slice(3).sort(), ['DEVICE_RETURNED', 'DEVICE_STATUS_CHANGED'])

  const { rows: [stored] } = await db.query('select * from public.assignments where id = $1', [assignmentId])

  const [assigned] = await readAudit(db, { action: 'DEVICE_ASSIGNED' })
  assert.equal(assigned.user_id, users.manager.id)
  assert.equal(assigned.entity_type, 'device')
  assert.equal(assigned.entity_id, deviceId)
  assert.equal(assigned.entity_title, 'IT-0200')
  assert.equal(assigned.details.assignment_id, assignmentId)
  assert.equal(assigned.details.employee_id, users.employee.id)
  assert.equal(assigned.details.employee_name, 'Erika Muster')
  assert.equal(new Date(assigned.details.assigned_at).getTime(), stored.assigned_at.getTime())

  const [returned] = await readAudit(db, { action: 'DEVICE_RETURNED' })
  assert.equal(returned.user_id, users.admin.id)
  assert.equal(returned.entity_id, deviceId)
  assert.equal(returned.details.assignment_id, assignmentId)
  assert.equal(returned.details.employee_name, 'Erika Muster')
  assert.equal(new Date(returned.details.assigned_at).getTime(), stored.assigned_at.getTime())
  assert.equal(new Date(returned.details.returned_at).getTime(), stored.returned_at.getTime())

  const statusChanges = (await readAudit(db, { action: 'DEVICE_STATUS_CHANGED' }))
    .map((entry) => `${entry.details.old_status}->${entry.details.new_status}`)
  assert.deepEqual(statusChanges, ['available->assigned', 'assigned->available'])
  assert.equal((await readAudit(db, { action: 'ASSIGNMENT_UPDATED' })).length, 0)
})

test('protokolliert Korrektur und Löschung einer Zuweisung (Installation ohne PBI-12)', async (t) => {
  // Mit PBI-12 sind Löschungen gesperrt; der Audit-Trigger funktioniert auch ohne.
  const db = await freshDatabase(t, { deviceHistory: false })
  const deviceId = await createDevice(db, { asset_tag: 'IT-0250' })
  const assignmentId = await assign(db, deviceId)

  await asService(db, 'update public.assignments set employee_id = $2 where id = $1', [assignmentId, users.employee2.id])
  const [updated] = await readAudit(db, { action: 'ASSIGNMENT_UPDATED' })
  assert.equal(updated.user_id, null)
  assert.equal(updated.entity_id, deviceId)
  assert.equal(updated.entity_title, 'IT-0250')
  assert.deepEqual(updated.details, {
    assignment_id: assignmentId,
    changes: { employee_id: { old: users.employee.id, new: users.employee2.id } },
  })

  await asService(db, 'delete from public.assignments where id = $1', [assignmentId])
  const [deleted] = await readAudit(db, { action: 'ASSIGNMENT_DELETED' })
  assert.equal(deleted.user_id, null)
  assert.equal(deleted.entity_type, 'device')
  assert.equal(deleted.entity_id, deviceId)
  assert.equal(deleted.details.assignment_id, assignmentId)
  assert.equal(deleted.details.employee_id, users.employee2.id)
  assert.equal(deleted.details.employee_name, 'Emil Beispiel')
  assert.equal(deleted.details.returned_at, null)
})

test('protokolliert neue Benutzerkonten mit anlegendem Administrator oder als System', async (t) => {
  const db = await createDatabase(t)
  const withCreator = await createAccount(db, {
    email: 'nina.neu@example.invalid', firstName: 'Nina', lastName: 'Neu',
    appMetadata: { created_by: users.admin.id }, session: false,
  })
  const withoutCreator = await createAccount(db, { email: 'ohne.name@example.invalid', session: false })
  const brokenCreator = await createAccount(db, {
    email: 'kaputt@example.invalid', appMetadata: { created_by: 'keine-uuid' }, session: false,
  })

  const byId = new Map((await readAudit(db, { action: 'USER_CREATED' })).map((entry) => [entry.entity_id, entry]))
  assert.equal(byId.size, 3)

  const created = byId.get(withCreator.id)
  assert.equal(created.user_id, users.admin.id)
  assert.equal(created.entity_type, 'user')
  assert.equal(created.entity_title, 'Nina Neu')
  assert.deepEqual(created.details, {
    first_name: 'Nina', last_name: 'Neu', role: 'employee', email: 'nina.neu@example.invalid',
  })

  const system = byId.get(withoutCreator.id)
  assert.equal(system.user_id, null, 'ohne created_by gilt das System als Akteur')
  assert.equal(system.entity_title, 'ohne.name@example.invalid')

  assert.equal(byId.get(brokenCreator.id).user_id, null, 'ungültige created_by-Werte brechen nichts ab')
})

test('protokolliert Namensänderung, Rollenwechsel, Deaktivierung und Reaktivierung eines Benutzers', async (t) => {
  const db = await createDatabase(t)

  await asUser(db, users.admin, 'select public.inventory_admin_update_user($1, $2, $3)', [users.employee.id, 'Erika', 'Mustermann'])
  const [updated] = await readAudit(db, { action: 'USER_UPDATED' })
  assert.equal(updated.user_id, users.admin.id)
  assert.equal(updated.entity_id, users.employee.id)
  assert.equal(updated.entity_title, 'Erika Mustermann')
  assert.deepEqual(updated.details, { changes: { last_name: { old: 'Muster', new: 'Mustermann' } } })

  await asUser(db, users.admin, 'select public.inventory_admin_assign_role($1, $2)', [users.employee2.id, 'device_manager'])
  const [roleChanged] = await readAudit(db, { action: 'USER_ROLE_CHANGED' })
  assert.equal(roleChanged.user_id, users.admin.id)
  assert.equal(roleChanged.entity_id, users.employee2.id)
  assert.equal(roleChanged.entity_title, 'Emil Beispiel')
  assert.deepEqual(roleChanged.details, { old_role: 'employee', new_role: 'device_manager' })

  await asUser(db, users.admin, 'select public.inventory_admin_disable_user($1)', [users.employee2.id])
  await asUser(db, users.admin, 'select public.inventory_admin_disable_user($1)', [users.employee2.id])
  const disabled = await readAudit(db, { action: 'USER_DISABLED' })
  assert.equal(disabled.length, 1, 'erneutes Deaktivieren erzeugt keinen zweiten Eintrag')
  assert.equal(disabled[0].user_id, users.admin.id)
  assert.ok(Date.parse(disabled[0].details.disabled_at))

  await db.query('update public.profiles set disabled_at = null where id = $1', [users.employee2.id])
  const [enabled] = await readAudit(db, { action: 'USER_ENABLED' })
  assert.equal(enabled.user_id, null)
  assert.deepEqual(enabled.details, {})

  assert.equal((await readAudit(db, { action: 'USER_UPDATED' })).length, 1, 'Rolle und Sperre erscheinen nicht als USER_UPDATED')
  assert.equal((await readAudit(db, { action: 'ROLE_PERMISSIONS_CHANGED' })).length, 0)
})

test('protokolliert geänderte Rollenberechtigungen mit dem neuen Stand', async (t) => {
  const db = await createDatabase(t)

  await asUser(
    db,
    users.superAdmin,
    'select public.inventory_superadmin_update_permissions($1, $2)',
    ['employee', ['settings:view', 'dashboard:view', 'devices:view_own']],
  )

  const [changed, ...rest] = await readAudit(db, { action: 'ROLE_PERMISSIONS_CHANGED' })
  assert.equal(rest.length, 0)
  assert.equal(changed.user_id, users.superAdmin.id)
  assert.equal(changed.entity_type, 'role')
  assert.equal(changed.entity_id, null)
  assert.equal(changed.entity_title, 'employee')
  assert.deepEqual(changed.details, {
    role: 'employee',
    permissions: ['dashboard:view', 'devices:view_own', 'settings:view'],
  })
})

test('protokolliert gelöschte Geräte und Profile; das Löschen entfernt nur den Benutzerbezug', async (t) => {
  const db = await createDatabase(t)
  const temp = await createAccount(db, { email: 'tom.temp@example.invalid', firstName: 'Tom', lastName: 'Temp' })

  // Eine Änderung mit Benutzersitzung von Tom (direkt, ohne RLS).
  const deviceId = await db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: temp.id, role: 'authenticated' })])
    const { rows } = await tx.query(
      "insert into public.devices (asset_tag, serial_number) values ('IT-0400', 'SN-0400') returning id",
    )
    return rows[0].id
  })
  const [created] = await readAudit(db, { action: 'DEVICE_CREATED' })
  assert.equal(created.user_id, temp.id)

  await db.query('delete from public.devices where id = $1', [deviceId])
  const [deletedDevice] = await readAudit(db, { action: 'DEVICE_DELETED' })
  assert.equal(deletedDevice.entity_id, deviceId)
  assert.equal(deletedDevice.entity_title, 'IT-0400')
  assert.equal(deletedDevice.details.serial_number, 'SN-0400')

  await db.query('delete from public.profiles where id = $1', [temp.id])
  const [deletedUser] = await readAudit(db, { action: 'USER_DELETED' })
  assert.equal(deletedUser.entity_type, 'user')
  assert.equal(deletedUser.entity_id, temp.id)
  assert.equal(deletedUser.entity_title, 'Tom Temp')
  assert.equal(deletedUser.details.email, 'tom.temp@example.invalid')

  const [kept] = await readAudit(db, { action: 'DEVICE_CREATED' })
  assert.equal(kept.id, created.id)
  assert.equal(kept.user_id, null, 'ON DELETE SET NULL')
  assert.deepEqual(
    { ...kept, user_id: created.user_id },
    created,
    'alle anderen Felder bleiben unverändert',
  )
})

test('schreibt Einträge ohne Benutzersitzung als System und nutzt fachliche Rückfallwerte', async (t) => {
  const db = await createDatabase(t)

  await asService(db, "insert into public.devices (asset_tag, serial_number) values ('IT-0300', 'SN-0300')")
  const { rows: [{ id: deviceId }] } = await asService(
    db,
    "insert into public.devices (asset_tag, serial_number, created_by) values ('IT-0301', 'SN-0301', $1) returning id",
    [users.manager.id],
  )
  const { rows: [{ id: assignmentId }] } = await asService(
    db,
    'insert into public.assignments (device_id, employee_id, assigned_by) values ($1, $2, $3) returning id',
    [deviceId, users.employee.id, users.manager.id],
  )
  await asService(
    db,
    'update public.assignments set returned_at = clock_timestamp(), returned_by = $2 where id = $1',
    [assignmentId, users.admin.id],
  )

  const created = new Map((await readAudit(db, { action: 'DEVICE_CREATED' })).map((entry) => [entry.entity_title, entry]))
  assert.equal(created.get('IT-0300').user_id, null)
  assert.equal(created.get('IT-0301').user_id, users.manager.id, 'created_by als Rückfallwert')
  assert.equal((await readAudit(db, { action: 'DEVICE_ASSIGNED' }))[0].user_id, users.manager.id)
  assert.equal((await readAudit(db, { action: 'DEVICE_RETURNED' }))[0].user_id, users.admin.id)

  const page = await listAudit(db, users.admin, { search: 'IT-0300' })
  assert.equal(page.total, 1)
  assert.equal(page.items[0].user_id, null)
  assert.equal(page.items[0].user_name, null)
  assert.equal(page.items[0].user_email, null)
})

test('verwendet nur Benutzer mit Profil als Akteur, ohne die fachliche Änderung abzubrechen', async (t) => {
  const db = await createDatabase(t)
  const unknown = randomUUID()

  await db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: unknown, role: 'authenticated' })])
    await tx.query("insert into public.devices (asset_tag, serial_number, created_by) values ('IT-0600', 'SN-0600', null)")
  })

  const { rows } = await db.query("select id from public.devices where asset_tag = 'IT-0600'")
  assert.equal(rows.length, 1, 'die Änderung selbst wurde gespeichert')
  const [entry] = await readAudit(db, { action: 'DEVICE_CREATED' })
  assert.equal(entry.user_id, null)
})

test('verwirft Audit-Einträge zusammen mit einer zurückgerollten Änderung (NFA-06)', async (t) => {
  const db = await createDatabase(t)
  const deviceId = await createDevice(db)
  const baseline = await readAudit(db)

  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: users.manager.id, session_id: users.manager.sessionId, role: 'authenticated' }),
      ])
      await tx.query('select public.inventory_assign_device($1, $2)', [deviceId, users.employee.id])
      // Innerhalb der Transaktion stehen Änderung und Audit-Einträge gemeinsam bereit.
      const { rows } = await tx.query(
        "select count(*)::int as n from public.audit_logs where entity_id = $1 and action in ('DEVICE_ASSIGNED', 'DEVICE_STATUS_CHANGED')",
        [deviceId],
      )
      assert.equal(rows[0].n, 2)
      throw new Error('Abbruch nach der Zuweisung')
    }),
    /Abbruch nach der Zuweisung/,
  )

  // Fehlgeschlagene RPC: Mitarbeiter ist kein zuweisbarer Empfänger.
  await assert.rejects(assign(db, deviceId, users.manager), { code: errorCodes.notFound })

  assert.deepEqual(await readAudit(db), baseline)
  const { rows } = await db.query('select count(*)::int as n from public.assignments where device_id = $1', [deviceId])
  assert.equal(rows[0].n, 0)
})

test('Browser-Rollen können audit_logs weder lesen noch schreiben', async (t) => {
  const db = await createDatabase(t)
  await createDevice(db)
  const statements = [
    'select * from public.audit_logs',
    "insert into public.audit_logs (action, entity_type) values ('FAKE', 'device')",
    "update public.audit_logs set action = 'FAKE'",
    'delete from public.audit_logs',
    "select inventory_private.write_audit_log(null, 'FAKE', 'device', null, null, null)",
  ]

  for (const account of Object.values(users)) {
    for (const sql of statements) {
      await assert.rejects(asUser(db, account, sql), forbidden, `${account.role}: ${sql}`)
    }
  }
  for (const sql of statements) {
    await assert.rejects(asAnon(db, sql), forbidden, `anon: ${sql}`)
  }
  for (const sql of statements.slice(1)) {
    await assert.rejects(asService(db, sql), forbidden, `service_role: ${sql}`)
  }
  await assert.rejects(asAnon(db, 'select public.inventory_audit_log_list()'), forbidden)
  await assert.rejects(asService(db, 'select public.inventory_audit_log_list()'), forbidden)

  const { rows: [grants] } = await db.query(`
    select
      has_function_privilege('anon', 'public.inventory_audit_log_list(integer,text,text,uuid,text,timestamptz,timestamptz)', 'execute') as anon,
      has_function_privilege('authenticated', 'public.inventory_audit_log_list(integer,text,text,uuid,text,timestamptz,timestamptz)', 'execute') as authenticated,
      has_function_privilege('service_role', 'public.inventory_audit_log_list(integer,text,text,uuid,text,timestamptz,timestamptz)', 'execute') as service_role,
      has_schema_privilege('authenticated', 'inventory_private', 'usage') as private_schema
  `)
  assert.deepEqual(grants, { anon: false, authenticated: true, service_role: false, private_schema: false })
  assert.equal((await readAudit(db)).length, 1)
})

test('Audit-Einträge sind auch für Superuser unveränderlich', async (t) => {
  const db = await createDatabase(t)
  await createDevice(db)
  const before = await readAudit(db)

  await assert.rejects(db.query("update public.audit_logs set action = 'FAKE'"), immutable)
  await assert.rejects(db.query("update public.audit_logs set created_at = created_at - interval '1 day'"), immutable)
  await assert.rejects(db.query('update public.audit_logs set user_id = null'), immutable,
    'Benutzerbezug darf nur beim Löschen des Profils entfallen')
  await assert.rejects(db.query('delete from public.audit_logs'), immutable)
  await assert.rejects(db.query('truncate public.audit_logs'), immutable)

  assert.deepEqual(await readAudit(db), before)
})

test('Administratoren und SuperAdmins lesen das Audit-Log über die RPC (FA-21)', async (t) => {
  const db = await createDatabase(t)
  const deviceId = await createDevice(db, { asset_tag: 'IT-0700' })
  await pause()
  await setStatus(db, deviceId, 'defective', users.manager)

  for (const reader of [users.admin, users.superAdmin]) {
    const page = await listAudit(db, reader)
    assert.equal(page.total, 2)
    assert.equal(page.page_size, 25)
    assert.equal(page.items.length, 2)
    for (const item of page.items) assert.deepEqual(Object.keys(item).sort(), ITEM_KEYS)

    const [newest, oldest] = page.items
    assert.equal(newest.action, 'DEVICE_STATUS_CHANGED')
    assert.equal(newest.entity_type, 'device')
    assert.equal(newest.entity_id, deviceId)
    assert.equal(newest.entity_title, 'IT-0700')
    assert.equal(newest.user_id, users.manager.id)
    assert.equal(newest.user_name, 'Max Manager')
    assert.equal(newest.user_email, 'manager@example.invalid')
    assert.deepEqual(newest.details, { old_status: 'available', new_status: 'defective' })
    assert.equal(typeof newest.id, 'string')
    assert.ok(Date.parse(newest.created_at) >= Date.parse(oldest.created_at))
    assert.equal(oldest.action, 'DEVICE_CREATED')
    assert.equal(oldest.user_name, 'Ada Admin')
  }

  const perDevice = await listAudit(db, users.admin, { entityType: 'device', entityId: deviceId })
  assert.equal(perDevice.total, 2)
})

test('Gerätemanager, Mitarbeiter und nicht angemeldete Benutzer erhalten keinen Zugriff (FA-21)', async (t) => {
  const db = await createDatabase(t)
  await createDevice(db)

  for (const account of [users.manager, users.employee, users.employee2]) {
    await assert.rejects(listAudit(db, account), forbidden, account.role)
  }
  // Ungültige Parameter verraten Unberechtigten nichts: zuerst wird die Berechtigung geprüft.
  await assert.rejects(listAudit(db, users.employee, { page: -1 }), forbidden)
  await assert.rejects(asAnon(db, 'select public.inventory_audit_log_list()'), forbidden)
})

test('Administrator verliert den Zugriff ohne audit:view, nach Deaktivierung oder Sitzungsende', async (t) => {
  // a) Berechtigung audit:view wird der Rolle admin entzogen.
  const db = await createDatabase(t)
  await createDevice(db)
  const withoutAudit = EDITABLE_ADMIN_PERMISSIONS.filter((permission) => permission !== 'audit:view')
  await asUser(db, users.superAdmin, 'select public.inventory_superadmin_update_permissions($1, $2)', ['admin', withoutAudit])

  await assert.rejects(listAudit(db, users.admin), forbidden, 'alte Sitzung wurde widerrufen')
  const freshLogin = await signInAgain(db, users.admin)
  await assert.rejects(listAudit(db, freshLogin), forbidden, 'neue Sitzung ohne audit:view')
  assert.equal((await listAudit(db, users.superAdmin)).total, 2, 'SuperAdmin behält den Zugriff')

  await asUser(db, users.superAdmin, 'select public.inventory_superadmin_update_permissions($1, $2)', ['admin', EDITABLE_ADMIN_PERMISSIONS])
  const restored = await signInAgain(db, users.admin)
  assert.ok((await listAudit(db, restored)).total >= 3)

  // b) Administrator wird deaktiviert.
  const disabledDb = await createDatabase(t)
  await asUser(disabledDb, users.superAdmin, 'select public.inventory_admin_disable_user($1)', [users.admin.id])
  await assert.rejects(listAudit(disabledDb, users.admin), forbidden)

  // c) Sitzung wurde beendet.
  const endedDb = await createDatabase(t)
  await asUser(endedDb, users.admin, 'select public.inventory_session_end()')
  await assert.rejects(listAudit(endedDb, users.admin), forbidden)
})

test('filtert nach Aktion, Objekt, Suchbegriff und Zeitraum', async (t) => {
  const db = await createDatabase(t)
  const wildcardDevice = await createDevice(db, { asset_tag: 'IT_1%', serial_number: 'SN-W1' })
  const plainDevice = await createDevice(db, { asset_tag: 'ITX1000', serial_number: 'SN-P1' })
  await pause()
  await setStatus(db, plainDevice, 'defective', users.manager)
  await pause()
  await assign(db, wildcardDevice, users.employee, users.manager)
  await pause()
  await asUser(db, users.admin, 'select public.inventory_admin_assign_role($1, $2)', [users.employee2.id, 'device_manager'])
  await pause()
  await asUser(
    db,
    users.superAdmin,
    'select public.inventory_superadmin_update_permissions($1, $2)',
    ['employee', ['dashboard:view', 'devices:view_own', 'assignments:view_own', 'settings:view']],
  )
  const all = await readAudit(db)
  assert.equal(all.length, 7)

  const total = async (filters) => (await listAudit(db, users.admin, filters)).total

  // Aktion und Objekttyp
  const statusPage = await listAudit(db, users.admin, { action: 'DEVICE_STATUS_CHANGED' })
  assert.equal(statusPage.total, 2)
  assert.ok(statusPage.items.every((item) => item.action === 'DEVICE_STATUS_CHANGED'))
  assert.equal(await total({ entityType: 'device' }), 5)
  assert.equal(await total({ entityType: 'user' }), 1)
  assert.equal(await total({ entityType: 'role' }), 1)
  assert.equal(await total({ entityType: 'device', entityId: plainDevice }), 2)
  assert.equal(await total({ action: 'DEVICE_STATUS_CHANGED', search: 'itx' }), 1)

  // Suche: Platzhalter werden wörtlich gesucht, Groß-/Kleinschreibung egal.
  assert.equal(await total({ search: '_' }), 3, 'nur IT_1% enthält einen Unterstrich')
  assert.equal(await total({ search: '%' }), 3)
  assert.equal(await total({ search: 'it_1' }), 3)
  assert.equal(await total({ search: '\\' }), 0)
  assert.equal(await total({ search: 'erika' }), 1, 'Mitarbeitername in den Details')
  assert.equal(await total({ search: 'Max Manager' }), 3, 'Name des ausführenden Benutzers')
  assert.equal(await total({ search: 'superadmin@example' }), 1, 'E-Mail des ausführenden Benutzers')
  assert.equal(await total({ search: 'emil beispiel' }), 1, 'Objektbezeichnung eines Benutzers')
  assert.equal(await total({ search: 'employee' }), 1, 'Rolle in den Details')
  assert.equal(await total({ search: '   ' }), 7, 'leere Suche filtert nicht')

  // Zeitraum: beide Grenzen inklusive
  const pivot = all[3].created_at
  assert.equal(await total({ from: pivot }), all.filter((entry) => entry.created_at >= pivot).length)
  assert.equal(await total({ to: pivot }), all.filter((entry) => entry.created_at <= pivot).length)
  const samePoint = all.filter((entry) => entry.created_at.getTime() === pivot.getTime()).length
  assert.ok(samePoint >= 1)
  assert.equal(await total({ from: pivot, to: pivot }), samePoint)
  assert.equal(await total({ from: new Date(Date.now() + 86_400_000) }), 0)
})

test('liefert Seiten zu je 25 Einträgen mit Gesamtzahl, neueste zuerst', async (t) => {
  const db = await createDatabase(t)
  await db.query(`
    insert into public.devices (asset_tag, serial_number)
    select 'P-' || lpad(g::text, 3, '0'), 'SN-P-' || g from generate_series(1, 60) g
  `)
  const { rows: expected } = await db.query('select id from public.audit_logs order by created_at desc, id desc')
  assert.equal(expected.length, 60)

  const pages = []
  for (const page of [0, 1, 2, 3]) pages.push(await listAudit(db, users.admin, { page }))
  assert.deepEqual(pages.map((result) => result.items.length), [25, 25, 10, 0])
  assert.ok(pages.every((result) => result.total === 60 && result.page_size === 25))
  assert.deepEqual(
    pages.flatMap((result) => result.items.map((item) => item.id)),
    expected.map((row) => row.id),
  )
  assert.equal((await listAudit(db, users.admin, { page: 10000 })).items.length, 0)
})

test('lehnt ungültige Filter mit 22023 ab', async (t) => {
  const db = await createDatabase(t)
  const now = new Date()
  const cases = [
    { page: -1 },
    { page: 10001 },
    { page: null },
    { action: 'FAKE' },
    { action: 'device_created' },
    { entityType: 'devices' },
    { search: 'x'.repeat(101) },
    { from: now, to: new Date(now.getTime() - 1) },
  ]
  for (const filters of cases) {
    await assert.rejects(listAudit(db, users.admin, filters), invalid, JSON.stringify(filters))
  }
  // Getrimmt höchstens 100 Zeichen sind erlaubt.
  assert.equal((await listAudit(db, users.admin, { search: `  ${'x'.repeat(100)}  ` })).total, 0)
})

test('installiert sich auf einer Datenbank mit den alten Audit-Migrationen und entfernt deren Objekte', async (t) => {
  const db = await freshDatabase(t, { legacyAudit: true })

  const { rows: [state] } = await db.query(`
    select
      to_regnamespace('private') is null as private_schema_removed,
      (select count(*)::int from pg_trigger where tgname in
        ('audit_device_changes', 'audit_assignment_changes', 'audit_profile_changes')) as legacy_triggers,
      (select count(*)::int from pg_policy where polname = 'audit_logs_admin_read') as legacy_policies,
      (select count(*)::int from pg_trigger where tgname like 'inventory_audit_%') as new_triggers,
      (select array_agg(confdeltype::text) from pg_constraint
        where conrelid = 'public.audit_logs'::regclass and contype = 'f') as user_fk_rules
  `)
  assert.deepEqual(state, {
    private_schema_removed: true,
    legacy_triggers: 0,
    legacy_policies: 0,
    new_triggers: 6,
    user_fk_rules: ['n'],
  })

  // Altbestand der alten Trigger bleibt erhalten (SuperAdmin-Bootstrap).
  const legacyEntries = await readAudit(db, { action: 'USER_ROLE_CHANGED' })
  assert.ok(legacyEntries.some((entry) =>
    entry.entity_id === users.superAdmin.id && entry.details.new_role === 'super_admin'))

  // Neue Änderungen werden genau einmal protokolliert.
  const deviceId = await createDevice(db, { asset_tag: 'IT-0800' })
  assert.deepEqual((await readAudit(db, { entityId: deviceId })).map((entry) => entry.action), ['DEVICE_CREATED'])
  await assert.rejects(asUser(db, users.admin, 'select * from public.audit_logs'), forbidden)
  assert.ok((await listAudit(db, users.admin)).total >= 2)
})

test('Preflight verweigert eine zweite Ausführung ohne Änderungen', async (t) => {
  const db = await createDatabase(t)
  const proposal = await readSql(AUDIT_PROPOSAL)

  await assert.rejects(db.exec(proposal), (error) => {
    assert.equal(error.code, '55000')
    assert.match(error.message, /inventory_audit_log_list existiert bereits/)
    return true
  })
  await db.exec('rollback')

  const { rows } = await db.query("select count(*)::int as n from pg_trigger where tgname = 'inventory_audit_devices'")
  assert.equal(rows[0].n, 1)
  await createDevice(db)
  assert.equal((await readAudit(db)).length, 1)
})

test('Preflight prüft Altdaten, wandelt Text-Details um und die Prüfabfragen laufen nur lesend', async (t) => {
  const db = await freshDatabase(t, { auditLog: false, deviceHistory: false, sessions: false })
  const proposal = await readSql(AUDIT_PROPOSAL)
  const check = await readSql(AUDIT_CHECK)
  const readOnly = (sql) => db.exec(`begin transaction read only;\n${sql}\nrollback;`)

  await readOnly(check)

  // Altdaten ohne Pflichtfelder stoppen die Installation vollständig.
  await db.exec("insert into public.audit_logs (action, entity_type) values (null, 'device')")
  await assert.rejects(db.exec(proposal), (error) => {
    assert.equal(error.code, '55000')
    assert.match(error.message, /ohne action, entity_type oder created_at/)
    return true
  })
  await db.exec('rollback')
  const { rows: columns } = await db.query(
    "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'audit_logs' and column_name = 'user_id'",
  )
  assert.equal(columns.length, 0, 'nichts wurde geändert')

  // Text-Details aus einem älteren Stand werden in jsonb umgewandelt.
  await db.exec(`
    delete from public.audit_logs;
    alter table public.audit_logs alter column details type text using details::text;
    insert into public.audit_logs (action, entity_type, entity_title, details)
      values ('DEVICE_CREATED', 'device', 'ALT-1', '{"model":"Alt"}');
  `)
  await db.exec(proposal)
  const { rows: [legacy] } = await db.query(
    "select details, pg_typeof(details)::text as type from public.audit_logs where entity_title = 'ALT-1'",
  )
  assert.deepEqual(legacy, { details: { model: 'Alt' }, type: 'jsonb' })

  await readOnly(check)
})
