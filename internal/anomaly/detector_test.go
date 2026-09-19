package anomaly

import (
	"testing"

	"github.com/LambdaScope/Core/internal/schema"
)

const (
	awsDDB   = "52.94.236.248"  // inside the AWS ranges, taught during learning
	awsS3    = "52.216.153.51"  // inside the AWS ranges, taught during learning
	awsNew   = "54.239.28.85"   // inside the AWS ranges, deliberately NOT taught
	evilHTTP = "185.220.101.47" // outside AWS
	evilSSH  = "45.148.10.92"   // outside AWS
)

// newTestDetector gives a detector with a frozen clock so anomaly timestamps
// are reproducible.
func newTestDetector(t *testing.T) *Detector {
	t.Helper()
	d := New(DefaultConfig(), DevAWSRanges())
	d.SetClock(func() int64 { return 1_700_000_000_000 })
	return d
}

type connSpec struct {
	ip   string
	port int
}

func newEvent(invID, sandboxID string, delta int, conns ...connSpec) *schema.InvocationEvent {
	ev := &schema.InvocationEvent{
		V:            schema.Version,
		Type:         "invocation",
		InvocationID: invID,
		SandboxID:    sandboxID,
		FunctionARN:  "arn:aws:lambda:ap-south-1:123456789012:function:demo",
		FunctionName: "demo",
		Tier:         schema.TierProcFallback,
		FD:           schema.FD{Start: 12, End: 12 + delta, Delta: delta, Limit: 1024},
	}
	for _, c := range conns {
		ev.Connections = append(ev.Connections, schema.Connection{
			RemoteIP: c.ip, RemotePort: c.port, Proto: "tcp",
		})
	}
	return ev
}

// teach runs the learning window using only in-AWS endpoints, leaving
// SeenExternalEgress false.
func teach(d *Detector, b *Baseline, s *SandboxState) {
	for i := 0; i < DefaultConfig().LearningWindow; i++ {
		ev := newEvent("learn", "sbx-learn", 0,
			connSpec{awsDDB, 443}, connSpec{awsS3, 443})
		d.Process(ev, b, s)
	}
}

// ---------------------------------------------------------------------------

func TestLearningWindowSuppressesAlerts(t *testing.T) {
	d := newTestDetector(t)
	b, s := NewBaseline("demo"), NewSandboxState("sbx-1")

	// Even a wildly suspicious endpoint must not alert while still learning.
	for i := 0; i < DefaultConfig().LearningWindow; i++ {
		got := d.Process(newEvent("inv", "sbx-1", 0, connSpec{evilSSH, 22}), b, s)
		if len(got) != 0 {
			t.Fatalf("invocation %d: expected no alerts during learning, got %d", i, len(got))
		}
	}
	if b.InvocationCount != 5 {
		t.Fatalf("expected InvocationCount 5, got %d", b.InvocationCount)
	}
}

func TestUnknownEndpointDetected(t *testing.T) {
	d := newTestDetector(t)
	b, s := NewBaseline("demo"), NewSandboxState("sbx-1")
	teach(d, b, s)

	// A known endpoint stays quiet.
	if got := d.Process(newEvent("inv-6", "sbx-1", 0, connSpec{awsDDB, 443}), b, s); len(got) != 0 {
		t.Fatalf("known endpoint should not alert, got %d", len(got))
	}

	// A new one does not.
	got := d.Process(newEvent("inv-7", "sbx-1", 0,
		connSpec{awsDDB, 443}, connSpec{evilHTTP, 8443}), b, s)
	if len(got) != 1 {
		t.Fatalf("expected exactly 1 alert, got %d", len(got))
	}
	if got[0].Kind != schema.KindUnknownEndpoint {
		t.Errorf("kind = %q, want unknown_endpoint", got[0].Kind)
	}
	if got[0].ExplanationStatus != schema.ExplanationPending {
		t.Errorf("a fresh alert must be pending, got %q", got[0].ExplanationStatus)
	}
	if got[0].Explanation != nil {
		t.Errorf("a fresh alert must have no explanation yet")
	}
}

