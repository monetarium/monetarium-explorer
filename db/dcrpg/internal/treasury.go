// Copyright (c) 2026, The Monetarium developers
// See LICENSE for details.

package internal

// Treasury removed: monetarium-node has no treasury subsystem.
// Stub constants and functions keep the compiler happy until callers are removed.

const (
	CreateTreasuryTable            = `-- treasury table removed`
	IndexTreasuryOnTxHash          = ``
	DeindexTreasuryOnTxHash        = ``
	IndexTreasuryOnBlockHeight     = ``
	DeindexTreasuryOnBlockHeight   = ``
	SelectTreasuryBalance          = ``
	SelectTreasuryTxns             = ``
	SelectTypedTreasuryTxns        = ``
	DeleteTreasuryTxns             = ``
	UpdateTreasuryMainchainByBlock = ``
)

// MakeTreasuryInsertStatement returns an empty string (treasury removed).
func MakeTreasuryInsertStatement(_, _ bool) string { return `` }

// MakeSelectTreasuryIOStatement returns an empty string (treasury removed).
func MakeSelectTreasuryIOStatement(_ string) string { return `` }
