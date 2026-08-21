#!/usr/bin/env node
// scripts/generar-schema-produccion.mjs
//
// P0-01 de docs/auditoria_operativa_aplicacion_entregas_2026-08-21.md:
// el repo no tenía una fuente de verdad del esquema realmente
// desplegado en producción -- solo el historial disperso de
// migration_*.sql en lib/supabase/, que puede divergir de lo que
// corre en producción si alguna migración se aplicó a mano.
//
// Este script NO usa `supabase db dump` (requiere Docker local, no
// siempre disponible) -- consulta directamente pg_catalog /
// information_schema contra la base LINKEADA vía `supabase db query`
// y reconstruye un snapshot legible de solo lectura en supabase/schema.sql.
//
// Uso:  npm run db:schema:snapshot
// Requiere: supabase CLI autenticado y proyecto ya linkeado
// (supabase/.temp/project-ref existente).

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const queriesDir = join(__dirname, 'schema-queries')
const outFile = join(__dirname, '..', 'supabase', 'schema.sql')

function runQuery(sqlFile) {
  const raw = execFileSync(
    'npx',
    ['supabase', 'db', 'query', '--file', sqlFile, '--linked', '--output', 'json'],
    { encoding: 'utf8', shell: true }
  )
  const start = raw.indexOf('{')
  const parsed = JSON.parse(raw.slice(start))
  return parsed.rows
}

console.log('Consultando esquema en producción (esto puede tardar unos segundos)...')

const files = readdirSync(queriesDir).sort()
const [colsFile, keysFile, idxFile, rlsFile, polFile, funcFile] = files.map(f => join(queriesDir, f))

const cols = runQuery(colsFile)
const keys = runQuery(keysFile)
const idx = runQuery(idxFile)
const rls = runQuery(rlsFile)
const policies = runQuery(polFile)
const funcs = runQuery(funcFile)

const projectRef = (() => {
  try {
    return readFileSync(join(__dirname, '..', 'supabase', '.temp', 'project-ref'), 'utf8').trim()
  } catch {
    return '(desconocido)'
  }
})()

const tables = [...new Set(cols.map(c => c.tabla))].sort()

let out = ''
out += `-- ============================================================\n`
out += `-- ESQUEMA CANONICO DE PRODUCCION -- generado por introspeccion\n`
out += `-- directa contra la base de datos live (proyecto ${projectRef}),\n`
out += `-- NO a mano ni copiado de migraciones locales.\n`
out += `--\n`
out += `-- Este archivo es un SNAPSHOT DE SOLO LECTURA, no se aplica con\n`
out += `-- "supabase db push". Se regenera con:\n`
out += `--   npm run db:schema:snapshot\n`
out += `-- Generado: ${new Date().toISOString().slice(0, 10)}\n`
out += `-- ============================================================\n\n`

for (const t of tables) {
  const tcols = cols.filter(c => c.tabla === t).sort((a, b) => a.orden - b.orden)
  const pk = keys.filter(k => k.tabla === t && k.tipo === 'PRIMARY KEY')
  const fks = keys.filter(k => k.tabla === t && k.tipo === 'FOREIGN KEY')
  const uniques = keys.filter(k => k.tabla === t && k.tipo === 'UNIQUE')
  const rlsRow = rls.find(r => r.tabla === t)
  const tPolicies = policies.filter(p => p.tabla === t)
  const tIdx = idx.filter(i => i.tabla === t && !pk.some(p => i.nombre.includes(p.nombre)))

  out += `-- ---------------------------------------------------------------\n`
  out += `-- Tabla: ${t}\n`
  out += `-- ---------------------------------------------------------------\n`
  out += `CREATE TABLE public.${t} (\n`
  out += tcols
    .map(c => {
      let line = `  ${c.columna} ${c.tipo}`
      if (c.not_null) line += ' NOT NULL'
      if (c.default_val) line += ` DEFAULT ${c.default_val}`
      return line
    })
    .join(',\n')
  if (pk.length) out += `,\n  PRIMARY KEY (${pk.map(p => p.columna).join(', ')})`
  out += `\n);\n`

  for (const fk of fks) {
    out += `ALTER TABLE public.${t} ADD CONSTRAINT ${fk.nombre} FOREIGN KEY (${fk.columna}) REFERENCES public.${fk.tabla_ref}(${fk.columna_ref});\n`
  }
  const uniqueGroups = {}
  for (const u of uniques) (uniqueGroups[u.nombre] ??= []).push(u.columna)
  for (const [nombre, columnas] of Object.entries(uniqueGroups)) {
    out += `ALTER TABLE public.${t} ADD CONSTRAINT ${nombre} UNIQUE (${columnas.join(', ')});\n`
  }
  for (const i of tIdx) out += `${i.definicion};\n`
  if (rlsRow?.rls_enabled) out += `ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;\n`
  for (const p of tPolicies) {
    out += `-- POLICY ${p.nombre} (${p.comando}, roles=${p.roles})\n`
    if (p.using_expr) out += `--   USING: ${p.using_expr}\n`
    if (p.with_check_expr) out += `--   WITH CHECK: ${p.with_check_expr}\n`
  }
  out += `\n`
}

out += `-- ============================================================\n`
out += `-- FUNCIONES (esquema public) -- solo firma, no cuerpo. El cuerpo\n`
out += `-- vive en el migration_*.sql correspondiente dentro de\n`
out += `-- lib/supabase/ (convencion del repo: no se mantiene una carpeta\n`
out += `-- supabase/migrations/ viva, solo el historial de archivos sueltos).\n`
out += `-- ============================================================\n\n`
for (const f of funcs.sort((a, b) => a.nombre.localeCompare(b.nombre))) {
  out += `-- ${f.security_definer ? '[SECURITY DEFINER] ' : ''}${f.nombre}(${f.args}) RETURNS ${f.retorna}  [${f.lenguaje}]\n`
}

writeFileSync(outFile, out)
console.log(`OK: ${tables.length} tablas, ${funcs.length} funciones -> ${outFile}`)
