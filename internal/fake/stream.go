// Package fake generates realistic invocation events.
//
// This is what keeps the Go side independent: the whole pipeline can be built,
// run and proved before the Rust extension emits its first real event. The
// same generator is reused later to push events into a real Kinesis stream.
package fake

import (
	"fmt"
	"time"

	"github.com/LambdaScope/Core/internal/schema"
)

const (
	FunctionARN  = "arn:aws:lambda:ap-south-1:123456789012:function:demo-checkout-api"
	FunctionName = "demo-checkout-api"

	EndpointDynamoDB = "52.94.236.248"  // inside AWS
	EndpointS3       = "52.216.153.51"  // inside AWS
	EndpointC2       = "185.220.101.47" // outside AWS - the "compromised dependency"
	EndpointSSH      = "45.148.10.92"   // outside AWS, port 22
)

type builder struct {
	events []schema.InvocationEvent
	clock  int64
	seq    int

	// seen tracks which sandboxes have already produced an event. A cold start
	// is by definition the first invocation in a new container, so it is a
	// property of the sandbox, not of the descriptor count.
	seen map[string]bool
}

func (b *builder) add(sandbox string, fdStart, fdDelta int, conns []schema.Connection, duration int64) {
	b.seq++
	b.clock += 1500

	if b.seen == nil {
		b.seen = make(map[string]bool)
	}
	cold := !b.seen[sandbox]
	b.seen[sandbox] = true
	b.events = append(b.events, schema.InvocationEvent{
		V:                schema.Version,
		Type:             "invocation",
		InvocationID:     fmt.Sprintf("inv-%03d", b.seq),
		SandboxID:        sandbox,
		ExtensionVersion: "0.1.0",
		FunctionARN:      FunctionARN,
		FunctionName:     FunctionName,
		FunctionVersion:  "$LATEST",
		Region:           "ap-south-1",
		StartMS:          b.clock,
		DurationMS:       duration,
		ColdStart:        cold,
		Tier:             schema.TierProcFallback,
		Connections:      conns,
		FD: schema.FD{
			Start: fdStart,
			End:   fdStart + fdDelta,
			Delta: fdDelta,
			Peak:  fdStart + fdDelta,
			Limit: 1024,
		},
		MemRSSKB: 51200,
		Threads:  4,
		Syscalls: nil, // proc_fallback cannot see syscalls
	})
}

func conn(ip string, port int) schema.Connection {
	return schema.Connection{RemoteIP: ip, RemotePort: port, Proto: "tcp", State: "ESTABLISHED"}
}

// Scenario returns a story in twenty invocations:
//
//	 1-10  sandbox A - normal AWS traffic, but file descriptors climb by 2
//	       every run. The leak is reported once the window fills.
//	11-20  sandbox B - a fresh, healthy container. On invocation 15 something
//	       in the function starts talking to an address outside AWS, and on 18
//	       it opens an SSH connection.
func Scenario() []schema.InvocationEvent {
	b := &builder{clock: time.Date(2026, 9, 18, 9, 0, 0, 0, time.UTC).UnixMilli()}

	awsOnly := []schema.Connection{conn(EndpointDynamoDB, 443)}
	awsBoth := []schema.Connection{conn(EndpointDynamoDB, 443), conn(EndpointS3, 443)}

	// Sandbox A: healthy-looking traffic, quietly leaking descriptors.
	fd := 12
	for i := 0; i < 10; i++ {
		c := awsOnly
		if i%3 == 2 {
			c = awsBoth
		}
		b.add("sbx-a1", fd, 2, c, 80+int64(i))
		fd += 2
	}

	// Sandbox B: fresh container, flat descriptors.
	b.add("sbx-b2", 12, 0, awsOnly, 298)
	b.add("sbx-b2", 12, 0, awsOnly, 71)
	b.add("sbx-b2", 12, 0, awsBoth, 68)
	b.add("sbx-b2", 12, 0, awsOnly, 74)

	// Invocation 15: the first contact outside AWS. Note the duration jump.
	b.add("sbx-b2", 12, 1, []schema.Connection{conn(EndpointDynamoDB, 443), conn(EndpointC2, 8443)}, 241)
	b.add("sbx-b2", 13, 0, awsOnly, 70)
	b.add("sbx-b2", 13, 1, []schema.Connection{conn(EndpointDynamoDB, 443), conn(EndpointC2, 8443)}, 233)

	// Invocation 18: SSH. A Lambda function has no business doing this.
	b.add("sbx-b2", 14, 0, []schema.Connection{conn(EndpointDynamoDB, 443), conn(EndpointSSH, 22)}, 189)

	b.add("sbx-b2", 14, 0, awsBoth, 66)
	b.add("sbx-b2", 14, 0, awsOnly, 72)

	return b.events
}
