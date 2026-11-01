// Phase 13 WI-1 — `npm run build` step 3 of 3 (after tsc and tsc-alias).
//
// tsc emits only JavaScript, but db/migrate.ts reads schema.sql and the
// migrations/ directory from next to itself at runtime. It silently skips
// migrations when that directory is missing, so a build without these files
// would start against an unmigrated database with no error. Copy them, and
// fail the build if either is absent.
const fs = require('fs')
const path = require('path')

const src = path.resolve(__dirname, '../db')
const dest = path.resolve(__dirname, '../dist/backend/db')

fs.mkdirSync(dest, { recursive: true })
fs.copyFileSync(path.join(src, 'schema.sql'), path.join(dest, 'schema.sql'))
fs.cpSync(path.join(src, 'migrations'), path.join(dest, 'migrations'), { recursive: true })

const copied = fs.readdirSync(path.join(dest, 'migrations')).filter(f => f.endsWith('.sql'))
if (copied.length === 0) throw new Error('copy-build-assets: no migrations copied')
console.log(`copy-build-assets: schema.sql + ${copied.length} migrations → dist/backend/db`)
