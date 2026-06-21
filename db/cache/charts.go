// Copyright (c) 2019-2021, The Decred developers
// See LICENSE for details.

package cache

import (
	"context"
	"database/sql"
	"encoding/gob"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/monetarium/monetarium-explorer/semver"
	"github.com/monetarium/monetarium-explorer/txhelpers"
	"github.com/monetarium/monetarium-node/chaincfg"
)

// Keys for specifying chart data type.
const (
	BlockSize       = "block-size"
	BlockChainSize  = "blockchain-size"
	ChainWork       = "chainwork"
	CoinSupply      = "coin-supply"
	DurationBTW     = "duration-btw-blocks"
	HashRate        = "hashrate"
	POWDifficulty   = "pow-difficulty"
	TicketPrice     = "ticket-price"
	TxCount         = "tx-count"
	Fees            = "fees"
	AnonymitySet    = "privacy-participation"
	TicketPoolSize  = "ticket-pool-size"
	TicketPoolValue = "ticket-pool-value"
	WindMissedVotes = "missed-votes"
	PercentStaked   = "stake-participation"

	// Some chartResponse keys
	heightKey       = "h"
	timeKey         = "t"
	binKey          = "bin"
	axisKey         = "axis"
	supplyKey       = "supply"
	windowKey       = "window"
	diffKey         = "diff"
	priceKey        = "price"
	countKey        = "count"
	offsetKey       = "offset"
	circulationKey  = "circulation"
	poolValKey      = "poolval"
	missedKey       = "missed"
	sizeKey         = "size"
	feesKey         = "fees"
	anonymitySetKey = "anonymitySet"
	durationKey     = "duration"
	workKey         = "work"
	rateKey         = "rate"
	activeMinersKey = "active_miners"

	// SKA coin supply chart prefix (coin-supply/N where N is coin type)
	SKASupplyPrefix = "coin-supply/"

	// SKA fee chart prefix (fees/N where N is coin type)
	SKAFeePrefix = "fees/"
)

// intervalType specifies the lookback interval for the active-miner rolling count.
type intervalType string

const (
	AllInterval  intervalType = "all"
	YearInterval intervalType = "year"
	WeekInterval intervalType = "week"
	DayInterval  intervalType = "day"

	DefaultInterval = WeekInterval
)

// binLevel specifies the granularity of data.
type binLevel string

// axisType is used to manage the type of x-axis data on display on the specified
// chart.
type axisType string

// These are the recognized binLevel and axisType values.
const (
	DayBin     binLevel = "day"
	BlockBin   binLevel = "block"
	WindowBin  binLevel = "window"
	HeightAxis axisType = "height"
	TimeAxis   axisType = "time"
)

// Check if the chart is window binned.
func isWindowBin(chart string) bool {
	switch chart {
	case POWDifficulty, TicketPrice, WindMissedVotes:
		return true
	}
	return false
}

// IsSKASupplyChart checks if the chart ID is an SKA supply chart (coin-supply/N).
func IsSKASupplyChart(chartID string) bool {
	return len(chartID) > len(SKASupplyPrefix) && chartID[:len(SKASupplyPrefix)] == SKASupplyPrefix
}

// SkaCoinType extracts the coin type number from an SKA supply chart ID.
// Returns 0 if the chart ID is invalid.
func SkaCoinType(chartID string) uint8 {
	if !IsSKASupplyChart(chartID) {
		return 0
	}
	var coinType uint8
	_, err := fmt.Sscanf(chartID[len(SKASupplyPrefix):], "%d", &coinType)
	if err != nil {
		return 0
	}
	return coinType
}

// IsSKAFeeChart checks if the chart ID is an SKA fee chart (fees/N).
func IsSKAFeeChart(chartID string) bool {
	return len(chartID) > len(SKAFeePrefix) && chartID[:len(SKAFeePrefix)] == SKAFeePrefix
}

// FeeCoinType extracts the coin type number from an SKA fee chart ID.
// Returns 0 if the chart ID is invalid.
func FeeCoinType(chartID string) uint8 {
	if !IsSKAFeeChart(chartID) {
		return 0
	}
	var coinType uint8
	_, err := fmt.Sscanf(chartID[len(SKAFeePrefix):], "%d", &coinType)
	if err != nil {
		return 0
	}
	return coinType
}

// DefaultBinLevel will be used if a bin level is not specified to
// (*ChartData).Chart (via empty string), or if the provided BinLevel is
// invalid.
var DefaultBinLevel = DayBin

// ParseBin will return the matching bin level, else the default bin.
func ParseBin(bin string) binLevel {
	switch binLevel(bin) {
	case BlockBin:
		return BlockBin
	case WindowBin:
		return WindowBin
	}
	return DefaultBinLevel
}

// ParseAxis returns the matching axis type, else the default of time axis.
func ParseAxis(aType string) axisType {
	switch axisType(aType) {
	case HeightAxis:
		return HeightAxis
	default:
		return TimeAxis
	}
}

// ParseInterval returns the matching interval type, else the default.
func ParseInterval(s string) intervalType {
	switch intervalType(s) {
	case AllInterval, YearInterval, WeekInterval, DayInterval:
		return intervalType(s)
	}
	return DefaultInterval
}

const (
	// aDay defines the number of seconds in a day.
	aDay = 86400
	// HashrateAvgLength is the number of blocks used the rolling average for
	// the network hashrate calculation.
	HashrateAvgLength = 120
)

// cacheVersion helps detect when the cache data stored has changed its
// structure or content. A change on the cache version results to recomputing
// all the charts data a fresh thereby making the cache to hold the latest changes.
//
// 6.4.0: issue #405 fixed SelectFeesPerBlockAboveHeight so per-block Fees no
// longer cancel to zero against the coinbase. Already-synced deployments cached
// the wrong (all-zero) Fees series; bumping the version forces a full recompute
// of the charts cache on next start so the corrected query reruns over every
// block. No database resync or backfill is needed — transactions.fees was
// always stored correctly.
//
// 6.5.0: windowSet adds Height field for window start heights and
// stakeCountVersion for live stake count cache invalidation.
// appendWindowStats now emits window data at window start with live
// stake count updates per block.
var cacheVersion = semver.NewSemver(6, 5, 0)

// versionedCacheData defines the cache data contents to be written into a .gob file.
type versionedCacheData struct {
	Version string
	Data    *ChartGobject
}

// ChartError is an Error interface for use with constant errors.
type ChartError string

func (e ChartError) Error() string {
	return string(e)
}

// UnknownChartErr is returned when a chart key is provided that does not match
// any known chart type constant.
const UnknownChartErr = ChartError("unknown chart")

// InvalidBinErr is returned when a ChartMaker receives an unknown BinLevel.
// In practice, this should be impossible, since ParseBin returns a default
// if a supplied bin specifier is invalid, and window-binned ChartMakers
// ignore the bin flag.
const InvalidBinErr = ChartError("invalid bin")

// An interface for reading and setting the length of datasets.
type lengther interface {
	Length() int
	Truncate(int) lengther
}

// ChartFloats is a slice of floats. It satisfies the lengther interface, and
// provides methods for taking averages or sums of segments.
type ChartFloats []float64

// Length returns the length of data. Satisfies the lengther interface.
func (data ChartFloats) Length() int {
	return len(data)
}

// Truncate makes a subset of the underlying dataset. It satisfies the lengther
// interface.
func (data ChartFloats) Truncate(l int) lengther {
	return data[:l]
}

// If the data is longer than max, return a subset of length max.
func (data ChartFloats) snip(max int) ChartFloats {
	if len(data) < max {
		max = len(data)
	}
	return data[:max]
}

// Avg is the average value of a segment of the dataset.
func (data ChartFloats) Avg(s, e int) float64 {
	if e <= s {
		return 0
	}
	var sum float64
	for _, v := range data[s:e] {
		sum += v
	}
	return sum / float64(e-s)
}

// Sum is the accumulation of a segment of the dataset.
func (data ChartFloats) Sum(s, e int) (sum float64) {
	if e <= s {
		return 0
	}
	for _, v := range data[s:e] {
		sum += v
	}
	return
}

// A constructor for a sized ChartFloats.
func newChartFloats(size int) ChartFloats {
	return make([]float64, 0, size)
}

// ChartBigInts is a slice of big ints. It satisfies the lengther interface.
type ChartBigInts []*big.Int

// Length returns the length of data. Satisfies the lengther interface.
func (data ChartBigInts) Length() int {
	return len(data)
}

// Truncate makes a subset of the underlying dataset. It satisfies the lengther
// interface.
func (data ChartBigInts) Truncate(l int) lengther {
	return data[:l]
}

// If the data is longer than max, return a subset of length max.
func (data ChartBigInts) snip(max int) ChartBigInts {
	if len(data) < max {
		max = len(data)
	}
	return data[:max]
}

// A constructor for a sized ChartBigInts.
func newChartBigInts(size int) ChartBigInts {
	return make(ChartBigInts, 0, size)
}

// ChartUints is a slice of uints. It satisfies the lengther interface, and
// provides methods for taking averages or sums of segments.
type ChartUints []uint64

// Length returns the length of data. Satisfies the lengther interface.
func (data ChartUints) Length() int {
	return len(data)
}

// Truncate makes a subset of the underlying dataset. It satisfies the lengther
// interface.
func (data ChartUints) Truncate(l int) lengther {
	return data[:l]
}

// If the data is longer than max, return a subset of length max.
func (data ChartUints) snip(max int) ChartUints {
	if len(data) < max {
		max = len(data)
	}
	return data[:max]
}

// Avg is the average value of a segment of the dataset.
func (data ChartUints) Avg(s, e int) uint64 {
	if e <= s {
		return 0
	}
	var sum uint64
	for _, v := range data[s:e] {
		sum += v
	}
	return sum / uint64(e-s)
}

