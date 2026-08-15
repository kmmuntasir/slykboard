import { Pool } from 'pg';
const pool = new Pool({ connectionString: 'postgresql://test:test@localhost:5432/test' });
const r = await pool.query("select current_database(), current_user, current_schema, count(*) from information_schema.tables where table_schema='public' and table_name in ('PipelineJobs','Tickets')");
console.log(r.rows);
await pool.end();
