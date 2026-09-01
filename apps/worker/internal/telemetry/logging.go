package telemetry

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"regexp"
	"strings"
)

const redactedValue = "[REDACTED]"

var (
	sensitiveKeyPattern = regexp.MustCompile(`(?i)(authorization|cookie|credential|password|secret|session|token|flag|answer)`)
	postgresURLPattern  = regexp.MustCompile(`(?i)(postgres(?:ql)?://[^:/\s]+:)[^@\s]+(@)`)
	bearerPattern       = regexp.MustCompile(`(?i)bearer\s+[A-Za-z0-9._~+/=-]+`)
	flagValuePattern    = regexp.MustCompile(`(?i)(?:flag|ctf)\{[^}\r\n]+\}`)
	assignmentPattern   = regexp.MustCompile(`(?i)(password|token|secret|credential)\s*[=:]\s*[^\s&,;]+`)
)

// NewJSONLogger returns the worker's single structured logging entry point.
// The wrapping handler applies the same redaction policy to every subsystem,
// including attributes supplied by dependencies and errors.
func NewJSONLogger(writer io.Writer) *slog.Logger {
	return slog.New(NewRedactingHandler(slog.NewJSONHandler(writer, nil)))
}

func NewRedactingHandler(next slog.Handler) slog.Handler {
	return &redactingHandler{next: next}
}

type redactingHandler struct {
	next slog.Handler
}

func (handler *redactingHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return handler.next.Enabled(ctx, level)
}

func (handler *redactingHandler) Handle(ctx context.Context, record slog.Record) error {
	redacted := slog.NewRecord(record.Time, record.Level, record.Message, record.PC)
	record.Attrs(func(attribute slog.Attr) bool {
		redacted.AddAttrs(redactAttribute(attribute))
		return true
	})
	return handler.next.Handle(ctx, redacted)
}

func (handler *redactingHandler) WithAttrs(attributes []slog.Attr) slog.Handler {
	redacted := make([]slog.Attr, 0, len(attributes))
	for _, attribute := range attributes {
		redacted = append(redacted, redactAttribute(attribute))
	}
	return &redactingHandler{next: handler.next.WithAttrs(redacted)}
}

func (handler *redactingHandler) WithGroup(name string) slog.Handler {
	return &redactingHandler{next: handler.next.WithGroup(name)}
}

func redactAttribute(attribute slog.Attr) slog.Attr {
	attribute.Value = attribute.Value.Resolve()
	if sensitiveKeyPattern.MatchString(attribute.Key) {
		return slog.String(attribute.Key, redactedValue)
	}
	if attribute.Value.Kind() == slog.KindGroup {
		children := attribute.Value.Group()
		redacted := make([]slog.Attr, 0, len(children))
		for _, child := range children {
			redacted = append(redacted, redactAttribute(child))
		}
		return slog.Group(attribute.Key, attrsToAny(redacted)...)
	}
	if attribute.Value.Kind() == slog.KindString {
		return slog.String(attribute.Key, sanitizeText(attribute.Value.String()))
	}
	if attribute.Value.Kind() == slog.KindAny {
		return slog.Any(attribute.Key, redactAny(attribute.Value.Any()))
	}
	return attribute
}

func redactAny(value any) any {
	switch typed := value.(type) {
	case nil, bool,
		int, int8, int16, int32, int64,
		uint, uint8, uint16, uint32, uint64,
		float32, float64, json.Number:
		return typed
	case error:
		return sanitizeText(typed.Error())
	case string:
		return sanitizeText(typed)
	case slog.LogValuer:
		return redactAttribute(slog.Any("value", typed.LogValue())).Value.Any()
	case map[string]any:
		return redactMap(typed)
	case []any:
		redacted := make([]any, len(typed))
		for index, item := range typed {
			redacted[index] = redactAny(item)
		}
		return redacted
	}

	encoded, err := json.Marshal(value)
	if err != nil {
		return value
	}
	var decoded any
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		return value
	}
	return redactAny(decoded)
}

func redactMap(value map[string]any) map[string]any {
	redacted := make(map[string]any, len(value))
	for key, child := range value {
		if sensitiveKeyPattern.MatchString(key) {
			redacted[key] = redactedValue
		} else {
			redacted[key] = redactAny(child)
		}
	}
	return redacted
}

func attrsToAny(attributes []slog.Attr) []any {
	values := make([]any, len(attributes))
	for index, attribute := range attributes {
		values[index] = attribute
	}
	return values
}

func sanitizeText(value string) string {
	value = postgresURLPattern.ReplaceAllString(value, `${1}`+redactedValue+`${2}`)
	value = bearerPattern.ReplaceAllString(value, redactedValue)
	value = flagValuePattern.ReplaceAllString(value, redactedValue)
	value = assignmentPattern.ReplaceAllStringFunc(value, func(match string) string {
		separator := strings.IndexAny(match, "=:")
		if separator < 0 {
			return redactedValue
		}
		return fmt.Sprintf("%s=%s", strings.TrimSpace(match[:separator]), redactedValue)
	})
	return value
}