// Sum is the accumulation of a segment of the dataset.
func (data ChartUints) Sum(s, e int) (sum uint64) {
	if e <= s {
		return 0
	}
	for _, v := range data[s:e] {
		sum += v
	}
	return
}

// A constructor for a sized ChartFloats.
func newChartUints(size int) ChartUints {
	return make(ChartUints, 0, size)
}

// zoomSet is a set of binned data. The smallest bin is block-sized. The zoomSet
// is managed by explorer, and subsequently the database packages. ChartData
// provides methods for validating the data and handling concurrency. The
// cacheID is updated anytime new data is added and validated (see
// Lengthen), typically once per bin duration.
type zoomSet struct {
	cacheID      uint64
	Height       ChartUints
	Time         ChartUints
	PoolSize     ChartUints
	PoolValue    ChartUints
	BlockSize    ChartUints
	TxCount      ChartUints
	NewAtoms     ChartUints
	Chainwork    ChartBigInts
	Fees         ChartUints
	TotalMixed   ChartUints
	AnonymitySet ChartUints
}

type SKASupplyChartData struct {
	Heights    []int64
	Timestamps []int64
	Values     []string
}

// SKASupplyData stores per-coin-type cumulative supply data (strings for precision).
type SKASupplyData map[uint8]SKASupplyChartData

// SKAFeeChartData holds per-block fee data for a single SKA coin type.
// Fees are stored as exact-precision strings to preserve 18 decimal places.
type SKAFeeChartData struct {
	Heights    []int64
	Timestamps []int64
	Fees       []string
}

// SKAFeesData stores per-coin-type SKA fee data.
type SKAFeesData map[uint8]SKAFeeChartData

// Snip truncates the zoomSet to a provided length.
func (set *zoomSet) Snip(length int) {
	if length < 0 {
		length = 0
	}
	set.Height = set.Height.snip(length)
	set.Time = set.Time.snip(length)
	set.PoolSize = set.PoolSize.snip(length)
	set.PoolValue = set.PoolValue.snip(length)
	set.BlockSize = set.BlockSize.snip(length)
	set.TxCount = set.TxCount.snip(length)
	set.NewAtoms = set.NewAtoms.snip(length)
	set.Chainwork = set.Chainwork.snip(length)
	set.Fees = set.Fees.snip(length)
	set.TotalMixed = set.TotalMixed.snip(length)
	set.AnonymitySet = set.AnonymitySet.snip(length)
}

// Constructor for a sized zoomSet for blocks, which has has no Height slice
// since the height is implicit for block-binned data.
func newBlockSet(size int) *zoomSet {
	return &zoomSet{
		Height:       newChartUints(size),
		Time:         newChartUints(size),
		PoolSize:     newChartUints(size),
		PoolValue:    newChartUints(size),
		BlockSize:    newChartUints(size),
		TxCount:      newChartUints(size),
		NewAtoms:     newChartUints(size),
		Chainwork:    newChartBigInts(size),
		Fees:         newChartUints(size),
		TotalMixed:   newChartUints(size),
		AnonymitySet: newChartUints(size),
	}
}

// Constructor for a sized zoomSet for day-binned data.
func newDaySet(size int) *zoomSet {
	set := newBlockSet(size)
	set.Height = newChartUints(size)
	return set
}

// windowSet is for data that only changes at the difficulty change interval,
// 144 blocks on mainnet. stakeValid defines the number windows before the
// stake validation height.
type windowSet struct {
	cacheID           uint64
	Time              ChartUints
	Height            ChartUints
	PowDiff           ChartFloats
	TicketPrice       ChartUints
	StakeCount        ChartUints
	MissedVotes       ChartUints
	StakeCountVersion uint32
}

// Snip truncates the windowSet to a provided length.
func (set *windowSet) Snip(length int) {
	if length < 0 {
		length = 0
	}

	set.Time = set.Time.snip(length)
	set.Height = set.Height.snip(length)
	set.PowDiff = set.PowDiff.snip(length)
	set.TicketPrice = set.TicketPrice.snip(length)
	set.StakeCount = set.StakeCount.snip(length)
	set.MissedVotes = set.MissedVotes.snip(length)
}

// Constructor for a sized windowSet.
func newWindowSet(size int) *windowSet {
	return &windowSet{
		Time:        newChartUints(size),
		Height:      newChartUints(size),
		PowDiff:     newChartFloats(size),
		TicketPrice: newChartUints(size),
		StakeCount:  newChartUints(size),
		MissedVotes: newChartUints(size),
	}
}

// PartialWindow holds data for an incomplete difficulty window, tracked by
// the DB layer for resumability across restarts.
type PartialWindow struct {
	Height     uint64
	Time       uint64
	Price      uint64
	Diff       float64
	StakeCount uint64
}

// ChartTip holds current live (RPC) values pushed from explorer.Store().
// Chart makers use these to override the last data point so the chart's
// final value matches what the home page displays.
type ChartTip struct {
	Height      uint64
	Time        uint64
	TicketPrice uint64 // atoms
	Difficulty  float64
	PoolValue   uint64 // atoms
	CoinSupply  uint64 // atoms
}

// ChartGobject is the storage object for saving to a gob file. ChartData itself
// has a lot of extraneous fields, and also embeds sync.RWMutex, so is not
// suitable for gobbing.
type ChartGobject struct {
	Height       ChartUints
	Time         ChartUints
	PoolSize     ChartUints
	PoolValue    ChartUints
	BlockSize    ChartUints
	TxCount      ChartUints
	NewAtoms     ChartUints
	Chainwork    ChartBigInts
	Fees         ChartUints
	WindowTime   ChartUints
	PowDiff      ChartFloats
	TicketPrice  ChartUints
	StakeCount   ChartUints
	MissedVotes  ChartUints
	TotalMixed   ChartUints
	AnonymitySet ChartUints
	MinerRanges  []MinerRange
}

// The chart data is cached with the current cacheID of the zoomSet or windowSet.
type cachedChart struct {
	cacheID uint64
	data    []byte
}

// A generic structure for JSON encoding arbitrary data.
type chartResponse map[string]interface{}

// A commonly used seed for chartResponse encoding.
func binAxisSeed(bin binLevel, axis axisType) chartResponse {
	return chartResponse{
		binKey:  bin,
		axisKey: axis,
	}
}

// A generic structure for JSON encoding keyed data sets
type lengtherMap map[string]lengther

// ChartUpdater is a pair of functions for fetching and appending chart data.
// The two steps are divided so that ChartData can check whether another thread
// has updated the data during the query, and abandon an update with appropriate
// messaging.
type ChartUpdater struct {
	Tag string
	// In addition to the sql.Rows and an error, the fetcher should return a
	// context.CancelFunc if appropriate, else a dummy.
	Fetcher func(context.Context, *ChartData) (*sql.Rows, func(), error)
	// The Appender will be run under mutex lock.
	Appender func(*ChartData, *sql.Rows) error
}

// MinerRange describes the range of blocks a single miner address was active in.
type MinerRange struct {
	FirstSeen uint64
	LastUsed  uint64
}

// ChartData is a set of data used for charts. It provides methods for
// managing data validation and update concurrency, but does not perform any
// data retrieval and must be used with care to keep the data valid. The Blocks
// and Windows fields must be updated by (presumably) a database package. The
// Days data is auto-generated from the Blocks data during Lengthen-ing.
type ChartData struct {
	mtx          sync.RWMutex
	ctx          context.Context
	DiffInterval int32
	StartPOS     int32
	Blocks       *zoomSet
	Windows      *windowSet
	Days         *zoomSet
	cacheMtx     sync.RWMutex
	cache        map[string]*cachedChart
	updateMtx    sync.Mutex
	updaters     []ChartUpdater
	SKASupply    SKASupplyData
	// Lock() must be held when mutating SKASupply.
	SKASupplyMtx sync.RWMutex
	SKAFees      SKAFeesData
	// SKAFeesMtx must be held when reading or mutating SKAFees.
	SKAFeesMtx  sync.RWMutex
	MinerRanges []MinerRange
	Tip         ChartTip
	tipMtx      sync.RWMutex
}

// ValidateLengths checks that the length of all arguments is equal.
func ValidateLengths(lens ...lengther) (int, error) {
	lenLen := len(lens)
	if lenLen == 0 {
		return 0, nil
	}
	firstLen := lens[0].Length()
	shortest, longest := firstLen, firstLen
	for i, l := range lens[1:lenLen] {
		dLen := l.Length()
		if dLen != firstLen {
			log.Warnf("charts.ValidateLengths: dataset at index %d has mismatched length %d != %d", i+1, dLen, firstLen)
			if dLen < shortest {
				shortest = dLen
			} else if dLen > longest {
				longest = dLen
			}
		}
	}
	if shortest != longest {
		return shortest, fmt.Errorf("data length mismatch")
	}
	return firstLen, nil
}

// Reduce the timestamp to the previous midnight.
func midnight(t uint64) (mid uint64) {
	if t > 0 {
		mid = t - t%aDay
	}
	return
}

