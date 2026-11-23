// PBI-12: Geräte- und Zuweisungshistorie anzeigen (FA-14)
// Prüft supabase/proposals/20261123_pbi_12_device_history.sql auf der Nachbildung
// des Produktionsschemas über die echten RPCs.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import {
  HISTORY_CHECK,
  HISTORY_PROPOSAL,
  asAnon,
  asService,
  asUser,
  assign,
  createAccount,
  createDevice,
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

const forbidden = { code: errorCodes.insufficientPrivilege }
const closedImmutable = { code: errorCodes.insufficientPrivilege, message: 'Abgeschlossene Zuweisungen sind unveränderlich.' }
const assignmentsKept = { code: errorCodes.insufficientPrivilege, message: 'Zuweisungen bleiben für die Gerätehistorie erhalten.' }
const historyImmutable = { code: errorCodes.insufficientPrivilege, message: 'Die Statushistorie ist unveränderlich.' }

const MANAGER_PERMISSIONS = [
  'dashboard:view', 'devices:view_own', 'devices:view_all', 'devices:manage',
  'assignments:view_own', 'assignments:view_all', 'assignments:manage', 'settings:view',
]

async function history(db, account, deviceId) {
  const { rows } = await asUser(db, account, 'select public.inventory_device_history($1) as result', [deviceId])
  return rows[0].result
}

const time = (value) => (value === null ? null : new Date(value).getTime())

test('zeigt den vollständigen Lebenszyklus mit Namen, Zeitpunkten und Reihenfolge (FA-14)', async (t) => {
  const db = await createDatabase(t)
  const deviceId = await createDevice(db, { asset_tag: 'IT-0500', name: 'Notebook Vertrieb' }, users.admin)
  await pause()
  await setStatus(db, deviceId, 'defective', users.manager)
  await pause()
  await setStatus(db, deviceId, 'available', users.admin)
  await pause()
  const first = await assign(db, deviceId, users.employee, users.manager)
  await pause()
  await returnAssignment(db, first, users.admin)
  await pause()
  await setStatus(db, deviceId, 'maintenance', users.manager)
  await pause()
  await setStatus(db, deviceId, 'available', users.manager)
  await pause()
  const second = await assign(db, deviceId, users.employee2, users.admin)

  const result = await history(db, users.manager, deviceId)
  assert.deepEqual(Object.keys(result).sort(), [
    'assignments', 'assignments_total', 'device', 'status_changes', 'status_changes_total',
  ])
  assert.deepEqual(result.device, {
    id: deviceId,
    asset_tag: 'IT-0500',
    name: 'Notebook Vertrieb',
    device_type: 'Laptop',
    manufacture: 'Lenovo',
    model: 'ThinkPad T14',
    status: 'assigned',
  })

  const { rows: stored } = await db.query(
    'select id, assigned_at, returned_at from public.assignments where device_id = $1',
    [deviceId],
  )
  const storedById = new Map(stored.map((row) => [row.id, row]))

  assert.equal(result.assignments_total, 2)
  const [current, past] = result.assignments
  assert.deepEqual(Object.keys(current).sort(), [
    'active', 'assigned_at', 'assigned_by_name', 'assignment_id', 'employee_email', 'employee_id',
    'employee_name', 'returned_at', 'returned_by_name',
  ])
  assert.equal(current.assignment_id, second)
  assert.equal(current.employee_id, users.employee2.id)
  assert.equal(current.employee_name, 'Emil Beispiel')
  assert.equal(current.employee_email, 'emil@example.invalid')
  assert.equal(current.assigned_by_name, 'Ada Admin')
  assert.equal(current.returned_at, null)
  assert.equal(current.returned_by_name, null)
  assert.equal(current.active, true)
  assert.equal(time(current.assigned_at), storedById.get(second).assigned_at.getTime())

  assert.equal(past.assignment_id, first)
  assert.equal(past.employee_name, 'Erika Muster')
  assert.equal(past.employee_email, 'erika@example.invalid')
  assert.equal(past.assigned_by_name, 'Max Manager')
  assert.equal(past.returned_by_name, 'Ada Admin')
  assert.equal(past.active, false)
  assert.equal(time(past.assigned_at), storedById.get(first).assigned_at.getTime())
  assert.equal(time(past.returned_at), storedById.get(first).returned_at.getTime())
  assert.ok(time(past.returned_at) > time(past.assigned_at), 'Beginn liegt vor dem Ende')

  assert.equal(result.status_changes_total, 7)
  assert.deepEqual(
    result.status_changes.map((change) => [change.old_status, change.new_status, change.changed_by_name]),
    [
      ['available', 'assigned', 'Ada Admin'],
      ['maintenance', 'available', 'Max Manager'],
      ['available', 'maintenance', 'Max Manager'],
      ['assigned', 'available', 'Ada Admin'],
      ['available', 'assigned', 'Max Manager'],
      ['defective', 'available', 'Ada Admin'],
      ['available', 'defective', 'Max Manager'],
    ],
  )
  const times = result.status_changes.map((change) => time(change.changed_at))
  assert.deepEqual(times, [...times].sort((a, b) => b - a), 'neueste Änderung zuerst')
  for (const change of result.status_changes) {
    assert.deepEqual(Object.keys(change).sort(), ['changed_at', 'changed_by_name', 'id', 'new_status', 'old_status'])
    assert.equal(typeof change.id, 'string')
  }

  // Administratoren und SuperAdmins sehen dieselbe Historie.
  assert.deepEqual(await history(db, users.admin, deviceId), result)
  assert.deepEqual(await history(db, users.superAdmin, deviceId), result)
})

