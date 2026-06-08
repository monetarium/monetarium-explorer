// Copyright (c) 2019-2021, The Decred developers
// See LICENSE for details.

package dcrpg

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/monetarium/monetarium-explorer/db/dbtypes"
	"github.com/monetarium/monetarium-explorer/db/dcrpg/internal"
	"github.com/monetarium/monetarium-explorer/stakedb"
	"github.com/monetarium/monetarium-explorer/txhelpers"
	"github.com/monetarium/monetarium-node/chaincfg"
)

// The database schema is versioned in the meta table as follows.
const (
	// compatVersion indicates major DB changes for which there are no automated
	// upgrades. A complete DB rebuild is required if this version changes. This
	// should change very rarely, but when it does change all of the upgrades
	// defined here should be removed since they are no longer applicable.
	compatVersion = 2

	// schemaVersion pertains to a sequence of incremental upgrades to the
	// database schema that may be performed for the same compatibility version.
	// This includes changes such as creating tables, adding/deleting columns,
	// adding/deleting indexes or any other operations that create, delete, or
	// modify the definition of any database relation.
	schemaVersion = 1

	// maintVersion indicates when certain maintenance operations should be
	// performed for the same compatVersion and schemaVersion. Such operations
	// include duplicate row check and removal, forced table analysis, patching
	// or recomputation of data values, reindexing, or any other operations that
	// do not create, delete or modify the definition of any database relation.
	//
	// maint 1: recompute blocks.ssfee_totals as the marker-based {PoW,PoS}
	// split (issue #273). The JSONB shape changed from map[uint8]string to
	// map[uint8]rewardtypes.SSFeeSplit; rows written by earlier code are
	// silently unreadable under the new type and must be recomputed.
	maintVersion = 1
)

var (
	targetDatabaseVersion = &DatabaseVersion{
		compat: compatVersion,
		schema: schemaVersion,
		maint:  maintVersion,
	}
)

// DatabaseVersion models a database version.
type DatabaseVersion struct {
	compat, schema, maint uint32
}

// String implements Stringer for DatabaseVersion.
func (v DatabaseVersion) String() string {
	return fmt.Sprintf("%d.%d.%d", v.compat, v.schema, v.maint)
}

// NewDatabaseVersion returns a new DatabaseVersion with the version major.minor.patch
func NewDatabaseVersion(major, minor, patch uint32) DatabaseVersion {
	return DatabaseVersion{major, minor, patch}
}

// DBVersion retrieves the database version from the meta table. See
// (*DatabaseVersion).NeededToReach for version comparison.
func DBVersion(db *sql.DB) (ver DatabaseVersion, err error) {
	err = db.QueryRow(internal.SelectMetaDBVersions).Scan(&ver.compat, &ver.schema, &ver.maint)
	return
}

// CompatAction defines the action to be taken once the current and the required
// pg table versions are compared.
type CompatAction int8

// These are the recognized CompatActions for upgrading a database from one
// version to another.
const (
	Rebuild CompatAction = iota
	Upgrade
	Maintenance
	OK
	TimeTravel
	Unknown
)

// NeededToReach describes what action is required for the DatabaseVersion to
// reach another version provided in the input argument.
func (v *DatabaseVersion) NeededToReach(other *DatabaseVersion) CompatAction {
	switch {
	case v.compat < other.compat:
		return Rebuild
	case v.compat > other.compat:
		return TimeTravel
	case v.schema < other.schema:
		return Upgrade
	case v.schema > other.schema:
		return TimeTravel
	case v.maint < other.maint:
		return Maintenance
	case v.maint > other.maint:
		return TimeTravel
	default:
		return OK
	}
}

// String implements Stringer for CompatAction.
func (v CompatAction) String() string {
	actions := map[CompatAction]string{
		Rebuild:     "rebuild",
		Upgrade:     "upgrade",
		Maintenance: "maintenance",
		TimeTravel:  "time travel",
		OK:          "ok",
	}
	if actionStr, ok := actions[v]; ok {
		return actionStr
	}
	return "unknown"
}

