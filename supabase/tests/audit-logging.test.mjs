import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  applyMigrations,
  asAnon,
  asService,
  asUser,
  assignDevice,
  clearAuditLog,
  createDevice,
  errorCodes,
  returnDevice,
  useTestDatabase,
  users,
} from './helpers.mjs'

const createDatabase = useTestDatabase()

async function auditLog(db, action) {
  const { rows } = await db.query(
    `select user_id, action, entity_type, entity_id, entity_title, details, created_at
     from public.audit_logs
     where $1::text is null or action = $1
     order by created_at`,
    [action ?? null],
  )
  return rows
}

test('protokolliert das Anlegen eines Gerätes mit Benutzer, Aktion und Zeitpunkt', async (t) => {
  const db = await createDatabase(t)
  const startedAt = new Date()

  const deviceId = await createDevice(db)

  const entries = await auditLog(db)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].action, 'DEVICE_CREATED')
  assert.equal(entries[0].user_id, users.manager.id)
  assert.equal(entries[0].entity_type, 'device')
  assert.equal(entries[0].entity_id, deviceId)
  assert.equal(entries[0].entity_title, 'NB-0001')
  assert.equal(entries[0].details.model, 'ThinkPad T14')
  assert.equal(entries[0].details.status, 'available')
  assert.ok(entries[0].created_at >= new Date(startedAt.getTime() - 1000))
})

test('protokolliert geänderte Gerätedaten mit altem und neuem Wert', async (t) => {
  const db = await createDatabase(t)
  const deviceId = await createDevice(db)
  await clearAuditLog(db)

  await asUser(
    db,
    users.manager,
    "update public.devices set model = 'ThinkPad T16', updated_at = now() where id = $1",
    [deviceId],
  )

  const entries = await auditLog(db)
  assert.deepEqual(
    entries.map((entry) => entry.action),
    ['DEVICE_UPDATED'],
  )
  assert.deepEqual(entries[0].details, {
    changes: { model: { old: 'ThinkPad T14', new: 'ThinkPad T16' } },
  })
})

test('protokolliert keine Aktualisierung ohne fachliche Änderung', async (t) => {
  const db = await createDatabase(t)
  const deviceId = await createDevice(db)
  await clearAuditLog(db)

  await asUser(db, users.manager, 'update public.devices set updated_at = now() where id = $1', [deviceId])
  await asUser(db, users.manager, "update public.devices set model = 'ThinkPad T14' where id = $1", [deviceId])

  assert.deepEqual(await auditLog(db), [])
})

test('protokolliert Statusänderungen als eigene Aktion', async (t) => {
  const db = await createDatabase(t)
  const deviceId = await createDevice(db)
  await clearAuditLog(db)

  await asUser(db, users.manager, "update public.devices set status = 'maintenance' where id = $1", [deviceId])

  const entries = await auditLog(db)
  assert.deepEqual(
    entries.map((entry) => entry.action),
    ['DEVICE_STATUS_CHANGED'],
  )
  assert.equal(entries[0].user_id, users.manager.id)
  assert.deepEqual(entries[0].details, { old_status: 'available', new_status: 'maintenance' })
})

test('protokolliert Zuweisung und Rückgabe beim betroffenen Gerät', async (t) => {
  const db = await createDatabase(t)
  const deviceId = await createDevice(db)
  await clearAuditLog(db)

  const assignmentId = await assignDevice(db, deviceId)
  await returnDevice(db, assignmentId)

  const [assigned] = await auditLog(db, 'DEVICE_ASSIGNED')
  assert.equal(assigned.user_id, users.manager.id)
  assert.equal(assigned.entity_type, 'device')
  assert.equal(assigned.entity_id, deviceId)
  assert.equal(assigned.entity_title, 'NB-0001')
  assert.equal(assigned.details.assignment_id, assignmentId)
  assert.equal(assigned.details.employee_id, users.employee.id)

  const [returned] = await auditLog(db, 'DEVICE_RETURNED')
  assert.equal(returned.user_id, users.manager.id)
  assert.equal(returned.entity_id, deviceId)
  assert.equal(returned.details.assignment_id, assignmentId)
  assert.ok(returned.details.returned_at)

  assert.equal((await auditLog(db, 'ASSIGNMENT_UPDATED')).length, 0)
})

