import { Pool } from 'pg';
import { DATABASE_URL } from '$env/static/private'; // Assuming you've set up environment variables

const pool = new Pool({
	connectionString: DATABASE_URL
});

export default pool;