// Lengthen performs data validation and populates the Days zoomSet. If there is
// an update to a zoomSet or windowSet, the cacheID will be incremented.
func (charts *ChartData) Lengthen() error {
	charts.mtx.Lock()
	defer charts.mtx.Unlock()

	// Make sure the database has set an equal number of blocks in each data set.
	blocks := charts.Blocks
	shortest, err := ValidateLengths(blocks.Height, blocks.Time,
		blocks.PoolSize, blocks.PoolValue, blocks.BlockSize, blocks.TxCount,
		blocks.NewAtoms, blocks.Chainwork, blocks.Fees, blocks.TotalMixed,
		blocks.AnonymitySet)
	if err != nil {
		log.Warnf("ChartData.Lengthen: block data length mismatch detected. "+
			"Truncating blocks length to %d", shortest)
		blocks.Snip(shortest)
	}
	if shortest == 0 {
		// No blocks yet. Not an error.
		return nil
	}

	windows := charts.Windows
	shortest, err = ValidateLengths(windows.Time, windows.PowDiff,
		windows.TicketPrice, windows.StakeCount, windows.MissedVotes)
	if err != nil {
		log.Warnf("ChartData.Lengthen: window data length mismatch detected. "+
			"Truncating windows length to %d", shortest)
		charts.Windows.Snip(shortest)
	}
	if shortest == 0 {
		return fmt.Errorf("unexpected zero-length window data")
	}

	days := charts.Days

	// Get the current first and last midnight stamps.
	end := midnight(blocks.Time[len(blocks.Time)-1])
	var start uint64
	if len(days.Time) > 0 {
		// Begin the scan at the beginning of the next day. The stamps in the Time
		// set are the midnight that starts the day.
		start = days.Time[len(days.Time)-1] + aDay
	} else {
		// Start from the beginning.
		// Already checked for empty blocks above.
		start = midnight(blocks.Time[0])
	}

	// Find the index that begins new data.
	offset := 0
	for i, t := range blocks.Time {
		if t > start {
			offset = i
			break
		}
	}

	intervals := [][2]int{}
	// If there is day or more worth of new data, append to the Days zoomSet by
	// finding the first and last+1 blocks of each new day, and taking averages
	// or sums of the blocks in the interval.
	if end > start+aDay {
		next := start + aDay
		startIdx := 0
		for i, t := range blocks.Time[offset:] {
			if t >= next {
				// Once passed the next midnight, prepare a day window by storing the
				// range of indices.
				intervals = append(intervals, [2]int{startIdx + offset, i + offset})
				days.Time = append(days.Time, start)
				start = next
				next += aDay
				startIdx = i
				if t > end {
					break
				}
			}
		}

		for _, interval := range intervals {
			// For each new day, take an appropriate snapshot. Some sets use sums,
			// some use averages, and some use the last value of the day.
			days.Height = append(days.Height, uint64(interval[1]-1))
			days.PoolSize = append(days.PoolSize, blocks.PoolSize.Avg(interval[0], interval[1]))
			days.PoolValue = append(days.PoolValue, blocks.PoolValue.Avg(interval[0], interval[1]))
			days.BlockSize = append(days.BlockSize, blocks.BlockSize.Sum(interval[0], interval[1]))
			days.TxCount = append(days.TxCount, blocks.TxCount.Sum(interval[0], interval[1]))
			days.NewAtoms = append(days.NewAtoms, blocks.NewAtoms.Sum(interval[0], interval[1]))
			days.Chainwork = append(days.Chainwork, blocks.Chainwork[interval[1]])
			days.Fees = append(days.Fees, blocks.Fees.Sum(interval[0], interval[1]))
			days.TotalMixed = append(days.TotalMixed, blocks.TotalMixed.Sum(interval[0], interval[1]))
			days.AnonymitySet = append(days.AnonymitySet, blocks.AnonymitySet.Avg(interval[0], interval[1]))
		}
	}

	// Check that all relevant datasets have been updated to the same length.
	daysLen, err := ValidateLengths(days.Height, days.Time, days.PoolSize,
		days.PoolValue, days.BlockSize, days.TxCount, days.NewAtoms,
		days.Chainwork, days.Fees, days.TotalMixed, days.AnonymitySet)
	if err != nil {
		return fmt.Errorf("day bin: %v", err)
	} else if daysLen == 0 {
		log.Warnf("(*ChartData).Lengthen: Zero-length day-binned data!")
	}

	charts.cacheMtx.Lock()
	defer charts.cacheMtx.Unlock()
	// The cacheID for day-binned data, only increment the cacheID when entries
	// were added.
	if len(intervals) > 0 {
		days.cacheID++
	}
	// For blocks and windows, the cacheID is the last timestamp.
	charts.Blocks.cacheID = blocks.Time[len(blocks.Time)-1]
	// For windows, combine last timestamp with StakeCountVersion to
	// invalidate cache when live stake count updates.
	charts.Windows.cacheID = (windows.Time[len(windows.Time)-1] << 32) | uint64(windows.StakeCountVersion)
	return nil
}

// ReorgHandler handles the charts cache data reorganization. ReorgHandler
// satisfies notification.ReorgHandler, and is registered as a handler in
// main.go.
func (charts *ChartData) ReorgHandler(reorg *txhelpers.ReorgData) error {
	commonAncestorHeight := int(reorg.NewChainHeight) - len(reorg.NewChain)
	charts.mtx.Lock()
	newHeight := commonAncestorHeight + 1
	log.Debugf("ChartData.ReorgHandler snipping blocks height to %d", newHeight)
	charts.Blocks.Snip(newHeight)
	// Snip the last two days
	daysLen := len(charts.Days.Time)
	daysLen -= 2
	log.Debugf("ChartData.ReorgHandler snipping days height to %d", daysLen)
	charts.Days.Snip(daysLen)
	// Drop the last window
	windowsLen := len(charts.Windows.Time)
	windowsLen--
	log.Debugf("ChartData.ReorgHandler snipping windows to height to %d", windowsLen)
	charts.Windows.Snip(windowsLen)
	charts.mtx.Unlock()
	return nil
}

// isFileExists checks if the provided file paths exists. It returns true if
// it does exist and false if otherwise.
func isFileExists(filePath string) bool {
	_, err := os.Stat(filePath)
	return !os.IsNotExist(err)
}

// writeCacheFile creates the charts cache in the provided file path if it
// doesn't exists. It dumps the ChartsData contents using the .gob encoding.
// Drops the old .gob dump before creating a new one. Delete the old cache here
// rather than after loading so that a dump will still be available after a crash.
func (charts *ChartData) writeCacheFile(filePath string) error {
	if isFileExists(filePath) {
		// delete the old dump files before creating new ones.
		os.RemoveAll(filePath)
	}

	file, err := os.Create(filePath)
	if err != nil {
		return err
	}

	defer file.Close()

	encoder := gob.NewEncoder(file)
	charts.mtx.RLock()
	defer charts.mtx.RUnlock()
	return encoder.Encode(versionedCacheData{cacheVersion.String(), charts.gobject()})
}

// readCacheFile reads the contents of the charts cache dump file encoded in
// .gob format if it exists returns an error if otherwise.
func (charts *ChartData) readCacheFile(filePath string) error {
	file, err := os.Open(filePath)
	if err != nil {
		return err
	}

	defer func() {
		file.Close()
	}()

	var data = new(versionedCacheData)
	decoder := gob.NewDecoder(file)
	err = decoder.Decode(&data)
	if err != nil {
		return err
	}

	// If the required cache version was not found in the .gob file return an error.
	if data.Version != cacheVersion.String() {
		return fmt.Errorf("expected cache version v%s but found v%s",
			cacheVersion, data.Version)
	}

	gobject := data.Data

	charts.mtx.Lock()
	charts.Blocks.Height = gobject.Height
	charts.Blocks.Time = gobject.Time
	charts.Blocks.PoolSize = gobject.PoolSize
	charts.Blocks.PoolValue = gobject.PoolValue
	charts.Blocks.BlockSize = gobject.BlockSize
	charts.Blocks.TxCount = gobject.TxCount
	charts.Blocks.NewAtoms = gobject.NewAtoms
	charts.Blocks.Chainwork = gobject.Chainwork
	charts.Blocks.Fees = gobject.Fees
	charts.Blocks.TotalMixed = gobject.TotalMixed
	charts.Blocks.AnonymitySet = gobject.AnonymitySet
	charts.Windows.Time = gobject.WindowTime
	charts.Windows.PowDiff = gobject.PowDiff
	charts.Windows.TicketPrice = gobject.TicketPrice
	charts.Windows.StakeCount = gobject.StakeCount
	charts.Windows.MissedVotes = gobject.MissedVotes
	charts.MinerRanges = gobject.MinerRanges

	charts.mtx.Unlock()

	err = charts.Lengthen()
	if err != nil {
		log.Warnf("problem detected during (*ChartData).Lengthen. clearing datasets: %v", err)
		charts.Blocks.Snip(0)
		charts.Windows.Snip(0)
		charts.Days.Snip(0)
	}

	return nil
}

// Load loads chart data from the gob file at the specified path and performs an
// update.
func (charts *ChartData) Load(cacheDumpPath string) error {
	t := time.Now()
	defer func() {
		log.Debugf("Completed the initial chart load and update in %f s",
			time.Since(t).Seconds())
	}()

	if err := charts.readCacheFile(cacheDumpPath); err != nil {
		log.Debugf("Cache dump data loading failed: %v", err)
		// Do not return non-nil error since a new cache file will be generated.
		// Also, return only after Update has restored the charts data.
	}

	// Bring the charts up to date.
	log.Infof("Updating charts data...")
	return charts.Update()
}

// Dump dumps a ChartGobject to a gob file at the given path.
func (charts *ChartData) Dump(dumpPath string) {
	err := charts.writeCacheFile(dumpPath)
	if err != nil {
		log.Errorf("ChartData.writeCacheFile failed: %v", err)
	} else {
		log.Debug("Dumping the charts cache data was successful")
	}
}

// SetTip pushes current RPC values from explorer.Store() into the chart
// cache. Chart makers use these to ensure the last data point matches the
// home page.
func (charts *ChartData) SetTip(tip ChartTip) {
	charts.tipMtx.Lock()
	defer charts.tipMtx.Unlock()
	charts.Tip = tip
	charts.invalidateTipCharts()
}

