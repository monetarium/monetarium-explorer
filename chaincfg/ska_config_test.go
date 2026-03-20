// Copyright (c) 2025 The Monetarium developers
// Use of this source code is governed by an ISC
// license that can be found in the LICENSE file.

package chaincfg

import (
	"math/big"
	"testing"

	"github.com/monetarium/monetarium-node/cointype"
)

// TestSKACoinConfig tests the SKACoinConfig structure and its methods.
func TestSKACoinConfig(t *testing.T) {
	// Test SKACoinConfig structure
	expectedMaxSupply := big.NewInt(1000000 * 1e8)
	config := &SKACoinConfig{
		CoinType:       5,
		Name:           "Test-SKA-5",
		Symbol:         "SKA-5",
		MaxSupply:      expectedMaxSupply,
		EmissionHeight: 12345,
		Active:         true,
		Description:    "Test SKA coin type",
	}

	// Test fields
	if config.CoinType != 5 {
		t.Errorf("Expected CoinType 5, got %d", config.CoinType)
	}
	if config.Name != "Test-SKA-5" {
		t.Errorf("Expected name 'Test-SKA-5', got %s", config.Name)
	}
	if config.Symbol != "SKA-5" {
		t.Errorf("Expected symbol 'SKA-5', got %s", config.Symbol)
	}
	if config.MaxSupply.Cmp(expectedMaxSupply) != 0 {
		t.Errorf("Expected MaxSupply %s, got %s", expectedMaxSupply.String(), config.MaxSupply.String())
	}
	if config.EmissionHeight != 12345 {
		t.Errorf("Expected EmissionHeight 12345, got %d", config.EmissionHeight)
	}
	if !config.Active {
		t.Error("Expected Active to be true")
	}
	if config.Description != "Test SKA coin type" {
		t.Errorf("Expected description 'Test SKA coin type', got %s", config.Description)
	}
}

// TestParamsGetSKACoinConfig tests the GetSKACoinConfig method.
func TestParamsGetSKACoinConfig(t *testing.T) {
	params := MainNetParams()

	// Test getting existing SKA coin config
	config := params.GetSKACoinConfig(1)
	if config == nil {
		t.Fatal("Expected to get SKA-1 config, got nil")
	}
	if config.CoinType != 1 {
		t.Errorf("Expected CoinType 1, got %d", config.CoinType)
	}
	if config.Name != "Skarb-1" {
		t.Errorf("Expected name 'Skarb-1', got %s", config.Name)
	}
	if config.Symbol != "SKA-1" {
		t.Errorf("Expected symbol 'SKA-1', got %s", config.Symbol)
	}

	// Test getting non-existent SKA coin config
	nonExistentConfig := params.GetSKACoinConfig(99)
	if nonExistentConfig != nil {
		t.Error("Expected nil for non-existent coin type, got config")
	}
}

// TestParamsIsSKACoinTypeActive tests the IsSKACoinTypeActive method.
func TestParamsIsSKACoinTypeActive(t *testing.T) {
	params := MainNetParams()

	tests := []struct {
		coinType cointype.CoinType
		expected bool
		name     string
	}{
		{1, true, "SKA-1 should be active"},
		{2, false, "SKA-2 should be inactive"},
		{99, false, "Non-existent coin type should be inactive"},
		{0, false, "VAR coin type should not be considered SKA"},
	}

	for _, test := range tests {
		result := params.IsSKACoinTypeActive(test.coinType)
		if result != test.expected {
			t.Errorf("%s: expected %t, got %t", test.name, test.expected, result)
		}
	}
}

// TestParamsGetActiveSKATypes tests the GetActiveSKATypes method.
func TestParamsGetActiveSKATypes(t *testing.T) {
	params := MainNetParams()

	activeTypes := params.GetActiveSKATypes()

	// Should have at least SKA-1 active
	if len(activeTypes) == 0 {
		t.Fatal("Expected at least one active SKA type")
	}

	// Check that SKA-1 is in the active list
	foundSKA1 := false
	for _, coinType := range activeTypes {
		if coinType == 1 {
			foundSKA1 = true
			break
		}
	}
	if !foundSKA1 {
		t.Error("Expected SKA-1 to be in active types list")
	}

	// Check that SKA-2 is not in the active list (it's configured but inactive)
	foundSKA2 := false
	for _, coinType := range activeTypes {
		if coinType == 2 {
			foundSKA2 = true
			break
		}
	}
	if foundSKA2 {
		t.Error("Expected SKA-2 to not be in active types list")
	}
}

// TestParamsGetAllSKATypes tests the GetAllSKATypes method.
func TestParamsGetAllSKATypes(t *testing.T) {
	params := MainNetParams()

	allTypes := params.GetAllSKATypes()

	// Should have at least SKA-1 and SKA-2 configured
	if len(allTypes) < 2 {
		t.Fatalf("Expected at least 2 configured SKA types, got %d", len(allTypes))
	}

	// Check that both SKA-1 and SKA-2 are in the list
	foundSKA1 := false
	foundSKA2 := false
	for _, coinType := range allTypes {
		if coinType == 1 {
			foundSKA1 = true
		}
		if coinType == 2 {
			foundSKA2 = true
		}
	}
	if !foundSKA1 {
		t.Error("Expected SKA-1 to be in all types list")
	}
	if !foundSKA2 {
		t.Error("Expected SKA-2 to be in all types list")
	}
}

