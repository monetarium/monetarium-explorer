package internal

const (
	CreateMinersTable = `CREATE TABLE IF NOT EXISTS miners (
		address TEXT NOT NULL PRIMARY KEY,
		first_seen INT4 NOT NULL,
		last_used INT4 NOT NULL,
		blocks_mined INT4 NOT NULL DEFAULT 1
	);`

	UpsertMinerRow = `
		INSERT INTO miners (address, first_seen, last_used, blocks_mined)
		VALUES ($1, $2, $3, 1)
		ON CONFLICT (address) DO UPDATE SET
			last_used = EXCLUDED.last_used,
			blocks_mined = miners.blocks_mined + 1;`

	CountMiners = `SELECT COUNT(*) FROM miners;`

	CountActiveMiners = `SELECT COUNT(*) FROM miners WHERE last_used >= $1;`

	BackfillMiners = `
		INSERT INTO miners (address, first_seen, last_used, blocks_mined)
		SELECT addr.address, MIN(addr.height)::INT4, MAX(addr.height)::INT4, COUNT(*)::INT4
		FROM (
			SELECT DISTINCT a.address, t.block_height AS height
			FROM addresses a
			JOIN transactions t ON a.tx_hash = t.tx_hash
			WHERE a.tx_type = 102
			  AND t.is_mainchain = true
		) addr
		GROUP BY addr.address
		ON CONFLICT (address) DO NOTHING;`
)