// invalidateTipCharts removes cached chart data for charts that depend on
// Tip. Called from SetTip() so the next Chart() request re-runs the maker
// with fresh values rather than serving stale cached data whose cacheID
// hasn't changed yet (window/day bins only update cacheID at boundaries).
func (charts *ChartData) invalidateTipCharts() {
	charts.cacheMtx.Lock()
	defer charts.cacheMtx.Unlock()
	// Window-binned charts that use Tip
	for _, chartID := range []string{TicketPrice, POWDifficulty} {
		for _, axis := range []axisType{TimeAxis, HeightAxis} {
			delete(charts.cache, cacheKey(chartID, WindowBin, axis, DefaultInterval))
		}
	}
	// Block/day-binned staked-coins chart that uses Tip
	for _, bin := range []binLevel{BlockBin, DayBin} {
		for _, axis := range []axisType{TimeAxis, HeightAxis} {
			delete(charts.cache, cacheKey(PercentStaked, bin, axis, DefaultInterval))
		}
	}
}

// TriggerUpdate triggers (*ChartData).Update.
func (charts *ChartData) TriggerUpdate(_ string, _ uint32) error {
	if err := charts.Update(); err != nil {
		// Only log errors from ChartsData.Update. TODO: make this more severe.
		log.Errorf("(*ChartData).Update failed: %v", err)
	}
	return nil
}

func (charts *ChartData) gobject() *ChartGobject {
	return &ChartGobject{
		Height:       charts.Blocks.Height,
		Time:         charts.Blocks.Time,
		PoolSize:     charts.Blocks.PoolSize,
		PoolValue:    charts.Blocks.PoolValue,
		BlockSize:    charts.Blocks.BlockSize,
		TxCount:      charts.Blocks.TxCount,
		NewAtoms:     charts.Blocks.NewAtoms,
		Chainwork:    charts.Blocks.Chainwork,
		Fees:         charts.Blocks.Fees,
		TotalMixed:   charts.Blocks.TotalMixed,
		AnonymitySet: charts.Blocks.AnonymitySet,
		WindowTime:   charts.Windows.Time,
		PowDiff:      charts.Windows.PowDiff,
		TicketPrice:  charts.Windows.TicketPrice,
		StakeCount:   charts.Windows.StakeCount,
		MissedVotes:  charts.Windows.MissedVotes,
		MinerRanges:  charts.MinerRanges,
	}
}

// StateID returns a unique (enough) ID associated with the state of the Blocks
// data in a thread-safe way.
func (charts *ChartData) StateID() uint64 {
	charts.mtx.RLock()
	defer charts.mtx.RUnlock()
	return charts.stateID()
}

// stateID returns a unique (enough) ID associated with the state of the Blocks
// data.
func (charts *ChartData) stateID() uint64 {
	timeLen := len(charts.Blocks.Time)
	if timeLen > 0 {
		return charts.Blocks.Time[timeLen-1]
	}
	return 0
}

// ValidState checks whether the provided chartID is still valid. ValidState
// should be used under at least a (*ChartData).RLock.
func (charts *ChartData) validState(stateID uint64) bool {
	return charts.stateID() == stateID
}

// SetMinerRanges replaces the MinerRanges data. Must be called under write lock.
func (charts *ChartData) SetMinerRanges(ranges []MinerRange) {
	charts.MinerRanges = ranges
}

// activeMinersCounts computes the per-block active miner count for the given
// lookback interval using an event sweep over miner range data. The lookback
// is determined empirically from actual block timestamps rather than a fixed
// block count, ensuring correctness regardless of block production rate.
//
// This is a single-interval approximation: each address stores only
// (first_seen, last_used), so a miner that mined at heights 100 and then 500
// is counted as active for every block in between, including idle gaps. The
// home card's CountActiveMiners query uses the same data and a strict >
// boundary to roughly align with the chart, but a sub-block-boundary
// discrepancy (height vs time axis) is inherent to this data model.
func (charts *ChartData) activeMinersCounts(numBlocks int, interval intervalType) []uint64 {
	if numBlocks == 0 || len(charts.MinerRanges) == 0 {
		return make([]uint64, numBlocks)
	}

	var duration uint64
	if interval != AllInterval {
		switch interval {
		case YearInterval:
			duration = uint64(365 * 24 * 60 * 60)
		case WeekInterval:
			duration = uint64(7 * 24 * 60 * 60)
		case DayInterval:
			duration = uint64(24 * 60 * 60)
		default:
			duration = uint64(7 * 24 * 60 * 60)
		}
	}

	type ev struct {
		height int
		delta  int32
	}
	events := make([]ev, 0, 2*len(charts.MinerRanges))
	for _, m := range charts.MinerRanges {
		if int(m.FirstSeen) >= numBlocks {
			continue
		}
		events = append(events, ev{height: int(m.FirstSeen), delta: 1})
		if interval != AllInterval {
			used := int(m.LastUsed)
			if used >= numBlocks {
				used = numBlocks - 1
			}
			tLast := charts.Blocks.Time[used]
			tExit := tLast + duration
			exitHeight := sort.Search(len(charts.Blocks.Time), func(i int) bool {
				return charts.Blocks.Time[i] > tExit
			})
			if exitHeight < numBlocks {
				events = append(events, ev{height: exitHeight, delta: -1})
			}
		}
	}

	sort.Slice(events, func(i, j int) bool { return events[i].height < events[j].height })

	counts := make([]uint64, numBlocks)
	var current uint64
	evIdx := 0
	for h := 0; h < numBlocks; h++ {
		for evIdx < len(events) && events[evIdx].height == h {
			if events[evIdx].delta > 0 {
				current += uint64(events[evIdx].delta)
			} else {
				current -= uint64(-events[evIdx].delta)
			}
			evIdx++
		}
		counts[h] = current
	}
	return counts
}

// Height is the height of the blocks data. Data is assumed to be complete and
// without extraneous entries, which means that the (zoomSet).Height does not
// need to be populated for (ChartData).Blocks because the height is just
// len(Blocks.*)-1.
func (charts *ChartData) Height() int32 {
	charts.mtx.RLock()
	defer charts.mtx.RUnlock()
	return int32(len(charts.Blocks.Time)) - 1
}

// FeesTip is the height of the Fees data.
func (charts *ChartData) FeesTip() int32 {
	charts.mtx.RLock()
	defer charts.mtx.RUnlock()
	return int32(len(charts.Blocks.Fees)) - 1
}

// TotalMixedTip is the height of the CoinJoin Total Mixed data
func (charts *ChartData) TotalMixedTip() int32 {
	charts.mtx.RLock()
	defer charts.mtx.RUnlock()
	return int32(len(charts.Blocks.TotalMixed)) - 1
}

// AnonymitySetTip is the height of the anonymity set
func (charts *ChartData) AnonymitySetTip() int32 {
	charts.mtx.RLock()
	defer charts.mtx.RUnlock()
	return int32(len(charts.Blocks.AnonymitySet)) - 1
}

// AnonymitySet is the last known anonymity set size.
func (charts *ChartData) AnonymitySet() uint64 {
	charts.mtx.RLock()
	defer charts.mtx.RUnlock()
	count := len(charts.Blocks.AnonymitySet)
	if count == 0 {
		return 0
	}
	return charts.Blocks.AnonymitySet[count-1]
}

// NewAtomsTip is the height of the NewAtoms data.
func (charts *ChartData) NewAtomsTip() int32 {
	charts.mtx.RLock()
	defer charts.mtx.RUnlock()
	return int32(len(charts.Blocks.NewAtoms)) - 1
}

// TicketPriceTip is the height of the TicketPrice data.
func (charts *ChartData) TicketPriceTip() int32 {
	charts.mtx.RLock()
	defer charts.mtx.RUnlock()
	return int32(len(charts.Windows.TicketPrice))*charts.DiffInterval - 1
}

// SKASupplyExists checks if SKA supply data exists for the given coin type.
func (charts *ChartData) SKASupplyExists(coinType uint8) bool {
	if charts == nil {
		return false
	}
	charts.SKASupplyMtx.RLock()
	defer charts.SKASupplyMtx.RUnlock()
	if charts.SKASupply == nil {
		return false
	}
	data, ok := charts.SKASupply[coinType]
	return ok && len(data.Timestamps) > 0
}

// SKASupplyHeight returns the height of the last recorded block for the given coin type.
func (charts *ChartData) SKASupplyHeight(coinType uint8) (int64, bool) {
	charts.SKASupplyMtx.RLock()
	defer charts.SKASupplyMtx.RUnlock()
	if charts.SKASupply == nil {
		return 0, false
	}
	data, ok := charts.SKASupply[coinType]
	if !ok || len(data.Heights) == 0 {
		return 0, false
	}
	return data.Heights[len(data.Heights)-1], true
}

// SKAFeesExists checks if SKA fee data exists for the given coin type.
func (charts *ChartData) SKAFeesExists(coinType uint8) bool {
	if charts == nil {
		return false
	}
	charts.SKAFeesMtx.RLock()
	defer charts.SKAFeesMtx.RUnlock()
	if charts.SKAFees == nil {
		return false
	}
	data, ok := charts.SKAFees[coinType]
	return ok && len(data.Fees) > 0
}

// SKAFeesHeight returns the height of the last recorded block for the given coin type.
func (charts *ChartData) SKAFeesHeight(coinType uint8) (int64, bool) {
	charts.SKAFeesMtx.RLock()
	defer charts.SKAFeesMtx.RUnlock()
	if charts.SKAFees == nil {
		return 0, false
	}
	data, ok := charts.SKAFees[coinType]
	if !ok || len(data.Heights) == 0 {
		return 0, false
	}
	return data.Heights[len(data.Heights)-1], true
}

// PoolSizeTip is the height of the PoolSize data.
func (charts *ChartData) PoolSizeTip() int32 {
	charts.mtx.RLock()
	defer charts.mtx.RUnlock()
	return int32(len(charts.Blocks.PoolSize)) - 1
}

