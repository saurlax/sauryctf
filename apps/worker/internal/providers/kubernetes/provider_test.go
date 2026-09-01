package kubernetes

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/saurlax/sauryctf/apps/worker/internal/contracts"
	"github.com/saurlax/sauryctf/apps/worker/internal/jobs"
	"github.com/saurlax/sauryctf/apps/worker/internal/providers"
	"github.com/saurlax/sauryctf/apps/worker/internal/providers/providertest"
)

func TestEnsureCreatesAndUpdatesOwnedResources(t *testing.T) {
	ctx := context.Background()
	client := fake.NewSimpleClientset()
	provider, err := New(client, "challenge-test")
	if err != nil {
		t.Fatal(err)
	}
	spec := kubernetesTestSpec()
	name, _ := spec.Key.ResourceName()

	observation, err := provider.Ensure(ctx, spec)
	if err != nil {
		t.Fatalf("Ensure() error = %v", err)
	}
	if observation.State != jobs.ObservedStarting || observation.ProviderResourceID != resourceID("challenge-test", name) || len(observation.Entrypoints) != 0 {
		t.Fatalf("Ensure() observation = %+v", observation)
	}

	workload, err := client.AppsV1().Deployments("challenge-test").Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	service, err := client.CoreV1().Services("challenge-test").Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	secret, err := client.CoreV1().Secrets("challenge-test").Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	assertOwnershipLabels(t, workload.Labels, spec.Key)
	assertOwnershipLabels(t, service.Labels, spec.Key)
	assertOwnershipLabels(t, secret.Labels, spec.Key)
	assertOwnershipLabels(t, workload.Spec.Template.Labels, spec.Key)

	if workload.Spec.Selector.MatchLabels["sauryctf.io/resource-name"] != name || workload.Spec.Template.Labels["sauryctf.io/resource-name"] != name {
		t.Fatalf("workload selector/template labels = %+v/%+v", workload.Spec.Selector.MatchLabels, workload.Spec.Template.Labels)
	}
	if len(workload.Spec.Template.Spec.Containers) != 1 {
		t.Fatalf("containers = %+v", workload.Spec.Template.Spec.Containers)
	}
	container := workload.Spec.Template.Spec.Containers[0]
	if container.Image != spec.Runtime.Image || !reflect.DeepEqual(container.Env, []corev1.EnvVar{{Name: "MODE", Value: "competition"}, {Name: "PORT_HINT", Value: "8080"}}) {
		t.Fatalf("container image/env = %q/%+v", container.Image, container.Env)
	}
	if !reflect.DeepEqual(container.Ports, []corev1.ContainerPort{{Name: "web", ContainerPort: 8080, Protocol: corev1.ProtocolTCP}, {Name: "shell", ContainerPort: 31337, Protocol: corev1.ProtocolTCP}}) {
		t.Fatalf("container ports = %+v", container.Ports)
	}
	assertQuantity(t, container.Resources.Limits[corev1.ResourceCPU], resource.MustParse("500m"), "cpu")
	assertQuantity(t, container.Resources.Limits[corev1.ResourceMemory], resource.MustParse("256Mi"), "memory")
	assertQuantity(t, container.Resources.Limits[corev1.ResourceEphemeralStorage], resource.MustParse("512Mi"), "ephemeral storage")

	if service.Spec.Type != corev1.ServiceTypeClusterIP || service.Spec.Selector["sauryctf.io/resource-name"] != name || len(service.Spec.Ports) != 2 {
		t.Fatalf("service = %+v", service.Spec)
	}
	if service.Spec.Ports[0].Name != "web" || service.Spec.Ports[0].TargetPort.StrVal != "web" || service.Spec.Ports[1].Name != "shell" || service.Spec.Ports[1].TargetPort.StrVal != "shell" {
		t.Fatalf("service ports = %+v", service.Spec.Ports)
	}

	var storedEnvelope contracts.InstanceSecretEnvelope
	if err := json.Unmarshal(secret.Data["envelope.json"], &storedEnvelope); err != nil {
		t.Fatalf("decode secret envelope: %v", err)
	}
	if !reflect.DeepEqual(storedEnvelope, *spec.Runtime.SecretEnvelope) {
		t.Fatalf("secret envelope = %+v", storedEnvelope)
	}
	assertSecretNotExposed(t, spec.Runtime.SecretEnvelope.CiphertextBase64, workload, service, secret)

	spec.Runtime.Image = "registry.example.test/challenges/web@sha256:fedcba9876543210"
	spec.Runtime.Environment[0].Value = "updated"
	if _, err := provider.Ensure(ctx, spec); err != nil {
		t.Fatalf("second Ensure() error = %v", err)
	}
	workloads, _ := client.AppsV1().Deployments("challenge-test").List(ctx, metav1.ListOptions{})
	services, _ := client.CoreV1().Services("challenge-test").List(ctx, metav1.ListOptions{})
	secrets, _ := client.CoreV1().Secrets("challenge-test").List(ctx, metav1.ListOptions{})
	if len(workloads.Items) != 1 || len(services.Items) != 1 || len(secrets.Items) != 1 {
		t.Fatalf("resource counts after repeated Ensure() = %d/%d/%d", len(workloads.Items), len(services.Items), len(secrets.Items))
	}
	updated, _ := client.AppsV1().Deployments("challenge-test").Get(ctx, name, metav1.GetOptions{})
	if updated.Spec.Template.Spec.Containers[0].Image != spec.Runtime.Image || updated.Spec.Template.Spec.Containers[0].Env[0].Value != "updated" {
		t.Fatalf("updated workload = %+v", updated.Spec.Template.Spec.Containers[0])
	}
}

