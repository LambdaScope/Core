package fake

import (
	"testing"

	"github.com/LambdaScope/Core/internal/schema"
)

// The generated stream is what Thushar builds his mock data against and what
// the processor is tested with, so wrong fixtures propagate as wrong UI and
// wrong assumptions. These tests keep the story honest.

func TestScenarioIsValid(t *testing.T) {
	for _, ev := range Scenario() {
		if err := ev.Validate(); err != nil {
			t.Errorf("%s: %v", ev.InvocationID, err)
		}
	}
}

// A cold start is the first invocation in a new container - one per sandbox,
// never more.
func TestColdStartIsFirstInvocationPerSandbox(t *testing.T) {
	seen := make(map[string]bool)

	for _, ev := range Scenario() {
		first := !seen[ev.SandboxID]
		seen[ev.SandboxID] = true

		if ev.ColdStart != first {
			t.Errorf("%s (sandbox %s): cold_start = %v, want %v",
				ev.InvocationID, ev.SandboxID, ev.ColdStart, first)
		}
	}
}

// proc_fallback cannot observe syscalls, so the field must be nil rather than
// an empty map - the dashboard distinguishes "none" from "cannot see".
func TestProcFallbackCarriesNoSyscalls(t *testing.T) {
	for _, ev := range Scenario() {
		if ev.Tier == schema.TierProcFallback && ev.Syscalls != nil {
			t.Errorf("%s: proc_fallback event carries syscall data", ev.InvocationID)
		}
	}
}

// fd.delta must agree with fd.end - fd.start, and the descriptor count must
// carry over between consecutive invocations of the same container.
func TestFDSeriesIsCoherent(t *testing.T) {
	lastEnd := make(map[string]int)

	for _, ev := range Scenario() {
		if got, want := ev.FD.Delta, ev.FD.End-ev.FD.Start; got != want {
			t.Errorf("%s: delta = %d, but end-start = %d", ev.InvocationID, got, want)
		}
		if prev, ok := lastEnd[ev.SandboxID]; ok && ev.FD.Start != prev {
			t.Errorf("%s: starts at %d but the previous invocation of %s ended at %d",
				ev.InvocationID, ev.FD.Start, ev.SandboxID, prev)
		}
		lastEnd[ev.SandboxID] = ev.FD.End
	}
}

func TestInvocationIDsAreUnique(t *testing.T) {
	seen := make(map[string]bool)
	for _, ev := range Scenario() {
		if seen[ev.InvocationID] {
			t.Errorf("duplicate invocation_id %q - idempotency would silently drop it", ev.InvocationID)
		}
		seen[ev.InvocationID] = true
	}
}
