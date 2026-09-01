package reconcile

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/saurlax/sauryctf/apps/worker/internal/contracts"
	"github.com/saurlax/sauryctf/apps/worker/internal/jobs"
	"github.com/saurlax/sauryctf/apps/worker/internal/providers"
)

type recordedObservation struct {
	instance           DesiredInstance
	expectedResourceID string
	observation        jobs.Observation
}

type fakeStore struct {
	mu           sync.Mutex
	desired      []DesiredInstance
	listCalls    int
	observations []recordedObservation
	orphans      []OrphanReport
}

func (store *fakeStore) ListDesiredInstances(context.Context) ([]DesiredInstance, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	store.listCalls++
	return append([]DesiredInstance(nil), store.desired...), nil
}

func (store *fakeStore) RecordObservation(_ context.Context, instance DesiredInstance, expectedResourceID string, observation jobs.Observation) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	store.observations = append(store.observations, recordedObservation{instance: instance, expectedResourceID: expectedResourceID, observation: observation})
	return nil
}

func (store *fakeStore) ReportOrphan(_ context.Context, report OrphanReport) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	store.orphans = append(store.orphans, report)
	return nil
}

type fakeBackend struct {
	resources []Resource
	ensured   []contracts.UUID
	inspected []string
	destroyed []string
}

type recoveryStore struct {
	mu                   sync.Mutex
	desired              []DesiredInstance
	recordFailuresLeft   int
	recordedObservations []recordedObservation
}

func (store *recoveryStore) ListDesiredInstances(context.Context) ([]DesiredInstance, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	return append([]DesiredInstance(nil), store.desired...), nil
}

func (store *recoveryStore) RecordObservation(_ context.Context, instance DesiredInstance, expectedResourceID string, observation jobs.Observation) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.recordFailuresLeft > 0 {
		store.recordFailuresLeft--
		return errors.New("injected crash before observation writeback")
	}
	for index := range store.desired {
		current := &store.desired[index]
		if current.ID != instance.ID || current.DesiredGeneration != instance.DesiredGeneration {
			continue
		}
		if current.ProviderResourceID != "" && current.ProviderResourceID != expectedResourceID {
			return ErrObservationConflict
		}
		current.ObservedState = observation.State
		current.ObservedGeneration = uint64(instance.DesiredGeneration)
		current.ProviderResourceID = observation.ProviderResourceID
		store.recordedObservations = append(store.recordedObservations, recordedObservation{
			instance: instance, expectedResourceID: expectedResourceID, observation: observation,
		})
		return nil
	}
	return ErrObservationConflict
}

func (*recoveryStore) ReportOrphan(context.Context, OrphanReport) error { return nil }

func (store *recoveryStore) providerResourceID() string {
	store.mu.Lock()
	defer store.mu.Unlock()
	if len(store.desired) == 0 {
		return ""
	}
	return store.desired[0].ProviderResourceID
}

type recoveryBackend struct {
	mu           sync.Mutex
	resources    map[string]Resource
	ensureCalls  int
	inspectCalls int
	listBarrier  *sync.WaitGroup
}

func newRecoveryBackend() *recoveryBackend {
	return &recoveryBackend{resources: make(map[string]Resource)}
}

func (backend *recoveryBackend) ListResources(context.Context) ([]Resource, error) {
	backend.mu.Lock()
	resources := make([]Resource, 0, len(backend.resources))
	for _, resource := range backend.resources {
		resources = append(resources, resource)
	}
	barrier := backend.listBarrier
	backend.mu.Unlock()
	if barrier != nil {
		barrier.Done()
		barrier.Wait()
	}
	return resources, nil
}

func (backend *recoveryBackend) Ensure(_ context.Context, spec providers.InstanceSpec) (jobs.Observation, error) {
	resourceID, err := spec.Key.ResourceName()
	if err != nil {
		return jobs.Observation{}, err
	}
	backend.mu.Lock()
	defer backend.mu.Unlock()
	backend.ensureCalls++
	backend.resources[spec.Key.IdentityKey()] = testResource(resourceID, Ownership(spec.Key))
	return jobs.Observation{State: jobs.ObservedStarting, ProviderResourceID: resourceID}, nil
}