test('historische Daten bleiben nach der Rückgabe erhalten', async (t) => {
  const db = await createDatabase(t)
  const deviceId = await createDevice(db)
  const assignmentId = await assign(db, deviceId)
  await pause()
  await returnAssignment(db, assignmentId)

  const { rows: [row] } = await db.query('select * from public.assignments where id = $1', [assignmentId])
  assert.equal(row.employee_id, users.employee.id)
  assert.equal(row.assigned_by, users.manager.id)
  assert.equal(row.returned_by, users.manager.id)
  assert.ok(row.returned_at >= row.assigned_at)

  const result = await history(db, users.manager, deviceId)
  assert.equal(result.device.status, 'available')
  assert.equal(result.assignments.length, 1)
  assert.equal(result.assignments[0].active, false)
  assert.equal(result.assignments[0].employee_name, 'Erika Muster')
  assert.equal(result.status_changes_total, 2)
})

test('abgeschlossene Zuweisungen sind auch für Superuser und Service-Key unveränderlich', async (t) => {
  const db = await createDatabase(t)
  const deviceId = await createDevice(db)
  const closedId = await assign(db, deviceId)
  await returnAssignment(db, closedId)
  const activeId = await assign(db, deviceId, users.employee2)
  const { rows: before } = await db.query('select * from public.assignments order by assigned_at')
  const auditBefore = await readAudit(db)

  const attempts = [
    ["update public.assignments set returned_at = returned_at + interval '1 hour' where id = $1", [closedId], closedImmutable],
    ['update public.assignments set returned_at = null where id = $1', [closedId], closedImmutable],
    ['update public.assignments set employee_id = $2 where id = $1', [closedId, users.employee2.id], closedImmutable],
    ['update public.assignments set assigned_by = null where id = $1', [closedId], closedImmutable],
    ['delete from public.assignments where id = $1', [closedId], assignmentsKept],
    ['delete from public.assignments where id = $1', [activeId], assignmentsKept],
  ]
  for (const [sql, params, expected] of attempts) {
    await assert.rejects(db.query(sql, params), expected, `Superuser: ${sql}`)
    await assert.rejects(asService(db, sql, params), expected, `Service-Key: ${sql}`)
  }
  await assert.rejects(db.query('truncate public.assignments'), assignmentsKept)

  // Browser-Rollen haben ohnehin keine Schreibrechte.
  await assert.rejects(
    asUser(db, users.admin, 'update public.assignments set returned_at = null where id = $1', [closedId]),
    forbidden,
  )
  await assert.rejects(asUser(db, users.manager, 'delete from public.assignments where id = $1', [closedId]), forbidden)

  assert.deepEqual((await db.query('select * from public.assignments order by assigned_at')).rows, before)
  assert.deepEqual(await readAudit(db), auditBefore, 'abgelehnte Änderungen hinterlassen keine Audit-Einträge')
})

