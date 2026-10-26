import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { before, after, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

// Lokales Testschema mit den geprüften Spalten, ohne Verbindung zu Supabase.
const migration = readFileSync(new URL('../migrations/20261025200000_employee_profiles_for_new_auth_users.sql', import.meta.url), 'utf8')
const uniqueRolesMigration = readFileSync(new URL('../migrations/20261025193000_roles_name_unique.sql', import.meta.url), 'utf8')
const missingProfileUser = '00000000-0000-4000-8000-000000000099'
const oldAdmin = '00000000-0000-4000-8000-000000000001'
const freshUser = '00000000-0000-4000-8000-000000000002'
let template

before(async () => {
  template = new PGlite()
  await template.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create role supabase_auth_admin nologin;
    create schema auth;
    create table auth.users (
      id uuid primary key,
      email text unique,
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
    create table public.roles (id bigint primary key, name text not null);
    create table public.profiles (
      id uuid primary key references auth.users(id),
      role_id bigint references public.roles(id),
      first_name text, last_name text,
      created_at timestamptz not null default now(), updated_at timestamptz default now()
    );
    alter table public.profiles enable row level security;
    create policy team_profile_read_scope on public.profiles for select to authenticated using (false);
    grant usage on schema public to anon, authenticated, service_role;
    grant select on public.profiles, public.roles to authenticated;
    grant usage on schema auth to supabase_auth_admin;
    grant insert, select on auth.users to supabase_auth_admin;
    insert into public.roles values (1,'admin'),(2,'device_manager'),(3,'employee');
    insert into auth.users(id,email) values
      ('${missingProfileUser}','profileless@example.invalid'), ('${oldAdmin}','admin@example.invalid');
    insert into public.profiles(id,role_id,first_name,last_name)
      values ('${oldAdmin}',1,'Existing','Admin');
  `)
  await template.exec(uniqueRolesMigration)
})
after(async () => template?.close())

async function dbFor(t, install = true) {
  const db = await template.clone()
  t.after(() => db.close())
  if (install) await db.exec(migration)
  return db
}
async function addAuth(db, metadata = {}, id = freshUser) {
  return db.transaction(async tx => {
    await tx.exec('set local role supabase_auth_admin')
    return tx.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)', [id,`${id}@example.invalid`,metadata])
  })
}
async function profile(db, id = freshUser) {
  return (await db.query('select p.id,p.role_id,p.first_name,p.last_name,r.name from public.profiles p join public.roles r on r.id=p.role_id where p.id=$1',[id])).rows
}
async function rejectedInstall(db, pattern) {
  await assert.rejects(db.exec(migration), pattern)
  await db.exec('rollback')
  assert.equal((await db.query("select to_regprocedure('public.inventory_create_employee_profile()') as f")).rows[0].f, null)
}

test('admin-service insert creates one employee despite hostile metadata; no auth-service profile grants needed', async t => {
  const db = await dbFor(t)
  await addAuth(db, {first_name:'  Ada  ',last_name:'Lovelace',role:'admin',role_id:1,is_admin:true})
  assert.deepEqual(await profile(db), [{id:freshUser,role_id:3,first_name:'Ada',last_name:'Lovelace',name:'employee'}])
})

test('existing accounts and profiles remain untouched, including the known profile-less account', async t => {
  const db = await dbFor(t)
  assert.deepEqual(await profile(db, missingProfileUser), [])
  assert.deepEqual(await profile(db, oldAdmin), [{id:oldAdmin,role_id:1,first_name:'Existing',last_name:'Admin',name:'admin'}])
})

test('optional names only accept strings with trimmed length1..100', async t => {
  const db = await dbFor(t)
  for (const [index, metadata, expectedFirst, expectedLast] of [
    [10,{},null,null],
    [11,{first_name:42,last_name:{role:'admin'}},null,null],
    [12,{first_name:['Jane'],last_name:null},null,null],
    [13,{first_name:'   ',last_name:'x'.repeat(101)},null,null],
    [14,{first_name:' x ',last_name:'x'.repeat(100)},'x','x'.repeat(100)],
  ]) {
    const id = `00000000-0000-4000-8000-${String(index).padStart(12,'0')}`
    await addAuth(db, metadata, id)
    const [p] = await profile(db,id)
    assert.equal(p.first_name,expectedFirst)
    assert.equal(p.last_name,expectedLast)
    assert.equal(p.name,'employee')
  }
})

test('no policies, RLS flags or client table grants are widened; definer function not executable by browser roles', async t => {
  const db = await dbFor(t, false)
  const policySql = "select policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname='public' order by policyname"
  const beforePolicy = await db.query(policySql)
  await db.exec(migration)
  assert.deepEqual((await db.query(policySql)).rows, beforePolicy.rows)
  for (const role of ['anon','authenticated','service_role']) {
    const permission = await db.query("select has_function_privilege($1,'public.inventory_create_employee_profile()','EXECUTE') as allowed", [role])
    assert.equal(permission.rows[0].allowed, false)
  }
  const functionDef = await db.query("select prosecdef,proconfig from pg_proc where oid='public.inventory_create_employee_profile()'::regprocedure")
  assert.equal(functionDef.rows[0].prosecdef,true)
  assert.deepEqual(functionDef.rows[0].proconfig,['search_path=""'])
  await assert.rejects(db.transaction(async tx => {
    await tx.exec('set local role authenticated')
    await tx.query('insert into public.profiles(id,role_id) values($1,1)',[missingProfileUser])
  }), {code:'42501'})
})

test('missing employee role at runtime rolls back the entire new auth insert', async t => {
  const db = await dbFor(t)
  await db.exec("update public.roles set name='retired_employee' where id=3")
  await assert.rejects(addAuth(db), {code:'P0002'})
  assert.equal((await db.query('select count(*)::integer n from auth.users where id=$1',[freshUser])).rows[0].n,0)
  assert.equal((await db.query('select count(*)::integer n from public.profiles where id=$1',[freshUser])).rows[0].n,0)
})

test('duplicate employee role after removing team integrity causes a loud atomic rollback', async t => {
  const db = await dbFor(t)
  await db.exec("alter table public.roles drop constraint roles_name_unique; insert into public.roles values(4,'employee')")
  await assert.rejects(addAuth(db), {code:'P0003'})
  assert.equal((await db.query('select count(*)::integer n from auth.users where id=$1',[freshUser])).rows[0].n,0)
})

test('profile insertion errors are not swallowed and roll back the new auth record', async t => {
  const db = await dbFor(t)
  await db.exec("alter table public.profiles add constraint reject_test_profile check(first_name is distinct from 'Rejected')")
  await assert.rejects(addAuth(db,{first_name:'Rejected'}), {code:'23514'})
  assert.equal((await db.query('select count(*)::integer n from auth.users where id=$1',[freshUser])).rows[0].n,0)
  assert.deepEqual(await profile(db,oldAdmin),[{id:oldAdmin,role_id:1,first_name:'Existing',last_name:'Admin',name:'admin'}])
})

test('existing custom auth INSERT triggers fail installation, even disabled and statement-level', async t => {
  for (const statementLevel of [false,true]) {
    const db = await dbFor(t,false)
    await db.exec(`create function public.team_auth_hook() returns trigger language plpgsql as $$begin return new; end$$;
      create trigger team_auth_hook before insert on auth.users for each ${statementLevel?'statement':'row'} execute function public.team_auth_hook();
      alter table auth.users disable trigger team_auth_hook;`)
    await rejectedInstall(db,{code:'55000'})
    assert.equal((await db.query("select count(*)::integer n from pg_trigger where tgrelid='auth.users'::regclass and tgname='team_auth_hook'")).rows[0].n,1)
  }
})

test('missing role uniqueness refuses installation rather than modifying team constraints', async t => {
  const db = await dbFor(t,false)
  await db.exec('alter table public.roles drop constraint roles_name_unique')
  await rejectedInstall(db,{code:'55000'})
  assert.equal((await db.query("select count(*)::integer n from pg_constraint where conname='roles_name_unique'")).rows[0].n,0)
})

test('missing/duplicate employee role refuses installation before function creation', async t => {
  for (const duplicate of [false,true]) {
    const db = await dbFor(t,false)
    if (duplicate) await db.exec("alter table public.roles drop constraint roles_name_unique; insert into public.roles values(4,'employee')")
    else await db.exec("update public.roles set name='not_employee' where id=3")
    await rejectedInstall(db,{code:'55000'})
  }
})

test('same-named unrelated function is never overwritten', async t => {
  const db = await dbFor(t,false)
  await db.exec("create function public.inventory_create_employee_profile() returns integer language sql as $$select 7$$")
  await assert.rejects(db.exec(migration),{code:'55000'})
  await db.exec('rollback')
  assert.equal((await db.query('select public.inventory_create_employee_profile() as value')).rows[0].value,7)
})

test('rerunning migration fails closed while retaining the original trigger and profiles', async t => {
  const db = await dbFor(t)
  await addAuth(db)
  await assert.rejects(db.exec(migration),{code:'55000'})
  await db.exec('rollback')
  assert.equal((await db.query("select count(*)::integer n from pg_trigger where tgrelid='auth.users'::regclass and tgname='inventory_auth_user_employee_profile'")).rows[0].n,1)
  assert.equal((await profile(db)).length,1)
})