// TestMainNetParamsSKAConfigs tests that MainNet parameters have correct SKA configurations.
func TestMainNetParamsSKAConfigs(t *testing.T) {
	params := MainNetParams()

	// Test SKA-1 configuration
	ska1Config := params.GetSKACoinConfig(1)
	if ska1Config == nil {
		t.Fatal("Expected SKA-1 to be configured")
	}
	if ska1Config.CoinType != 1 {
		t.Errorf("SKA-1: Expected CoinType 1, got %d", ska1Config.CoinType)
	}
	if ska1Config.Name != "Skarb-1" {
		t.Errorf("SKA-1: Expected name 'Skarb-1', got %s", ska1Config.Name)
	}
	if ska1Config.Symbol != "SKA-1" {
		t.Errorf("SKA-1: Expected symbol 'SKA-1', got %s", ska1Config.Symbol)
	}
	// SKA-1 mainnet: 900 trillion coins * 1e18 atoms/coin
	expectedSKA1MaxSupply, _ := new(big.Int).SetString("900000000000000000000000000000000", 10)
	if ska1Config.MaxSupply == nil || ska1Config.MaxSupply.Cmp(expectedSKA1MaxSupply) != 0 {
		t.Errorf("SKA-1: Expected MaxSupply %s, got %v", expectedSKA1MaxSupply.String(), ska1Config.MaxSupply)
	}
	if ska1Config.EmissionHeight != 4096 {
		t.Errorf("SKA-1: Expected EmissionHeight 4096, got %d", ska1Config.EmissionHeight)
	}
	if !ska1Config.Active {
		t.Error("SKA-1: Expected to be active")
	}

	// Test SKA-2 configuration
	ska2Config := params.GetSKACoinConfig(2)
	if ska2Config == nil {
		t.Fatal("Expected SKA-2 to be configured")
	}
	if ska2Config.CoinType != 2 {
		t.Errorf("SKA-2: Expected CoinType 2, got %d", ska2Config.CoinType)
	}
	if ska2Config.Name != "Skarb-2" {
		t.Errorf("SKA-2: Expected name 'Skarb-2', got %s", ska2Config.Name)
	}
	if ska2Config.Symbol != "SKA-2" {
		t.Errorf("SKA-2: Expected symbol 'SKA-2', got %s", ska2Config.Symbol)
	}
	// SKA-2 mainnet: 5 million coins * 1e18 atoms/coin
	expectedSKA2MaxSupply, _ := new(big.Int).SetString("5000000000000000000000000", 10)
	if ska2Config.MaxSupply == nil || ska2Config.MaxSupply.Cmp(expectedSKA2MaxSupply) != 0 {
		t.Errorf("SKA-2: Expected MaxSupply %s, got %v", expectedSKA2MaxSupply.String(), ska2Config.MaxSupply)
	}
	if ska2Config.EmissionHeight != 150000 {
		t.Errorf("SKA-2: Expected EmissionHeight 150000, got %d", ska2Config.EmissionHeight)
	}
	if ska2Config.Active {
		t.Error("SKA-2: Expected to be inactive (proof of concept)")
	}

	// Test InitialSKATypes
	if len(params.InitialSKATypes) != 1 {
		t.Errorf("Expected 1 initial SKA type, got %d", len(params.InitialSKATypes))
	}
	if params.InitialSKATypes[0] != 1 {
		t.Errorf("Expected initial SKA type to be 1, got %d", params.InitialSKATypes[0])
	}
}

// TestSKAConfigConsistency tests consistency between different SKA configuration methods.
func TestSKAConfigConsistency(t *testing.T) {
	params := MainNetParams()

	// Get all configured SKA types
	allTypes := params.GetAllSKATypes()

	// Verify each type has a valid configuration
	for _, coinType := range allTypes {
		config := params.GetSKACoinConfig(coinType)
		if config == nil {
			t.Errorf("Coin type %d is in all types list but has no configuration", coinType)
			continue
		}

		// Verify config consistency
		if config.CoinType != coinType {
			t.Errorf("Config for coin type %d has mismatched CoinType field %d",
				coinType, config.CoinType)
		}

		// Verify active status consistency
		isActive := params.IsSKACoinTypeActive(coinType)
		if isActive != config.Active {
			t.Errorf("Active status mismatch for coin type %d: method says %t, config says %t",
				coinType, isActive, config.Active)
		}
	}

	// Verify active types are subset of all types
	activeTypes := params.GetActiveSKATypes()
	for _, activeCoinType := range activeTypes {
		found := false
		for _, allCoinType := range allTypes {
			if activeCoinType == allCoinType {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("Active coin type %d is not in all types list", activeCoinType)
		}
	}
}