test('Einträge der Statushistorie sind unveränderlich', async (t) => {
  const db = await createDatabase(t)
  const deviceId = await createDevice(db)
  await setStatus(db, deviceId, 'defective')
  const { rows: before } = await db.query('select * from public.device_status_history')
  assert.equal(before.length, 1)

  const attempts = [
    ["update public.device_status_history set new_status = 'retired'"],
    ["update public.device_status_history set changed_at = changed_at - interval '1 day'"],
    ['update public.device_status_history set changed_by = null'],
    ['delete from public.device_status_history'],
    ['truncate public.device_status_history'],
  ]
  for (const [sql] of attempts) {
    await assert.rejects(db.query(sql), historyImmutable, `Superuser: ${sql}`)
  }
  for (const [sql] of attempts.slice(0, 4)) {
    await assert.rejects(asService(db, sql), historyImmutable, `Service-Key: ${sql}`)
    await assert.rejects(asUser(db, users.admin, sql), forbidden, `authenticated: ${sql}`)
  }
  assert.deepEqual((await db.query('select * from public.device_status_history')).rows, before)
})

test('beim Löschen eines Profils dürfen Benutzerbezüge weiterhin auf NULL gesetzt werden', async (t) => {
  const db = await createDatabase(t)
  const temp = await createAccount(db, {
    email: 'tina.temp@example.invalid', firstName: 'Tina', lastName: 'Temp', role: 'device_manager',
  })
  const deviceId = await createDevice(db)
  await setStatus(db, deviceId, 'maintenance', temp)
  await setStatus(db, deviceId, 'available', temp)
  const closedId = await assign(db, deviceId, users.employee, temp)
  await returnAssignment(db, closedId, temp)
  const activeId = await assign(db, deviceId, users.employee2, temp)

  // Solange das Profil existiert, ist auch das Nullsetzen eine unzulässige Änderung.
  await assert.rejects(db.query('update public.assignments set assigned_by = null where id = $1', [closedId]), closedImmutable)
  await assert.rejects(db.query('update public.device_status_history set changed_by = null where device_id = $1', [deviceId]), historyImmutable)

  await db.query('delete from public.profiles where id = $1', [temp.id])

  const { rows: assignmentRows } = await db.query(
    'select id, assigned_by, returned_by, returned_at from public.assignments where device_id = $1',
    [deviceId],
  )
  assert.equal(assignmentRows.length, 2)
  assert.ok(assignmentRows.every((row) => row.assigned_by === null && row.returned_by === null))
  assert.ok(assignmentRows.find((row) => row.id === closedId).returned_at, 'Rückgabezeitpunkt bleibt erhalten')
  const { rows: historyRows } = await db.query(
    'select changed_by from public.device_status_history where device_id = $1',
    [deviceId],
  )
  assert.equal(historyRows.length, 5)
  assert.ok(historyRows.every((row) => row.changed_by === null))

  const result = await history(db, users.manager, deviceId)
  assert.equal(result.assignments_total, 2)
  for (const entry of result.assignments) {
    assert.equal(entry.assigned_by_name, null, 'Anzeige als System')
    assert.equal(entry.returned_by_name, null)
  }
  assert.equal(result.assignments.find((entry) => entry.assignment_id === activeId).active, true)
  assert.ok(result.status_changes.every((change) => change.changed_by_name === null))
})

test('Rücknahme einer aktiven Zuweisung bleibt möglich, eine zweite Rücknahme nicht', async (t) => {
  const db = await createDatabase(t)
  const deviceId = await createDevice(db)
  const assignmentId = await assign(db, deviceId)

  await returnAssignment(db, assignmentId, users.manager)
  await assert.rejects(returnAssignment(db, assignmentId, users.manager), { code: errorCodes.checkViolation })

  const result = await history(db, users.manager, deviceId)
  assert.equal(result.assignments[0].active, false)
  assert.equal(result.assignments[0].returned_by_name, 'Max Manager')
})

