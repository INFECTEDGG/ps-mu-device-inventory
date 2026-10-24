import assert from 'node:assert/strict'
import { test } from 'node:test'
import { asUser, assignDevice, createDevice, errorCodes, returnDevice, useTestDatabase, users } from './helpers.mjs'

const createDatabase = useTestDatabase()

const deviceStatuses = ['available', 'assigned', 'defective', 'maintenance', 'retired']

test('erlaubt pro Gerät nur eine aktive Zuweisung (NFA-05)', async (t) => {
  const db = await createDatabase(t)
  const deviceId = await createDevice(db)
  await assignDevice(db, deviceId)

  await assert.rejects(assignDevice(db, deviceId, users.admin), { code: errorCodes.uniqueViolation })
})

test('erlaubt einem Mitarbeiter mehrere Geräte gleichzeitig', async (t) => {
  const db = await createDatabase(t)
  const laptopId = await createDevice(db, 'NB-0001')
  const phoneId = await createDevice(db, 'SP-0001')

  await assignDevice(db, laptopId)
  await assignDevice(db, phoneId)

  const { rows } = await db.query(
    'select device_id from public.assignments where employee_id = $1 and returned_at is null',
    [users.employee.id],
  )
  assert.equal(rows.length, 2)
})

test('erlaubt nach der Rückgabe eine neue Zuweisung und behält die abgeschlossene Zuweisung', async (t) => {
  const db = await createDatabase(t)
  const deviceId = await createDevice(db)
  const firstAssignmentId = await assignDevice(db, deviceId)
  await returnDevice(db, firstAssignmentId)

  await assignDevice(db, deviceId, users.admin)

  const { rows } = await db.query(
    `select employee_id, returned_at, returned_by
     from public.assignments
     where device_id = $1
     order by assigned_at`,
    [deviceId],
  )
  assert.equal(rows.length, 2)
  assert.equal(rows[0].employee_id, users.employee.id)
  assert.ok(rows[0].returned_at)
  assert.equal(rows[0].returned_by, users.manager.id)
  assert.equal(rows[1].employee_id, users.admin.id)
  assert.equal(rows[1].returned_at, null)
})

test('lässt keine Rückgabe vor dem Zuweisungszeitpunkt zu', async (t) => {
  const db = await createDatabase(t)
  const deviceId = await createDevice(db)
  const assignmentId = await assignDevice(db, deviceId)

  await assert.rejects(
    asUser(
      db,
      users.manager,
      "update public.assignments set returned_at = assigned_at - interval '1 minute' where id = $1",
      [assignmentId],
    ),
    { code: errorCodes.checkViolation },
  )
})

test('lässt nur die definierten Gerätestatus zu (FA-07)', async (t) => {
  const db = await createDatabase(t)
  const deviceId = await createDevice(db)

  for (const status of deviceStatuses) {
    await asUser(db, users.manager, 'update public.devices set status = $2 where id = $1', [deviceId, status])
  }

  await assert.rejects(
    asUser(db, users.manager, "update public.devices set status = 'lost' where id = $1", [deviceId]),
    { code: errorCodes.checkViolation },
  )
})

test('verwendet in der Statushistorie dieselben Statuswerte', async (t) => {
  const db = await createDatabase(t)
  const deviceId = await createDevice(db)

  await asUser(
    db,
    users.manager,
    `insert into public.device_status_history (device_id, old_status, new_status, changed_by)
     values ($1, 'available', 'maintenance', $2)`,
    [deviceId, users.manager.id],
  )

  for (const [oldStatus, newStatus] of [
    ['available', 'lost'],
    ['lost', 'available'],
  ]) {
    await assert.rejects(
      asUser(
        db,
        users.manager,
        `insert into public.device_status_history (device_id, old_status, new_status, changed_by)
         values ($1, $2, $3, $4)`,
        [deviceId, oldStatus, newStatus, users.manager.id],
      ),
      { code: errorCodes.checkViolation },
    )
  }
})