// A flagged endpoint must never be folded into the baseline, or an attacker
// only has to connect twice to be whitelisted forever.
func TestFlaggedEndpointIsNotLearned(t *testing.T) {
	d := newTestDetector(t)
	b, s := NewBaseline("demo"), NewSandboxState("sbx-1")
	teach(d, b, s)

	for i, invID := range []string{"inv-a", "inv-b", "inv-c"} {
		got := d.Process(newEvent(invID, "sbx-1", 0, connSpec{evilHTTP, 8443}), b, s)
		if len(got) != 1 {
			t.Fatalf("occurrence %d: expected the endpoint to alert again, got %d alerts", i+1, len(got))
		}
	}
	if b.KnownEndpoints["185.220.101.47:8443"] {
		t.Error("flagged endpoint leaked into the baseline")
	}
}

func TestEndpointSeverityLadder(t *testing.T) {
	tests := []struct {
		name          string
		priorExternal bool
		conn          connSpec
		want          schema.Severity
	}{
		{"new but inside AWS", false, connSpec{awsNew, 443}, schema.SeverityLow},
		{"first ever egress outside AWS", false, connSpec{evilHTTP, 443}, schema.SeverityCritical},
		{"external HTTPS, egress is normal here", true, connSpec{evilHTTP, 443}, schema.SeverityMedium},
		{"external SSH, egress is normal here", true, connSpec{evilSSH, 22}, schema.SeverityHigh},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			d := newTestDetector(t)
			b, s := NewBaseline("demo"), NewSandboxState("sbx-1")
			teach(d, b, s)
			b.SeenExternalEgress = tc.priorExternal

			got := d.Process(newEvent("inv-x", "sbx-1", 0, tc.conn), b, s)
			if len(got) != 1 {
				t.Fatalf("expected 1 alert, got %d", len(got))
			}
			if got[0].Severity != tc.want {
				t.Errorf("severity = %q, want %q", got[0].Severity, tc.want)
			}
		})
	}
}

// Without real range data we must not claim an address is external.
func TestSeverityDegradesWhenRangesUnknown(t *testing.T) {
	d := New(DefaultConfig(), &AWSRanges{}) // never loaded
	d.SetClock(func() int64 { return 1 })
	b, s := NewBaseline("demo"), NewSandboxState("sbx-1")
	teach(d, b, s)

	got := d.Process(newEvent("inv-x", "sbx-1", 0, connSpec{evilHTTP, 443}), b, s)
	if len(got) != 1 {
		t.Fatalf("expected 1 alert, got %d", len(got))
	}
	if got[0].Severity == schema.SeverityCritical {
		t.Error("must not claim critical without range data")
	}
	if got[0].Evidence["aws_ranges_known"] != false {
		t.Error("evidence should record that ranges were unavailable")
	}
}

// ---------------------------------------------------------------------------

func TestFDLeakDetected(t *testing.T) {
	d := newTestDetector(t)
	b, s := NewBaseline("demo"), NewSandboxState("sbx-leak")

	cfg := DefaultConfig()
	var alerts []schema.Anomaly

	// A real leak climbs: each invocation starts where the last one ended.
	start := 12
	for i := 0; i < cfg.FDWindow; i++ {
		ev := newEvent("inv", "sbx-leak", 2, connSpec{awsDDB, 443})
		ev.FD = schema.FD{Start: start, End: start + 2, Delta: 2, Limit: 1024}
		start += 2
		alerts = append(alerts, d.Process(ev, b, s)...)
	}

	var leaks []schema.Anomaly
	for _, a := range alerts {
		if a.Kind == schema.KindFDLeak {
			leaks = append(leaks, a)
		}
	}
	if len(leaks) != 1 {
		t.Fatalf("expected exactly 1 fd_leak alert, got %d", len(leaks))
	}
	if got := leaks[0].Evidence["growth"]; got != 20 {
		t.Errorf("growth = %v, want 20", got)
	}
	if got := leaks[0].Evidence["headroom"]; got != 1024-32 {
		t.Errorf("headroom = %v, want %d", got, 1024-32)
	}

	// It must not keep firing on every subsequent invocation.
	more := d.Process(newEvent("inv", "sbx-leak", 2, connSpec{awsDDB, 443}), b, s)
	for _, a := range more {
		if a.Kind == schema.KindFDLeak {
			t.Error("fd_leak alerted twice for the same sandbox")
		}
	}
}

