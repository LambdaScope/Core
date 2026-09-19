// Package anomaly decides whether one invocation looks different from what a
// function normally does.
//
// There is no blocklist and no threat feed here. Everything it knows, it
// learned from the function's own history. That is what lets it flag an attack
// nobody has catalogued yet: the question is not "is this known bad?" but "is
// this different from what this function always does?"
package anomaly

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/LambdaScope/Core/internal/schema"
)

type Config struct {
	// LearningWindow is how many invocations we observe before we start
	// judging. Without it, invocation #1 would flag everything it does.
	LearningWindow int

	// FDWindow is how many recent invocations of one sandbox the leak detector
	// looks at. FDGrowth is the total descriptor growth across that window
	// required to call it a leak.
	FDWindow int
	FDGrowth int

	// SyscallSigma is how many standard deviations from the running mean counts
	// as an outlier. SyscallMinSamples is how much history a syscall needs
	// before its statistics are trusted at all.
	SyscallSigma      float64
	SyscallMinSamples int
}

func DefaultConfig() Config {
	return Config{
		LearningWindow:    5,
		FDWindow:          10,
		FDGrowth:          20,
		SyscallSigma:      3,
		SyscallMinSamples: 8,
	}
}

type Detector struct {
	cfg Config
	aws *AWSRanges
	now func() int64 // injectable so tests get deterministic timestamps
}

func New(cfg Config, aws *AWSRanges) *Detector {
	return &Detector{
		cfg: cfg,
		aws: aws,
		now: func() int64 { return time.Now().UnixMilli() },
	}
}

// SetClock overrides the time source. Tests only.
func (d *Detector) SetClock(f func() int64) { d.now = f }

// Process runs every detector against one event and then folds the event into
// the baseline.
//
// Order matters and is enforced here rather than left to callers: we judge
// against the OLD baseline first, then learn. The other way round, every event
// teaches itself and nothing is ever anomalous.
//
// The baseline and sandbox state are mutated in place; the caller persists them.
func (d *Detector) Process(ev *schema.InvocationEvent, b *Baseline, s *SandboxState) []schema.Anomaly {
	b.ensure()

	learning := b.InvocationCount < d.cfg.LearningWindow

	var found []schema.Anomaly
	if !learning {
		found = append(found, d.detectUnknownEndpoint(ev, b)...)
		found = append(found, d.detectSyscallOutlier(ev, b)...)
	}
	// The FD detector runs in every mode: it needs a full window of history
	// before it can say anything anyway, which is its own warm-up period.
	found = append(found, d.detectFDLeak(ev, s)...)

	d.learn(ev, b, found)
	return found
}

// ---------------------------------------------------------------------------
// Detector A - an endpoint this function has never contacted
// ---------------------------------------------------------------------------

func (d *Detector) detectUnknownEndpoint(ev *schema.InvocationEvent, b *Baseline) []schema.Anomaly {
	var out []schema.Anomaly

	for _, conn := range ev.Connections {
		endpoint := conn.Endpoint()
		if b.Knows(endpoint) {
			continue
		}

		sev := d.endpointSeverity(conn, b)
		out = append(out, d.newAnomaly(ev, schema.KindUnknownEndpoint, sev,
			[]string{endpoint},
			map[string]any{
				"endpoint":         endpoint,
				"remote_ip":        conn.RemoteIP,
				"remote_port":      conn.RemotePort,
				"inside_aws":       d.aws.Contains(conn.RemoteIP),
				"aws_ranges_known": d.aws.Loaded(),
				"known_endpoints":  sortedKeys(b.KnownEndpoints),
				"invocations_seen": b.InvocationCount,
			}))
	}
	return out
}

