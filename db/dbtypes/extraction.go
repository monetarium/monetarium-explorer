package dbtypes

import (
	"fmt"
	"math/big"

	"github.com/monetarium/monetarium-explorer/txhelpers"
	"github.com/monetarium/monetarium-node/blockchain/stake"
	"github.com/monetarium/monetarium-node/chaincfg"
	"github.com/monetarium/monetarium-node/cointype"
	"github.com/monetarium/monetarium-node/txscript/stdscript"
	"github.com/monetarium/monetarium-node/wire"
)

// DevSubsidyAddress returns the development subsidy address for the specified
// network.
func DevSubsidyAddress(params *chaincfg.Params) (string, error) {
	if len(params.OrganizationPkScript) == 0 {
		return "", nil
	}
	_, devSubsidyAddresses := stdscript.ExtractAddrs(
		params.OrganizationPkScriptVersion, params.OrganizationPkScript, params) // legacy org pkScript is not a treasury script
	if len(devSubsidyAddresses) != 1 {
		return "", fmt.Errorf("failed to decode dev subsidy address")
	}

	return devSubsidyAddresses[0].String(), nil
}

// ExtractBlockTransactions extracts transaction information from a
// wire.MsgBlock and returns the processed information in slices of the dbtypes
// Tx, Vout, and VinTxPropertyARRAY.
func ExtractBlockTransactions(msgBlock *wire.MsgBlock, txTree int8,
	chainParams *chaincfg.Params, isValid, isMainchain bool) ([]*Tx, [][]*Vout, []VinTxPropertyARRAY) {
	dbTxs, dbTxVouts, dbTxVins := processTransactions(msgBlock, txTree,
		chainParams, isValid, isMainchain)
	if txTree != wire.TxTreeRegular && txTree != wire.TxTreeStake {
		fmt.Printf("Invalid transaction tree: %v", txTree)
	}
	return dbTxs, dbTxVouts, dbTxVins
}

// bigIntMapAdd adds v to the big.Int accumulator map at key k.
func bigIntMapAdd(m map[uint8]*big.Int, k uint8, v *big.Int) {
	if cur, ok := m[k]; ok {
		cur.Add(cur, v)
	} else {
		m[k] = new(big.Int).Set(v)
	}
}

// bigIntMapToStrings converts a map[uint8]*big.Int to map[uint8]string (decimal atom strings).
func bigIntMapToStrings(m map[uint8]*big.Int) map[uint8]string {
	if len(m) == 0 {
		return nil
	}
	out := make(map[uint8]string, len(m))
	for k, v := range m {
		out[k] = v.String()
	}
	return out
}

