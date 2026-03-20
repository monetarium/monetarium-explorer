package chaincfg

import (
	"fmt"
	"testing"
)

func TestVAREmissionSchedule(t *testing.T) {
	// Test mainnet parameters
	mainnet := MainNetParams()

	// Expected values
	expectedBaseSubsidy := int64(6400000000)   // 64 VAR in atoms
	expectedReductionInterval := int64(420480) // ~4 years
	expectedMulSubsidy := int64(1)             // For halving
	expectedDivSubsidy := int64(2)             // For halving

	// Verify parameters
	if mainnet.BaseSubsidy != expectedBaseSubsidy {
		t.Errorf("BaseSubsidy: got %d, want %d", mainnet.BaseSubsidy, expectedBaseSubsidy)
	}
	if mainnet.SubsidyReductionInterval != expectedReductionInterval {
		t.Errorf("SubsidyReductionInterval: got %d, want %d",
			mainnet.SubsidyReductionInterval, expectedReductionInterval)
	}
	if mainnet.MulSubsidy != expectedMulSubsidy {
		t.Errorf("MulSubsidy: got %d, want %d", mainnet.MulSubsidy, expectedMulSubsidy)
	}
	if mainnet.DivSubsidy != expectedDivSubsidy {
		t.Errorf("DivSubsidy: got %d, want %d", mainnet.DivSubsidy, expectedDivSubsidy)
	}

	// Calculate total supply after 34 halvings
	totalSupply := int64(0)
	currentSubsidy := expectedBaseSubsidy
	halvings := 34

	for i := 0; i < halvings; i++ {
		blocksInPeriod := expectedReductionInterval
		periodSupply := currentSubsidy * blocksInPeriod
		totalSupply += periodSupply

		// Apply halving
		currentSubsidy = currentSubsidy * expectedMulSubsidy / expectedDivSubsidy

		fmt.Printf("Halving %d: Subsidy per block = %d atoms (%.8f VAR), Period supply = %.2f VAR\n",
			i+1, currentSubsidy, float64(currentSubsidy)/1e8, float64(periodSupply)/1e8)
	}

	// Convert to VAR
	totalSupplyVAR := float64(totalSupply) / 1e8
	fmt.Printf("\nTotal supply after %d halvings: %.2f VAR\n", halvings, totalSupplyVAR)

	// Expected is approximately 53,821,440 VAR
	expectedTotalVAR := 53821440.0
	tolerance := 1.0 // Allow 1 VAR difference due to rounding

	if totalSupplyVAR < expectedTotalVAR-tolerance || totalSupplyVAR > expectedTotalVAR+tolerance {
		t.Errorf("Total supply: got %.2f VAR, want approximately %.2f VAR",
			totalSupplyVAR, expectedTotalVAR)
	}
}

func TestAllNetworksVAREmission(t *testing.T) {
	// Production networks (excluding regnet which has different parameters for testing)
	networks := []struct {
		name   string
		params *Params
	}{
		{"mainnet", MainNetParams()},
		{"testnet", TestNet3Params()},
		{"simnet", SimNetParams()},
	}

	for _, net := range networks {
		t.Run(net.name, func(t *testing.T) {
			// All production networks should have same base subsidy
			if net.params.BaseSubsidy != 6400000000 {
				t.Errorf("%s: BaseSubsidy = %d, want 6400000000",
					net.name, net.params.BaseSubsidy)
			}

			// All should use true halving
			if net.params.MulSubsidy != 1 || net.params.DivSubsidy != 2 {
				t.Errorf("%s: MulSubsidy=%d, DivSubsidy=%d, want 1 and 2 for halving",
					net.name, net.params.MulSubsidy, net.params.DivSubsidy)
			}
		})
	}

	// Regnet has different parameters for testing purposes
	t.Run("regnet", func(t *testing.T) {
		regnet := RegNetParams()
		// Regnet should have its original testing parameters
		if regnet.BaseSubsidy != 50000000000 {
			t.Errorf("regnet: BaseSubsidy = %d, want 50000000000 (for testing)",
				regnet.BaseSubsidy)
		}
		if regnet.MulSubsidy != 100 || regnet.DivSubsidy != 101 {
			t.Errorf("regnet: MulSubsidy=%d, DivSubsidy=%d, want 100 and 101 (for testing)",
				regnet.MulSubsidy, regnet.DivSubsidy)
		}
	})
}