func TestInspectObservesWorkloadReadinessWithoutPublishingRoute(t *testing.T) {
	ctx := context.Background()
	client := fake.NewSimpleClientset()
	provider, err := New(client, "challenge-test")
	if err != nil {
		t.Fatal(err)
	}
	spec := kubernetesTestSpec()
	name, _ := spec.Key.ResourceName()

	missing, err := provider.Inspect(ctx, spec.Key)
	if err != nil || missing.State != jobs.ObservedUnknown || missing.ErrorCode != "provider.resource_missing" {
		t.Fatalf("Inspect() missing = %+v/%v", missing, err)
	}
	if err := missing.Validate(); err != nil {
		t.Fatalf("missing observation is invalid: %v", err)
	}

	workload := deployment(name, "challenge-test", spec)
	if _, err := client.AppsV1().Deployments("challenge-test").Create(ctx, workload, metav1.CreateOptions{}); err != nil {
		t.Fatal(err)
	}
	withoutService, err := provider.Inspect(ctx, spec.Key)
	if err != nil || withoutService.State != jobs.ObservedStarting || withoutService.ProviderResourceID == "" {
		t.Fatalf("Inspect() without service = %+v/%v", withoutService, err)
	}
	if _, err := client.CoreV1().Services("challenge-test").Create(ctx, service(name, "challenge-test", spec), metav1.CreateOptions{}); err != nil {
		t.Fatal(err)
	}

	workload, _ = client.AppsV1().Deployments("challenge-test").Get(ctx, name, metav1.GetOptions{})
	workload.Generation = 3
	workload.Status.ObservedGeneration = 2
	workload.Status.ReadyReplicas = 1
	workload.Status.AvailableReplicas = 1
	workload.Status.Conditions = []appsv1.DeploymentCondition{{Type: appsv1.DeploymentAvailable, Status: corev1.ConditionTrue}}
	if deploymentReady(workload) {
		t.Fatal("deploymentReady() accepted a stale observed generation")
	}
	workload.Status.ObservedGeneration = 3
	if !deploymentReady(workload) {
		t.Fatal("deploymentReady() rejected an available current generation")
	}
	if _, err := client.AppsV1().Deployments("challenge-test").Update(ctx, workload, metav1.UpdateOptions{}); err != nil {
		t.Fatal(err)
	}
	readyWorkload, err := provider.Inspect(ctx, spec.Key)
	if err != nil || readyWorkload.State != jobs.ObservedStarting || len(readyWorkload.Entrypoints) != 0 {
		t.Fatalf("Inspect() ready workload without route = %+v/%v", readyWorkload, err)
	}
	if err := readyWorkload.Validate(); err != nil {
		t.Fatalf("ready workload observation is invalid: %v", err)
	}
}

