# SauryCTF instance worker

This directory is the independent Go module for the private dynamic-instance
worker. It will consume versioned `instance_jobs`, operate approved Docker or
Kubernetes providers, reconcile managed resources, and write observations back
to PostgreSQL.

The worker must not expose public user, authentication, contest, submission, or
administration APIs. It must not import code from `legacy/go-monolith`.

The executable entry point will be added under `cmd/worker` by OpenSpec task
8.1. Until then this package only establishes the module and ownership boundary.
