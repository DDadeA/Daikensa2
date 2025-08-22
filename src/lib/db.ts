import { Pool } from 'pg';
// import { env } from '$env/dynamic/private';

// Import from .env file
import { DATABASE_URL } from '$env/static/private';

const pool = new Pool({
	// connectionString: env.DATABASE_URL
	connectionString: DATABASE_URL
});

export default pool;
