// Copyright (c) 2018-2026, The Monetarium developers
// See LICENSE for details.

// Package verifymessage verifies message signatures with a fixed outcome
// vocabulary shared by the HTML and API handlers.
package verifymessage

import (
	"encoding/base64"
	"strings"

	"github.com/monetarium/monetarium-node/dcrutil"
	"github.com/monetarium/monetarium-node/txscript/stdaddr"
)

// compactSigSize is the length of a serialized compact signature: a header
// byte plus two 32-byte scalars (R and S).
const compactSigSize = 65

// Result is the outcome of Verify. Exactly one of Match or Mismatch is true,
// or ErrMsg carries a fixed-vocabulary error description.
type Result struct {
	Match    bool
	Mismatch bool
	ErrMsg   string
}

// Verify reports whether signature is a valid signature of message for
// address on the given network params. Inputs are validated explicitly before
// signature recovery so each failure mode is classified by construction rather
// than by matching upstream error prose, which can embed caller-controlled
// strings (stdaddr embeds the address in decode errors via %q).
func Verify(address, signature, message string, params dcrutil.AddressParams) Result {
	// Decode the address first: it is the only input whose error text
	// includes caller content, so a fixed message is used.
	addr, err := stdaddr.DecodeAddress(address, params)
	if err != nil {
		return Result{ErrMsg: "invalid address"}
	}

	// Only P2PKH addresses can sign messages. Hoisting the type assertion
	// here (dcrutil.VerifyMessage performs it between the address and
	// signature checks) keeps an address fault reported as such even when
	// the signature is malformed too.
	if _, ok := addr.(*stdaddr.AddressPubKeyHashEcdsaSecp256k1V0); !ok {
		return Result{ErrMsg: "invalid address"}
	}

	// Validate the signature encoding and compact length before recovery, so
	// malformed signatures map to "invalid signature encoding" regardless of
	// the underlying base64/ecdsa error text.
	sig, err := base64.StdEncoding.DecodeString(signature)
	if err != nil || len(sig) != compactSigSize {
		return Result{ErrMsg: "invalid signature encoding"}
	}

	err = dcrutil.VerifyMessage(address, signature, message, params)
	if err != nil {
		if strings.Contains(err.Error(), "message not signed by address") {
			return Result{Mismatch: true}
		}
		return Result{ErrMsg: "invalid signature"}
	}
	return Result{Match: true}
}
