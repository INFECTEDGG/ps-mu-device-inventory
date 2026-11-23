import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8')
const superAdmin = '00000000-0000-4000-8000-000000000001'
const employee = '00000000-0000-4000-8000-000000000002'
const manager = '00000000-0000-4000-8000-000000000003'
const admin = '00000000-0000-4000-8000-000000000005'
const sid = id => id.replace(/^0/,'1')

async function caller(db, user, fn) {
  return db.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:user,session_id:sid(user),role:'authenticated'})])
    await tx.exec('set local role authenticated')
    return fn(tx)
  })
}

async function createDB(t) {
  const db = new PGlite()
  t.after(()=>db.close())
  await db.exec(`
    create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
    create function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid$$;
    create table auth.users(id uuid primary key,email text unique,banned_until timestamptz,raw_user_meta_data jsonb default '{}'::jsonb);
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),created_at timestamptz default clock_timestamp(),not_after timestamptz);
    create table public.roles(id bigint primary key,name text unique);
    insert into public.roles values (1,'admin'),(2,'device_manager'),(3,'employee');
    create table public.profiles(id uuid primary key references auth.users(id),role_id bigint references public.roles(id),first_name text,last_name text,created_at timestamptz default now(),updated_at timestamptz default now());
    grant usage on schema public,auth to authenticated,anon;
  `)
  for(const [id,role] of [[superAdmin,1],[admin,1],[employee,3],[manager,2]]){
    await db.query('insert into auth.users(id,email) values($1,$2)',[id,`${id.slice(-4)}@example.invalid`])
    await db.query('insert into public.profiles(id,role_id,first_name,last_name) values($1,$2,$3,$4)',[id,role,'Test','User'])
    await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[sid(id),id])
  }
  for(const table of ['devices','assignments','device_status_history','audit_logs'])
    await db.exec(`create table public.${table}(id integer primary key);`)
  for(const table of ['profiles','roles','devices','assignments','device_status_history','audit_logs'])
    await db.exec(`alter table public.${table} enable row level security;grant select,insert,update,delete on public.${table} to authenticated;`)
  await db.exec(read('../migrations/20261025200000_employee_profiles_for_new_auth_users.sql'))
  await db.exec(read('../migrations/20261026080000_auth_profile_read_policies.sql'))
  await db.exec(read('../migrations/20261026120000_server_session_inactivity.sql'))
  await db.exec(read('../proposals/20261027090000_user_management.sql'))
  await db.exec(read('../proposals/20261028102000_superadmin_role_permissions.sql'))
  await db.query("update public.profiles set role_id=(select id from public.roles where name='super_admin') where id=$1",[superAdmin])
  for(const user of [superAdmin,admin,employee,manager])
    await caller(db,user,tx=>tx.query('select public.inventory_session_start()'))
  return db
}

test('ordinary admin cannot appoint or change an administrator', async t => {
  const db=await createDB(t)
  await assert.rejects(caller(db,admin,tx=>tx.query('select public.inventory_admin_assign_role($1,$2)',[employee,'admin'])),{code:'42501'})
  await assert.rejects(caller(db,admin,tx=>tx.query('select public.inventory_admin_assign_role($1,$2)',[superAdmin,'employee'])),{code:'42501'})
  await assert.rejects(caller(db,admin,tx=>tx.query('select public.inventory_admin_disable_user($1)',[superAdmin])),{code:'42501'})
  await assert.rejects(caller(db,admin,tx=>tx.query('select public.inventory_superadmin_list_permissions()')),{code:'42501'})
  await assert.rejects(caller(db,employee,tx=>tx.query('select public.inventory_admin_assign_role($1,$2)',[manager,'admin'])),{code:'42501'})
})

test('admin can assign employee/manager and target session is revoked', async t => {
  const db=await createDB(t)
  await caller(db,admin,tx=>tx.query('select public.inventory_admin_assign_role($1,$2)',[employee,'device_manager']))
  const {rows}=await db.query('select r.name as role from public.profiles p join public.roles r on r.id=p.role_id where p.id=$1',[employee])
  assert.equal(rows[0].role,'device_manager')
  const sessions=await db.query('select revoked_at from inventory_private.sessions where user_id=$1',[employee])
  assert.ok(sessions.rows[0].revoked_at)
  await assert.rejects(caller(db,admin,tx=>tx.query('select public.inventory_admin_assign_role($1,$2)',[admin,'device_manager'])),{code:'22023'})
})

test('superadmin can appoint an admin but never app-appoint a superadmin', async t => {
  const db=await createDB(t)
  await caller(db,superAdmin,tx=>tx.query('select public.inventory_admin_assign_role($1,$2)',[manager,'admin']))
  const {rows}=await db.query('select r.name from public.profiles p join public.roles r on r.id=p.role_id where p.id=$1',[manager])
  assert.equal(rows[0].name,'admin')
  await assert.rejects(caller(db,superAdmin,tx=>tx.query('select public.inventory_admin_assign_role($1,$2)',[employee,'super_admin'])),{code:'22023'})
})

test('superadmin can edit operational rights but not sensitive rights', async t => {
  const db=await createDB(t)
  await assert.rejects(caller(db,admin,tx=>tx.query('select public.inventory_superadmin_update_permissions($1,$2)', ['employee',['devices:manage']])),{code:'42501'})
  await assert.rejects(caller(db,superAdmin,tx=>tx.query('select public.inventory_superadmin_update_permissions($1,$2)', ['employee',['users:manage']])),{code:'22023'})
  await caller(db,superAdmin,tx=>tx.query('select public.inventory_superadmin_update_permissions($1,$2)', ['employee',['dashboard:view','devices:manage']]))
  const result = await caller(db,superAdmin,tx=>tx.query('select public.inventory_superadmin_list_permissions() as matrix'))
  assert.deepEqual(result.rows[0].matrix.employee,['dashboard:view','devices:manage'])
  assert.ok(result.rows[0].matrix.admin.includes('users:manage'))
})