func (backend *recoveryBackend) Inspect(_ context.Context, key providers.InstanceKey) (jobs.Observation, error) {
	backend.mu.Lock()
	defer backend.mu.Unlock()
	backend.inspectCalls++
	resource, exists := backend.resources[key.IdentityKey()]
	if !exists {
		return jobs.Observation{State: jobs.ObservedStopped}, nil
	}
	return jobs.Observation{
		State: jobs.ObservedRunning, ProviderResourceID: resource.ResourceID,
		Entrypoints: []jobs.Entrypoint{{Name: "web", Protocol: "http", Host: "challenge.internal", Port: 8080, URL: "https://challenge.example.test"}},
	}, nil
}

func (backend *recoveryBackend) Destroy(_ context.Context, key providers.InstanceKey) (jobs.Observation, error) {
	backend.mu.Lock()
	defer backend.mu.Unlock()
	delete(backend.resources, key.IdentityKey())
	return jobs.Observation{State: jobs.ObservedStopped}, nil
}

func (backend *recoveryBackend) resourceCount() int {
	backend.mu.Lock()
	defer backend.mu.Unlock()
	return len(backend.resources)
}

func (backend *recoveryBackend) deleteExternally(key providers.InstanceKey) {
	backend.mu.Lock()
	defer backend.mu.Unlock()
	delete(backend.resources, key.IdentityKey())
}

func (backend *fakeBackend) ListResources(context.Context) ([]Resource, error) {
	return append([]Resource(nil), backend.resources...), nil
}

func (backend *fakeBackend) Ensure(_ context.Context, spec providers.InstanceSpec) (jobs.Observation, error) {
	backend.ensured = append(backend.ensured, spec.Key.Instance)
	return jobs.Observation{State: jobs.ObservedStarting, ProviderResourceID: "resource/" + string(spec.Key.Instance)}, nil
}

func (backend *fakeBackend) Inspect(_ context.Context, key providers.InstanceKey) (jobs.Observation, error) {
	resourceID := fakeResourceID(key)
	backend.inspected = append(backend.inspected, resourceID)
	return jobs.Observation{
		State: jobs.ObservedRunning, ProviderResourceID: resourceID,
		Entrypoints: []jobs.Entrypoint{{Name: "web", Protocol: "http", Host: "challenge.internal", Port: 8080, URL: "https://challenge.example.test"}},
	}, nil
}

func (backend *fakeBackend) Destroy(_ context.Context, key providers.InstanceKey) (jobs.Observation, error) {
	backend.destroyed = append(backend.destroyed, fakeResourceID(key))
	return jobs.Observation{State: jobs.ObservedStopped}, nil
}

