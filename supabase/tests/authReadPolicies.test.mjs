import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(new URL('../migrations/20261026080000_auth_profile_read_policies.sql', import.meta.url), 'utf8')
const employeeProfileMigration = readFileSync(new URL('../migrations/20261025200000_employee_profiles_for_new_auth_users.sql', import.meta.url), 'utf8')
const employee = '00000000-0000-4000-8000-000000000011'
const admin = '00000000-0000-4000-8000-000000000012'
const profileless = '00000000-0000-4000-8000-000000000013'
let template

before(async () => {
  template = new PGlite()
  await template.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth, public to anon, authenticated;
    create table auth.users(id uuid primary key);
    create table public.roles(id bigint primary key, name text not null unique);
    create table public.profiles(
      id uuid primary key references auth.users(id) on delete cascade,
      role_id bigint references public.roles(id),
      first_name text
    );
    alter table public.profiles enable row level security;
    alter table public.roles enable row level security;
    -- Breite Tabellengrants wie im Projekt; RLS muss den Zugriff trotzdem begrenzen.
    grant select, insert, update, delete on public.profiles, public.roles to anon, authenticated;
    insert into public.roles values(1,'admin'),(2,'device_manager'),(3,'employee');
    insert into auth.users values('${employee}'),('${admin}'),('${profileless}');
    insert into public.profiles values('${employee}',3,'Employee'),('${admin}',1,'Admin');
  `)
})
after(async () => template?.close())

async function dbFor(t, install = true) {
  const db = await template.clone()
  t.after(() => db.close())
  if (install) await db.exec(migration)
  return db
}

async function asUser(db, role, userId, operation) {
  return db.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ''])
    await tx.exec(`set local role ${role}`)
    return operation(tx)
  })
}

async function rejectInstallation(db) {
  await assert.rejects(db.exec(migration), { code: '55000' })
  await db.exec('rollback')
  assert.equal((await db.query("select count(*)::integer n from pg_policy where polname in ('inventory_profile_read_self','inventory_role_read_self')")).rows[0].n, 0)
}

test('authenticated employee sees only own profile and linked role through real RLS', async t => {
  const db = await dbFor(t)
  const result = await asUser(db, 'authenticated', employee, async tx => ({
    profiles: (await tx.query('select id,role_id from public.profiles order by id')).rows,
    roles: (await tx.query('select id,name from public.roles order by id')).rows,
    foreignProfile: (await tx.query('select id from public.profiles where id=$1', [admin])).rows,
  }))
  assert.deepEqual(result.profiles, [{id: employee, role_id: 3}])
  assert.deepEqual(result.roles, [{id: 3, name: 'employee'}])
  assert.deepEqual(result.foreignProfile, [])
})

test('two-step role lookup succeeds without access to other profiles or role names', async t => {
  const db = await dbFor(t)
  const result = await asUser(db, 'authenticated', employee, async tx => {
    const profile = (await tx.query('select role_id from public.profiles where id=$1', [employee])).rows[0]
    return (await tx.query('select name from public.roles where id=$1', [profile.role_id])).rows
  })
  assert.deepEqual(result, [{name: 'employee'}])
})

test('admin-service account creation and read policies work together from auth insert to employee role lookup', async t => {
  const db = await dbFor(t, false)
  const freshUser = '00000000-0000-4000-8000-000000000014'
  await db.exec(`
    create role service_role nologin;
    create role supabase_auth_admin nologin;
    alter table auth.users add column raw_user_meta_data jsonb not null default '{}'::jsonb;
    alter table public.profiles add column last_name text;
    alter table public.profiles add column created_at timestamptz not null default now();
    alter table public.profiles add column updated_at timestamptz default now();
    grant usage on schema auth to supabase_auth_admin;
    grant insert, select on auth.users to supabase_auth_admin;
  `)
  await db.exec(employeeProfileMigration)
  await db.exec(migration)

  assert.equal((await db.query("select has_table_privilege('supabase_auth_admin','public.profiles','INSERT') allowed")).rows[0].allowed, false)
  await asUser(db, 'supabase_auth_admin', null, tx => tx.query(
    'insert into auth.users(id,raw_user_meta_data) values($1,$2)',
    [freshUser, {first_name:'New',last_name:'Employee',role:'admin',role_id:1}],
  ))

  const result = await asUser(db, 'authenticated', freshUser, async tx => {
    const profiles = (await tx.query('select id,role_id,first_name,last_name from public.profiles where id=$1', [freshUser])).rows
    const roles = (await tx.query('select name from public.roles where id=$1', [profiles[0].role_id])).rows
    const foreignProfiles = (await tx.query('select id from public.profiles where id <> $1', [freshUser])).rows
    return {profiles, roles, foreignProfiles}
  })
  assert.deepEqual(result, {
    profiles: [{id:freshUser,role_id:3,first_name:'New',last_name:'Employee'}],
    roles: [{name:'employee'}],
    foreignProfiles: [],
  })
})

test('admin receives only its own bootstrap reads; no general administration policy is invented', async t => {
  const db = await dbFor(t)
  const result = await asUser(db, 'authenticated', admin, async tx => ({
    profiles: (await tx.query('select id from public.profiles')).rows,
    roles: (await tx.query('select name from public.roles')).rows,
  }))
  assert.deepEqual(result, {profiles: [{id: admin}], roles: [{name: 'admin'}]})
})

test('anonymous, profile-less and claim-less requests cannot read profiles or roles', async t => {
  const db = await dbFor(t)
  for (const [role, userId] of [['anon', employee], ['authenticated', profileless], ['authenticated', null]]) {
    const result = await asUser(db, role, userId, async tx => ({
      profiles: (await tx.query('select id from public.profiles')).rows,
      roles: (await tx.query('select name from public.roles')).rows,
    }))
    assert.deepEqual(result, {profiles: [], roles: []})
  }
})

test('own and foreign profile role updates and deletes remain blocked despite table grants', async t => {
  const db = await dbFor(t)
  await asUser(db, 'authenticated', employee, async tx => {
    assert.deepEqual((await tx.query('update public.profiles set role_id=1 where id=$1 returning id', [employee])).rows, [])
    assert.deepEqual((await tx.query('update public.profiles set role_id=3 where id=$1 returning id', [admin])).rows, [])
    assert.deepEqual((await tx.query('delete from public.profiles where id=$1 returning id', [employee])).rows, [])
  })
  assert.deepEqual((await db.query('select id,role_id from public.profiles order by id')).rows, [{id: employee, role_id: 3}, {id: admin, role_id: 1}])
})

test('profile-less users cannot create their own privileged profile', async t => {
  const db = await dbFor(t)
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(asUser(db, role, profileless, tx => tx.query('insert into public.profiles(id,role_id) values($1,1)', [profileless])), {code: '42501'})
  }
  assert.deepEqual((await db.query('select id from public.profiles where id=$1', [profileless])).rows, [])
})

test('role inserts, updates and deletes remain blocked for authenticated and anonymous callers', async t => {
  const db = await dbFor(t)
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(asUser(db, role, employee, tx => tx.query("insert into public.roles values(4,'self_admin')")), {code: '42501'})
    await asUser(db, role, employee, async tx => {
      assert.deepEqual((await tx.query("update public.roles set name='self_admin' where id=3 returning id")).rows, [])
      assert.deepEqual((await tx.query('delete from public.roles where id=3 returning id')).rows, [])
    })
  }
  assert.deepEqual((await db.query('select name from public.roles order by id')).rows, [{name:'admin'},{name:'device_manager'},{name:'employee'}])
})

test('migration adds SELECT policies only and preserves grants and RLS flags', async t => {
  const db = await dbFor(t, false)
  const grantsSql = "select grantee,table_name,privilege_type from information_schema.role_table_grants where table_schema='public' order by grantee,table_name,privilege_type"
  const beforeGrants = (await db.query(grantsSql)).rows
  await db.exec(migration)
  assert.deepEqual((await db.query(grantsSql)).rows, beforeGrants)
  assert.deepEqual((await db.query("select cmd,roles from pg_policies where schemaname='public' order by policyname")).rows, [{cmd:'SELECT',roles:['authenticated']},{cmd:'SELECT',roles:['authenticated']}])
  assert.deepEqual((await db.query("select relrowsecurity,relforcerowsecurity from pg_class where oid in ('public.profiles'::regclass,'public.roles'::regclass)")).rows, [{relrowsecurity:true,relforcerowsecurity:false},{relrowsecurity:true,relforcerowsecurity:false}])
})

test('existing team policies stop installation without replacing or adding access', async t => {
  for (const table of ['profiles','roles']) {
    const db = await dbFor(t, false)
    await db.exec(`create policy team_read on public.${table} for select to authenticated using(false)`)
    await rejectInstallation(db)
    assert.deepEqual((await db.query("select policyname from pg_policies where schemaname='public'")).rows, [{policyname:'team_read'}])
  }
})

test('disabled RLS stops installation without enabling it or installing policies', async t => {
  for (const table of ['profiles','roles']) {
    const db = await dbFor(t, false)
    await db.exec(`alter table public.${table} disable row level security`)
    await rejectInstallation(db)
    assert.equal((await db.query('select relrowsecurity from pg_class where oid=$1::regclass', [`public.${table}`])).rows[0].relrowsecurity, false)
  }
})

test('missing SELECT grants fail atomically instead of broadening table privileges', async t => {
  const db = await dbFor(t, false)
  await db.exec('revoke select on public.roles from authenticated')
  await rejectInstallation(db)
  assert.equal((await db.query("select has_table_privilege('authenticated','public.roles','SELECT') allowed")).rows[0].allowed, false)
})

test('client table ownership or BYPASSRLS cannot silently bypass the read restrictions', async t => {
  for (const owner of [false, true]) {
    const db = await dbFor(t, false)
    if (owner) await db.exec('alter table public.profiles owner to authenticated')
    else await db.exec('alter role authenticated bypassrls')
    await rejectInstallation(db)
  }
})

test('reapplying the policy migration does not replace the existing definitions', async t => {
  const db = await dbFor(t)
  const policySql = "select policyname,qual from pg_policies where schemaname='public' order by policyname"
  const beforePolicies = (await db.query(policySql)).rows
  await assert.rejects(db.exec(migration), {code:'55000'})
  await db.exec('rollback')
  assert.deepEqual((await db.query(policySql)).rows, beforePolicies)
})