// endpointSeverity ranks a new endpoint on two axes: where the address lives,
// and whether this function has ever reached outside AWS before.
func (d *Detector) endpointSeverity(conn schema.Connection, b *Baseline) schema.Severity {
	// Without real range data we cannot claim an address is external, so we
	// rank on the port alone rather than inventing a stronger claim.
	if !d.aws.Loaded() {
		if conn.RemotePort == 443 {
			return schema.SeverityMedium
		}
		return schema.SeverityHigh
	}

	if d.aws.Contains(conn.RemoteIP) {
		// New, but still inside AWS - most likely a newly added SDK call.
		return schema.SeverityLow
	}

	// Outside AWS, and this function has never done that in its life. This is
	// the strongest signal the tool produces.
	if !b.SeenExternalEgress {
		return schema.SeverityCritical
	}

	// Outside AWS on a non-HTTPS port. Normal applications rarely do this;
	// port 22 in particular has no business in a Lambda function.
	if conn.RemotePort != 443 {
		return schema.SeverityHigh
	}

	// Outside AWS over HTTPS. Could be a legitimate third-party API.
	return schema.SeverityMedium
}

// ---------------------------------------------------------------------------
// Detector B - file descriptors climbing inside one warm container
// ---------------------------------------------------------------------------

func (d *Detector) detectFDLeak(ev *schema.InvocationEvent, s *SandboxState) []schema.Anomaly {
	// A timed-out invocation never got to record a trustworthy end count.
	// Feeding it in would corrupt the window.
	if ev.TimedOut {
		return nil
	}

	s.push(ev.FD.Delta, d.cfg.FDWindow)

	if len(s.RecentDeltas) < d.cfg.FDWindow || s.LeakReported {
		return nil
	}

	total, monotonic := s.growth()
	if !monotonic || total < d.cfg.FDGrowth {
		return nil
	}

	s.LeakReported = true

	evidence := map[string]any{
		"sandbox_id": ev.SandboxID,
		"growth":     total,
		"window":     d.cfg.FDWindow,
		"current":    ev.FD.End,
	}
	if ev.FD.Limit > 0 {
		evidence["limit"] = ev.FD.Limit
		evidence["headroom"] = ev.FD.Limit - ev.FD.End
	}

	return []schema.Anomaly{
		d.newAnomaly(ev, schema.KindFDLeak, schema.SeverityHigh,
			[]string{ev.SandboxID}, evidence),
	}
}

// ---------------------------------------------------------------------------
// Detector C - a syscall count far outside its running statistics
// ---------------------------------------------------------------------------

func (d *Detector) detectSyscallOutlier(ev *schema.InvocationEvent, b *Baseline) []schema.Anomaly {
	// /proc cannot see syscalls. Running this detector on a proc_fallback event
	// would be reporting on data we do not have.
	if !ev.Tier.SeesSyscalls() || len(ev.Syscalls) == 0 {
		return nil
	}

	var out []schema.Anomaly

	// Sorted so the output is deterministic - Go map order is random.
	for _, name := range sortedSyscalls(ev.Syscalls) {
		count := ev.Syscalls[name]
		stat, seen := b.Syscalls[name]

		// A syscall this function has never made before is always worth
		// reporting, no statistics required.
		if !seen {
			out = append(out, d.newAnomaly(ev, schema.KindSyscallOutlier, schema.SeverityHigh,
				[]string{name},
				map[string]any{
					"syscall": name,
					"count":   count,
					"reason":  "never observed for this function before",
				}))
			continue
		}

		if stat.Count < d.cfg.SyscallMinSamples {
			continue // not enough history to trust the statistics yet
		}
		sd := stat.StdDev()
		if sd <= 0 {
			continue // perfectly constant so far; one sample cannot prove a trend
		}
		deviation := math.Abs(float64(count)-stat.Mean) / sd
		if deviation <= d.cfg.SyscallSigma {
			continue
		}

		out = append(out, d.newAnomaly(ev, schema.KindSyscallOutlier, schema.SeverityMedium,
			[]string{name},
			map[string]any{
				"syscall": name,
				"count":   count,
				"mean":    round2(stat.Mean),
				"stddev":  round2(sd),
				"sigma":   round2(deviation),
			}))
	}
	return out
}

// ---------------------------------------------------------------------------
// Learning
// ---------------------------------------------------------------------------