// MissedVotesTip is the height of the MissedVotes data.
func (charts *ChartData) MissedVotesTip() int32 {
	charts.mtx.RLock()
	defer charts.mtx.RUnlock()
	return int32(len(charts.Windows.MissedVotes))*charts.DiffInterval - 1
}

// AddUpdater adds a ChartUpdater to the Updaters slice. Updaters are run
// sequentially during (*ChartData).Update.
func (charts *ChartData) AddUpdater(updater ChartUpdater) {
	charts.updateMtx.Lock()
	charts.updaters = append(charts.updaters, updater)
	charts.updateMtx.Unlock()
}

// Update refreshes chart data by calling the ChartUpdaters sequentially. The
// Update is abandoned with a warning if stateID changes while running a Fetcher
// (likely due to a new update starting during a query).
func (charts *ChartData) Update() error {
	// Block simultaneous updates.
	charts.updateMtx.Lock()
	defer charts.updateMtx.Unlock()

	t := time.Now()
	log.Debugf("Running charts updaters for data at height %d...", charts.Height())

	for _, updater := range charts.updaters {
		ti := time.Now()
		stateID := charts.StateID()
		// The Appender checks rows.Err
		// nolint:rowserrcheck
		rows, cancel, err := updater.Fetcher(charts.ctx, charts)
		if err != nil {
			err = fmt.Errorf("error encountered during charts %s update. aborting update: %v", updater.Tag, err)
		} else {
			charts.mtx.Lock()
			if !charts.validState(stateID) {
				err = fmt.Errorf("state change detected during charts %s update. aborting update", updater.Tag)
			} else {
				err = updater.Appender(charts, rows)
				if err != nil {
					err = fmt.Errorf("error detected during charts %s append. aborting update: %v", updater.Tag, err)
				}
			}
			charts.mtx.Unlock()
		}
		cancel()
		if err != nil {
			return err
		}
		log.Debugf(" - Chart updater %q completed in %f seconds.",
			updater.Tag, time.Since(ti).Seconds())
	}

	log.Debugf("Charts updaters complete at height %d in %f seconds.",
		charts.Height(), time.Since(t).Seconds())

	// Since the charts db data query is complete. Update chart.Days derived dataset.
	if err := charts.Lengthen(); err != nil {
		return fmt.Errorf("(*ChartData).Lengthen failed: %v", err)
	}
	return nil
}

// NewChartData constructs a new ChartData.
func NewChartData(ctx context.Context, height uint32, chainParams *chaincfg.Params) *ChartData {
	base64Height := int64(height)
	// Allocate datasets for at least as many blocks as in a sdiff window.
	if base64Height < chainParams.StakeDiffWindowSize {
		height = uint32(chainParams.StakeDiffWindowSize)
	}
	genesis := chainParams.GenesisBlock.Header.Timestamp
	// Start datasets at 25% larger than height. This matches golang's default
	// capacity size increase for slice lengths > 1024
	// https://github.com/golang/go/blob/87e48c5afdcf5e01bb2b7f51b7643e8901f4b7f9/src/runtime/slice.go#L100-L112
	size := int(height * 5 / 4)
	days := int(time.Since(genesis)/time.Hour/24)*5/4 + 1 // at least one day
	windows := int(base64Height/chainParams.StakeDiffWindowSize+1) * 5 / 4

	return &ChartData{
		ctx:          ctx,
		DiffInterval: int32(chainParams.StakeDiffWindowSize),
		StartPOS:     int32(chainParams.StakeValidationHeight),
		Blocks:       newBlockSet(size),
		Windows:      newWindowSet(windows),
		Days:         newDaySet(days),
		cache:        make(map[string]*cachedChart),
		updaters:     make([]ChartUpdater, 0),
		SKASupply:    make(SKASupplyData),
		SKAFees:      make(SKAFeesData),
	}
}

// A cacheKey is used to specify cached data of a given type and BinLevel.
func cacheKey(chartID string, bin binLevel, axis axisType, interval intervalType) string {
	return chartID + "-" + string(bin) + "-" + string(axis) + "-" + string(interval)
}

// Grabs the cacheID associated with the provided BinLevel. Should
// be called under at least a (ChartData).cacheMtx.RLock.
func (charts *ChartData) cacheID(bin binLevel) uint64 {
	switch bin {
	case BlockBin:
		return charts.Blocks.cacheID
	case DayBin:
		return charts.Days.cacheID
	case WindowBin:
		return charts.Windows.cacheID
	}
	return 0
}

// Grab the cached data, if it exists. The cacheID is returned as a convenience.
func (charts *ChartData) getCache(chartID string, bin binLevel, axis axisType, interval intervalType) (data *cachedChart, found bool, cacheID uint64) {
	// Ignore zero length since bestHeight would just be set to zero anyway.
	ck := cacheKey(chartID, bin, axis, interval)
	charts.cacheMtx.RLock()
	defer charts.cacheMtx.RUnlock()
	cacheID = charts.cacheID(bin)
	data, found = charts.cache[ck]
	return
}

// Store the chart associated with the provided type and BinLevel.
func (charts *ChartData) cacheChart(chartID string, bin binLevel, axis axisType, interval intervalType, data []byte) {
	ck := cacheKey(chartID, bin, axis, interval)
	charts.cacheMtx.Lock()
	defer charts.cacheMtx.Unlock()
	// Using the current best cacheID. This leaves open the small possibility that
	// the cacheID is wrong, if the cacheID has been updated between the
	// ChartMaker and here. This would just cause a one block delay.
	charts.cache[ck] = &cachedChart{
		cacheID: charts.cacheID(bin),
		data:    data,
	}
}

// ChartMaker is a function that accepts a chart type and BinLevel, and returns
// a JSON-encoded chartResponse.
type ChartMaker func(charts *ChartData, bin binLevel, axis axisType, interval intervalType) ([]byte, error)

var chartMakers = map[string]ChartMaker{
	BlockSize:       blockSizeChart,
	BlockChainSize:  blockchainSizeChart,
	ChainWork:       chainWorkChart,
	CoinSupply:      coinSupplyChart,
	DurationBTW:     durationBTWChart,
	HashRate:        hashRateChart,
	POWDifficulty:   powDifficultyChart,
	TicketPrice:     ticketPriceChart,
	TxCount:         txCountChart,
	Fees:            feesChart,
	AnonymitySet:    anonymitySetChart,
	TicketPoolSize:  ticketPoolSizeChart,
	TicketPoolValue: poolValueChart,
	WindMissedVotes: missedVotesChart,
	PercentStaked:   stakedCoinsChart,
}

// Chart will return a JSON-encoded chartResponse of the provided chart,
// binLevel, axis, and interval (TimeAxis, HeightAxis). binString is ignored for
// window-binned charts.
func (charts *ChartData) Chart(chartID, binString, axisString, intervalString string) ([]byte, error) {
	if isWindowBin(chartID) {
		binString = string(WindowBin)
	}
	bin := ParseBin(binString)
	axis := ParseAxis(axisString)
	interval := ParseInterval(intervalString)
	// Only the hashrate chart consumes the interval parameter; waste-free
	// caching means other chart keys should not vary by interval.
	if chartID != HashRate {
		interval = DefaultInterval
	}
	cache, found, cacheID := charts.getCache(chartID, bin, axis, interval)
	if found && cache.cacheID == cacheID {
		return cache.data, nil
	}
	maker, hasMaker := chartMakers[chartID]
	if !hasMaker {
		// Check if it's an SKA supply chart
		if IsSKASupplyChart(chartID) {
			return charts.skaSupplyChart(chartID, bin, axis)
		}
		// Check if it's an SKA fee chart
		if IsSKAFeeChart(chartID) {
			return charts.skaFeeChart(chartID, bin, axis)
		}
		return nil, UnknownChartErr
	}
	// Do the locking here, rather than in encode, so that the helper functions
	// (accumulate, btw) are run under lock.
	charts.mtx.RLock()
	data, err := maker(charts, bin, axis, interval)
	charts.mtx.RUnlock()
	if err != nil {
		return nil, err
	}
	charts.cacheChart(chartID, bin, axis, interval, data)
	return data, nil
}

// Encode the data sets. Optionally add arbitrary additional data as part of the
// chartResponse seed. A nil seed is allowed.
func encode(sets lengtherMap, seed chartResponse) ([]byte, error) {
	if len(sets) == 0 {
		return nil, fmt.Errorf("encode called without arguments")
	}
	smaller := -1
	for _, set := range sets {
		l := set.Length()
		if smaller == -1 {
			smaller = l
		} else if l < smaller {
			smaller = l
		}
	}
	if len(seed) == 0 {
		seed = make(chartResponse, len(sets))
	}
	for k, v := range sets {
		seed[k] = v.Truncate(smaller)
	}
	return json.Marshal(seed)
}

// Each point is translated to the sum of all points before and itself.
func accumulate(data ChartUints) ChartUints {
	d := make(ChartUints, 0, len(data))
	var accumulator uint64
	for _, v := range data {
		accumulator += v
		d = append(d, accumulator)
	}
	return d
}

// genesisGapThreshold is the inter-block interval (seconds) above which the
// genesis→block-1 gap is treated as a pre-launch dead period rather than a
// real mining interval. On a healthy network block 0→1 is on the order of the
// target block time (minutes), so the threshold is never crossed; only a long
// pre-launch gap (e.g. Monetarium testnet's ~205 days) exceeds one hour.
const genesisGapThreshold = 3600

