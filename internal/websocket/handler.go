package websocket

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sync"

	"github.com/LambdaScope/Core/internal/schema"
	"github.com/LambdaScope/Core/internal/store"
	"github.com/aws/aws-lambda-go/events"
)

// Snapshot sizes. The dashboard needs enough to render a populated page the
// moment it opens; more than this is a scroll-back feature, not a snapshot.
const (
	snapshotInvocations = 50
	snapshotAnomalies   = 10
)

// ActionSnapshot is what the dashboard sends right after the socket opens.
//
// API Gateway does not let a $connect handler post to the connection it is
// accepting - the connection only exists once the handler returns - so the
// snapshot cannot be pushed on connect. The client asks for it instead:
//
//	ws.onopen = () => ws.send(JSON.stringify({ action: "snapshot" }))
const ActionSnapshot = "snapshot"

// PosterFactory builds a Poster for a given management endpoint.
type PosterFactory func(ctx context.Context, endpoint string) (Poster, error)

// Handler serves the $connect, $disconnect and $default routes.
type Handler struct {
	store     store.Store
	newPoster PosterFactory
	log       *slog.Logger

	// Endpoint overrides the management endpoint derived from the request.
	// Needed when the API sits behind a custom domain.
	Endpoint string

	mu      sync.Mutex
	posters map[string]Poster // one client per endpoint, reused across invocations
}

func NewHandler(st store.Store, newPoster PosterFactory, log *slog.Logger) *Handler {
	if log == nil {
		log = slog.Default()
	}
	return &Handler{store: st, newPoster: newPoster, log: log, posters: make(map[string]Poster)}
}

func respond(status int, body string) events.APIGatewayProxyResponse {
	return events.APIGatewayProxyResponse{StatusCode: status, Body: body}
}

// Handle is the Lambda entry point for all WebSocket routes.
func (h *Handler) Handle(ctx context.Context, req events.APIGatewayWebsocketProxyRequest) (events.APIGatewayProxyResponse, error) {
	id := req.RequestContext.ConnectionID
	log := h.log.With("route", req.RequestContext.RouteKey, "connection", id)

	switch req.RequestContext.RouteKey {
	case "$connect":
		if err := h.store.AddConnection(ctx, id); err != nil {
			log.Error("register connection", "err", err)
			// A non-2xx here makes API Gateway refuse the connection, which is
			// right: an unregistered viewer would never receive a broadcast.
			return respond(http.StatusInternalServerError, "could not register connection"), nil
		}
		return respond(http.StatusOK, ""), nil

	case "$disconnect":
		if err := h.store.RemoveConnection(ctx, id); err != nil {
			// The connection is already closed; the TTL will clean the row up.
			log.Warn("forget connection", "err", err)
		}
		return respond(http.StatusOK, ""), nil

	default:
		return h.handleMessage(ctx, log, req), nil
	}
}

func (h *Handler) handleMessage(ctx context.Context, log *slog.Logger, req events.APIGatewayWebsocketProxyRequest) events.APIGatewayProxyResponse {
	var msg struct {
		Action string `json:"action"`
	}
	if err := json.Unmarshal([]byte(req.Body), &msg); err != nil {
		return respond(http.StatusBadRequest, "body must be JSON like {\"action\":\"snapshot\"}")
	}
	if msg.Action != ActionSnapshot {
		return respond(http.StatusBadRequest, fmt.Sprintf("unknown action %q", msg.Action))
	}

	poster, err := h.posterFor(ctx, req)
	if err != nil {
		log.Error("management client", "err", err)
		return respond(http.StatusInternalServerError, "")
	}

	snap, err := h.buildSnapshot(ctx)
	if err != nil {
		log.Error("build snapshot", "err", err)
		return respond(http.StatusInternalServerError, "")
	}

	n := NewNotifier(poster, h.store)
	if err := n.SendTo(ctx, req.RequestContext.ConnectionID, snap); err != nil {
		log.Error("send snapshot", "err", err)
		return respond(http.StatusInternalServerError, "")
	}
	return respond(http.StatusOK, "")
}

// buildSnapshot assembles recent state and shrinks it until it fits one frame.
func (h *Handler) buildSnapshot(ctx context.Context) (schema.WSMessage, error) {
	invs, err := h.store.RecentInvocations(ctx, snapshotInvocations)
	if err != nil {
		return schema.WSMessage{}, err
	}
	anoms, err := h.store.RecentAnomalies(ctx, snapshotAnomalies)
	if err != nil {
		return schema.WSMessage{}, err
	}
	for i := range invs {
		invs[i] = invs[i].ForWire()
	}

	// Anomalies matter more than history, so if the frame is too big we drop
	// the oldest invocations first and keep every anomaly.
	for {
		msg := schema.NewWSMessage(schema.MsgSnapshot, schema.Snapshot{Invocations: invs, Anomalies: anoms})
		if _, err := encode(msg); err == nil {
			return msg, nil
		} else if !errors.Is(err, ErrFrameTooLarge) {
			return schema.WSMessage{}, err
		}
		if len(invs) == 0 {
			return schema.WSMessage{}, ErrFrameTooLarge
		}
		invs = invs[:len(invs)/2]
	}
}

// ManagementEndpoint derives the https management endpoint for the stage that
// received this request.
func ManagementEndpoint(req events.APIGatewayWebsocketProxyRequest) string {
	return "https://" + req.RequestContext.DomainName + "/" + req.RequestContext.Stage
}

func (h *Handler) posterFor(ctx context.Context, req events.APIGatewayWebsocketProxyRequest) (Poster, error) {
	endpoint := h.Endpoint
	if endpoint == "" {
		endpoint = ManagementEndpoint(req)
	}

	h.mu.Lock()
	defer h.mu.Unlock()
	if p, ok := h.posters[endpoint]; ok {
		return p, nil
	}
	p, err := h.newPoster(ctx, endpoint)
	if err != nil {
		return nil, err
	}
	h.posters[endpoint] = p
	return p, nil
}