// learn folds this event into the baseline.
//
// The important rule is at the top of the endpoint loop: an endpoint we just
// flagged is NOT learned. Otherwise an attacker only has to connect twice and
// the address is whitelisted forever.
func (d *Detector) learn(ev *schema.InvocationEvent, b *Baseline, found []schema.Anomaly) {
	flagged := make(map[string]bool, len(found))
	for _, a := range found {
		if a.Kind == schema.KindUnknownEndpoint {
			if ep, ok := a.Evidence["endpoint"].(string); ok {
				flagged[ep] = true
			}
		}
	}

	for _, conn := range ev.Connections {
		endpoint := conn.Endpoint()
		if flagged[endpoint] {
			continue
		}
		b.KnownEndpoints[endpoint] = true
		if d.aws.Loaded() && !d.aws.Contains(conn.RemoteIP) {
			b.SeenExternalEgress = true
		}
	}

	if ev.Tier.SeesSyscalls() {
		for name, count := range ev.Syscalls {
			stat, ok := b.Syscalls[name]
			if !ok {
				stat = &SyscallStat{}
				b.Syscalls[name] = stat
			}
			stat.Update(float64(count))
		}
	}

	b.InvocationCount++
}

// ---------------------------------------------------------------------------
// Construction helpers
// ---------------------------------------------------------------------------

// newAnomaly builds an alert with a deterministic ID and signature.
//
// Deterministic matters twice over. The ID means replaying the same Kinesis
// record produces the same anomaly, so the conditional write in the store is a
// no-op instead of a duplicate alert. The signature means the same problem seen
// a thousand times shares one cached Bedrock explanation instead of a thousand
// billed calls.
func (d *Detector) newAnomaly(
	ev *schema.InvocationEvent,
	kind schema.AnomalyKind,
	sev schema.Severity,
	distinguishers []string,
	evidence map[string]any,
) schema.Anomaly {
	sig := signature(ev.BaselineKey(), kind, distinguishers)
	return schema.Anomaly{
		V:                 schema.Version,
		AnomalyID:         shortHash(ev.InvocationID, string(kind), sig),
		InvocationID:      ev.InvocationID,
		SandboxID:         ev.SandboxID,
		FunctionARN:       ev.FunctionARN,
		FunctionName:      ev.FunctionName,
		Kind:              kind,
		Severity:          sev,
		DetectedAtMS:      d.now(),
		Signature:         sig,
		Evidence:          evidence,
		Explanation:       nil,
		ExplanationStatus: schema.ExplanationPending,
	}
}

// signature identifies "the same problem", independent of which invocation
// happened to surface it.
func signature(baselineKey string, kind schema.AnomalyKind, distinguishers []string) string {
	parts := append([]string{baselineKey, string(kind)}, distinguishers...)
	return shortHash(parts...)
}

func shortHash(parts ...string) string {
	h := sha256.New()
	for _, p := range parts {
		h.Write([]byte(p))
		h.Write([]byte{0}) // separator, so ("ab","c") != ("a","bc")
	}
	return hex.EncodeToString(h.Sum(nil))[:16]
}

func sortedKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func sortedSyscalls(m map[string]int) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func round2(f float64) float64 { return math.Round(f*100) / 100 }

// Describe renders an anomaly as one human-readable line. Used in logs and as
// the fallback text when Bedrock is unavailable, so an alert is never empty.
func Describe(a schema.Anomaly) string {
	switch a.Kind {
	case schema.KindUnknownEndpoint:
		return fmt.Sprintf("%s contacted %v, which it has never contacted in %v prior invocations",
			a.FunctionName, a.Evidence["endpoint"], a.Evidence["invocations_seen"])
	case schema.KindFDLeak:
		return fmt.Sprintf("sandbox %v leaked %v file descriptors over %v consecutive invocations (now at %v)",
			a.Evidence["sandbox_id"], a.Evidence["growth"], a.Evidence["window"], a.Evidence["current"])
	case schema.KindSyscallOutlier:
		return fmt.Sprintf("syscall %v called %v times, outside this function's normal range",
			a.Evidence["syscall"], a.Evidence["count"])
	}
	return string(a.Kind)
}
