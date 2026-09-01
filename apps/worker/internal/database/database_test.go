package database

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

type fakeConnection struct {
	pingError  error
	values     []bool
	queryError error
	query      string
	args       []any
}

func (connection *fakeConnection) Ping(context.Context) error {
	return connection.pingError
}

func (connection *fakeConnection) QueryRow(_ context.Context, query string, args ...any) pgxRow {
	connection.query = query
	connection.args = args
	return pgxRow{values: connection.values, err: connection.queryError}
}

type pgxRow struct {
	values []bool
	err    error
}

func (row pgxRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	for index, value := range row.values {
		pointer, ok := dest[index].(*bool)
		if !ok {
			return errors.New("unexpected scan destination")
		}
		*pointer = value
	}
	return nil
}

type testConnection struct {
	*fakeConnection
}

func (connection testConnection) QueryRow(ctx context.Context, query string, args ...any) pgx.Row {
	row := connection.fakeConnection.QueryRow(ctx, query, args...)
	return row
}

func TestReadinessAcceptsRestrictedRoleAndInstanceSchema(t *testing.T) {
	connection := &fakeConnection{values: []bool{true, true, true, true}}
	readiness := NewReadiness(testConnection{connection}, "sauryctf_worker")
	if err := readiness.Ready(context.Background()); err != nil {
		t.Fatalf("Ready() error = %v", err)
	}
	if len(connection.args) != 1 || connection.args[0] != "sauryctf_worker" {
		t.Fatalf("unexpected role arguments: %#v", connection.args)
	}
	for _, table := range []string{"public.instances", "public.instance_jobs", "public.instance_job_attempts"} {
		if !strings.Contains(connection.query, table) {
			t.Fatalf("readiness query does not check %s", table)
		}
	}
	for _, restriction := range []string{"NOT login_role.rolsuper", "NOT login_role.rolcreatedb", "NOT login_role.rolcreaterole", "NOT login_role.rolreplication", "NOT login_role.rolbypassrls"} {
		if !strings.Contains(connection.query, restriction) {
			t.Fatalf("readiness query does not enforce %s", restriction)
		}
	}
}

func TestReadinessKeepsLivenessIndependentFromDatabase(t *testing.T) {
	readiness := NewReadiness(testConnection{&fakeConnection{pingError: errors.New("secret dsn failure")}}, "sauryctf_worker")
	err := readiness.Ready(context.Background())
	if !errors.Is(err, ErrUnavailable) || strings.Contains(err.Error(), "secret") {
		t.Fatalf("Ready() error = %q, want sanitized database error", err)
	}
}

func TestReadinessSanitizesQueryFailures(t *testing.T) {
	readiness := NewReadiness(testConnection{&fakeConnection{queryError: errors.New("role or schema secret")}}, "sauryctf_worker")
	err := readiness.Ready(context.Background())
	if !errors.Is(err, ErrUnavailable) || strings.Contains(err.Error(), "secret") {
		t.Fatalf("Ready() error = %q, want sanitized query error", err)
	}
}

func TestReadinessRejectsBroadRoleAndIncompleteSchema(t *testing.T) {
	tests := []struct {
		name   string
		values []bool
		want   error
	}{
		{name: "role", values: []bool{false, true, true, true}, want: ErrUnexpectedRole},
		{name: "schema", values: []bool{true, true, false, true}, want: ErrInstanceSchema},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			readiness := NewReadiness(testConnection{&fakeConnection{values: test.values}}, "sauryctf_worker")
			if err := readiness.Ready(context.Background()); !errors.Is(err, test.want) {
				t.Fatalf("Ready() error = %v, want %v", err, test.want)
			}
		})
	}
}