// DatabaseUpgrade is used to define a required DB upgrade.
type DatabaseUpgrade struct {
	TableName               string
	UpgradeType             CompatAction
	CurrentVer, RequiredVer DatabaseVersion
}

// String implements Stringer for DatabaseUpgrade.
func (s DatabaseUpgrade) String() string {
	return fmt.Sprintf("Table %s requires %s (%s -> %s).", s.TableName,
		s.UpgradeType, s.CurrentVer, s.RequiredVer)
}

type metaData struct {
	netName         string
	currencyNet     uint32
	bestBlockHeight int64
	// bestBlockHash   dbtypes.ChainHash
	dbVer DatabaseVersion
	// ibdComplete bool
}

func initMetaData(db *sql.DB, meta *metaData) error {
	_, err := db.Exec(internal.InitMetaRow, meta.netName, meta.currencyNet,
		meta.bestBlockHeight, // meta.bestBlockHash,
		meta.dbVer.compat, meta.dbVer.schema, meta.dbVer.maint,
		false /* meta.ibdComplete */)
	return err
}

func updateSchemaVersion(db *sql.DB, schema uint32) error { //nolint:unused
	_, err := db.Exec(internal.SetDBSchemaVersion, schema)
	return err
}

func updateMaintenanceVersion(db *sql.DB, maint uint32) error {
	_, err := db.Exec(internal.SetDBMaintenanceVersion, maint)
	return err
}

// Upgrader contains a number of elements necessary to perform a database
// upgrade.
type Upgrader struct {
	db      *sql.DB
	params  *chaincfg.Params
	bg      BlockGetter
	stakeDB *stakedb.StakeDatabase
	ctx     context.Context
}

// NewUpgrader is a contructor for an Upgrader.
func NewUpgrader(ctx context.Context, params *chaincfg.Params, db *sql.DB, bg BlockGetter, stakeDB *stakedb.StakeDatabase) *Upgrader {
	return &Upgrader{
		db:      db,
		params:  params,
		bg:      bg,
		stakeDB: stakeDB,
		ctx:     ctx,
	}
}

// UpgradeDatabase attempts to upgrade the given sql.DB with help from the
// BlockGetter. The DB version will be compared against the target version to
// decide what upgrade type to initiate.
func (u *Upgrader) UpgradeDatabase() (bool, error) {
	initVer, upgradeType, err := versionCheck(u.db)
	if err != nil {
		return false, err
	}

	switch upgradeType {
	case OK:
		return true, nil
	case Upgrade, Maintenance:
		// Automatic upgrade is supported. Attempt to upgrade from initVer ->
		// targetDatabaseVersion.
		return u.upgradeDatabase(*initVer, *targetDatabaseVersion)
	case TimeTravel:
		return false, fmt.Errorf("the current table version is newer than supported: "+
			"%v > %v", initVer, targetDatabaseVersion)
	case Unknown, Rebuild:
		fallthrough
	default:
		return false, fmt.Errorf("rebuild of entire database required")
	}
}

func (u *Upgrader) upgradeDatabase(current, target DatabaseVersion) (bool, error) {
	switch current.compat {
	case 2:
		return u.compatVersion2Upgrades(current, target)
	default:
		return false, fmt.Errorf("unsupported DB compatibility version %d", current.compat)
	}
}

