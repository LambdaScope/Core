package processor

import (
	"context"
	"errors"

	"github.com/aws/aws-lambda-go/events"
)

// HandleKinesis is the Lambda entry point for a batch of stream records.
//
// It never returns a non-nil error. Returning one would make Lambda retry the
// ENTIRE batch, which means every already-successful record in it gets
// reprocessed: duplicate alerts, duplicate model calls, duplicate pages. Instead
// we report exactly which records failed via BatchItemFailures, and Lambda
// retries only those.
//
// This requires FunctionResponseTypes: [ReportBatchItemFailures] on the event
// source mapping in the SAM template. Without that flag the response is ignored
// and the all-or-nothing behaviour comes back silently.
func (p *Processor) HandleKinesis(ctx context.Context, ev events.KinesisEvent) (events.KinesisEventResponse, error) {
	var failures []events.KinesisBatchItemFailure

	for _, rec := range ev.Records {
		// The Lambda SDK has already base64-decoded this for us.
		err := p.HandleRecord(ctx, rec.Kinesis.Data)
		if err == nil {
			continue
		}

		// A record that cannot be parsed will never parse, however many times
		// we try. Drop it loudly rather than poisoning the shard forever - one
		// bad record blocking a stream is a classic way to lose a whole demo.
		var malformed ErrMalformed
		if errors.As(err, &malformed) {
			p.log.Error("dropping unprocessable record",
				"sequence", rec.Kinesis.SequenceNumber,
				"err", malformed.Reason)
			continue
		}

		p.log.Error("record failed, will be retried",
			"sequence", rec.Kinesis.SequenceNumber, "err", err)
		failures = append(failures, events.KinesisBatchItemFailure{
			ItemIdentifier: rec.Kinesis.SequenceNumber,
		})
	}

	return events.KinesisEventResponse{BatchItemFailures: failures}, nil
}
