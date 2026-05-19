package rewardtypes

import "math/big"

// SSFeeSplit holds the PoW and PoS portions of the reward for a coin type.
type SSFeeSplit struct {
	PoW *big.Int `json:"pow"`
	PoS *big.Int `json:"pos"`
}
