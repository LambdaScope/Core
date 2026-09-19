// Package processor is the decision layer: it consumes invocation events,
// compares them against learned behaviour, and raises alerts.
package processor

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/LambdaScope/Core/internal/anomaly"
	"github.com/LambdaScope/Core/internal/schema"
	"github.com/LambdaScope/Core/internal/store"
)

type Processor struct {
	store    store.Store
	detector *anomaly.Detector
	notifier Notifier
	explain  Explainer // optional; nil means use the local fallback text
	alerter  Alerter
	log      *slog.Logger

	// AlertMinSeverity is the floor for paging anyone out of band. Everything
	// still reaches the dashboard; this only gates SNS, so a noisy low-severity
	// finding does not wake someone at 3am.
	AlertMinSeverity schema.Severity
}

type Options struct {
	Store    store.Store
	Detector *anomaly.Detector
	Notifier Notifier
	Explain  Explainer
	Alerter  Alerter
	Log      *slog.Logger
}

func New(o Options) *Processor {
	if o.Notifier == nil {
		o.Notifier = NoopNotifier{}
	}
	if o.Alerter == nil {
		o.Alerter = NoopAlerter{}
	}
	if o.Log == nil {
		o.Log = slog.Default()
	}
	return &Processor{
		store:            o.Store,
		detector:         o.Detector,
		notifier:         o.Notifier,
		explain:          o.Explain,
		alerter:          o.Alerter,
		log:              o.Log,
		AlertMinSeverity: schema.SeverityHigh,
	}
}

// ErrMalformed marks a record that can never succeed no matter how often it is
// retried. These are dropped and counted rather than failed, because sending
// them back to Kinesis just burns the batch again on the next attempt.
type ErrMalformed struct{ Reason error }

func (e ErrMalformed) Error() string { return "malformed record: " + e.Reason.Error() }

// HandleRecord processes the raw bytes of one Kinesis record.
//
// It returns ErrMalformed for data that is permanently unusable, and any other
// error for a transient failure that is worth retrying.
func (p *Processor) HandleRecord(ctx context.Context, data []byte) error {
	var ev schema.InvocationEvent
	if err := json.Unmarshal(data, &ev); err != nil {
		return ErrMalformed{Reason: err}
	}
	if err := ev.Validate(); err != nil {
		return ErrMalformed{Reason: err}
	}
	return p.HandleEvent(ctx, &ev)
}

// HandleEvent runs the full pipeline for one already-decoded event.
func (p *Processor) HandleEvent(ctx context.Context, ev *schema.InvocationEvent) error {
	log := p.log.With("invocation_id", ev.InvocationID, "function", ev.FunctionName)

	// Idempotency gate. Kinesis delivers at least once; without this a retried
	// batch would re-alert and re-bill every anomaly in it.
	isNew, err := p.store.PutInvocation(ctx, ev)
	if err != nil {
		return fmt.Errorf("put invocation: %w", err)
	}
	if !isNew {
		log.Debug("duplicate record, already processed")
		return nil
	}

	baseline, err := p.store.LoadBaseline(ctx, ev.BaselineKey())
	if err != nil {
		return fmt.Errorf("load baseline: %w", err)
	}
	sandbox, err := p.store.LoadSandbox(ctx, ev.SandboxID)
	if err != nil {
		return fmt.Errorf("load sandbox: %w", err)
	}

	found := p.detector.Process(ev, baseline, sandbox)

	// Persist the learned state before anything else. If a later step fails and
	// the record is retried, the idempotency gate above stops us from learning
	// the same event twice.
	if err := p.store.SaveBaseline(ctx, baseline); err != nil {
		return fmt.Errorf("save baseline: %w", err)
	}
	if err := p.store.SaveSandbox(ctx, sandbox); err != nil {
		return fmt.Errorf("save sandbox: %w", err)
	}

	if err := p.notifier.Broadcast(ctx, schema.NewWSMessage(schema.MsgInvocation, trim(ev))); err != nil {
		// The dashboard is a view, not a system of record. Losing a frame is
		// not worth replaying the whole batch.
		log.Warn("broadcast invocation failed", "err", err)
	}

	for i := range found {
		if err := p.handleAnomaly(ctx, log, &found[i]); err != nil {
			return err
		}
	}

	if len(found) > 0 {
		log.Info("anomalies raised", "count", len(found))
	}
	return nil
}

