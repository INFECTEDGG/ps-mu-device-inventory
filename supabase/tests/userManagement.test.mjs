import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { before, after, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8')
const admin = '00000000-0000-4000-8000-000000000001'
const employee = '00000000-0000-4000-8000-000000000002'
const manager = '00000000-0000-4000-8000-000000000003'
const fresh = '00000000-0000-4000-8000-000000000004'
const sid = (id) => id.replace(/^0/, '1')
let template
before(async () => {
  template = new PGlite()
  await template.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true),'')::jsonb,'{}'::jsonb) $$;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
    create table auth.users(id uuid primary key, email text unique, banned_until timestamptz, raw_user_meta_data jsonb default '{}'::jsonb);
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),created_at timestamptz default clock_timestamp(),not_after timestamptz);
    create table public.roles(id bigint primary key,name text unique);
    insert into public.roles values(1,'admin'),(2,'device_manager'),(3,'employee');
    create table public.profiles(id uuid primary key references auth.users(id),role_id bigint references public.roles(id),first_name text,last_name text,created_at timestamptz default now(),updated_at timestamptz default now());
    insert into auth.users(id,email) values('${admin}','admin@example.invalid'),('${employee}','employee@example.invalid'),('${manager}','manager@example.invalid');
    insert into public.profiles(id,role_id,first_name,last_name) values('${admin}',1,'Admin','Test'),('${employee}',3,'Employee','Test'),('${manager}',2,'Manager','Test');
    insert into auth.sessions(id,user_id) values('${sid(admin)}','${admin}'),('${sid(employee)}','${employee}'),('${sid(manager)}','${manager}');
    grant usage on schema public,auth to anon,authenticated;
  `)
  for (const table of [
    'devices',
    'assignments',
    'device_status_history',
    'audit_logs',
  ]) {
    await template.exec(
      `create table public.${table}(id integer primary key); insert into public.${table} values(1);`,
    )
  }
  for (const table of [
    'profiles',
    'roles',
    'devices',
    'assignments',
    'device_status_history',
    'audit_logs',
  ]) {
    await template.exec(
      `alter table public.${table} enable row level security; grant select,insert,update,delete on public.${table} to authenticated;`,
    )
  }
  await template.exec(
    read(
      '../migrations/20261025200000_employee_profiles_for_new_auth_users.sql',
    ),
  )
  await template.exec(
    read('../migrations/20261026080000_auth_profile_read_policies.sql'),
  )
  await template.exec(
    read('../migrations/20261026120000_server_session_inactivity.sql'),
  )
  await template.exec(read('../proposals/20261027090000_user_management.sql'))
  await template.exec(
    `create policy test_device_read on public.devices for select to authenticated using(true)`,
  )
})
after(async () => template?.close())

async function dbFor(t) {
  const db = await template.clone()
  t.after(() => db.close())
  await db.exec('update auth.sessions set created_at=clock_timestamp()')
  for (const user of [admin, employee, manager])
    await caller(db, user, (tx) =>
      tx.query('select public.inventory_session_start()'),
    )
  return db
}
async function caller(db, user, operation) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({
        sub: user,
        session_id: sid(user),
        role: 'authenticated',
      }),
    ])
    await tx.exec('set local role authenticated')
    return operation(tx)
  })
}
test('only an active admin can list email, profile, role and status', async (t) => {
  const db = await dbFor(t)
  const result = await caller(db, admin, (tx) =>
    tx.query("select public.inventory_admin_list_users(0,'') as result"),
  )
  assert.equal(result.rows[0].result.total, 3)
  assert.equal(result.rows[0].result.users[0].email, 'admin@example.invalid')
  for (const user of [employee, manager]) {
    await assert.rejects(
      caller(db, user, (tx) =>
        tx.query("select public.inventory_admin_list_users(0,'')"),
      ),
      { code: '42501' },
    )
  }
})
test('direct profile/role escalation and non-admin mutation RPCs are denied', async (t) => {
  const db = await dbFor(t)
  await assert.rejects(
    caller(db, employee, (tx) =>
      tx.query('update public.profiles set role_id=1 where id=$1', [employee]),
    ),
    { code: '42501' },
  )
  for (const user of [employee, manager]) {
    await assert.rejects(
      caller(db, user, (tx) =>
        tx.query('select public.inventory_admin_disable_user($1)', [admin]),
      ),
      { code: '42501' },
    )
    await assert.rejects(
      caller(db, user, (tx) =>
        tx.query("select public.inventory_admin_update_user($1,'New','Name')", [
          admin,
        ]),
      ),
      { code: '42501' },
    )
  }
})
test('admin editing updates only the allowed name fields', async (t) => {
  const db = await dbFor(t)
  await caller(db, admin, (tx) =>
    tx.query("select public.inventory_admin_update_user($1,' New ',' Name ')", [
      employee,
    ]),
  )
  const { rows } = await db.query(
    'select first_name,last_name,role_id from public.profiles where id=$1',
    [employee],
  )
  assert.deepEqual(rows[0], {
    first_name: 'New',
    last_name: 'Name',
    role_id: 3,
  })
})
test('deactivation retains records, revokes sessions and immediately blocks existing JWT reads', async (t) => {
  const db = await dbFor(t)
  assert.equal(
    (
      await caller(db, employee, (tx) =>
        tx.query('select * from public.devices'),
      )
    ).rows.length,
    1,
  )
  await caller(db, admin, (tx) =>
    tx.query('select public.inventory_admin_disable_user($1)', [employee]),
  )
  assert.equal(
    (
      await caller(db, employee, (tx) =>
        tx.query('select * from public.devices'),
      )
    ).rows.length,
    0,
  )
  assert.equal(
    (
      await caller(db, employee, (tx) =>
        tx.query('select public.inventory_user_is_enabled() enabled'),
      )
    ).rows[0].enabled,
    false,
  )
  assert.ok(
    (
      await db.query('select disabled_at from public.profiles where id=$1', [
        employee,
      ])
    ).rows[0].disabled_at,
  )
  assert.ok(
    (
      await db.query(
        'select revoked_at from inventory_private.sessions where user_id=$1',
        [employee],
      )
    ).rows[0].revoked_at,
  )
  assert.equal(
    (await db.query('select * from auth.users where id=$1', [employee])).rows
      .length,
    1,
  )
  // Safe retry if the separate Auth ban failed after the SQL transaction committed.
  await caller(db, admin, (tx) =>
    tx.query('select public.inventory_admin_disable_user($1)', [employee]),
  )
})
test('self-deactivation, expired sessions and disabled admins cannot perform mutations', async (t) => {
  const db = await dbFor(t)
  await assert.rejects(
    caller(db, admin, (tx) =>
      tx.query('select public.inventory_admin_disable_user($1)', [admin]),
    ),
    { code: '22023' },
  )
  await db.query(
    "update inventory_private.sessions set last_active_at=clock_timestamp()-interval '31 minutes' where user_id=$1",
    [admin],
  )
  await assert.rejects(
    caller(db, admin, (tx) =>
      tx.query('select public.inventory_admin_check()'),
    ),
    { code: '42501' },
  )
  await db.query(
    'update inventory_private.sessions set last_active_at=clock_timestamp() where user_id=$1',
    [admin],
  )
  await db.query('update public.profiles set disabled_at=now() where id=$1', [
    admin,
  ])
  await assert.rejects(
    caller(db, admin, (tx) =>
      tx.query('select public.inventory_admin_check()'),
    ),
    { code: '42501' },
  )
})
test('Auth-banned accounts are denied even without a profile deactivation timestamp', async (t) => {
  const db = await dbFor(t)
  await db.query(
    "update auth.users set banned_until=now()+interval '1 year' where id=$1",
    [admin],
  )
  await assert.rejects(
    caller(db, admin, (tx) =>
      tx.query('select public.inventory_admin_check()'),
    ),
    { code: '42501' },
  )
})
test('disabled JWTs cannot read any application table or clear their own deactivation', async (t) => {
  const db = await dbFor(t)
  await caller(db, admin, (tx) =>
    tx.query('select public.inventory_admin_disable_user($1)', [employee]),
  )
  for (const table of [
    'profiles',
    'roles',
    'devices',
    'assignments',
    'device_status_history',
    'audit_logs',
  ]) {
    assert.equal(
      (
        await caller(db, employee, (tx) =>
          tx.query(`select * from public.${table}`),
        )
      ).rows.length,
      0,
    )
  }
  await assert.rejects(
    caller(db, employee, (tx) =>
      tx.query('update public.profiles set disabled_at=null where id=$1', [
        employee,
      ]),
    ),
    { code: '42501' },
  )
})
test('anonymous RPCs, invalid names and missing targets fail without mutations', async (t) => {
  const db = await dbFor(t)
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.exec('set local role anon')
      return tx.query('select public.inventory_admin_check()')
    }),
    { code: '42501' },
  )
  await assert.rejects(
    caller(db, admin, (tx) =>
      tx.query("select public.inventory_admin_update_user($1,' ','Test')", [
        employee,
      ]),
    ),
    { code: '22023' },
  )
  await assert.rejects(
    caller(db, admin, (tx) =>
      tx.query("select public.inventory_admin_update_user($1,'New','Name')", [
        fresh,
      ]),
    ),
    { code: 'P0002' },
  )
})
test('the existing trigger atomically creates an employee profile; failure leaves no orphan Auth user', async (t) => {
  const db = await dbFor(t)
  await caller(db, admin, (tx) =>
    tx.query('select public.inventory_admin_creation_ready()'),
  )
  await db.query(
    'insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',
    [
      fresh,
      'fresh@example.invalid',
      JSON.stringify({ first_name: 'Fresh', last_name: 'User', role_id: 1 }),
    ],
  )
  assert.equal(
    (await db.query('select role_id from public.profiles where id=$1', [fresh]))
      .rows[0].role_id,
    3,
  )
  const broken = '00000000-0000-4000-8000-000000000005'
  await db.exec(
    "alter table public.profiles add constraint reject_name check(first_name <> 'FAIL')",
  )
  await assert.rejects(
    db.query(
      'insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',
      [
        broken,
        'broken@example.invalid',
        JSON.stringify({ first_name: 'FAIL' }),
      ],
    ),
  )
  assert.equal(
    (await db.query('select * from auth.users where id=$1', [broken])).rows
      .length,
    0,
  )
})