func (u *Upgrader) compatVersion2Upgrades(current, target DatabaseVersion) (bool, error) {
	upgradeCheck := func() (done bool, err error) {
		switch current.NeededToReach(&target) {
		case OK:
			// No upgrade needed.
			return true, nil
		case Upgrade, Maintenance:
			// Automatic upgrade is supported.
			return false, nil
		case TimeTravel:
			return false, fmt.Errorf("the current table version is newer than supported: "+
				"%v > %v", current, target)
		case Unknown, Rebuild:
			fallthrough
		default:
			return false, fmt.Errorf("rebuild of entire database required")
		}
	}

	// Initial upgrade status check.
	done, err := upgradeCheck()
	if done || err != nil {
		return done, err
	}

	// Process schema upgrades and table maintenance.
	// initSchema := current.schema
	switch current.schema {
	case 0:
		// Schema v0 -> v1: create miners table and backfill from vouts.
		log.Infof("Performing database upgrade 2.0.%d -> 2.1.%d: "+
			"creating miners table", current.maint, current.maint)
		if _, err := u.db.Exec(internal.CreateMinersTable); err != nil {
			return false, fmt.Errorf("failed to create miners table: %w", err)
		}
		if _, err := u.db.Exec(internal.BackfillMiners); err != nil {
			return false, fmt.Errorf("failed to backfill miners table: %w", err)
		}
		current.schema = 1
		if err := updateSchemaVersion(u.db, current.schema); err != nil {
			return false, fmt.Errorf("failed to update schema version: %w", err)
		}
		fallthrough
	case 1:
		// Schema v1 maintenance.
		switch current.maint {
		case 0:
			log.Infof("Performing database maintenance upgrade 2.1.0 -> 2.1.1: "+
				"recomputing blocks.ssfee_totals as marker-based PoW/PoS split")
			if err := u.recomputeSSFeeTotals(); err != nil {
				return false, fmt.Errorf("failed maintenance 2.1.0 -> 2.1.1: %v", err)
			}
			if err := updateMaintenanceVersion(u.db, 1); err != nil {
				return false, fmt.Errorf("failed to update maintenance version: %v", err)
			}
			fallthrough
		case 1:
			return true, nil
		default:
			return false, fmt.Errorf("unsupported maint version %d", current.maint)
		}
	}

	return upgradeCheck()
}

// recomputeSSFeeTotals re-derives blocks.ssfee_totals for every main-chain
// block using the marker-based txhelpers.BlockSSFeeTotals. It is idempotent
// and safe to re-run. Required because issue #273 changed the persisted JSONB
// shape (map[uint8]string -> map[uint8]rewardtypes.SSFeeSplit); rows written by
// earlier code are silently unreadable under the new type.
func (u *Upgrader) recomputeSSFeeTotals() error {
	var bestHeight int64
	if err := u.db.QueryRow(
		`SELECT COALESCE(max(height), -1) FROM blocks WHERE is_mainchain = true;`,
	).Scan(&bestHeight); err != nil {
		return fmt.Errorf("failed to get best block height: %w", err)
	}
	if bestHeight < 0 {
		return nil // empty database; nothing to recompute
	}

	stmt, err := u.db.Prepare(internal.UpdateBlockSSFeeTotals)
	if err != nil {
		return fmt.Errorf("failed to prepare ssfee_totals update: %w", err)
	}
	defer stmt.Close()

	log.Infof("Recomputing ssfee_totals for %d blocks (this runs once)...", bestHeight+1)
	for h := int64(0); h <= bestHeight; h++ {
		if err := u.ctx.Err(); err != nil {
			return err
		}
		hash, err := u.bg.GetBlockHash(u.ctx, h)
		if err != nil {
			return fmt.Errorf("GetBlockHash(%d): %w", h, err)
		}
		msgBlock, err := u.bg.GetBlock(u.ctx, hash)
		if err != nil {
			return fmt.Errorf("GetBlock(%d): %w", h, err)
		}
		split := txhelpers.BlockSSFeeTotals(msgBlock.STransactions)
		if _, err := stmt.Exec(dbtypes.ToJSONB(split), h); err != nil {
			return fmt.Errorf("update ssfee_totals at height %d: %w", h, err)
		}
		if h > 0 && h%2000 == 0 {
			log.Infof("  ...recomputed ssfee_totals through height %d/%d", h, bestHeight)
		}
	}
	log.Infof("Finished recomputing ssfee_totals for %d blocks.", bestHeight+1)
	return nil
}