func TestEnsureAndDestroyRefuseConflictingOwnership(t *testing.T) {
	ctx := context.Background()
	spec := kubernetesTestSpec()
	name, _ := spec.Key.ResourceName()
	foreignLabels := spec.Key.Labels()
	foreignLabels[providers.LabelTeam] = "018f47a2-4ef8-7e2c-9c24-6d68b7459999"
	foreignService := service(name, "challenge-test", spec)
	foreignService.Labels = foreignLabels
	client := fake.NewSimpleClientset(foreignService)
	provider, err := New(client, "challenge-test")
	if err != nil {
		t.Fatal(err)
	}

	if _, err := provider.Ensure(ctx, spec); jobs.ClassifyFailure(err).Code != "provider.ownership_conflict" {
		t.Fatalf("Ensure() conflict error = %v", err)
	}
	if _, err := client.AppsV1().Deployments("challenge-test").Get(ctx, name, metav1.GetOptions{}); !apierrors.IsNotFound(err) {
		t.Fatalf("Ensure() continued after ownership conflict: %v", err)
	}
	if _, err := provider.Destroy(ctx, spec.Key); jobs.ClassifyFailure(err).Code != "provider.ownership_conflict" {
		t.Fatalf("Destroy() conflict error = %v", err)
	}
	if _, err := client.CoreV1().Services("challenge-test").Get(ctx, name, metav1.GetOptions{}); err != nil {
		t.Fatalf("Destroy() removed conflicting service: %v", err)
	}
}

func TestKubernetesProviderSharedDestroyContract(t *testing.T) {
	providertest.RunContract(t, kubernetesTestSpec().Key, func(t *testing.T) providers.Provider {
		provider, err := New(fake.NewSimpleClientset(), "challenge-test")
		if err != nil {
			t.Fatal(err)
		}
		return provider
	})
}

func TestDestroyOwnedResourcesIsIdempotent(t *testing.T) {
	ctx := context.Background()
	client := fake.NewSimpleClientset()
	provider, err := New(client, "challenge-test")
	if err != nil {
		t.Fatal(err)
	}
	spec := kubernetesTestSpec()
	name, _ := spec.Key.ResourceName()
	if _, err := provider.Ensure(ctx, spec); err != nil {
		t.Fatal(err)
	}
	for attempt := 1; attempt <= 2; attempt++ {
		observation, err := provider.Destroy(ctx, spec.Key)
		if err != nil || observation.State != jobs.ObservedStopped {
			t.Fatalf("Destroy() attempt %d = %+v/%v", attempt, observation, err)
		}
	}
	for kind, err := range map[string]error{
		"deployment": getDeploymentError(ctx, client, name),
		"service":    getServiceError(ctx, client, name),
		"secret":     getSecretError(ctx, client, name),
	} {
		if !apierrors.IsNotFound(err) {
			t.Fatalf("%s remains after Destroy(): %v", kind, err)
		}
	}
}

func TestListReturnsOnlyPlatformDeployments(t *testing.T) {
	ctx := context.Background()
	spec := kubernetesTestSpec()
	name, _ := spec.Key.ResourceName()
	owned := deployment(name, "challenge-test", spec)
	foreign := deployment("foreign", "challenge-test", spec)
	foreign.Labels[providers.LabelPlatform] = "other"
	client := fake.NewSimpleClientset(owned, foreign)
	provider, err := New(client, "challenge-test")
	if err != nil {
		t.Fatal(err)
	}
	resources, err := provider.List(ctx, spec.Key.Platform)
	if err != nil || len(resources) != 1 || resources[0].ResourceID != resourceID("challenge-test", name) || resources[0].Provider != contracts.ProviderKubernetes {
		t.Fatalf("List() = %+v/%v", resources, err)
	}
}