func TestCycleOnlyManagesCompleteCurrentPlatformResources(t *testing.T) {
	now := time.Date(2026, 9, 2, 12, 0, 0, 0, time.UTC)
	desired := []DesiredInstance{
		testDesired(1, contracts.DesiredStateRunning, 2, nil),
		testDesired(2, contracts.DesiredStateStopped, 1, nil),
		testDesired(3, contracts.DesiredStateRunning, 2, nil),
		testDesired(4, contracts.DesiredStateRunning, 2, nil),
		testDesired(5, contracts.DesiredStateRunning, 1, nil),
		testDesired(6, contracts.DesiredStateRunning, 1, timePointer(now.Add(-time.Minute))),
	}
	desired[0].ProviderResourceID = "resource/current"
	desired[0].ObservedState = jobs.ObservedRunning
	desired[0].ObservedGeneration = 2
	desired[1].ProviderResourceID = "resource/stopped"
	desired[2].ProviderResourceID = "resource/stale"
	desired[5].ProviderResourceID = "resource/expired"

	resources := []Resource{
		testResource("resource/current", desired[0].ownership("sauryctf")),
		testResource("resource/stopped", desired[1].ownership("sauryctf")),
		testResource("resource/stale", ownershipForGeneration(desired[2], "sauryctf", 1)),
		testResource("resource/future", ownershipForGeneration(desired[3], "sauryctf", 3)),
		testResource("resource/orphan", testOwnership("sauryctf", uuid(99), 1)),
		{Provider: contracts.ProviderDocker, ResourceID: "resource/unlabelled", Labels: map[string]string{}},
		{Provider: contracts.ProviderDocker, ResourceID: "resource/partial", Labels: map[string]string{LabelPlatform: "sauryctf", LabelInstance: string(desired[0].ID)}},
		{Provider: contracts.ProviderDocker, ResourceID: "resource/foreign", Labels: map[string]string{LabelPlatform: "another-platform"}},
		testResource("resource/expired", desired[5].ownership("sauryctf")),
	}
	store := &fakeStore{desired: desired}
	backend := &fakeBackend{resources: resources}
	reconciler, err := New("sauryctf", time.Minute, store, backend, discardLogger())
	if err != nil {
		t.Fatal(err)
	}
	reconciler.now = func() time.Time { return now }

	result, err := reconciler.Cycle(context.Background())
	if err != nil {
		t.Fatalf("Cycle() error = %v", err)
	}
	if result != (Result{Desired: 6, Resources: 9, Ensured: 2, Inspected: 1, Destroyed: 3, Orphans: 2, Unmanaged: 3}) {
		t.Fatalf("Cycle() result = %+v", result)
	}
	assertStrings(t, backend.inspected, []string{"resource/current"})
	assertStrings(t, backend.destroyed, []string{"resource/stopped", "resource/stale", "resource/expired"})
	assertUUIDs(t, backend.ensured, []contracts.UUID{desired[2].ID, desired[4].ID})
	for _, forbidden := range []string{"resource/unlabelled", "resource/partial", "resource/foreign", "resource/future", "resource/orphan"} {
		if contains(backend.inspected, forbidden) || contains(backend.destroyed, forbidden) {
			t.Fatalf("unsafe resource %q was managed", forbidden)
		}
	}
	if len(store.orphans) != 2 || store.orphans[0].Reason != OrphanFutureGeneration || store.orphans[1].Reason != OrphanUnknownInstance {
		t.Fatalf("orphan reports = %+v", store.orphans)
	}
	if len(store.observations) != 5 {
		t.Fatalf("recorded observations = %d, want 5", len(store.observations))
	}
}

