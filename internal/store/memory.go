package store

import (
	"context"
	"encoding/json"
	"sort"
	"sync"

	"github.com/LambdaScope/Core/internal/anomaly"
	"github.com/LambdaScope/Core/internal/schema"
)

// Memory is a complete in-process Store.
//
// It is not a toy: it enforces the same conditional-write semantics as the
// DynamoDB implementation, and it deep-copies everything on the way in and out
// so that a caller mutating a returned Baseline cannot silently corrupt stored
// state. DynamoDB always hands back a fresh copy; if Memory handed back a
// pointer into its own map, tests would pass here and fail in production.
type Memory struct {
	mu sync.RWMutex

	baselines    map[string]*anomaly.Baseline
	sandboxes    map[string]*anomaly.SandboxState
	invocations  map[string]schema.InvocationEvent
	anomalies    map[string]schema.Anomaly
	explanations map[string]string
	connections  map[string]bool

	// insertion order, so "recent" means something without real timestamps
	invocationOrder []string
	anomalyOrder    []string
}

func NewMemory() *Memory {
	return &Memory{
		baselines:    make(map[string]*anomaly.Baseline),
		sandboxes:    make(map[string]*anomaly.SandboxState),
		invocations:  make(map[string]schema.InvocationEvent),
		anomalies:    make(map[string]schema.Anomaly),
		explanations: make(map[string]string),
		connections:  make(map[string]bool),
	}
}

// compile-time check that Memory satisfies the interface
var _ Store = (*Memory)(nil)

func deepCopy[T any](src T) T {
	var dst T
	b, err := json.Marshal(src)
	if err != nil {
		return dst
	}
	_ = json.Unmarshal(b, &dst)
	return dst
}

// --- learned state ---------------------------------------------------------

func (m *Memory) LoadBaseline(_ context.Context, key string) (*anomaly.Baseline, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	b, ok := m.baselines[key]
	if !ok {
		return anomaly.NewBaseline(key), nil
	}
	return deepCopy(b), nil
}

func (m *Memory) SaveBaseline(_ context.Context, b *anomaly.Baseline) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.baselines[b.Key] = deepCopy(b)
	return nil
}

func (m *Memory) LoadSandbox(_ context.Context, id string) (*anomaly.SandboxState, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	s, ok := m.sandboxes[id]
	if !ok {
		return anomaly.NewSandboxState(id), nil
	}
	return deepCopy(s), nil
}

func (m *Memory) SaveSandbox(_ context.Context, s *anomaly.SandboxState) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sandboxes[s.SandboxID] = deepCopy(s)
	return nil
}

// --- records ---------------------------------------------------------------

func (m *Memory) PutInvocation(_ context.Context, ev *schema.InvocationEvent) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.invocations[ev.InvocationID]; exists {
		return false, nil // duplicate Kinesis delivery
	}
	m.invocations[ev.InvocationID] = deepCopy(*ev)
	m.invocationOrder = append(m.invocationOrder, ev.InvocationID)
	return true, nil
}

func (m *Memory) PutAnomaly(_ context.Context, a *schema.Anomaly) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.anomalies[a.AnomalyID]; exists {
		return false, nil
	}
	m.anomalies[a.AnomalyID] = deepCopy(*a)
	m.anomalyOrder = append(m.anomalyOrder, a.AnomalyID)
	return true, nil
}

func (m *Memory) SetExplanation(_ context.Context, anomalyID string, explanation *string, status schema.ExplanationStatus) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	a, ok := m.anomalies[anomalyID]
	if !ok {
		return nil // nothing to update; not an error worth failing a batch over
	}
	a.Explanation = explanation
	a.ExplanationStatus = status
	m.anomalies[anomalyID] = a
	return nil
}

// --- explanation cache -----------------------------------------------------

func (m *Memory) GetExplanation(_ context.Context, signature string) (string, bool, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	v, ok := m.explanations[signature]
	return v, ok, nil
}

func (m *Memory) PutExplanation(_ context.Context, signature, explanation string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.explanations[signature] = explanation
	return nil
}

// --- reads for the dashboard -----------------------------------------------

func (m *Memory) RecentInvocations(_ context.Context, limit int) ([]schema.InvocationEvent, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	out := make([]schema.InvocationEvent, 0, limit)
	for i := len(m.invocationOrder) - 1; i >= 0 && len(out) < limit; i-- {
		out = append(out, m.invocations[m.invocationOrder[i]])
	}
	return out, nil
}

func (m *Memory) RecentAnomalies(_ context.Context, limit int) ([]schema.Anomaly, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	out := make([]schema.Anomaly, 0, limit)
	for i := len(m.anomalyOrder) - 1; i >= 0 && len(out) < limit; i-- {
		out = append(out, m.anomalies[m.anomalyOrder[i]])
	}
	return out, nil
}

// --- websocket connections -------------------------------------------------

func (m *Memory) AddConnection(_ context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.connections[id] = true
	return nil
}

func (m *Memory) RemoveConnection(_ context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.connections, id)
	return nil
}

func (m *Memory) ListConnections(_ context.Context) ([]string, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	out := make([]string, 0, len(m.connections))
	for id := range m.connections {
		out = append(out, id)
	}
	sort.Strings(out) // deterministic, so broadcast order is reproducible in tests
	return out, nil
}
