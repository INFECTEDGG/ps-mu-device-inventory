// Kernprozesse Zuweisung und Rücknahme (NFA-13)
// Testet die echten RPCs inventory_assign_device, inventory_return_device und
// inventory_device_set_status auf der Nachbildung des Produktionsschemas.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  asUser,
  assign,
  createDevice,
  databaseNow,
  errorCodes,
  readAudit,
  returnAssignment,
  setStatus,
  useInventoryStack,
  users,
  withUser,
} from './support/inventoryStack.mjs'

const createDatabase = useInventoryStack()

// PGlite misst clock_timestamp() nur millisekundengenau; kurze Pausen trennen
// Vorgänge, deren Reihenfolge geprüft wird.
const pause = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms))

const forbidden = { code: errorCodes.insufficientPrivilege }

async function deviceStatus(db, deviceId) {
  const { rows } = await db.query('select status from public.devices where id = $1', [deviceId])
  return rows[0].status
}

async function statusHistory(db, deviceId) {
  const { rows } = await db.query(
    'select old_status, new_status, changed_by, changed_at from public.device_status_history where device_id = $1 order by changed_at, id',
    [deviceId],
  )
  return rows
}

async function assignmentsOf(db, deviceId) {
  const { rows } = await db.query(
    'select * from public.assignments where device_id = $1 order by assigned_at, id',
    [deviceId],
  )
  return rows
}

test('FA-08: nur verfügbare Geräte können zugewiesen werden', async (t) => {
  const db = await createDatabase(t)
  const cases = [
    ['defective', users.manager],
    ['maintenance', users.manager],
    ['retired', users.admin],
  ]
  for (const [index, [status, actor]] of cases.entries()) {
    const deviceId = await createDevice(db, { asset_tag: `IT-08${index}` })
    await setStatus(db, deviceId, status, actor)
    await assert.rejects(assign(db, deviceId), { code: errorCodes.checkViolation }, status)
  }

  const withoutStatus = await createDevice(db, { asset_tag: 'IT-0890' })
  await db.query('update public.devices set status = null where id = $1', [withoutStatus])
  await assert.rejects(assign(db, withoutStatus), { code: errorCodes.checkViolation }, 'Status nicht gesetzt')

  const available = await createDevice(db, { asset_tag: 'IT-0899' })
  await assign(db, available)
  await assert.rejects(assign(db, available, users.employee2), { code: errorCodes.checkViolation }, 'bereits zugewiesen')

  const { rows } = await db.query('select count(*)::int as n from public.assignments')
  assert.equal(rows[0].n, 1)
})

test('FA-09: Gerät, Mitarbeiter, Zeitpunkt und ausführender Benutzer werden gespeichert', async (t) => {
  const db = await createDatabase(t)
  const deviceId = await createDevice(db)
  const startedAt = await databaseNow(db)
  const assignmentId = await assign(db, deviceId, users.employee, users.manager)
  const finishedAt = await databaseNow(db)

  const [stored] = await assignmentsOf(db, deviceId)
  assert.equal(stored.id, assignmentId)
  assert.equal(stored.device_id, deviceId)
  assert.equal(stored.employee_id, users.employee.id)
  assert.equal(stored.assigned_by, users.manager.id)
  assert.ok(stored.assigned_at >= startedAt && stored.assigned_at <= finishedAt)
  assert.equal(stored.returned_at, null)
  assert.equal(stored.returned_by, null)
})

test('FA-10: nach der Zuweisung hat das Gerät den Status assigned', async (t) => {
  const db = await createDatabase(t)
  const deviceId = await createDevice(db)
  assert.equal(await deviceStatus(db, deviceId), 'available')
  await assign(db, deviceId)
  assert.equal(await deviceStatus(db, deviceId), 'assigned')
})