func TestCycleReportsDuplicateCompleteIdentityWithoutManagingIt(t *testing.T) {
	instance := testDesired(1, contracts.DesiredStateRunning, 1, nil)
	ownership := instance.ownership("sauryctf")
	store := &fakeStore{desired: []DesiredInstance{instance}}
	backend := &fakeBackend{resources: []Resource{
		testResource("resource/duplicate-a", ownership),
		testResource("resource/duplicate-b", ownership),
	}}
	reconciler, err := New("sauryctf", time.Minute, store, backend, discardLogger())
	if err != nil {
		t.Fatal(err)
	}
	result, err := reconciler.Cycle(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result.Orphans != 2 || len(backend.ensured)+len(backend.inspected)+len(backend.destroyed) != 0 {
		t.Fatalf("duplicate reconciliation result = %+v, backend = %+v", result, backend)
	}
}

func TestCycleRecoversAfterResourceCreationBeforeObservationWriteback(t *testing.T) {
	instance := testDesired(1, contracts.DesiredStateRunning, 1, nil)
	store := &recoveryStore{desired: []DesiredInstance{instance}, recordFailuresLeft: 1}
	backend := newRecoveryBackend()
	reconciler, err := New("sauryctf", time.Minute, store, backend, discardLogger())
	if err != nil {
		t.Fatal(err)
	}

	first, err := reconciler.Cycle(context.Background())
	if err == nil || first.Failures != 1 {
		t.Fatalf("first Cycle() = %+v/%v, want injected writeback failure", first, err)
	}
	if backend.resourceCount() != 1 || backend.ensureCalls != 1 || store.providerResourceID() != "" {
		t.Fatalf("state after writeback failure = resources:%d ensure:%d recorded:%q", backend.resourceCount(), backend.ensureCalls, store.providerResourceID())
	}

	second, err := reconciler.Cycle(context.Background())
	if err != nil {
		t.Fatalf("second Cycle() error = %v", err)
	}
	if second.Inspected != 1 || second.Ensured != 0 || backend.resourceCount() != 1 || backend.ensureCalls != 1 || backend.inspectCalls != 1 {
		t.Fatalf("second Cycle() = %+v, resources/ensure/inspect = %d/%d/%d", second, backend.resourceCount(), backend.ensureCalls, backend.inspectCalls)
	}
	if store.providerResourceID() == "" {
		t.Fatal("reconciler did not recover the resource observation")
	}
}

func TestConcurrentRepeatedStartConvergesWithoutDuplicateResources(t *testing.T) {
	instance := testDesired(1, contracts.DesiredStateRunning, 1, nil)
	store := &recoveryStore{desired: []DesiredInstance{instance}}
	backend := newRecoveryBackend()
	barrier := &sync.WaitGroup{}
	barrier.Add(2)
	backend.listBarrier = barrier
	reconciler, err := New("sauryctf", time.Minute, store, backend, discardLogger())
	if err != nil {
		t.Fatal(err)
	}

	type cycleResult struct {
		result Result
		err    error
	}
	results := make(chan cycleResult, 2)
	for range 2 {
		go func() {
			result, cycleErr := reconciler.Cycle(context.Background())
			results <- cycleResult{result: result, err: cycleErr}
		}()
	}
	var failures int
	for range 2 {
		outcome := <-results
		if outcome.err != nil {
			failures += outcome.result.Failures
		}
	}
	backend.mu.Lock()
	backend.listBarrier = nil
	ensureCalls := backend.ensureCalls
	backend.mu.Unlock()
	if failures != 1 || ensureCalls != 2 || backend.resourceCount() != 1 {
		t.Fatalf("concurrent starts = failures:%d ensure:%d resources:%d, want 1/2/1", failures, ensureCalls, backend.resourceCount())
	}

	converged, err := reconciler.Cycle(context.Background())
	if err != nil || converged.Inspected != 1 || backend.resourceCount() != 1 {
		t.Fatalf("converging Cycle() = %+v/%v, resources:%d", converged, err, backend.resourceCount())
	}
}

func TestCycleRecreatesExternallyDeletedResourceWithSameIdentity(t *testing.T) {
	instance := testDesired(1, contracts.DesiredStateRunning, 1, nil)
	store := &recoveryStore{desired: []DesiredInstance{instance}}
	backend := newRecoveryBackend()
	reconciler, err := New("sauryctf", time.Minute, store, backend, discardLogger())
	if err != nil {
		t.Fatal(err)
	}

	first, err := reconciler.Cycle(context.Background())
	if err != nil || first.Ensured != 1 || backend.resourceCount() != 1 {
		t.Fatalf("first Cycle() = %+v/%v, resources:%d", first, err, backend.resourceCount())
	}
	resourceID := store.providerResourceID()
	backend.deleteExternally(providers.InstanceKey(instance.ownership("sauryctf")))
	if backend.resourceCount() != 0 {
		t.Fatal("external deletion did not remove the runtime resource")
	}

	second, err := reconciler.Cycle(context.Background())
	if err != nil || second.Ensured != 1 || backend.resourceCount() != 1 {
		t.Fatalf("second Cycle() = %+v/%v, resources:%d", second, err, backend.resourceCount())
	}
	if store.providerResourceID() != resourceID || backend.ensureCalls != 2 {
		t.Fatalf("recreated identity = %q/%q, ensure calls = %d", store.providerResourceID(), resourceID, backend.ensureCalls)
	}
}

func TestRunPerformsImmediateAndPeriodicCyclesUntilCancelled(t *testing.T) {
	store := &fakeStore{}
	reconciler, err := New("sauryctf", 5*time.Millisecond, store, &fakeBackend{}, discardLogger())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	stopped := make(chan error, 1)
	go func() { stopped <- reconciler.Run(ctx) }()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		store.mu.Lock()
		calls := store.listCalls
		store.mu.Unlock()
		if calls >= 2 {
			break
		}
		time.Sleep(time.Millisecond)
	}
	cancel()
	if err := <-stopped; err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.listCalls < 2 {
		t.Fatalf("Run() cycles = %d, want at least 2", store.listCalls)
	}
}

