// Package schema is the Go translation of schema/events.json.
//
// That JSON file is the contract shared with the Rust extension and the
// dashboard. If you change a field here, change it there too and tell the
// group - integration breaks silently otherwise.
package schema

import (
	"fmt"
	"net"
	"sort"
	"strconv"
)

// Version is the `v` carried by every payload. Bump on an incompatible change.
const Version = 1

// ---------------------------------------------------------------------------
// Enums. These strings are the contract - do not "tidy" them.
// ---------------------------------------------------------------------------

// Tier is which observation strategy the extension's seccomp probe settled on.
// These must match the serde output of ProbeResult in extension/src/prober.rs,
// which needs #[serde(rename_all = "snake_case")].
type Tier string

const (
	TierKernelEBPF    Tier = "kernel_ebpf"
	TierUserspaceEBPF Tier = "userspace_ebpf"
	TierProcFallback  Tier = "proc_fallback"
)

// Valid reports whether t is one of the three known tiers. An unrecognised
// tier usually means the extension and the processor are out of sync.
func (t Tier) Valid() bool {
	switch t {
	case TierKernelEBPF, TierUserspaceEBPF, TierProcFallback:
		return true
	}
	return false
}

// SeesSyscalls reports whether this tier can observe syscalls at all.
// proc_fallback cannot - /proc does not expose them - so Syscalls will be nil
// and the syscall detector must not run.
func (t Tier) SeesSyscalls() bool {
	return t == TierKernelEBPF || t == TierUserspaceEBPF
}

type Severity string

const (
	SeverityLow      Severity = "low"
	SeverityMedium   Severity = "medium"
	SeverityHigh     Severity = "high"
	SeverityCritical Severity = "critical"
)

// Rank gives an orderable value so alerts can be sorted worst-first.
func (s Severity) Rank() int {
	switch s {
	case SeverityCritical:
		return 4
	case SeverityHigh:
		return 3
	case SeverityMedium:
		return 2
	case SeverityLow:
		return 1
	}
	return 0
}

type AnomalyKind string

const (
	KindUnknownEndpoint AnomalyKind = "unknown_endpoint"
	KindFDLeak          AnomalyKind = "fd_leak"
	KindSyscallOutlier  AnomalyKind = "syscall_outlier"
)

type ExplanationStatus string

const (
	ExplanationPending ExplanationStatus = "pending"
	ExplanationReady   ExplanationStatus = "ready"
	ExplanationFailed  ExplanationStatus = "failed"
)

// WebSocket message types.
const (
	MsgSnapshot      = "snapshot"
	MsgInvocation    = "invocation"
	MsgAnomaly       = "anomaly"
	MsgAnomalyUpdate = "anomaly_update"
)

// ---------------------------------------------------------------------------
// Kinesis event: extension -> processor
// ---------------------------------------------------------------------------

type Connection struct {
	RemoteIP    string `json:"remote_ip"`
	RemotePort  int    `json:"remote_port"`
	Proto       string `json:"proto"`
	State       string `json:"state,omitempty"`
	FirstSeenMS int64  `json:"first_seen_ms,omitempty"`
	BytesOut    *int64 `json:"bytes_out,omitempty"`
}

// Endpoint is the identity we baseline on: IP and port together.
//
// Port matters. An attacker reusing a known IP on a different port is still a
// new endpoint and must still be flagged. net.JoinHostPort also brackets IPv6
// correctly, giving "[2606:4700::1]:443".
func (c Connection) Endpoint() string {
	return net.JoinHostPort(c.RemoteIP, strconv.Itoa(c.RemotePort))
}

// FD carries raw file-descriptor facts only. Whether this constitutes a leak
// is decided by the processor, which has the cross-invocation history.
type FD struct {
	Start int `json:"start"`
	End   int `json:"end"`
	Delta int `json:"delta"`
	Peak  int `json:"peak,omitempty"`
	Limit int `json:"limit,omitempty"`
}

type InvocationEvent struct {
	V    int    `json:"v"`
	Type string `json:"type"` // always "invocation"

	InvocationID     string `json:"invocation_id"` // idempotency key
	SandboxID        string `json:"sandbox_id"`    // groups warm invocations
	ExtensionVersion string `json:"extension_version,omitempty"`

	FunctionARN     string `json:"function_arn"` // partition key + baseline key
	FunctionName    string `json:"function_name"`
	FunctionVersion string `json:"function_version,omitempty"`
	Region          string `json:"region,omitempty"`

	StartMS    int64 `json:"start_ms"`
	DurationMS int64 `json:"duration_ms"`
	ColdStart  bool  `json:"cold_start"`
	TimedOut   bool  `json:"timed_out,omitempty"`

	Tier          Tier    `json:"tier"`
	Degraded      bool    `json:"degraded,omitempty"`
	DegradeReason *string `json:"degrade_reason,omitempty"`

	Connections []Connection `json:"connections,omitempty"`
	FD          FD           `json:"fd"`
	MemRSSKB    int64        `json:"mem_rss_kb,omitempty"`
	Threads     int          `json:"threads,omitempty"`

	// Syscalls is nil whenever Tier is proc_fallback. Always check
	// Tier.SeesSyscalls() before reading it.
	Syscalls map[string]int `json:"syscalls"`
}

