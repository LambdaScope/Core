package anomaly

import "math"

// ewmaAlpha controls how fast the baseline forgets. 0.1 means roughly the last
// ten invocations dominate. Higher = adapts faster but is noisier.
const ewmaAlpha = 0.1

// SyscallStat is an exponentially-weighted running mean and variance.
//
// The point of EWMA is that it needs O(1) storage per syscall instead of a
// growing history: two floats, updated in constant time. That matters because
// this lives in DynamoDB and gets read and written on every single invocation.
type SyscallStat struct {
	Mean     float64 `json:"mean"`
	Variance float64 `json:"variance"`
	Count    int     `json:"count"`
}

// Update folds one new observation into the running statistics.
func (s *SyscallStat) Update(x float64) {
	if s.Count == 0 {
		s.Mean, s.Variance, s.Count = x, 0, 1
		return
	}
	delta := x - s.Mean
	s.Mean += ewmaAlpha * delta
	s.Variance = (1 - ewmaAlpha) * (s.Variance + ewmaAlpha*delta*delta)
	s.Count++
}

func (s *SyscallStat) StdDev() float64 { return math.Sqrt(s.Variance) }

// Baseline is one function's learned notion of "normal".
//
// Nothing in here comes from a threat feed or a blocklist. It is built
// entirely from the function's own past behaviour, which is why this approach
// catches attacks nobody has seen before: we are not asking "is this known
// bad?", we are asking "is this different from what this function always does?"
type Baseline struct {
	Key             string `json:"key"` // function ARN (+ version)
	InvocationCount int    `json:"invocation_count"`

	// KnownEndpoints holds "ip:port" strings learned during the learning window.
	KnownEndpoints map[string]bool `json:"known_endpoints"`

	// SeenExternalEgress records whether this function has EVER contacted an
	// address outside the AWS ranges. A function whose answer is "never" and
	// which suddenly does so is the strongest signal we have.
	SeenExternalEgress bool `json:"seen_external_egress"`

	Syscalls map[string]*SyscallStat `json:"syscalls"`
}

func NewBaseline(key string) *Baseline {
	return &Baseline{
		Key:            key,
		KnownEndpoints: make(map[string]bool),
		Syscalls:       make(map[string]*SyscallStat),
	}
}

// ensure guards against a Baseline that came back from JSON with nil maps.
func (b *Baseline) ensure() {
	if b.KnownEndpoints == nil {
		b.KnownEndpoints = make(map[string]bool)
	}
	if b.Syscalls == nil {
		b.Syscalls = make(map[string]*SyscallStat)
	}
}

// Knows reports whether this endpoint has been seen before.
func (b *Baseline) Knows(endpoint string) bool {
	b.ensure()
	return b.KnownEndpoints[endpoint]
}

// SandboxState is the per-warm-container memory the FD detector needs.
//
// It is keyed by sandbox_id rather than by function, because file descriptors
// accumulate inside one container. A fresh container starts clean, so its
// history must start clean too.
type SandboxState struct {
	SandboxID    string `json:"sandbox_id"`
	RecentDeltas []int  `json:"recent_deltas"`
	LeakReported bool   `json:"leak_reported"`
}

func NewSandboxState(id string) *SandboxState {
	return &SandboxState{SandboxID: id}
}

// push appends a delta and keeps only the last window entries.
func (s *SandboxState) push(delta, window int) {
	s.RecentDeltas = append(s.RecentDeltas, delta)
	if len(s.RecentDeltas) > window {
		s.RecentDeltas = s.RecentDeltas[len(s.RecentDeltas)-window:]
	}
}

// growth returns the total increase across the window, and whether every
// invocation in it grew.
//
// The "every one grew" condition is what separates a leak from noise: a leak
// is monotonic. A single healthy invocation (delta <= 0) means something is
// being released, so suspicion is cleared.
func (s *SandboxState) growth() (total int, monotonic bool) {
	for _, d := range s.RecentDeltas {
		if d <= 0 {
			return 0, false
		}
		total += d
	}
	return total, true
}