test('verwendet assigned_by und returned_by, wenn keine Benutzersitzung vorliegt', async (t) => {
  const db = await createDatabase(t)
  const deviceId = await createDevice(db)
  await clearAuditLog(db)

  const { rows } = await asService(
    db,
    `insert into public.assignments (device_id, employee_id, assigned_by)
     values ($1, $2, $3)
     returning id`,
    [deviceId, users.employee.id, users.manager.id],
  )
  await asService(
    db,
    'update public.assignments set returned_at = now(), returned_by = $2 where id = $1',
    [rows[0].id, users.admin.id],
  )

  assert.equal((await auditLog(db, 'DEVICE_ASSIGNED'))[0].user_id, users.manager.id)
  assert.equal((await auditLog(db, 'DEVICE_RETURNED'))[0].user_id, users.admin.id)
})

test('protokolliert Änderungen ohne Benutzersitzung ohne Benutzer statt sie zu verwerfen', async (t) => {
  const db = await createDatabase(t)

  await asService(db, "insert into public.devices (asset_tag) values ('MON-0001')")

  const entries = await auditLog(db)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].action, 'DEVICE_CREATED')
  assert.equal(entries[0].user_id, null)
})

test('protokolliert Korrektur und Löschung einer Zuweisung', async (t) => {
  const db = await createDatabase(t)
  const deviceId = await createDevice(db)
  const assignmentId = await assignDevice(db, deviceId)
  await clearAuditLog(db)

  await asUser(db, users.admin, 'update public.assignments set employee_id = $2 where id = $1', [
    assignmentId,
    users.admin.id,
  ])
  await asUser(db, users.admin, 'delete from public.assignments where id = $1', [assignmentId])

  const [updated] = await auditLog(db, 'ASSIGNMENT_UPDATED')
  assert.equal(updated.user_id, users.admin.id)
  assert.equal(updated.entity_id, deviceId)
  assert.deepEqual(updated.details.changes, {
    employee_id: { old: users.employee.id, new: users.admin.id },
  })

  const [deleted] = await auditLog(db, 'ASSIGNMENT_DELETED')
  assert.equal(deleted.user_id, users.admin.id)
  assert.equal(deleted.entity_id, deviceId)
  assert.equal(deleted.details.assignment_id, assignmentId)
  assert.equal(deleted.details.employee_id, users.admin.id)
})

test('protokolliert Anlegen, Bearbeiten und Rollenwechsel eines Benutzers', async (t) => {
  const db = await createDatabase(t)
  const newUserId = '00000000-0000-4000-8000-000000000004'
  await db.query('insert into auth.users (id) values ($1)', [newUserId])

  await asUser(
    db,
    users.admin,
    `insert into public.profiles (id, role_id, first_name, last_name)
     values ($1, (select id from public.roles where name = 'employee'), 'Tom', 'Neu')`,
    [newUserId],
  )
  await asUser(
    db,
    users.admin,
    `update public.profiles
     set role_id = (select id from public.roles where name = 'device_manager'),
         last_name = 'Neumann',
         updated_at = now()
     where id = $1`,
    [newUserId],
  )

  const [created] = await auditLog(db, 'USER_CREATED')
  assert.equal(created.user_id, users.admin.id)
  assert.equal(created.entity_type, 'user')
  assert.equal(created.entity_id, newUserId)
  assert.equal(created.entity_title, 'Tom Neu')
  assert.equal(created.details.role, 'employee')

  const [roleChanged] = await auditLog(db, 'USER_ROLE_CHANGED')
  assert.equal(roleChanged.user_id, users.admin.id)
  assert.equal(roleChanged.entity_title, 'Tom Neumann')
  assert.deepEqual(roleChanged.details, { old_role: 'employee', new_role: 'device_manager' })

  const [updated] = await auditLog(db, 'USER_UPDATED')
  assert.deepEqual(updated.details, { changes: { last_name: { old: 'Neu', new: 'Neumann' } } })
})