// Validate catches records that are structurally unusable. A record that fails
// this must be dropped and counted - never retried, because retrying malformed
// data just burns the batch again.
func (e *InvocationEvent) Validate() error {
	switch {
	case e.V == 0:
		return fmt.Errorf("missing v")
	case e.V != Version:
		return fmt.Errorf("unsupported schema version %d (this build speaks %d)", e.V, Version)
	case e.InvocationID == "":
		return fmt.Errorf("missing invocation_id")
	case e.FunctionARN == "":
		return fmt.Errorf("missing function_arn")
	case e.SandboxID == "":
		return fmt.Errorf("missing sandbox_id")
	case !e.Tier.Valid():
		return fmt.Errorf("unknown tier %q - extension and processor are out of sync", e.Tier)
	}
	return nil
}

// BaselineKey is what a function's learned "normal" is stored under. Version is
// included deliberately: $LATEST and v3 can behave differently and should not
// share a baseline.
func (e *InvocationEvent) BaselineKey() string {
	if e.FunctionVersion == "" {
		return e.FunctionARN
	}
	return e.FunctionARN + ":" + e.FunctionVersion
}

// ---------------------------------------------------------------------------
// Anomaly: processor -> store -> dashboard
// ---------------------------------------------------------------------------

type Anomaly struct {
	V int `json:"v"`

	AnomalyID    string `json:"anomaly_id"`
	InvocationID string `json:"invocation_id"`
	SandboxID    string `json:"sandbox_id,omitempty"`
	FunctionARN  string `json:"function_arn"`
	FunctionName string `json:"function_name,omitempty"`

	Kind         AnomalyKind `json:"kind"`
	Severity     Severity    `json:"severity"`
	DetectedAtMS int64       `json:"detected_at_ms"`

	// Signature is a stable hash of the things that make this anomaly the same
	// as another one. Two invocations hitting the same bad endpoint produce the
	// same signature, so we can dedupe alerts and reuse one Bedrock call.
	Signature string `json:"signature"`

	Evidence map[string]any `json:"evidence,omitempty"`

	Explanation       *string           `json:"explanation"`
	ExplanationStatus ExplanationStatus `json:"explanation_status"`
}

// AnomalyUpdate is the second half of the two-phase alert: the alert itself
// goes out immediately with a nil Explanation, and this follows once Bedrock
// answers. The dashboard matches on AnomalyID and fills the text in place.
type AnomalyUpdate struct {
	AnomalyID         string            `json:"anomaly_id"`
	Explanation       *string           `json:"explanation"`
	ExplanationStatus ExplanationStatus `json:"explanation_status"`
}

// ---------------------------------------------------------------------------
// WebSocket envelope: api -> dashboard
// ---------------------------------------------------------------------------

type WSMessage struct {
	V    int    `json:"v"`
	Type string `json:"type"`
	Data any    `json:"data"`
}

func NewWSMessage(msgType string, data any) WSMessage {
	return WSMessage{V: Version, Type: msgType, Data: data}
}

// Snapshot is pushed once on $connect so a freshly opened dashboard has
// something to render instead of a blank page.
type Snapshot struct {
	Invocations []InvocationEvent `json:"invocations"`
	Anomalies   []Anomaly         `json:"anomalies"`
}

// MaxSyscallsOnWire caps how much of the syscall map is sent to a browser.
// API Gateway rejects WebSocket frames over 128 KB, and the dashboard only
// renders a handful of bars anyway.
const MaxSyscallsOnWire = 10

// ForWire returns a copy of the event fit to send to the dashboard: the syscall
// map is reduced to the highest-count entries. The receiver is not modified.
func (e InvocationEvent) ForWire() InvocationEvent {
	out := e
	if len(e.Syscalls) <= MaxSyscallsOnWire {
		return out
	}
	names := make([]string, 0, len(e.Syscalls))
	for k := range e.Syscalls {
		names = append(names, k)
	}
	// Highest count first; ties broken by name so the result is stable.
	sort.Slice(names, func(i, j int) bool {
		a, b := e.Syscalls[names[i]], e.Syscalls[names[j]]
		if a != b {
			return a > b
		}
		return names[i] < names[j]
	})
	out.Syscalls = make(map[string]int, MaxSyscallsOnWire)
	for _, k := range names[:MaxSyscallsOnWire] {
		out.Syscalls[k] = e.Syscalls[k]
	}
	return out
}