test('zeigt Ersatzwerte für fehlende Namen und Gerätedaten', async (t) => {
  const db = await createDatabase(t)
  const { rows: [{ id: deviceId }] } = await db.query(
    "insert into public.devices (asset_tag, status, device_type, manufacture, model) values ('IT-0900', 'available', null, null, null) returning id",
  )
  const emailOnly = await createAccount(db, { email: 'nur.mail@example.invalid', session: false })
  const anonymous = await createAccount(db, { email: null, session: false })

  const first = await assign(db, deviceId, emailOnly)
  await pause()
  await returnAssignment(db, first)
  await pause()
  await assign(db, deviceId, anonymous)
  await db.query(
    "insert into public.device_status_history (device_id, old_status, new_status, changed_by, changed_at) values ($1, null, 'available', null, '2020-01-01T00:00:00Z')",
    [deviceId],
  )

  const result = await history(db, users.manager, deviceId)
  assert.deepEqual(result.device, {
    id: deviceId, asset_tag: 'IT-0900', name: null, device_type: null, manufacture: null, model: null, status: 'assigned',
  })
  const [current, past] = result.assignments
  assert.equal(current.employee_name, 'Unbekannt')
  assert.equal(current.employee_email, '')
  assert.equal(past.employee_name, 'nur.mail@example.invalid')
  assert.equal(past.employee_email, 'nur.mail@example.invalid')

  const oldest = result.status_changes.at(-1)
  assert.deepEqual(
    { old_status: oldest.old_status, new_status: oldest.new_status, changed_by_name: oldest.changed_by_name },
    { old_status: null, new_status: 'available', changed_by_name: null },
  )
})

test('liefert ein Gerät ohne Historie mit leeren Listen', async (t) => {
  const db = await createDatabase(t)
  const deviceId = await createDevice(db)

  const result = await history(db, users.admin, deviceId)
  assert.deepEqual(result.assignments, [])
  assert.deepEqual(result.status_changes, [])
  assert.equal(result.assignments_total, 0)
  assert.equal(result.status_changes_total, 0)
})

test('Zugriffsmatrix: nur Gerätemanager, Administratoren und SuperAdmins mit beiden Leserechten', async (t) => {
  const db = await createDatabase(t)
  const deviceId = await createDevice(db)

  for (const account of [users.manager, users.admin, users.superAdmin]) {
    assert.equal((await history(db, account, deviceId)).device.id, deviceId, account.role)
  }
  for (const account of [users.employee, users.employee2]) {
    await assert.rejects(history(db, account, deviceId), forbidden, account.role)
  }
  await assert.rejects(asAnon(db, 'select public.inventory_device_history($1)', [deviceId]), forbidden)
  await assert.rejects(asService(db, 'select public.inventory_device_history($1)', [deviceId]), forbidden)

  const { rows: [grants] } = await db.query(`
    select
      has_function_privilege('anon', 'public.inventory_device_history(uuid)', 'execute') as anon,
      has_function_privilege('authenticated', 'public.inventory_device_history(uuid)', 'execute') as authenticated,
      has_function_privilege('service_role', 'public.inventory_device_history(uuid)', 'execute') as service_role
  `)
  assert.deepEqual(grants, { anon: false, authenticated: true, service_role: false })

  // Ohne assignments:view_all bzw. devices:view_all kein Zugriff (auch nach erneuter Anmeldung).
  for (const missing of ['assignments:view_all', 'devices:view_all']) {
    const restricted = await createDatabase(t)
    const restrictedDevice = await createDevice(restricted)
    await asUser(
      restricted,
      users.superAdmin,
      'select public.inventory_superadmin_update_permissions($1, $2)',
      ['device_manager', MANAGER_PERMISSIONS.filter((permission) => permission !== missing)],
    )
    const manager = await signInAgain(restricted, users.manager)
    await assert.rejects(history(restricted, manager, restrictedDevice), forbidden, `ohne ${missing}`)
    assert.ok(await history(restricted, users.admin, restrictedDevice), 'andere Rollen sind nicht betroffen')
  }

  // Deaktiviertes Konto
  const disabledDb = await createDatabase(t)
  await asUser(disabledDb, users.admin, 'select public.inventory_admin_disable_user($1)', [users.manager.id])
  await assert.rejects(history(disabledDb, users.manager, deviceId), forbidden)

  // Beendete Sitzung
  const endedDb = await createDatabase(t)
  await asUser(endedDb, users.manager, 'select public.inventory_session_end()')
  await assert.rejects(history(endedDb, users.manager, deviceId), forbidden)
})

