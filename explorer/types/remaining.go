package types

import (
	"fmt"
	"time"
)

// RemainingWindowText renders the human-readable time left until the end of a
// block window (ticket-price window or reward window). idx is the 1-based index
// of the current block within the window, max is the window size, and blockTime
// is the target time per block in nanoseconds. It returns "imminent" when the
// window has no blocks left, otherwise a string like "1w 2d 3h 4m 5s remaining".
//
// This is the single source of truth for the countdown string: the "remaining"
// template func and the live WebSocket payload builders both call it so the
// server render and live update can never diverge (issue #502).
func RemainingWindowText(idx int, max, blockTime int64) string {
	x := (max - int64(idx)) * blockTime
	if x == 0 {
		return "imminent"
	}
	allsecs := int(time.Duration(x).Seconds())
	str := ""
	if allsecs > 604799 {
		weeks := allsecs / 604800
		allsecs %= 604800
		str += fmt.Sprintf("%dw ", weeks)
	}
	if allsecs > 86399 {
		days := allsecs / 86400
		allsecs %= 86400
		str += fmt.Sprintf("%dd ", days)
	}
	if allsecs > 3599 {
		hours := allsecs / 3600
		allsecs %= 3600
		str += fmt.Sprintf("%dh ", hours)
	}
	if allsecs > 59 {
		mins := allsecs / 60
		allsecs %= 60
		str += fmt.Sprintf("%dm ", mins)
	}
	if allsecs > 0 {
		str += fmt.Sprintf("%ds ", allsecs)
	}
	return str + "remaining"
}