// NormalizeGenesisBlockTime collapses an abnormally large genesis→block-1 gap
// in a block-time series so that time-axis charts begin at real network start
// rather than the genesis date, and the duration-between-blocks chart does not
// show the entire pre-launch gap as its first interval.
//
// It mutates times[0] in place, moving it to just before block 1, and returns
// whether a correction was applied. It is genesis-only and self-no-op: after a
// correction the gap is ~1s (< genesisGapThreshold), so re-running on
// incremental syncs and after gob restarts changes nothing. A chain with only
// the genesis block (len < 2) is left untouched so times[1] is never indexed.
//
// This is a derived-cache correction only; it must never feed back into the
// canonical block timestamp in Postgres or the block-details/API responses.
func NormalizeGenesisBlockTime(times ChartUints) bool {
	if len(times) < 2 {
		return false
	}
	if times[1]-times[0] <= genesisGapThreshold {
		return false
	}
	// Keep timestamps strictly increasing (gap of 1s) so the height alignment
	// and day-bin start both fold onto block 1's day.
	times[0] = times[1] - 1
	return true
}

// Translate the times slice to a slice of differences. The original dataset
// minus the first element is returned for convenience.
func blockTimes(blocks ChartUints) (ChartUints, ChartUints) {
	times := make(ChartUints, 0, len(blocks))
	dataLen := len(blocks)
	if dataLen < 2 {
		// Fewer than two data points is invalid for btw. Return empty data sets so
		// that the JSON encoding will have the correct type.
		return times, times
	}
	last := blocks[0]
	for _, v := range blocks[1:] {
		dif := v - last
		if int64(dif) < 0 {
			dif = 0
		}
		times = append(times, dif)
		last = v
	}
	return blocks[1:], times
}

// Take the average block times on the intervals defined by the ticks argument.
func avgBlockTimes(ticks, blocks ChartUints) (ChartUints, ChartUints) {
	if len(ticks) < 2 {
		// Return empty arrays so that JSON-encoding will have the correct type.
		return ChartUints{}, ChartUints{}
	}
	avgDiffs := make(ChartUints, 0, len(ticks)-1)
	times := make(ChartUints, 0, len(ticks)-1)
	nextIdx := 1
	workingOn := ticks[0]
	next := ticks[nextIdx]
	lastIdx := 0
	for i, t := range blocks {
		if t > next {
			_, pts := blockTimes(blocks[lastIdx:i])
			avgDiffs = append(avgDiffs, pts.Avg(0, len(pts)))
			times = append(times, workingOn)
			nextIdx++
			if nextIdx > len(ticks)-1 {
				break
			}
			lastIdx = i
			next = ticks[nextIdx]
			workingOn = next
		}
	}
	return times, avgDiffs
}

func blockSizeChart(charts *ChartData, bin binLevel, axis axisType, _ intervalType) ([]byte, error) {
	seed := binAxisSeed(bin, axis)
	switch bin {
	case BlockBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				sizeKey: charts.Blocks.BlockSize,
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey: charts.Blocks.Time,
				sizeKey: charts.Blocks.BlockSize,
			}, seed)
		}
	case DayBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				heightKey: charts.Days.Height,
				sizeKey:   charts.Days.BlockSize,
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey: charts.Days.Time,
				sizeKey: charts.Days.BlockSize,
			}, seed)
		}
	}
	return nil, InvalidBinErr
}

func blockchainSizeChart(charts *ChartData, bin binLevel, axis axisType, _ intervalType) ([]byte, error) {
	seed := binAxisSeed(bin, axis)
	switch bin {
	case BlockBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				sizeKey: accumulate(charts.Blocks.BlockSize),
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey: charts.Blocks.Time,
				sizeKey: accumulate(charts.Blocks.BlockSize),
			}, seed)
		}
	case DayBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				heightKey: charts.Days.Height,
				sizeKey:   accumulate(charts.Days.BlockSize),
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey: charts.Days.Time,
				sizeKey: accumulate(charts.Days.BlockSize),
			}, seed)
		}
	}
	return nil, InvalidBinErr
}

func bigIntsToFloats(data ChartBigInts) ChartFloats {
	out := make(ChartFloats, len(data))
	for i, v := range data {
		f, _ := new(big.Float).SetInt(v).Float64()
		out[i] = f
	}
	return out
}

func chainWorkChart(charts *ChartData, bin binLevel, axis axisType, _ intervalType) ([]byte, error) {
	seed := binAxisSeed(bin, axis)
	switch bin {
	case BlockBin:
		work := bigIntsToFloats(charts.Blocks.Chainwork)
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				workKey: work,
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey: charts.Blocks.Time,
				workKey: work,
			}, seed)
		}
	case DayBin:
		work := bigIntsToFloats(charts.Days.Chainwork)
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				heightKey: charts.Days.Height,
				workKey:   work,
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey: charts.Days.Time,
				workKey: work,
			}, seed)
		}
	}
	return nil, InvalidBinErr
}

func coinSupplyChart(charts *ChartData, bin binLevel, axis axisType, _ intervalType) ([]byte, error) {
	seed := binAxisSeed(bin, axis)
	switch bin {
	case BlockBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				supplyKey:       accumulate(charts.Blocks.NewAtoms),
				anonymitySetKey: charts.Blocks.AnonymitySet,
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey:         charts.Blocks.Time,
				supplyKey:       accumulate(charts.Blocks.NewAtoms),
				anonymitySetKey: charts.Blocks.AnonymitySet,
			}, seed)
		}
	case DayBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				heightKey:       charts.Days.Height,
				supplyKey:       accumulate(charts.Days.NewAtoms),
				anonymitySetKey: charts.Days.AnonymitySet,
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey:         charts.Days.Time,
				supplyKey:       accumulate(charts.Days.NewAtoms),
				anonymitySetKey: charts.Days.AnonymitySet,
				heightKey:       charts.Days.Height,
			}, seed)
		}
	}
	return nil, InvalidBinErr
}

func durationBTWChart(charts *ChartData, bin binLevel, axis axisType, _ intervalType) ([]byte, error) {
	seed := binAxisSeed(bin, axis)
	switch bin {
	case BlockBin:
		switch axis {
		case HeightAxis:
			_, diffs := blockTimes(charts.Blocks.Time)
			return encode(lengtherMap{
				durationKey: diffs,
			}, seed)
		default:
			times, diffs := blockTimes(charts.Blocks.Time)
			return encode(lengtherMap{
				timeKey:     times,
				durationKey: diffs,
			}, seed)
		}
	case DayBin:
		switch axis {
		case HeightAxis:
			if len(charts.Days.Height) < 2 {
				return nil, fmt.Errorf("found the length of charts.Days.Height slice to be less than 2")
			}
			_, diffs := avgBlockTimes(charts.Days.Time, charts.Blocks.Time)
			return encode(lengtherMap{
				heightKey:   charts.Days.Height[:len(charts.Days.Height)-1],
				durationKey: diffs,
			}, seed)
		default:
			times, diffs := avgBlockTimes(charts.Days.Time, charts.Blocks.Time)
			return encode(lengtherMap{
				timeKey:     times,
				durationKey: diffs,
			}, seed)
		}
	}
	return nil, InvalidBinErr
}

// hashrate converts the provided chainwork data to hashrate data. Since
// hashrates are averaged over HashrateAvgLength blocks, the returned slice
// is HashrateAvgLength shorter than the provided chainwork. A time slice is
// required as well, and a truncated time slice with the same length as the
// hashrate slice is returned.
func hashrate(time ChartUints, chainwork ChartBigInts) (ChartUints, ChartFloats) {
	hrLen := len(chainwork) - HashrateAvgLength
	if hrLen <= 0 {
		return newChartUints(0), newChartFloats(0)
	}
	t := make(ChartUints, 0, hrLen)
	y := make(ChartFloats, 0, hrLen)
	var rotator [HashrateAvgLength]*big.Int
	for i, work := range chainwork {
		idx := i % HashrateAvgLength
		rotator[idx] = work
		if i >= HashrateAvgLength {
			lastWork := rotator[(idx+1)%HashrateAvgLength]
			lastTime := time[i-HashrateAvgLength]
			thisTime := time[i]
			t = append(t, thisTime)
			workDiff := new(big.Int).Sub(work, lastWork)
			rate := new(big.Float).Quo(
				new(big.Float).SetInt(workDiff),
				new(big.Float).SetUint64(thisTime-lastTime),
			)
			f, _ := rate.Float64()
			y = append(y, f)
		}
	}
	return t, y
}

// dailyHashrate converts the provided daily chainwork data to hashrate data.
// Since hashrates are based on a difference, the returned arrays will be 1
// element fewer than the number of days. A truncated time slice with the same
// length as the hashrate slice is returned.
func dailyHashrate(time ChartUints, chainwork ChartBigInts) (ChartUints, ChartFloats) {
	if len(time) == 0 || len(chainwork) == 0 {
		return ChartUints{}, ChartFloats{}
	}
	times := make(ChartUints, 0, len(time)-1)
	rates := make(ChartFloats, 0, len(time)-1)
	var dupes int
	for i, t := range time[1:] {
		tDiff := int64(t - time[i])
		if tDiff <= 0 {
			tDiff = aDay
			dupes++
		}
		workDiff := new(big.Int).Sub(chainwork[i+1], chainwork[i])
		rate := new(big.Float).Quo(
			new(big.Float).SetInt(workDiff),
			new(big.Float).SetUint64(uint64(tDiff)),
		)
		f, _ := rate.Float64()
		rates = append(rates, f)
		times = append(times, t)
	}
	if dupes > 0 {
		log.Warnf("charts: dailyHashrate: %d duplicate timestamp(s) found")
	}
	return times, rates
}