func processTransactions(msgBlock *wire.MsgBlock, tree int8, chainParams *chaincfg.Params,
	isValid, isMainchain bool) ([]*Tx, [][]*Vout, []VinTxPropertyARRAY) {

	var stakeTree bool
	var txs []*wire.MsgTx
	switch tree {
	case wire.TxTreeRegular:
		txs = msgBlock.Transactions
	case wire.TxTreeStake:
		txs = msgBlock.STransactions
		stakeTree = true
	default:
		return nil, nil, nil
	}

	blockHeight := msgBlock.Header.Height
	blockHash := ChainHash(msgBlock.BlockHash())
	blockTime := NewTimeDef(msgBlock.Header.Timestamp)

	dbTransactions := make([]*Tx, 0, len(txs))
	dbTxVouts := make([][]*Vout, len(txs))
	dbTxVins := make([]VinTxPropertyARRAY, len(txs))

	ticketPrice := msgBlock.Header.SBits

	for txIndex, tx := range txs {
		txType := txhelpers.DetermineTxType(tx)
		isStake := txType != stake.TxTypeRegular
		if isStake && !stakeTree {
			fmt.Printf(" ***************** INCONSISTENT TREE: txn %v, type = %v", tx.TxHash(), txType)
			continue
		}

		var mixDenom int64
		var mixCount uint32
		if !isStake {
			_, mixDenom, mixCount = txhelpers.IsMixTx(tx)
			if mixCount == 0 {
				_, mixDenom, mixCount = txhelpers.IsMixedSplitTx(tx, int64(txhelpers.DefaultRelayFeePerKb), ticketPrice)
			}
		}

		// Per-coin accumulators: VAR uses int64, SKA uses big.Int.
		var varSpent, varSent int64
		skaSpent := make(map[uint8]*big.Int)
		skaSent := make(map[uint8]*big.Int)

		for _, txin := range tx.TxIn {
			if txin.SKAValueIn != nil {
				// Determine coin type from outputs (inputs don't carry CoinType directly).
				// We accumulate SKA inputs under a temporary key; the coin type will be
				// resolved per-output below. For now accumulate all SKA inputs together.
				// This is sufficient for fee calculation since a tx is single-coin.
				bigIntMapAdd(skaSpent, 0xff, txin.SKAValueIn) // 0xff = placeholder
			} else {
				varSpent += txin.ValueIn
			}
		}

		for _, txout := range tx.TxOut {
			ct := txout.CoinType
			if ct == cointype.CoinTypeVAR {
				varSent += txout.Value
			} else if ct.IsSKA() && txout.SKAValue != nil {
				bigIntMapAdd(skaSent, uint8(ct), txout.SKAValue)
			}
		}

		// Resolve SKA spent: move placeholder to the actual SKA coin type.
		// A tx is single-coin, so find the SKA type from outputs.
		if placeholder, ok := skaSpent[0xff]; ok {
			delete(skaSpent, 0xff)
			for ct := range skaSent {
				bigIntMapAdd(skaSpent, ct, placeholder)
				break
			}
		}

		// Compute per-coin fees.
		varFees := varSpent - varSent
		skaFees := make(map[uint8]*big.Int)
		for ct, spent := range skaSpent {
			sent, hasSent := skaSent[ct]
			fee := new(big.Int).Set(spent)
			if hasSent {
				fee.Sub(fee, sent)
			}
			if fee.Sign() > 0 {
				skaFees[ct] = fee
			}
		}

		dbTx := &Tx{
			BlockHash:        blockHash,
			BlockHeight:      int64(blockHeight),
			BlockTime:        blockTime,
			TxType:           int16(txType),
			Version:          tx.Version,
			Tree:             tree,
			TxID:             ChainHash(*tx.CachedTxHash()),
			BlockIndex:       uint32(txIndex),
			Locktime:         tx.LockTime,
			Expiry:           tx.Expiry,
			Size:             uint32(tx.SerializeSize()),
			Spent:            varSpent,
			Sent:             varSent,
			Fees:             varFees,
			MixCount:         int32(mixCount),
			MixDenom:         mixDenom,
			NumVin:           uint32(len(tx.TxIn)),
			NumVout:          uint32(len(tx.TxOut)),
			IsValid:          isValid || tree == wire.TxTreeStake,
			IsMainchainBlock: isMainchain,
		}

		// Attach per-SKA maps only when SKA coins are present.
		if len(skaSpent) > 0 || len(skaSent) > 0 || len(skaFees) > 0 {
			dbTx.SpentByCoin = bigIntMapToStrings(skaSpent)
			dbTx.SentByCoin = bigIntMapToStrings(skaSent)
			dbTx.FeesByCoin = bigIntMapToStrings(skaFees)
		}

		// Derive vin coin type from outputs (tx is single-coin).
		vinCoinType := uint8(cointype.CoinTypeVAR)
		for ct := range skaSent {
			vinCoinType = ct
			break
		}

		dbTxVins[txIndex] = make(VinTxPropertyARRAY, 0, len(tx.TxIn))
		for idx, txin := range tx.TxIn {
			dbTxVins[txIndex] = append(dbTxVins[txIndex], VinTxProperty{
				PrevTxHash:  ChainHash(txin.PreviousOutPoint.Hash),
				PrevTxIndex: txin.PreviousOutPoint.Index,
				PrevTxTree:  uint16(txin.PreviousOutPoint.Tree),
				Sequence:    txin.Sequence,
				ValueIn:     txin.ValueIn,
				TxID:        dbTx.TxID,
				TxIndex:     uint32(idx),
				TxType:      dbTx.TxType,
				TxTree:      uint16(dbTx.Tree),
				Time:        blockTime,
				BlockHeight: txin.BlockHeight,
				BlockIndex:  txin.BlockIndex,
				ScriptSig:   txin.SignatureScript,
				IsValid:     dbTx.IsValid,
				IsMainchain: isMainchain,
				CoinType:    vinCoinType,
			})
		}

		dbTxVouts[txIndex] = make([]*Vout, 0, len(tx.TxOut))
		for io, txout := range tx.TxOut {
			ct := txout.CoinType
			vout := Vout{
				TxHash:   dbTx.TxID,
				TxIndex:  uint32(io),
				TxTree:   tree,
				TxType:   dbTx.TxType,
				CoinType: uint8(ct),
				Version:  txout.Version,
				// Mixed only applies to VAR CoinJoin outputs.
				Mixed: ct == cointype.CoinTypeVAR && mixDenom > 0 && mixDenom == txout.Value,
			}
			if ct == cointype.CoinTypeVAR {
				vout.Value = uint64(txout.Value)
			} else if ct.IsSKA() && txout.SKAValue != nil {
				vout.SKAValue = txout.SKAValue.String()
			}
			scriptClass, scriptAddrs := stdscript.ExtractAddrs(vout.Version, txout.PkScript, chainParams)
			addys := make([]string, 0, len(scriptAddrs))
			for ia := range scriptAddrs {
				addys = append(addys, scriptAddrs[ia].String())
			}
			vout.ScriptPubKeyData.Type = NewScriptClass(scriptClass)
			vout.ScriptPubKeyData.Addresses = addys
			dbTxVouts[txIndex] = append(dbTxVouts[txIndex], &vout)
		}

		dbTransactions = append(dbTransactions, dbTx)
	}

	return dbTransactions, dbTxVouts, dbTxVins
}