test('FA-11/FA-12: Rücknahme speichert Zeitpunkt und ausführenden Benutzer und beendet die Zuweisung', async (t) => {
  const db = await createDatabase(t)
  const deviceId = await createDevice(db)
  const assignmentId = await assign(db, deviceId, users.employee, users.manager)

  await returnAssignment(db, assignmentId, users.admin)

  const [stored] = await assignmentsOf(db, deviceId)
  assert.ok(stored.returned_at instanceof Date)
  assert.ok(stored.returned_at >= stored.assigned_at)
  assert.equal(stored.returned_by, users.admin.id)
  assert.equal(stored.assigned_by, users.manager.id, 'Zuweisungsdaten bleiben unverändert')

  const { rows } = await asUser(db, users.manager, "select public.inventory_assignments_overview('active', 0) as overview")
  assert.equal(rows[0].overview.active_count, 0)
  assert.equal(rows[0].overview.returned_count, 1)
})

test('FA-13: nach der Rücknahme ist das Gerät wieder verfügbar und erneut zuweisbar', async (t) => {
  const db = await createDatabase(t)
  const deviceId = await createDevice(db)
  const first = await assign(db, deviceId)
  await pause()
  await returnAssignment(db, first)
  assert.equal(await deviceStatus(db, deviceId), 'available')

  await pause()
  await assign(db, deviceId, users.employee2)
  const rows = await assignmentsOf(db, deviceId)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].employee_id, users.employee.id)
  assert.ok(rows[0].returned_at, 'abgeschlossene Zuweisung bleibt erhalten')
  assert.equal(rows[1].employee_id, users.employee2.id)
  assert.equal(rows[1].returned_at, null)
})

test('FA-14: jede Statusänderung erscheint in der Statushistorie', async (t) => {
  const db = await createDatabase(t)
  const deviceId = await createDevice(db)
  await setStatus(db, deviceId, 'maintenance', users.manager)
  await pause()
  await setStatus(db, deviceId, 'available', users.manager)
  await pause()
  const assignmentId = await assign(db, deviceId, users.employee, users.admin)
  await pause()
  await returnAssignment(db, assignmentId, users.manager)

  const rows = await statusHistory(db, deviceId)
  assert.deepEqual(
    rows.map((row) => [row.old_status, row.new_status, row.changed_by]),
    [
      ['available', 'maintenance', users.manager.id],
      ['maintenance', 'available', users.manager.id],
      ['available', 'assigned', users.admin.id],
      ['assigned', 'available', users.manager.id],
    ],
  )
  const [stored] = await assignmentsOf(db, deviceId)
  assert.equal(rows[3].changed_at.getTime(), stored.returned_at.getTime(), 'Rücknahme und Historie teilen den Zeitpunkt')

  // Ein Statuswechsel ohne Änderung erzeugt keinen Eintrag.
  await setStatus(db, deviceId, 'available', users.manager)
  assert.equal((await statusHistory(db, deviceId)).length, 4)
})

test('NFA-05: pro Gerät höchstens eine aktive Zuweisung, mehrere Geräte pro Mitarbeiter', async (t) => {
  const db = await createDatabase(t)
  const laptop = await createDevice(db, { asset_tag: 'IT-0001' })
  const phone = await createDevice(db, { asset_tag: 'IT-0002' })
  await assign(db, laptop, users.employee)
  await assign(db, phone, users.employee)

  // Auch ein direkter Schreibzugriff am RPC vorbei scheitert am eindeutigen Index.
  await assert.rejects(
    db.query('insert into public.assignments (device_id, employee_id, assigned_by) values ($1, $2, $3)', [laptop, users.employee2.id, users.admin.id]),
    { code: errorCodes.uniqueViolation },
  )

  const { rows } = await db.query(
    'select count(*)::int as n from public.assignments where employee_id = $1 and returned_at is null',
    [users.employee.id],
  )
  assert.equal(rows[0].n, 2)
})

