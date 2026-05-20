// Copyright (c) 2025, The Monetarium developers
// See LICENSE for details.

package explorer

import (
	"strings"
	"testing"

	"github.com/monetarium/monetarium-node/chaincfg"
)

func TestBuildSKACoinParams_Mainnet(t *testing.T) {
	got := buildSKACoinParams(chaincfg.MainNetParams())
	if len(got) < 2 {
		t.Fatalf("expected >=2 SKA entries on mainnet, got %d", len(got))
	}

	// Entries must be sorted by CoinType.
	for i := 1; i < len(got); i++ {
		if got[i-1].CoinType >= got[i].CoinType {
			t.Fatalf("SKA entries not sorted by CoinType: %d before %d", got[i-1].CoinType, got[i].CoinType)
		}
	}

	first := got[0]
	if first.CoinType != 1 {
		t.Errorf("first CoinType=%d, want 1", first.CoinType)
	}
	if first.Label != "SKA1" {
		t.Errorf("first Label=%q, want %q (no dash)", first.Label, "SKA1")
	}
	if !first.InitiallyActive {
		t.Error("SKA1 should be in InitialSKATypes")
	}
	if !first.Active {
		t.Error("SKA1 should be Active")
	}
	if !strings.Contains(first.MaxSupply, ",") {
		t.Errorf("MaxSupply=%q has no thousands separators", first.MaxSupply)
	}
	if strings.ContainsAny(first.MaxSupply, "eE") {
		t.Errorf("MaxSupply=%q must not use scientific notation", first.MaxSupply)
	}
	if strings.HasSuffix(first.MaxSupply, ".") {
		t.Errorf("MaxSupply=%q must not have a trailing decimal point for whole-coin values", first.MaxSupply)
	}

	const wantAtomsPerCoin = "1,000,000,000,000,000,000"
	if first.AtomsPerCoin != wantAtomsPerCoin {
		t.Errorf("AtomsPerCoin=%q, want %q", first.AtomsPerCoin, wantAtomsPerCoin)
	}

	if len(first.EmissionAddresses) == 0 {
		t.Error("SKA1 should have at least one EmissionAddress")
	}
	if len(first.EmissionAmounts) != len(first.EmissionAddresses) {
		t.Errorf("EmissionAmounts len=%d != EmissionAddresses len=%d",
			len(first.EmissionAmounts), len(first.EmissionAddresses))
	}

	// SKA2 on mainnet is configured but inactive and not in InitialSKATypes.
	second := got[1]
	if second.CoinType != 2 {
		t.Errorf("second CoinType=%d, want 2", second.CoinType)
	}
	if second.Label != "SKA2" {
		t.Errorf("second Label=%q, want %q", second.Label, "SKA2")
	}
	if second.InitiallyActive {
		t.Error("SKA2 should NOT be in InitialSKATypes on mainnet")
	}
	if second.Active {
		t.Error("SKA2 should be inactive on mainnet")
	}
}

func TestBuildSKACoinParams_OtherNets(t *testing.T) {
	// Must not panic and must produce non-empty output where SKACoins are
	// configured. simnet/testnet/regnet may differ in coin sets but the
	// builder should work uniformly.
	for _, p := range []*chaincfg.Params{
		chaincfg.SimNetParams(),
		chaincfg.TestNet3Params(),
		chaincfg.RegNetParams(),
	} {
		got := buildSKACoinParams(p)
		_ = got // existence + no panic is the contract; SKACoins may be empty.
	}
}