test('behält den Audit-Eintrag, wenn ein Gerät gelöscht wird', async (t) => {
  const db = await createDatabase(t)
  const deviceId = await createDevice(db)

  await asUser(db, users.admin, 'delete from public.devices where id = $1', [deviceId])

  const [deleted] = await auditLog(db, 'DEVICE_DELETED')
  assert.equal(deleted.user_id, users.admin.id)
  assert.equal(deleted.entity_id, deviceId)
  assert.equal(deleted.entity_title, 'NB-0001')
  assert.equal(deleted.details.serial_number, 'SN-123')
  assert.equal((await auditLog(db, 'DEVICE_CREATED')).length, 1)
})

test('verwirft den Audit-Eintrag, wenn die Änderung zurückgerollt wird', async (t) => {
  const db = await createDatabase(t)
  const deviceId = await createDevice(db)
  await assignDevice(db, deviceId)

  await assert.rejects(assignDevice(db, deviceId, users.admin), { code: errorCodes.uniqueViolation })

  const entries = await auditLog(db, 'DEVICE_ASSIGNED')
  assert.equal(entries.length, 1)
  assert.equal(entries[0].details.employee_id, users.employee.id)
})

test('verhindert, dass Anwendungsbenutzer das Audit-Log schreiben oder ändern', async (t) => {
  const db = await createDatabase(t)
  await createDevice(db)

  await assert.rejects(
    asUser(
      db,
      users.admin,
      "insert into public.audit_logs (user_id, action, entity_type) values ($1, 'FAKE', 'device')",
      [users.admin.id],
    ),
    /permission denied/,
  )
  await assert.rejects(
    asUser(db, users.admin, "update public.audit_logs set action = 'FAKE'"),
    /permission denied/,
  )
  await assert.rejects(asUser(db, users.admin, 'delete from public.audit_logs'), /permission denied/)
  await assert.rejects(
    asUser(
      db,
      users.admin,
      "select private.write_audit_log($1, 'FAKE', 'device', null, null, null)",
      [users.admin.id],
    ),
    /permission denied/,
  )

  assert.equal((await auditLog(db)).length, 1)
})

test('Administratoren können alle Audit-Einträge lesen', async (t) => {
  const db = await createDatabase(t)
  const deviceId = await createDevice(db)
  await assignDevice(db, deviceId)
  await createDevice(db, 'NB-0002')

  const { rows: all } = await asUser(db, users.admin, 'select * from public.audit_logs')
  assert.equal(all.length, 3)

  const { rows: forDevice } = await asUser(
    db,
    users.admin,
    `select action from public.audit_logs
     where entity_type = 'device' and entity_id = $1
     order by created_at desc`,
    [deviceId],
  )
  assert.deepEqual(forDevice.map((entry) => entry.action).sort(), ['DEVICE_ASSIGNED', 'DEVICE_CREATED'])
})

test('Gerätemanager, Mitarbeiter und nicht angemeldete Benutzer sehen keine Audit-Einträge', async (t) => {
  const db = await createDatabase(t)
  await createDevice(db)

  for (const user of [users.manager, users.employee]) {
    const { rows } = await asUser(db, user, 'select * from public.audit_logs')
    assert.equal(rows.length, 0, `${user.role} darf das Audit-Log nicht lesen`)
  }
  assert.equal((await asAnon(db, 'select * from public.audit_logs')).rows.length, 0)
  assert.equal((await auditLog(db)).length, 1)
})

test('entzieht den Lesezugriff, sobald die Administratorrolle entfernt wird', async (t) => {
  const db = await createDatabase(t)
  await createDevice(db)

  await db.query(
    "update public.profiles set role_id = (select id from public.roles where name = 'employee') where id = $1",
    [users.admin.id],
  )

  const { rows } = await asUser(db, users.admin, "select * from public.audit_logs where action = 'DEVICE_CREATED'")
  assert.equal(rows.length, 0)
})

test('lässt sich erneut ausführen, ohne Einträge doppelt zu schreiben', async (t) => {
  const db = await createDatabase(t)

  await applyMigrations(db)
  await createDevice(db)

  assert.equal((await auditLog(db)).length, 1)
})