func TestNewRejectsMissingClientAndInvalidNamespace(t *testing.T) {
	if _, err := New(nil, "challenge-test"); err == nil {
		t.Fatal("New() accepted a nil client")
	}
	if _, err := New(fake.NewSimpleClientset(), "Invalid_Namespace"); err == nil {
		t.Fatal("New() accepted an invalid namespace")
	}
}

func kubernetesTestSpec() providers.InstanceSpec {
	return providers.InstanceSpec{
		Key: providers.InstanceKey{
			Platform: "sauryctf", Provider: contracts.ProviderKubernetes,
			Contest: "018f47a2-4ef8-7e2c-9c24-6d68b7451021", Challenge: "018f47a2-4ef8-7e2c-9c24-6d68b7451031",
			Team: "018f47a2-4ef8-7e2c-9c24-6d68b7451051", Instance: "018f47a2-4ef8-7e2c-9c24-6d68b7451001", Generation: 7,
		},
		Runtime: contracts.InstanceRuntimeSpec{
			Image: "registry.example.test/challenges/web@sha256:0123456789abcdef",
			Entrypoints: []contracts.InstanceEntrypointSpec{
				{Name: "web", Protocol: "http", ContainerPort: 8080},
				{Name: "shell", Protocol: "tcp", ContainerPort: 31337},
			},
			Environment: []contracts.InstanceEnvironmentVariable{{Name: "MODE", Value: "competition"}, {Name: "PORT_HINT", Value: "8080"}},
			Resources:   contracts.InstanceResourceLimits{CPUMillicores: 500, MemoryBytes: 256 * 1024 * 1024, EphemeralStorageBytes: 512 * 1024 * 1024},
			Network:     contracts.InstanceNetworkPolicy{Egress: "deny"},
			SecretEnvelope: &contracts.InstanceSecretEnvelope{
				Schema: "instance-secrets.v1", KeyID: "test-key", CiphertextBase64: "c2VjcmV0LWVudmVsb3Bl",
			},
		},
	}
}

func assertOwnershipLabels(t *testing.T, actual map[string]string, key providers.InstanceKey) {
	t.Helper()
	for label, expected := range key.Labels() {
		if actual[label] != expected {
			t.Fatalf("label %s = %q, want %q in %+v", label, actual[label], expected, actual)
		}
	}
}

func assertQuantity(t *testing.T, actual, expected resource.Quantity, name string) {
	t.Helper()
	if actual.Cmp(expected) != 0 {
		t.Fatalf("%s limit = %s, want %s", name, actual.String(), expected.String())
	}
}

func assertSecretNotExposed(t *testing.T, ciphertext string, workload *appsv1.Deployment, service *corev1.Service, secret *corev1.Secret) {
	t.Helper()
	for _, labels := range []map[string]string{workload.Labels, workload.Spec.Template.Labels, service.Labels, secret.Labels} {
		for label, value := range labels {
			if strings.Contains(label, ciphertext) || strings.Contains(value, ciphertext) {
				t.Fatalf("secret ciphertext leaked through label %q=%q", label, value)
			}
		}
	}
	for _, variable := range workload.Spec.Template.Spec.Containers[0].Env {
		if strings.Contains(variable.Name, ciphertext) || strings.Contains(variable.Value, ciphertext) {
			t.Fatalf("secret ciphertext leaked through environment variable %+v", variable)
		}
	}
}

func getDeploymentError(ctx context.Context, client *fake.Clientset, name string) error {
	_, err := client.AppsV1().Deployments("challenge-test").Get(ctx, name, metav1.GetOptions{})
	return err
}

func getServiceError(ctx context.Context, client *fake.Clientset, name string) error {
	_, err := client.CoreV1().Services("challenge-test").Get(ctx, name, metav1.GetOptions{})
	return err
}

func getSecretError(ctx context.Context, client *fake.Clientset, name string) error {
	_, err := client.CoreV1().Secrets("challenge-test").Get(ctx, name, metav1.GetOptions{})
	return err
}
