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

	SelectMiners = `SELECT first_seen, last_used FROM miners;`

	IndexMinersTableOnLastUsed = `CREATE INDEX IF NOT EXISTS ` + IndexOfMinersTableOnLastUsed + ` ON miners (last_used);`

	BackfillMiners = `
		INSERT INTO miners (address, first_seen, last_used, blocks_mined)
		SELECT sub.addr, MIN(sub.height)::INT4, MAX(sub.height)::INT4, COUNT(*)::INT4
		FROM (
			SELECT DISTINCT v.script_addresses AS addr, t.block_height AS height
			FROM vouts v
			JOIN transactions t ON v.tx_hash = t.tx_hash
			WHERE t.tree = 0
			  AND t.block_index = 0
			  AND t.is_mainchain = true
			  AND v.script_type IN ('pubkeyhash', 'scripthash', 'pubkey', 'pubkeyalt', 'pubkeyhashalt')
			  AND v.value > 0
			  AND v.script_addresses IS NOT NULL
			  AND v.script_addresses NOT IN ('', 'unknown')
			  AND v.script_addresses NOT LIKE '{%}'
		) sub
		WHERE sub.addr IS NOT NULL AND sub.addr != ''
		GROUP BY sub.addr
		ON CONFLICT (address) DO NOTHING;`

	RevertOrphanMinerUpdate = `
		UPDATE miners SET
			blocks_mined = GREATEST(0, miners.blocks_mined - 1),
			-- Approximation: when the orphaned height equals last_used, we
			-- subtract 1 rather than re-querying the miner's actual previous
			-- mainchain block. The error is bounded by the gap between the
			-- miner's last two mainchain blocks and auto-corrects on the next
			-- mining event.
			last_used = CASE
				WHEN miners.last_used = $1 AND miners.blocks_mined > 1 THEN $1 - 1
				ELSE miners.last_used
			END
		WHERE address IN (
			SELECT DISTINCT v.script_addresses
			FROM vouts v
			JOIN transactions t ON v.tx_hash = t.tx_hash
			WHERE t.block_height = $1
			  AND t.tree = 0 AND t.block_index = 0
			  AND v.script_type IN ('pubkeyhash', 'scripthash', 'pubkey', 'pubkeyalt', 'pubkeyhashalt')
			  AND v.value > 0
			  AND v.script_addresses IS NOT NULL
			  AND v.script_addresses NOT IN ('', 'unknown')
			  AND v.script_addresses NOT LIKE '{%}'
		);`

	CleanupMinerZeros = `DELETE FROM miners WHERE blocks_mined <= 0;`
)