// handleAnomaly implements the two-phase alert: the finding goes out
// immediately with no explanation, and the prose follows when it is ready.
// Holding the alert for 1-3 seconds while an LLM writes a sentence would make
// the dashboard feel broken.
func (p *Processor) handleAnomaly(ctx context.Context, log *slog.Logger, a *schema.Anomaly) error {
	isNew, err := p.store.PutAnomaly(ctx, a)
	if err != nil {
		return fmt.Errorf("put anomaly: %w", err)
	}
	if !isNew {
		return nil
	}

	log.Info("anomaly", "kind", a.Kind, "severity", a.Severity, "what", anomaly.Describe(*a))

	// Phase 1 - the alert itself, right now.
	//
	// Send a snapshot, not the pointer: we are about to fill in the explanation
	// below, and a notifier that queues or serialises later would otherwise
	// emit the mutated value and the "pending" state would never be observed.
	pending := *a
	if err := p.notifier.Broadcast(ctx, schema.NewWSMessage(schema.MsgAnomaly, pending)); err != nil {
		log.Warn("broadcast anomaly failed", "err", err)
	}

	// Phase 2 - the explanation, as soon as we have one.
	text, status := p.explanationFor(ctx, log, a)
	if err := p.store.SetExplanation(ctx, a.AnomalyID, &text, status); err != nil {
		log.Warn("persist explanation failed", "err", err)
	}
	a.Explanation, a.ExplanationStatus = &text, status

	update := schema.AnomalyUpdate{
		AnomalyID:         a.AnomalyID,
		Explanation:       &text,
		ExplanationStatus: status,
	}
	if err := p.notifier.Broadcast(ctx, schema.NewWSMessage(schema.MsgAnomalyUpdate, update)); err != nil {
		log.Warn("broadcast explanation failed", "err", err)
	}

	if a.Severity.Rank() >= p.AlertMinSeverity.Rank() {
		if err := p.alerter.Alert(ctx, *a); err != nil {
			log.Warn("out-of-band alert failed", "err", err)
		}
	}
	return nil
}

// explanationFor returns the text and how we got it.
//
// The signature cache is what makes this affordable: the same bad endpoint seen
// five hundred times costs one model call, not five hundred. An explainer
// failure is never fatal - we fall back to deterministic text so an alert is
// never shown empty.
func (p *Processor) explanationFor(ctx context.Context, log *slog.Logger, a *schema.Anomaly) (string, schema.ExplanationStatus) {
	if cached, ok, err := p.store.GetExplanation(ctx, a.Signature); err == nil && ok {
		return cached, schema.ExplanationReady
	}

	if p.explain == nil {
		return anomaly.Describe(*a), schema.ExplanationFailed
	}

	text, err := p.explain.Explain(ctx, *a)
	if err != nil || text == "" {
		log.Warn("explainer failed, using local fallback", "err", err)
		return anomaly.Describe(*a), schema.ExplanationFailed
	}

	if err := p.store.PutExplanation(ctx, a.Signature, text); err != nil {
		log.Warn("cache explanation failed", "err", err)
	}
	return text, schema.ExplanationReady
}

// maxSyscallsOnWire is re-exported for the tests in this package.
const maxSyscallsOnWire = schema.MaxSyscallsOnWire

// trim produces the dashboard's view of an invocation.
func trim(ev *schema.InvocationEvent) schema.InvocationEvent { return ev.ForWire() }