test('meldet 22023 ohne Geräte-ID und P0002 für unbekannte Geräte', async (t) => {
  const db = await createDatabase(t)
  await assert.rejects(history(db, users.manager, null), { code: errorCodes.invalidParameter })
  await assert.rejects(history(db, users.manager, randomUUID()), { code: errorCodes.notFound })
  // Unberechtigte erhalten immer 42501, unabhängig von den Parametern.
  await assert.rejects(history(db, users.employee, null), forbidden)
})

test('begrenzt beide Listen auf 200 Einträge und liefert vollständige Gesamtzahlen', async (t) => {
  const db = await createDatabase(t)
  const deviceId = await createDevice(db)
  await db.query(
    `insert into public.assignments (device_id, employee_id, assigned_by, assigned_at, returned_at, returned_by)
     select $1, $2, $3,
       timestamptz '2025-01-01 08:00+00' + g * interval '1 day',
       timestamptz '2025-01-01 16:00+00' + g * interval '1 day',
       $3
     from generate_series(1, 205) g`,
    [deviceId, users.employee.id, users.manager.id],
  )
  await db.query(
    `insert into public.device_status_history (device_id, old_status, new_status, changed_by, changed_at)
     select $1,
       case when g % 2 = 1 then 'available' else 'maintenance' end,
       case when g % 2 = 1 then 'maintenance' else 'available' end,
       $2,
       timestamptz '2025-01-01 00:00+00' + g * interval '1 hour'
     from generate_series(1, 210) g`,
    [deviceId, users.manager.id],
  )

  const result = await history(db, users.manager, deviceId)
  assert.equal(result.assignments.length, 200)
  assert.equal(result.assignments_total, 205)
  assert.equal(result.status_changes.length, 200)
  assert.equal(result.status_changes_total, 210)
  assert.equal(time(result.assignments[0].assigned_at), Date.parse('2025-07-25T08:00:00Z'), 'neueste Zuweisung zuerst (Tag 205)')
  assert.equal(time(result.assignments.at(-1).assigned_at), Date.parse('2025-01-07T08:00:00Z'), 'älteste angezeigte Zuweisung (Tag 6)')
  assert.equal(time(result.status_changes[0].changed_at), Date.parse('2025-01-09T18:00:00Z'), 'neueste Statusänderung zuerst (Stunde 210)')
})

test('Preflight verweigert eine zweite Ausführung; Installation ist unabhängig vom Audit-Log', async (t) => {
  const db = await createDatabase(t)
  const proposal = await readSql(HISTORY_PROPOSAL)
  await assert.rejects(db.exec(proposal), (error) => {
    assert.equal(error.code, '55000')
    assert.match(error.message, /inventory_device_history existiert bereits/)
    return true
  })
  await db.exec('rollback')
  const { rows } = await db.query(
    "select count(*)::int as n from pg_trigger where tgname in ('inventory_assignments_preserve_history', 'inventory_status_history_preserve')",
  )
  assert.equal(rows[0].n, 2)

  // Ohne PBI-15: lesende Prüfung, Installation, erneute Prüfung.
  const bare = await freshDatabase(t, { auditLog: false, deviceHistory: false })
  const check = await readSql(HISTORY_CHECK)
  const readOnly = (sql) => bare.exec(`begin transaction read only;\n${sql}\nrollback;`)
  await readOnly(check)
  await bare.exec(proposal)
  await readOnly(check)
  const deviceId = await createDevice(bare)
  const assignmentId = await assign(bare, deviceId)
  await returnAssignment(bare, assignmentId)
  assert.equal((await history(bare, users.manager, deviceId)).assignments_total, 1)
  await assert.rejects(bare.query('delete from public.assignments'), assignmentsKept)
})
