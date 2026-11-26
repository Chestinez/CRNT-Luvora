const { Pool } = require('pg');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function reset() {
  // The starter routes use their own tables. Luvora is installed through its migrations.
  try {
    const schemaSql = fs.readFileSync(path.join(__dirname, 'starter-schema.sql'), 'utf8');
    console.log('Resetting starter tables...');
    await pool.query(schemaSql);
    console.log('Starter schema applied.');
  } finally {
    await pool.end();
  }

  console.log('Running seed...');
  execFileSync(process.execPath, [path.join(__dirname, 'seed.js')], { stdio: 'inherit' });

  console.log('Database reset completed successfully.');
}

reset().catch((err) => {
  console.error('Reset failed:', err);
  process.exitCode = 1;
});
