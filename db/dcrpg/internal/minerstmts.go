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

	CountActiveMiners = `SELECT COUNT(*) FROM miners WHERE last_used > $1;`

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
			  AND t.block_hash = $2
			  AND t.tree = 0 AND t.block_index = 0
			  AND v.script_type IN ('pubkeyhash', 'scripthash', 'pubkey', 'pubkeyalt', 'pubkeyhashalt')
			  AND v.value > 0
			  AND v.script_addresses IS NOT NULL
			  AND v.script_addresses NOT IN ('', 'unknown')
			  AND v.script_addresses NOT LIKE '{%}'
		);`

	CleanupMinerZeros = `DELETE FROM miners WHERE blocks_mined <= 0;`

	// SelectMinerRewardCounts returns, for every miner reward address that
	// received at least one PoW-reward (coinbase) transaction within the
	// inclusive block-height window [$1, $2], the number of distinct coinbase
	// blocks that paid it plus the VAR atoms it received for them: the sum of
	// the coinbases' ValueIn (reward_atoms, the consensus-checked miner subsidy
	// without fees) and the sum of their payment outputs to the address
	// (paid_atoms). Fees = paid_atoms - reward_atoms is computed by callers.
	//
	// The payment-output predicate matches BackfillMiners and
	// RevertOrphanMinerUpdate verbatim (the codebase's canonical definition of
	// a miner-reward output): coinbase = tree 0 / block_index 0 / mainchain;
	// recipient = a single payment-script address (no multisig sets) with
	// value > 0. This predicate stays in lockstep with those two queries so the
	// page count never diverges from the main-page active-miner counter (spec
	// §4.3). The additions on top of it are deliberate and inert: the
	// block_height bounds ($1/$2), the explicit coin_type = 0 (spec §4.5 — VAR
	// only; SKA vouts carry their amount in ska_value and leave value empty
	// today, so value > 0 already excludes them) and the vins join that feeds
	// the money columns (spec §9).
	// $1 = 0 selects the whole chain below $2 ("All").
	//
	// Aggregation is two-level (spec §9): the inner level folds each coinbase to
	// one row per (address, height, tx) — MAX(vin.value_in) takes the single
	// coinbase input exactly once, SUM(v.value) totals all of its payment
	// outputs — so the outer COUNT is distinct blocks (semantically identical to
	// the old DISTINCT-subquery count) and the sums never double-count.
	SelectMinerRewardCounts = `
		SELECT sub.addr,
		       COUNT(*)::INT8        AS blocks,
		       SUM(sub.reward)::INT8 AS reward_atoms,
		       SUM(sub.paid)::INT8   AS paid_atoms
		FROM (
			SELECT v.script_addresses AS addr,
			       t.block_height     AS height,
			       MAX(vin.value_in)  AS reward,
			       SUM(v.value)       AS paid
			FROM vouts v
			JOIN transactions t ON v.tx_hash = t.tx_hash
			JOIN vins vin       ON vin.tx_hash = t.tx_hash
			  AND vin.tx_index = 0 AND vin.coin_type = 0
			WHERE t.tree = 0
			  AND t.block_index = 0
			  AND t.is_mainchain = true
			  AND t.block_height >= $1
			  AND t.block_height <= $2
			  AND v.coin_type = 0
			  AND v.script_type IN ('pubkeyhash', 'scripthash', 'pubkey', 'pubkeyalt', 'pubkeyhashalt')
			  AND v.value > 0
			  AND v.script_addresses IS NOT NULL
			  AND v.script_addresses NOT IN ('', 'unknown')
			  AND v.script_addresses NOT LIKE '{%}'
			GROUP BY v.script_addresses, t.block_height, t.tx_hash
		) sub
		WHERE sub.addr IS NOT NULL AND sub.addr != ''
		GROUP BY sub.addr
		ORDER BY blocks DESC`

	// SelectMultiAddressCoinbases finds coinbase transactions within the
	// inclusive block-height window [$1, $2] that pay more than one distinct
	// payment address. The hashrate-shares reward attribution assumes a coinbase
	// has exactly one payment output (spec §10.4): if this query ever returns
	// rows, that assumption has broken and the Miner Reward column would hand the
	// full ValueIn to every address of the coinbase.
	SelectMultiAddressCoinbases = `
		SELECT t.block_height, t.tx_hash, COUNT(DISTINCT v.script_addresses)::INT8 AS addr_count
		FROM vouts v
		JOIN transactions t ON v.tx_hash = t.tx_hash
		WHERE t.tree = 0
		  AND t.block_index = 0
		  AND t.is_mainchain = true
		  AND t.block_height >= $1
		  AND t.block_height <= $2
		  AND v.coin_type = 0
		  AND v.script_type IN ('pubkeyhash', 'scripthash', 'pubkey', 'pubkeyalt', 'pubkeyhashalt')
		  AND v.value > 0
		  AND v.script_addresses IS NOT NULL
		  AND v.script_addresses NOT IN ('', 'unknown')
		  AND v.script_addresses NOT LIKE '{%}'
		GROUP BY t.block_height, t.tx_hash
		HAVING COUNT(DISTINCT v.script_addresses) > 1
		ORDER BY t.block_height, t.tx_hash`
)
