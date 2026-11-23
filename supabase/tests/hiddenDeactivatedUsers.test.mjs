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
  await db.exec(read('../proposals/20261028114500_hide_deactivated_users_from_list.sql'))
  await db.query("update public.profiles set role_id=(select id from public.roles where name='super_admin') where id=$1",[superAdmin])
  for(const user of [superAdmin,admin,employee,manager])
    await caller(db,user,tx=>tx.query('select public.inventory_session_start()'))
  return db
}


test('Benutzerliste versteckt vollstaendig deaktivierte Konten und korrigiert Anzahl/Suche', async t => {
  const db = await createDB(t)
  const list = (search = '', page = 0) => caller(db, admin, tx =>
    tx.query('select public.inventory_admin_list_users($1,$2) as result', [page,search])
  ).then(res => res.rows[0].result)
  assert.equal((await list()).total, 4)

  // Die Datenbanksperre wird zuerst gesetzt; solange der Auth-Ban noch aussteht,
  // bleibt das Konto zur Nachbearbeitung sichtbar.
  await caller(db, admin, tx =>
    tx.query('select public.inventory_admin_disable_user($1)', [employee]))
  let result = await list()
  assert.equal(result.total, 4)
  assert.ok(result.users.some(u => u.id === employee && u.disabled_at && !u.login_blocked))

  // Nach erfolgreicher Auth-Sperre darf das Konto in der Liste, Suche und Seitenzahl
  // nicht mehr auftauchen; im Datenbestand bleibt es erhalten.
  await db.query("update auth.users set banned_until=now()+interval '1 year' where id=$1", [employee])
  result = await list()
  assert.equal(result.total, 3)
  assert.ok(result.users.every(u => u.id !== employee))
  assert.equal((await list('0002')).total, 0)
  assert.equal((await list('Employee')).total, 0)
  assert.equal((await list('',1)).users.length, 0)
  const stored = await db.query('select id from public.profiles where id=$1',[employee])
  assert.equal(stored.rows.length, 1)
  await assert.rejects(caller(db, employee, tx =>
    tx.query("select public.inventory_admin_list_users(0,'')")),{code:'42501'})
})