func hashRateChart(charts *ChartData, bin binLevel, axis axisType, interval intervalType) ([]byte, error) {
	seed := binAxisSeed(bin, axis)
	switch bin {
	case BlockBin:
		if len(charts.Blocks.Time) < 2 {
			return nil, fmt.Errorf("Not enough blocks to calculate hashrate")
		}
		seed[offsetKey] = HashrateAvgLength
		times, rates := hashrate(charts.Blocks.Time, charts.Blocks.Chainwork)

		numBlocks := len(charts.Blocks.Time)
		activeFull := charts.activeMinersCounts(numBlocks, interval)
		active := ChartUints(activeFull)
		if numBlocks > HashrateAvgLength {
			active = activeFull[HashrateAvgLength:]
		}

		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				rateKey:         rates,
				activeMinersKey: active,
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey:         times,
				rateKey:         rates,
				activeMinersKey: active,
			}, seed)
		}
	case DayBin:
		if len(charts.Days.Time) < 2 {
			return nil, fmt.Errorf("Not enough days to calculate hashrate")
		}
		seed[offsetKey] = 1
		times, rates := dailyHashrate(charts.Days.Time, charts.Days.Chainwork)

		numBlocks := len(charts.Blocks.Time)
		activeFull := charts.activeMinersCounts(numBlocks, interval)
		dailyActive := make(ChartUints, len(charts.Days.Height)-1)
		for i, h := range charts.Days.Height[1:] {
			if int(h) < len(activeFull) {
				dailyActive[i] = activeFull[h]
			}
		}

		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				heightKey:       charts.Days.Height[1:],
				rateKey:         rates,
				activeMinersKey: dailyActive,
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey:         times,
				rateKey:         rates,
				activeMinersKey: dailyActive,
			}, seed)
		}
	}
	return nil, InvalidBinErr
}

func powDifficultyChart(charts *ChartData, _ binLevel, axis axisType, _ intervalType) ([]byte, error) {
	// Pow Difficulty only has window level bin, so all others are ignored.
	seed := chartResponse{windowKey: charts.DiffInterval}

	charts.tipMtx.RLock()
	tip := charts.Tip
	charts.tipMtx.RUnlock()

	diffData := charts.Windows.PowDiff
	if tip.Difficulty > 0 && len(diffData) > 0 {
		diffData = append(ChartFloats(nil), diffData...)
		diffData[len(diffData)-1] = tip.Difficulty
	}

	switch axis {
	case HeightAxis:
		return encode(lengtherMap{
			diffKey: diffData,
		}, seed)
	default:
		return encode(lengtherMap{
			timeKey: charts.Windows.Time,
			diffKey: diffData,
		}, seed)
	}
}

func ticketPriceChart(charts *ChartData, _ binLevel, axis axisType, _ intervalType) ([]byte, error) {
	// Ticket price only has window level bin, so all others are ignored.
	seed := chartResponse{windowKey: charts.DiffInterval}

	charts.tipMtx.RLock()
	tip := charts.Tip
	charts.tipMtx.RUnlock()

	priceData := charts.Windows.TicketPrice
	countData := charts.Windows.StakeCount
	if tip.TicketPrice > 0 && len(priceData) > 0 {
		priceData = append(ChartUints(nil), priceData...)
		priceData[len(priceData)-1] = tip.TicketPrice
	}

	switch axis {
	case HeightAxis:
		return encode(lengtherMap{
			priceKey: priceData,
			countKey: countData,
		}, seed)
	default:
		return encode(lengtherMap{
			timeKey:  charts.Windows.Time,
			priceKey: priceData,
			countKey: countData,
		}, seed)
	}
}

func txCountChart(charts *ChartData, bin binLevel, axis axisType, _ intervalType) ([]byte, error) {
	seed := binAxisSeed(bin, axis)
	switch bin {
	case BlockBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				countKey: charts.Blocks.TxCount,
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey:  charts.Blocks.Time,
				countKey: charts.Blocks.TxCount,
			}, seed)
		}
	case DayBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				heightKey: charts.Days.Height,
				countKey:  charts.Days.TxCount,
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey:  charts.Days.Time,
				countKey: charts.Days.TxCount,
			}, seed)
		}
	}
	return nil, InvalidBinErr
}

func feesChart(charts *ChartData, bin binLevel, axis axisType, _ intervalType) ([]byte, error) {
	seed := binAxisSeed(bin, axis)
	switch bin {
	case BlockBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				feesKey: charts.Blocks.Fees,
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey: charts.Blocks.Time,
				feesKey: charts.Blocks.Fees,
			}, seed)
		}
	case DayBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				heightKey: charts.Days.Height,
				feesKey:   charts.Days.Fees,
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey: charts.Days.Time,
				feesKey: charts.Days.Fees,
			}, seed)
		}
	}
	return nil, InvalidBinErr
}

func anonymitySetChart(charts *ChartData, bin binLevel, axis axisType, _ intervalType) ([]byte, error) {
	seed := binAxisSeed(bin, axis)
	switch bin {
	case BlockBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				heightKey:       charts.Blocks.Height,
				anonymitySetKey: charts.Blocks.TotalMixed,
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey:         charts.Blocks.Time,
				anonymitySetKey: charts.Blocks.TotalMixed,
			}, seed)
		}
	case DayBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				heightKey:       charts.Days.Height,
				anonymitySetKey: charts.Days.TotalMixed,
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey:         charts.Days.Time,
				anonymitySetKey: charts.Days.TotalMixed,
			}, seed)
		}
	}
	return nil, InvalidBinErr
}

func ticketPoolSizeChart(charts *ChartData, bin binLevel, axis axisType, _ intervalType) ([]byte, error) {
	seed := binAxisSeed(bin, axis)
	switch bin {
	case BlockBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				countKey: charts.Blocks.PoolSize,
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey:  charts.Blocks.Time,
				countKey: charts.Blocks.PoolSize,
			}, seed)
		}
	case DayBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				heightKey: charts.Days.Height,
				countKey:  charts.Days.PoolSize,
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey:  charts.Days.Time,
				countKey: charts.Days.PoolSize,
			}, seed)
		}
	}
	return nil, InvalidBinErr
}

func poolValueChart(charts *ChartData, bin binLevel, axis axisType, _ intervalType) ([]byte, error) {
	seed := binAxisSeed(bin, axis)
	switch bin {
	case BlockBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				poolValKey: charts.Blocks.PoolValue,
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey:    charts.Blocks.Time,
				poolValKey: charts.Blocks.PoolValue,
			}, seed)
		}
	case DayBin:
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				heightKey:  charts.Days.Height,
				poolValKey: charts.Days.PoolValue,
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey:    charts.Days.Time,
				poolValKey: charts.Days.PoolValue,
			}, seed)
		}
	}
	return nil, InvalidBinErr
}

func missedVotesChart(charts *ChartData, _ binLevel, axis axisType, _ intervalType) ([]byte, error) {
	prestakeWindows := int(charts.StartPOS / charts.DiffInterval)
	if prestakeWindows >= len(charts.Windows.MissedVotes) ||
		prestakeWindows >= len(charts.Windows.Time) {
		prestakeWindows = 0
	}
	seed := chartResponse{
		windowKey: charts.DiffInterval,
		offsetKey: prestakeWindows,
	}
	switch axis {
	case HeightAxis:
		return encode(lengtherMap{
			missedKey: charts.Windows.MissedVotes[prestakeWindows:],
		}, seed)
	default:
		return encode(lengtherMap{
			timeKey:   charts.Windows.Time[prestakeWindows:],
			missedKey: charts.Windows.MissedVotes[prestakeWindows:],
		}, seed)
	}
}

func stakedCoinsChart(charts *ChartData, bin binLevel, axis axisType, _ intervalType) ([]byte, error) {
	seed := binAxisSeed(bin, axis)

	charts.tipMtx.RLock()
	tip := charts.Tip
	charts.tipMtx.RUnlock()

	// Block/day-binned data has no window concept, so the override guard
	// is whether a tip was pushed, not whether a partial window exists.
	// The last block's accumulated supply/pool-value may be stale relative
	// to the live RPC values. Unlike window charts, this override applies
	// to both time and height axis — it updates the last point in-place
	// rather than appending, so there's no missing x-position problem.
	override := tip.CoinSupply > 0

	switch bin {
	case BlockBin:
		circulation := accumulate(charts.Blocks.NewAtoms)
		poolVal := charts.Blocks.PoolValue
		if override && len(circulation) > 0 && len(poolVal) > 0 {
			circulation[len(circulation)-1] = tip.CoinSupply
			poolVal = append(ChartUints(nil), poolVal...)
			poolVal[len(poolVal)-1] = tip.PoolValue
		}
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				circulationKey: circulation,
				poolValKey:     poolVal,
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey:        charts.Blocks.Time,
				circulationKey: circulation,
				poolValKey:     poolVal,
			}, seed)
		}
	case DayBin:
		circulation := accumulate(charts.Days.NewAtoms)
		poolVal := charts.Days.PoolValue
		if override && len(circulation) > 0 && len(poolVal) > 0 {
			circulation[len(circulation)-1] = tip.CoinSupply
			poolVal = append(ChartUints(nil), poolVal...)
			poolVal[len(poolVal)-1] = tip.PoolValue
		}
		switch axis {
		case HeightAxis:
			return encode(lengtherMap{
				heightKey:      charts.Days.Height,
				circulationKey: circulation,
				poolValKey:     poolVal,
			}, seed)
		default:
			return encode(lengtherMap{
				timeKey:        charts.Days.Time,
				circulationKey: circulation,
				poolValKey:     poolVal,
			}, seed)
		}
	}
	return nil, InvalidBinErr
}

