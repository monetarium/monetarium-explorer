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

	BackfillMiners = `
		INSERT INTO miners (address, first_seen, last_used, blocks_mined)
		SELECT addr, MIN(height)::INT4, MAX(height)::INT4, COUNT(*)::INT4
		FROM (
			SELECT DISTINCT vouts.address, vouts.block_height AS height
			FROM vouts
			WHERE vouts.tx_type = 102
		) sub
		GROUP BY addr
		ON CONFLICT (address) DO NOTHING;`
)
