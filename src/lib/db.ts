import { Pool } from 'pg';
import { env } from '$env/dynamic/private';

const pool = new Pool({
	connectionString: env.DATABASE_URL
});

export default pool;