test('NFA-06: eine fehlgeschlagene Zuweisung hinterlässt keine Teildaten', async (t) => {
  const db = await createDatabase(t)
  const deviceId = await createDevice(db)
  const auditBefore = await readAudit(db)

  // Fehler im letzten Schritt (Statushistorie) nach Anlage der Zuweisung und Statuswechsel.
  await db.exec(`
    create function public.test_history_failure() returns trigger language plpgsql as $$
    begin raise exception 'Testfehler in der Statushistorie'; end $$;
    create trigger test_history_failure before insert on public.device_status_history
      for each row execute function public.test_history_failure();
  `)
  await assert.rejects(assign(db, deviceId), /Testfehler in der Statushistorie/)
  await db.exec('drop trigger test_history_failure on public.device_status_history')

  // Ungültiger Empfänger (kein Mitarbeiter) und Abbruch des Aufrufers.
  await assert.rejects(assign(db, deviceId, users.manager), { code: errorCodes.notFound })
  await assert.rejects(
    withUser(db, users.manager, async (tx) => {
      await tx.query('select public.inventory_assign_device($1, $2)', [deviceId, users.employee.id])
      throw new Error('Abbruch durch den Aufrufer')
    }),
    /Abbruch durch den Aufrufer/,
  )

  assert.equal(await deviceStatus(db, deviceId), 'available')
  assert.deepEqual(await assignmentsOf(db, deviceId), [])
  assert.deepEqual(await statusHistory(db, deviceId), [])
  assert.deepEqual(await readAudit(db), auditBefore)

  // Danach funktioniert die Zuweisung regulär.
  await assign(db, deviceId)
  assert.equal(await deviceStatus(db, deviceId), 'assigned')
})

test('FA-04: Mitarbeiter dürfen weder zuweisen noch zurücknehmen', async (t) => {
  const db = await createDatabase(t)
  const deviceId = await createDevice(db)
  const assignmentId = await assign(db, deviceId)
  const freeDevice = await createDevice(db, { asset_tag: 'IT-0002' })

  await assert.rejects(assign(db, freeDevice, users.employee, users.employee), forbidden)
  await assert.rejects(returnAssignment(db, assignmentId, users.employee), forbidden)
  await assert.rejects(
    asUser(db, users.employee, 'insert into public.assignments (device_id, employee_id) values ($1, $2)', [freeDevice, users.employee.id]),
    forbidden,
  )
  await assert.rejects(
    asUser(db, users.employee, 'update public.assignments set returned_at = now() where id = $1', [assignmentId]),
    forbidden,
  )
  // Den Status ändert niemand direkt, auch Gerätemanager und Administratoren nicht.
  for (const account of [users.employee, users.manager, users.admin]) {
    await assert.rejects(
      asUser(db, account, "update public.devices set status = 'available' where id = $1", [deviceId]),
      forbidden,
      account.role,
    )
  }
  await assert.rejects(setStatus(db, freeDevice, 'defective', users.employee), forbidden)

  assert.equal(await deviceStatus(db, deviceId), 'assigned')
  assert.equal((await assignmentsOf(db, freeDevice)).length, 0)
})

test('FA-07: Gerätestatus und Statushistorie lassen nur die definierten Werte zu', async (t) => {
  const db = await createDatabase(t)
  const deviceId = await createDevice(db)

  await assert.rejects(setStatus(db, deviceId, 'lost'), { code: errorCodes.invalidParameter })
  await assert.rejects(setStatus(db, deviceId, 'assigned'), { code: errorCodes.invalidParameter }, 'assigned nur über die Zuweisung')
  await assert.rejects(setStatus(db, deviceId, 'retired', users.manager), forbidden, 'Ausmustern nur durch Administratoren')
  await assert.rejects(db.query("update public.devices set status = 'lost' where id = $1", [deviceId]), { code: errorCodes.checkViolation })
  await assert.rejects(
    db.query("insert into public.device_status_history (device_id, old_status, new_status) values ($1, 'available', 'lost')", [deviceId]),
    { code: errorCodes.checkViolation },
  )
  assert.equal(await deviceStatus(db, deviceId), 'available')
})

test('Datenintegrität: ein Rückgabezeitpunkt liegt nie vor dem Zuweisungszeitpunkt', async (t) => {
  const db = await createDatabase(t)
  const deviceId = await createDevice(db)
  const assignmentId = await assign(db, deviceId)

  await assert.rejects(
    db.query("update public.assignments set returned_at = assigned_at - interval '1 minute' where id = $1", [assignmentId]),
    { code: errorCodes.checkViolation },
  )
})