func TestFDLeakClearedByOneHealthyInvocation(t *testing.T) {
	d := newTestDetector(t)
	b, s := NewBaseline("demo"), NewSandboxState("sbx-ok")

	deltas := []int{2, 2, 2, 2, 0, 2, 2, 2, 2, 2, 2} // one healthy run in the middle
	for _, delta := range deltas {
		for _, a := range d.Process(newEvent("inv", "sbx-ok", delta, connSpec{awsDDB, 443}), b, s) {
			if a.Kind == schema.KindFDLeak {
				t.Fatal("a non-monotonic series must not be reported as a leak")
			}
		}
	}
}

func TestFDStateIsPerSandbox(t *testing.T) {
	d := newTestDetector(t)
	b := NewBaseline("demo")
	leaky, healthy := NewSandboxState("sbx-leaky"), NewSandboxState("sbx-healthy")

	for i := 0; i < DefaultConfig().FDWindow; i++ {
		d.Process(newEvent("inv", "sbx-healthy", 0, connSpec{awsDDB, 443}), b, healthy)
	}
	if healthy.LeakReported {
		t.Error("flat sandbox was reported as leaking")
	}

	var leaked bool
	for i := 0; i < DefaultConfig().FDWindow; i++ {
		for _, a := range d.Process(newEvent("inv", "sbx-leaky", 3, connSpec{awsDDB, 443}), b, leaky) {
			if a.Kind == schema.KindFDLeak {
				leaked = true
			}
		}
	}
	if !leaked {
		t.Error("climbing sandbox was not reported")
	}
}

func TestTimedOutInvocationSkipsFD(t *testing.T) {
	d := newTestDetector(t)
	b, s := NewBaseline("demo"), NewSandboxState("sbx-t")

	for i := 0; i < DefaultConfig().FDWindow*2; i++ {
		ev := newEvent("inv", "sbx-t", 2, connSpec{awsDDB, 443})
		ev.TimedOut = true
		for _, a := range d.Process(ev, b, s) {
			if a.Kind == schema.KindFDLeak {
				t.Fatal("timed-out invocations have unreliable fd.end and must be skipped")
			}
		}
	}
	if len(s.RecentDeltas) != 0 {
		t.Errorf("timed-out deltas polluted the window: %v", s.RecentDeltas)
	}
}

// ---------------------------------------------------------------------------

func TestSyscallDetectorSkippedOnProcFallback(t *testing.T) {
	d := newTestDetector(t)
	b, s := NewBaseline("demo"), NewSandboxState("sbx-1")
	teach(d, b, s)

	ev := newEvent("inv-x", "sbx-1", 0, connSpec{awsDDB, 443})
	ev.Tier = schema.TierProcFallback
	ev.Syscalls = map[string]int{"ptrace": 9999} // must be ignored: /proc cannot see this

	for _, a := range d.Process(ev, b, s) {
		if a.Kind == schema.KindSyscallOutlier {
			t.Fatal("syscall detector ran on proc_fallback, where there is no syscall data")
		}
	}
}

func TestUnseenSyscallIsFlagged(t *testing.T) {
	d := newTestDetector(t)
	b, s := NewBaseline("demo"), NewSandboxState("sbx-1")

	base := map[string]int{"openat": 10, "connect": 2}
	for i := 0; i < DefaultConfig().LearningWindow; i++ {
		ev := newEvent("inv", "sbx-1", 0, connSpec{awsDDB, 443})
		ev.Tier = schema.TierKernelEBPF
		ev.Syscalls = base
		d.Process(ev, b, s)
	}

	ev := newEvent("inv-new", "sbx-1", 0, connSpec{awsDDB, 443})
	ev.Tier = schema.TierKernelEBPF
	ev.Syscalls = map[string]int{"openat": 10, "connect": 2, "ptrace": 1}

	var found bool
	for _, a := range d.Process(ev, b, s) {
		if a.Kind == schema.KindSyscallOutlier && a.Evidence["syscall"] == "ptrace" {
			found = true
			if a.Severity != schema.SeverityHigh {
				t.Errorf("severity = %q, want high for a never-seen syscall", a.Severity)
			}
		}
	}
	if !found {
		t.Fatal("a syscall never seen before was not flagged")
	}
}