// skaSupplyChart generates chart data for an SKA coin type supply.
// The data is fetched per-request via the registered chartSource SKASupplyChart.
// Values are returned as exact-precision strings to preserve 18 decimal places.
func (charts *ChartData) skaSupplyChart(chartID string, bin binLevel, axis axisType) ([]byte, error) {
	coinType := SkaCoinType(chartID)
	if !IsSKASupplyChart(chartID) {
		return nil, fmt.Errorf("invalid SKA supply chart: %s", chartID)
	}

	// coinType 0 uses the existing VAR coin supply chart
	if coinType == 0 {
		return coinSupplyChart(charts, bin, axis, DefaultInterval)
	}

	// SKA supply data should already be pre-loaded in SKASupply map
	charts.mtx.RLock()
	if charts.SKASupply == nil {
		charts.mtx.RUnlock()
		return nil, fmt.Errorf("SKA supply data not initialized for coin type %d", coinType)
	}
	data, ok := charts.SKASupply[coinType]
	charts.mtx.RUnlock()
	if !ok || len(data.Timestamps) == 0 {
		return nil, fmt.Errorf("no SKA supply data found for coin type %d", coinType)
	}

	// Return exact-precision strings directly
	switch bin {
	case BlockBin:
		switch axis {
		case HeightAxis:
			resp := struct {
				Bin    string   `json:"bin"`
				Axis   string   `json:"axis"`
				H      []int64  `json:"h"`
				Supply []string `json:"supply"`
			}{
				Bin:    string(bin),
				Axis:   string(axis),
				H:      data.Heights,
				Supply: data.Values,
			}
			return json.Marshal(resp)
		default:
			resp := struct {
				Bin    string   `json:"bin"`
				Axis   string   `json:"axis"`
				H      []int64  `json:"h"`
				T      []int64  `json:"t"`
				Supply []string `json:"supply"`
			}{
				Bin:    string(bin),
				Axis:   string(axis),
				H:      data.Heights,
				T:      data.Timestamps,
				Supply: data.Values,
			}
			return json.Marshal(resp)
		}
	case DayBin:
		timestamps, heights, values := aggregateSKASupply(data.Timestamps, data.Heights, data.Values)
		switch axis {
		case HeightAxis:
			resp := struct {
				Bin    string   `json:"bin"`
				Axis   string   `json:"axis"`
				H      []int64  `json:"h"`
				Supply []string `json:"supply"`
			}{
				Bin:    string(bin),
				Axis:   string(axis),
				H:      heights,
				Supply: values,
			}
			return json.Marshal(resp)
		default:
			resp := struct {
				Bin    string   `json:"bin"`
				Axis   string   `json:"axis"`
				H      []int64  `json:"h"`
				T      []int64  `json:"t"`
				Supply []string `json:"supply"`
			}{
				Bin:    string(bin),
				Axis:   string(axis),
				H:      heights,
				T:      timestamps,
				Supply: values,
			}
			return json.Marshal(resp)
		}
	}

	return nil, InvalidBinErr
}

// skaFeeChart generates chart data for an SKA coin type's transaction fees.
// Data is pre-loaded in the SKAFees map. Values are returned as exact-precision
// strings to preserve 18 decimal places. coinType 0 is not handled here (it
// uses the existing VAR fees path via the chartMakers registry).
func (charts *ChartData) skaFeeChart(chartID string, bin binLevel, axis axisType) ([]byte, error) {
	coinType := FeeCoinType(chartID)
	if !IsSKAFeeChart(chartID) || coinType == 0 {
		return nil, fmt.Errorf("invalid SKA fee chart: %s", chartID)
	}

	charts.SKAFeesMtx.RLock()
	if charts.SKAFees == nil {
		charts.SKAFeesMtx.RUnlock()
		return nil, fmt.Errorf("SKA fee data not initialized for coin type %d", coinType)
	}
	data, ok := charts.SKAFees[coinType]
	charts.SKAFeesMtx.RUnlock()
	if !ok || len(data.Fees) == 0 {
		return nil, fmt.Errorf("no SKA fee data found for coin type %d", coinType)
	}

	switch bin {
	case BlockBin:
		switch axis {
		case HeightAxis:
			resp := struct {
				Bin  string   `json:"bin"`
				Axis string   `json:"axis"`
				H    []int64  `json:"h"`
				Fees []string `json:"fees"`
			}{
				Bin:  string(bin),
				Axis: string(axis),
				H:    data.Heights,
				Fees: data.Fees,
			}
			return json.Marshal(resp)
		default:
			resp := struct {
				Bin  string   `json:"bin"`
				Axis string   `json:"axis"`
				H    []int64  `json:"h"`
				T    []int64  `json:"t"`
				Fees []string `json:"fees"`
			}{
				Bin:  string(bin),
				Axis: string(axis),
				H:    data.Heights,
				T:    data.Timestamps,
				Fees: data.Fees,
			}
			return json.Marshal(resp)
		}
	case DayBin:
		timestamps, heights, values := aggregateSKAFees(data.Timestamps, data.Heights, data.Fees)
		switch axis {
		case HeightAxis:
			resp := struct {
				Bin  string   `json:"bin"`
				Axis string   `json:"axis"`
				H    []int64  `json:"h"`
				Fees []string `json:"fees"`
			}{
				Bin:  string(bin),
				Axis: string(axis),
				H:    heights,
				Fees: values,
			}
			return json.Marshal(resp)
		default:
			resp := struct {
				Bin  string   `json:"bin"`
				Axis string   `json:"axis"`
				H    []int64  `json:"h"`
				T    []int64  `json:"t"`
				Fees []string `json:"fees"`
			}{
				Bin:  string(bin),
				Axis: string(axis),
				H:    heights,
				T:    timestamps,
				Fees: values,
			}
			return json.Marshal(resp)
		}
	}

	return nil, InvalidBinErr
}

// skaSupplyChartData holds raw SKA supply data from the database.
type skaSupplyChartData struct {
	Heights []int64
	Values  []string
}

// ChartUintsFromInt64 converts []int64 to ChartUints.
func ChartUintsFromInt64(data []int64) ChartUints {
	result := make(ChartUints, len(data))
	for i, v := range data {
		result[i] = uint64(v)
	}
	return result
}

// ChartUintsFromStrings converts []string (exact precision) to ChartUints.
// This is a best-effort conversion; for display, use the original strings.
func ChartUintsFromStrings(data []string) ChartUints {
	result := make(ChartUints, len(data))
	for i, s := range data {
		if v, err := strconv.ParseUint(s, 10, 64); err == nil {
			result[i] = v
		}
	}
	return result
}

// aggregateSKASupply aggregates block-level SKA supply data to daily bins.
// It takes the last recorded supply value of each day to reflect the end-of-day supply.
func aggregateSKASupply(timestamps []int64, heights []int64, values []string) ([]int64, []int64, []string) {
	if len(timestamps) == 0 {
		return nil, nil, nil
	}

	type dailyData struct {
		timestamp int64
		height    int64
		value     *big.Int
	}
	dailyMap := make(map[int64]dailyData)

	for i, t := range timestamps {
		dayKey := t / 86400
		if i < len(values) && i < len(heights) {
			if v, ok := new(big.Int).SetString(values[i], 10); ok {
				// Overwrite with the latest value for the day to capture end-of-day supply.
				dailyMap[dayKey] = dailyData{
					timestamp: t,
					height:    heights[i],
					value:     v,
				}
			}
		}
	}

	dayKeys := make([]int64, 0, len(dailyMap))
	for day := range dailyMap {
		dayKeys = append(dayKeys, day)
	}
	sort.Slice(dayKeys, func(i, j int) bool { return dayKeys[i] < dayKeys[j] })

	dayTimestamps := make([]int64, 0, len(dailyMap))
	dayHeights := make([]int64, 0, len(dailyMap))
	dayValues := make([]string, 0, len(dailyMap))
	for _, day := range dayKeys {
		d := dailyMap[day]
		dayTimestamps = append(dayTimestamps, day*86400)
		dayHeights = append(dayHeights, d.height)
		dayValues = append(dayValues, d.value.String())
	}

	return dayTimestamps, dayHeights, dayValues
}

// aggregateSKAFees aggregates per-block SKA fee data into daily bins by summing
// fees within each day. Sums are accumulated in big.Int because SKA atoms use
// 18 decimals and overflow float64/int64. The bin's timestamp is the start of
// the UTC day; the bin's height is the height of the first block that
// contributes to that day — i.e. the first with a parseable fee value (input is
// assumed ordered by ascending height/time, matching the query).
func aggregateSKAFees(timestamps []int64, heights []int64, values []string) ([]int64, []int64, []string) {
	if len(timestamps) == 0 {
		return nil, nil, nil
	}

	type dailyData struct {
		timestamp int64
		height    int64
		total     *big.Int
	}
	dailyMap := make(map[int64]*dailyData)

	for i, t := range timestamps {
		dayKey := t / 86400
		if i >= len(values) || i >= len(heights) {
			continue
		}
		v, ok := new(big.Int).SetString(values[i], 10)
		if !ok {
			continue
		}
		if d, exists := dailyMap[dayKey]; exists {
			d.total.Add(d.total, v)
		} else {
			dailyMap[dayKey] = &dailyData{
				timestamp: t - (t % 86400),
				height:    heights[i],
				total:     new(big.Int).Set(v),
			}
		}
	}

	dayKeys := make([]int64, 0, len(dailyMap))
	for day := range dailyMap {
		dayKeys = append(dayKeys, day)
	}
	sort.Slice(dayKeys, func(i, j int) bool { return dayKeys[i] < dayKeys[j] })

	dayTimestamps := make([]int64, 0, len(dailyMap))
	dayHeights := make([]int64, 0, len(dailyMap))
	dayValues := make([]string, 0, len(dailyMap))
	for _, day := range dayKeys {
		d := dailyMap[day]
		dayTimestamps = append(dayTimestamps, d.timestamp)
		dayHeights = append(dayHeights, d.height)
		dayValues = append(dayValues, d.total.String())
	}

	return dayTimestamps, dayHeights, dayValues
}