func storeVers(db *sql.DB, dbVer *DatabaseVersion) error { //nolint:unused
	err := updateSchemaVersion(db, dbVer.schema)
	if err != nil {
		return fmt.Errorf("failed to update schema version: %w", err)
	}
	err = updateMaintenanceVersion(db, dbVer.maint)
	return fmt.Errorf("failed to update maintenance version: %w", err)
}

/* define when needed
func (u *Upgrader) upgradeSchema-to1() error {
	log.Infof("Performing database upgrade 2.0.0 -> 2.1.0")
	// describe the actions...
	return whatever(u.db)
}
*/

// upgradeSchemaMultiCoin applies the multi-coin schema migration for existing
// databases. Safe to run multiple times (IF NOT EXISTS / IF column does not exist).
func upgradeSchemaMultiCoin(db *sql.DB) error {
	log.Infof("Applying multi-coin schema migration (Task 10)")
	stmts := []string{
		`ALTER TABLE vins     ADD COLUMN IF NOT EXISTS coin_type INT2 NOT NULL DEFAULT 0`,
		`ALTER TABLE vins     ADD COLUMN IF NOT EXISTS ska_value TEXT`,
		`ALTER TABLE vouts    ADD COLUMN IF NOT EXISTS coin_type INT2 NOT NULL DEFAULT 0`,
		`ALTER TABLE vouts    ADD COLUMN IF NOT EXISTS ska_value TEXT`,
		`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS ska_fees JSONB`,
		`ALTER TABLE addresses ADD COLUMN IF NOT EXISTS coin_type INT2 NOT NULL DEFAULT 0`,
		`ALTER TABLE addresses ADD COLUMN IF NOT EXISTS ska_value TEXT`,
		`ALTER TABLE swaps    ADD COLUMN IF NOT EXISTS coin_type INT2 NOT NULL DEFAULT 0`,
		// TEXT conversion for ticket/vote price fields (no-op if already TEXT)
		`DO $$ BEGIN
			IF EXISTS (SELECT 1 FROM information_schema.columns
				WHERE table_name='tickets' AND column_name='price' AND data_type='double precision')
			THEN ALTER TABLE tickets ALTER COLUMN price TYPE TEXT USING price::TEXT;
			END IF;
		END $$`,
		`DO $$ BEGIN
			IF EXISTS (SELECT 1 FROM information_schema.columns
				WHERE table_name='tickets' AND column_name='fee' AND data_type='double precision')
			THEN ALTER TABLE tickets ALTER COLUMN fee TYPE TEXT USING fee::TEXT;
			END IF;
		END $$`,
		`DO $$ BEGIN
			IF EXISTS (SELECT 1 FROM information_schema.columns
				WHERE table_name='votes' AND column_name='ticket_price' AND data_type='double precision')
			THEN ALTER TABLE votes ALTER COLUMN ticket_price TYPE TEXT USING ticket_price::TEXT;
			END IF;
		END $$`,
		`DO $$ BEGIN
			IF EXISTS (SELECT 1 FROM information_schema.columns
				WHERE table_name='votes' AND column_name='vote_reward' AND data_type='double precision')
			THEN ALTER TABLE votes ALTER COLUMN vote_reward TYPE TEXT USING vote_reward::TEXT;
			END IF;
		END $$`,
		`ALTER TABLE blocks ADD COLUMN IF NOT EXISTS coin_amounts JSONB`,
		`ALTER TABLE blocks ADD COLUMN IF NOT EXISTS coin_tx_stats JSONB`,
		`ALTER TABLE blocks ADD COLUMN IF NOT EXISTS ssfee_totals JSONB`,
	}
	for _, stmt := range stmts {
		if _, err := db.Exec(stmt); err != nil {
			return fmt.Errorf("multi-coin migration: %w", err)
		}
	}
	return nil
}