func testDesired(index int, state contracts.InstanceDesiredState, generation contracts.ResourceVersion, expiresAt *time.Time) DesiredInstance {
	runtimeSpec := validRuntimeSpec()
	return DesiredInstance{
		ID: uuid(index), Provider: contracts.ProviderDocker, DesiredState: state,
		DesiredGeneration: generation, ObservedState: jobs.ObservedPending,
		ExpiresAt: expiresAt, ContestID: uuid(100), ChallengeID: uuid(101), ParticipationID: uuid(103), TeamID: uuid(102), RuntimeSpec: &runtimeSpec,
	}
}

func testOwnership(platform string, instance contracts.UUID, generation contracts.ResourceVersion) Ownership {
	return Ownership{Platform: platform, Provider: contracts.ProviderDocker, Contest: uuid(100), Challenge: uuid(101), Team: uuid(102), Instance: instance, Generation: generation}
}

func ownershipForGeneration(instance DesiredInstance, platform string, generation contracts.ResourceVersion) Ownership {
	ownership := instance.ownership(platform)
	ownership.Generation = generation
	return ownership
}

func testResource(resourceID string, ownership Ownership) Resource {
	return Resource{Provider: ownership.Provider, ResourceID: resourceID, Labels: ownership.Labels()}
}

func validRuntimeSpec() contracts.InstanceRuntimeSpec {
	return contracts.InstanceRuntimeSpec{
		Image:       "registry.example.test/challenge@sha256:0123456789abcdef",
		Entrypoints: []contracts.InstanceEntrypointSpec{{Name: "web", Protocol: "http", ContainerPort: 8080}},
		Resources: contracts.InstanceResourceLimits{
			CPUMillicores: 500, MemoryBytes: 256 * 1024 * 1024, EphemeralStorageBytes: 512 * 1024 * 1024,
		},
		Network: contracts.InstanceNetworkPolicy{Egress: "deny"},
	}
}

func fakeResourceID(key providers.InstanceKey) string {
	switch {
	case key.Instance == uuid(1):
		return "resource/current"
	case key.Instance == uuid(2):
		return "resource/stopped"
	case key.Instance == uuid(3) && key.Generation == 1:
		return "resource/stale"
	case key.Instance == uuid(6):
		return "resource/expired"
	default:
		return "resource/" + string(key.Instance)
	}
}

func uuid(index int) contracts.UUID {
	return contracts.UUID("018f47a2-4ef8-7e2c-9c24-" + formatIndex(index))
}

func formatIndex(index int) string {
	const digits = "0123456789abcdef"
	buffer := make([]byte, 12)
	for position := len(buffer) - 1; position >= 0; position-- {
		buffer[position] = digits[index&15]
		index >>= 4
	}
	return string(buffer)
}

func timePointer(value time.Time) *time.Time { return &value }

func discardLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func assertStrings(t *testing.T, got, want []string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("strings = %v, want %v", got, want)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("strings = %v, want %v", got, want)
		}
	}
}

func assertUUIDs(t *testing.T, got, want []contracts.UUID) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("UUIDs = %v, want %v", got, want)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("UUIDs = %v, want %v", got, want)
		}
	}
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