func TestSyscallOutlierNeedsEnoughHistory(t *testing.T) {
	d := newTestDetector(t)
	b, s := NewBaseline("demo"), NewSandboxState("sbx-1")
	cfg := DefaultConfig()

	// Build a stable-but-not-constant history so stddev is non-zero.
	counts := []int{10, 11, 9, 10, 12, 9, 10, 11, 10, 10, 11, 9}
	for _, c := range counts {
		ev := newEvent("inv", "sbx-1", 0)
		ev.Tier = schema.TierKernelEBPF
		ev.Syscalls = map[string]int{"openat": c}
		d.Process(ev, b, s)
	}

	if b.Syscalls["openat"].Count < cfg.SyscallMinSamples {
		t.Fatalf("test setup: not enough samples (%d)", b.Syscalls["openat"].Count)
	}

	spike := newEvent("inv-spike", "sbx-1", 0)
	spike.Tier = schema.TierKernelEBPF
	spike.Syscalls = map[string]int{"openat": 5000}

	var found bool
	for _, a := range d.Process(spike, b, s) {
		if a.Kind == schema.KindSyscallOutlier && a.Evidence["syscall"] == "openat" {
			found = true
		}
	}
	if !found {
		t.Error("a 5000-call spike against a mean of ~10 was not flagged")
	}
}

// ---------------------------------------------------------------------------

// Replaying the same record must produce byte-identical IDs, so the store's
// conditional write turns a Kinesis retry into a no-op instead of a second alert.
func TestAnomalyIDsAreDeterministic(t *testing.T) {
	run := func() schema.Anomaly {
		d := newTestDetector(t)
		b, s := NewBaseline("demo"), NewSandboxState("sbx-1")
		teach(d, b, s)
		got := d.Process(newEvent("inv-dup", "sbx-1", 0, connSpec{evilHTTP, 8443}), b, s)
		if len(got) != 1 {
			t.Fatalf("expected 1 alert, got %d", len(got))
		}
		return got[0]
	}

	a, bb := run(), run()
	if a.AnomalyID != bb.AnomalyID {
		t.Errorf("anomaly_id not deterministic: %q vs %q", a.AnomalyID, bb.AnomalyID)
	}
	if a.Signature != bb.Signature {
		t.Errorf("signature not deterministic: %q vs %q", a.Signature, bb.Signature)
	}
}

// Two different invocations hitting the same bad endpoint must share a
// signature, so they share one cached Bedrock explanation.
func TestSignatureIsSharedAcrossInvocations(t *testing.T) {
	d := newTestDetector(t)
	b, s := NewBaseline("demo"), NewSandboxState("sbx-1")
	teach(d, b, s)

	first := d.Process(newEvent("inv-1", "sbx-1", 0, connSpec{evilHTTP, 8443}), b, s)
	second := d.Process(newEvent("inv-2", "sbx-1", 0, connSpec{evilHTTP, 8443}), b, s)

	if first[0].Signature != second[0].Signature {
		t.Error("same endpoint produced different signatures - the explanation cache will never hit")
	}
	if first[0].AnomalyID == second[0].AnomalyID {
		t.Error("different invocations must still be distinct alerts")
	}
}

func TestDescribeCoversEveryKind(t *testing.T) {
	d := newTestDetector(t)
	b, s := NewBaseline("demo"), NewSandboxState("sbx-1")
	teach(d, b, s)

	got := d.Process(newEvent("inv-x", "sbx-1", 0, connSpec{evilHTTP, 8443}), b, s)
	if text := Describe(got[0]); text == "" || text == string(got[0].Kind) {
		t.Errorf("Describe produced no useful fallback text: %q", text)
	}
}
