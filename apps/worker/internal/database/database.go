// Package database owns the private PostgreSQL connection used by the
// instance worker.
package database

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrUnavailable    = errors.New("worker database is unavailable")
	ErrUnexpectedRole = errors.New("expected worker database role is not active")
	ErrInstanceSchema = errors.New("instance job schema is not ready")
)

// Options configures the worker's dedicated connection pool.
type Options struct {
	URL            string
	MaxConnections int32
	ConnectTimeout time.Duration
}

// Open creates a lazy PostgreSQL pool. Readiness, rather than process startup,
// reports transient database availability so liveness remains independent.
func Open(ctx context.Context, options Options) (*pgxpool.Pool, error) {
	poolConfig, err := pgxpool.ParseConfig(options.URL)
	if err != nil {
		return nil, errors.New("parse worker database configuration")
	}
	poolConfig.MaxConns = options.MaxConnections
	poolConfig.ConnConfig.ConnectTimeout = options.ConnectTimeout

	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, errors.New("create worker database pool")
	}
	return pool, nil
}

type connection interface {
	Ping(context.Context) error
	QueryRow(context.Context, string, ...any) pgx.Row
}

// Readiness verifies that the Worker is connected through its restricted role
// and that the instance queue schema is available.
type Readiness struct {
	connection   connection
	expectedRole string
}

func NewReadiness(connection connection, expectedRole string) *Readiness {
	return &Readiness{connection: connection, expectedRole: expectedRole}
}

func (readiness *Readiness) Ready(ctx context.Context) error {
	if err := readiness.connection.Ping(ctx); err != nil {
		return ErrUnavailable
	}

	var roleAccepted bool
	var instancesReady bool
	var jobsReady bool
	var attemptsReady bool
	var orphanReportsReady bool
	query := `
		SELECT
			EXISTS (
				SELECT 1
				FROM pg_roles AS login_role
				JOIN pg_roles AS expected_role ON expected_role.rolname = $1
				WHERE login_role.rolname = current_user
				  AND NOT login_role.rolsuper
				  AND NOT login_role.rolcreatedb
				  AND NOT login_role.rolcreaterole
				  AND NOT login_role.rolreplication
				  AND NOT login_role.rolbypassrls
				  AND (
					current_user = expected_role.rolname
					OR pg_has_role(current_user, expected_role.oid, 'member')
				  )
			),
			to_regclass('public.instances') IS NOT NULL,
			to_regclass('public.instance_jobs') IS NOT NULL,
			to_regclass('public.instance_job_attempts') IS NOT NULL,
			to_regclass('public.instance_orphan_reports') IS NOT NULL`
	if err := readiness.connection.QueryRow(ctx, query, readiness.expectedRole).Scan(
		&roleAccepted,
		&instancesReady,
		&jobsReady,
		&attemptsReady,
		&orphanReportsReady,
	); err != nil {
		return ErrUnavailable
	}
	if !roleAccepted {
		return ErrUnexpectedRole
	}
	if !instancesReady || !jobsReady || !attemptsReady || !orphanReportsReady {
		return fmt.Errorf("%w: required instance tables are missing", ErrInstanceSchema)
	}
	return nil
}
