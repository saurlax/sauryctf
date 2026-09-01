package kubernetes

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
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
	provider, err := New(client, "challenge-test", kubernetesTestRouteConfig())
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
	httpIngress, err := client.NetworkingV1().Ingresses("challenge-test").Get(ctx, httpRouteName(name), metav1.GetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	tcpService, err := client.CoreV1().Services("challenge-test").Get(ctx, tcpRouteName(name), metav1.GetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	networkPolicy, err := client.NetworkingV1().NetworkPolicies("challenge-test").Get(ctx, networkPolicyName(name), metav1.GetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	assertOwnershipLabels(t, workload.Labels, spec.Key)
	assertOwnershipLabels(t, service.Labels, spec.Key)
	assertOwnershipLabels(t, secret.Labels, spec.Key)
	assertOwnershipLabels(t, httpIngress.Labels, spec.Key)
	assertOwnershipLabels(t, tcpService.Labels, spec.Key)
	assertOwnershipLabels(t, networkPolicy.Labels, spec.Key)
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
	if httpIngress.Spec.IngressClassName == nil || *httpIngress.Spec.IngressClassName != "challenge-ingress" || len(httpIngress.Spec.Rules) != 1 || len(httpIngress.Spec.TLS) != 1 {
		t.Fatalf("http ingress = %+v", httpIngress.Spec)
	}
	if httpIngress.Spec.Rules[0].Host != entrypointHost(name, "web", "challenges.example.test") || httpIngress.Spec.Rules[0].HTTP.Paths[0].Backend.Service.Name != name || httpIngress.Spec.Rules[0].HTTP.Paths[0].Backend.Service.Port.Name != "web" {
		t.Fatalf("http ingress rule = %+v", httpIngress.Spec.Rules[0])
	}
	if tcpService.Spec.Type != corev1.ServiceTypeLoadBalancer || tcpService.Spec.AllocateLoadBalancerNodePorts == nil || *tcpService.Spec.AllocateLoadBalancerNodePorts || tcpService.Spec.LoadBalancerClass == nil || *tcpService.Spec.LoadBalancerClass != "example.test/challenge" {
		t.Fatalf("tcp service exposure policy = %+v", tcpService.Spec)
	}
	if len(tcpService.Spec.Ports) != 1 || tcpService.Spec.Ports[0].Name != "shell" || tcpService.Spec.Ports[0].Port != 30000 || tcpService.Spec.Ports[0].TargetPort.StrVal != "shell" || tcpService.Spec.Ports[0].NodePort != 0 {
		t.Fatalf("tcp service ports = %+v", tcpService.Spec.Ports)
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
	ingresses, _ := client.NetworkingV1().Ingresses("challenge-test").List(ctx, metav1.ListOptions{})
	networkPolicies, _ := client.NetworkingV1().NetworkPolicies("challenge-test").List(ctx, metav1.ListOptions{})
	if len(workloads.Items) != 1 || len(services.Items) != 2 || len(secrets.Items) != 1 || len(ingresses.Items) != 1 || len(networkPolicies.Items) != 1 {
		t.Fatalf("resource counts after repeated Ensure() = %d/%d/%d/%d/%d", len(workloads.Items), len(services.Items), len(secrets.Items), len(ingresses.Items), len(networkPolicies.Items))
	}
	updated, _ := client.AppsV1().Deployments("challenge-test").Get(ctx, name, metav1.GetOptions{})
	if updated.Spec.Template.Spec.Containers[0].Image != spec.Runtime.Image || updated.Spec.Template.Spec.Containers[0].Env[0].Value != "updated" {
		t.Fatalf("updated workload = %+v", updated.Spec.Template.Spec.Containers[0])
	}
}

func TestInspectObservesWorkloadReadinessWithoutPublishingRoute(t *testing.T) {
	ctx := context.Background()
	client := fake.NewSimpleClientset()
	provider, err := New(client, "challenge-test", kubernetesTestRouteConfig())
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
	if _, err := provider.Ensure(ctx, spec); err != nil {
		t.Fatal(err)
	}

	workload, _ := client.AppsV1().Deployments("challenge-test").Get(ctx, name, metav1.GetOptions{})
	stale := workload.DeepCopy()
	stale.Generation = 3
	stale.Status.ObservedGeneration = 2
	stale.Status.ReadyReplicas = 1
	stale.Status.AvailableReplicas = 1
	stale.Status.Conditions = []appsv1.DeploymentCondition{{Type: appsv1.DeploymentAvailable, Status: corev1.ConditionTrue}}
	if deploymentReady(stale) {
		t.Fatal("deploymentReady() accepted a stale observed generation")
	}
	stale.Status.ObservedGeneration = 3
	if !deploymentReady(stale) {
		t.Fatal("deploymentReady() rejected an available current generation")
	}

	httpIngress, _ := client.NetworkingV1().Ingresses("challenge-test").Get(ctx, httpRouteName(name), metav1.GetOptions{})
	httpIngress.Status.LoadBalancer.Ingress = []networkingv1.IngressLoadBalancerIngress{{Hostname: "ingress.example.test"}}
	if _, err := client.NetworkingV1().Ingresses("challenge-test").UpdateStatus(ctx, httpIngress, metav1.UpdateOptions{}); err != nil {
		t.Fatal(err)
	}
	tcpService, _ := client.CoreV1().Services("challenge-test").Get(ctx, tcpRouteName(name), metav1.GetOptions{})
	tcpService.Status.LoadBalancer.Ingress = []corev1.LoadBalancerIngress{{IP: "192.0.2.50"}}
	if _, err := client.CoreV1().Services("challenge-test").UpdateStatus(ctx, tcpService, metav1.UpdateOptions{}); err != nil {
		t.Fatal(err)
	}
	routesOnly, err := provider.Inspect(ctx, spec.Key)
	if err != nil || routesOnly.State != jobs.ObservedStarting || len(routesOnly.Entrypoints) != 0 {
		t.Fatalf("Inspect() ready routes before workload = %+v/%v", routesOnly, err)
	}

	workload.Status.ObservedGeneration = workload.Generation
	workload.Status.ReadyReplicas = 1
	workload.Status.AvailableReplicas = 1
	workload.Status.Conditions = []appsv1.DeploymentCondition{{Type: appsv1.DeploymentAvailable, Status: corev1.ConditionTrue}}
	if _, err := client.AppsV1().Deployments("challenge-test").UpdateStatus(ctx, workload, metav1.UpdateOptions{}); err != nil {
		t.Fatal(err)
	}
	ready, err := provider.Inspect(ctx, spec.Key)
	if err != nil || ready.State != jobs.ObservedRunning || len(ready.Entrypoints) != 2 {
		t.Fatalf("Inspect() ready workload and routes = %+v/%v", ready, err)
	}
	if ready.Entrypoints[0].Name != "web" || ready.Entrypoints[0].Protocol != "http" || ready.Entrypoints[0].Port != 443 || ready.Entrypoints[0].URL != "https://"+entrypointHost(name, "web", "challenges.example.test") {
		t.Fatalf("HTTP entrypoint = %+v", ready.Entrypoints[0])
	}
	if ready.Entrypoints[1] != (jobs.Entrypoint{Name: "shell", Protocol: "tcp", Host: "192.0.2.50", Port: 30000}) {
		t.Fatalf("TCP entrypoint = %+v", ready.Entrypoints[1])
	}
	if err := ready.Validate(); err != nil {
		t.Fatalf("running observation is invalid: %v", err)
	}
}

func TestEnsureRequiresExplicitRouteMechanisms(t *testing.T) {
	ctx := context.Background()
	client := fake.NewSimpleClientset()
	provider, err := New(client, "challenge-test", RouteConfig{HTTPDomain: "challenges.example.test"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = provider.Ensure(ctx, kubernetesTestSpec())
	failure := jobs.ClassifyFailure(err)
	if failure.Kind != jobs.FailurePermanent || failure.Code != "provider.routes_unavailable" {
		t.Fatalf("Ensure() failure = %+v/%v", failure, err)
	}
	workloads, listErr := client.AppsV1().Deployments("challenge-test").List(ctx, metav1.ListOptions{})
	if listErr != nil || len(workloads.Items) != 0 {
		t.Fatalf("Ensure() created resources before route validation: %+v/%v", workloads.Items, listErr)
	}
}

func TestInspectReadyWorkloadWaitsForEveryRoute(t *testing.T) {
	ctx := context.Background()
	client := fake.NewSimpleClientset()
	provider, err := New(client, "challenge-test", kubernetesTestRouteConfig())
	if err != nil {
		t.Fatal(err)
	}
	spec := kubernetesTestSpec()
	name, _ := spec.Key.ResourceName()
	if _, err := provider.Ensure(ctx, spec); err != nil {
		t.Fatal(err)
	}
	workload, _ := client.AppsV1().Deployments("challenge-test").Get(ctx, name, metav1.GetOptions{})
	workload.Status.ObservedGeneration = workload.Generation
	workload.Status.ReadyReplicas = 1
	workload.Status.AvailableReplicas = 1
	workload.Status.Conditions = []appsv1.DeploymentCondition{{Type: appsv1.DeploymentAvailable, Status: corev1.ConditionTrue}}
	if _, err := client.AppsV1().Deployments("challenge-test").UpdateStatus(ctx, workload, metav1.UpdateOptions{}); err != nil {
		t.Fatal(err)
	}

	observation, err := provider.Inspect(ctx, spec.Key)
	if err != nil || observation.State != jobs.ObservedStarting || len(observation.Entrypoints) != 0 {
		t.Fatalf("Inspect() ready workload before routes = %+v/%v", observation, err)
	}
}

func TestInspectRejectsRoutePolicyDrift(t *testing.T) {
	t.Run("Ingress backend is missing", func(t *testing.T) {
		provider, client, spec, name := readyFakeKubernetesProvider(t)
		ctx := context.Background()
		httpIngress, _ := client.NetworkingV1().Ingresses("challenge-test").Get(ctx, httpRouteName(name), metav1.GetOptions{})
		httpIngress.Spec.Rules[0].HTTP = nil
		if _, err := client.NetworkingV1().Ingresses("challenge-test").Update(ctx, httpIngress, metav1.UpdateOptions{}); err != nil {
			t.Fatal(err)
		}
		if _, err := provider.Inspect(ctx, spec.Key); jobs.ClassifyFailure(err).Code != "provider.invalid_route" {
			t.Fatalf("Inspect() error = %v", err)
		}
	})

	t.Run("TCP Service enables NodePort allocation", func(t *testing.T) {
		provider, client, spec, name := readyFakeKubernetesProvider(t)
		ctx := context.Background()
		tcpService, _ := client.CoreV1().Services("challenge-test").Get(ctx, tcpRouteName(name), metav1.GetOptions{})
		allocateNodePorts := true
		tcpService.Spec.AllocateLoadBalancerNodePorts = &allocateNodePorts
		if _, err := client.CoreV1().Services("challenge-test").Update(ctx, tcpService, metav1.UpdateOptions{}); err != nil {
			t.Fatal(err)
		}
		if _, err := provider.Inspect(ctx, spec.Key); jobs.ClassifyFailure(err).Code != "provider.invalid_route" {
			t.Fatalf("Inspect() error = %v", err)
		}
	})
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
	provider, err := New(client, "challenge-test", kubernetesTestRouteConfig())
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
	provider, err := New(client, "challenge-test", kubernetesTestRouteConfig())
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
		"deployment":     getDeploymentError(ctx, client, name),
		"service":        getServiceError(ctx, client, name),
		"secret":         getSecretError(ctx, client, name),
		"ingress":        getIngressError(ctx, client, name),
		"tcp service":    getTCPServiceError(ctx, client, name),
		"network policy": getNetworkPolicyError(ctx, client, name),
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
	if _, err := New(fake.NewSimpleClientset(), "challenge-test", RouteConfig{HTTPDomain: "invalid_domain"}); err == nil {
		t.Fatal("New() accepted an invalid route configuration")
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

func kubernetesTestRouteConfig() RouteConfig {
	return RouteConfig{
		HTTPDomain:        "challenges.example.test",
		IngressClassName:  "challenge-ingress",
		TLSSecretName:     "challenge-tls",
		TCPPortStart:      30000,
		LoadBalancerClass: "example.test/challenge",
	}
}

func readyFakeKubernetesProvider(t *testing.T) (*Provider, *fake.Clientset, providers.InstanceSpec, string) {
	t.Helper()
	ctx := context.Background()
	client := fake.NewSimpleClientset()
	provider, err := New(client, "challenge-test", kubernetesTestRouteConfig())
	if err != nil {
		t.Fatal(err)
	}
	spec := kubernetesTestSpec()
	name, _ := spec.Key.ResourceName()
	if _, err := provider.Ensure(ctx, spec); err != nil {
		t.Fatal(err)
	}
	workload, _ := client.AppsV1().Deployments("challenge-test").Get(ctx, name, metav1.GetOptions{})
	workload.Status.ObservedGeneration = workload.Generation
	workload.Status.ReadyReplicas = 1
	workload.Status.AvailableReplicas = 1
	workload.Status.Conditions = []appsv1.DeploymentCondition{{Type: appsv1.DeploymentAvailable, Status: corev1.ConditionTrue}}
	if _, err := client.AppsV1().Deployments("challenge-test").UpdateStatus(ctx, workload, metav1.UpdateOptions{}); err != nil {
		t.Fatal(err)
	}
	httpIngress, _ := client.NetworkingV1().Ingresses("challenge-test").Get(ctx, httpRouteName(name), metav1.GetOptions{})
	httpIngress.Status.LoadBalancer.Ingress = []networkingv1.IngressLoadBalancerIngress{{Hostname: "ingress.example.test"}}
	if _, err := client.NetworkingV1().Ingresses("challenge-test").UpdateStatus(ctx, httpIngress, metav1.UpdateOptions{}); err != nil {
		t.Fatal(err)
	}
	tcpService, _ := client.CoreV1().Services("challenge-test").Get(ctx, tcpRouteName(name), metav1.GetOptions{})
	tcpService.Status.LoadBalancer.Ingress = []corev1.LoadBalancerIngress{{IP: "192.0.2.50"}}
	if _, err := client.CoreV1().Services("challenge-test").UpdateStatus(ctx, tcpService, metav1.UpdateOptions{}); err != nil {
		t.Fatal(err)
	}
	return provider, client, spec, name
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

func getIngressError(ctx context.Context, client *fake.Clientset, name string) error {
	_, err := client.NetworkingV1().Ingresses("challenge-test").Get(ctx, httpRouteName(name), metav1.GetOptions{})
	return err
}

func getTCPServiceError(ctx context.Context, client *fake.Clientset, name string) error {
	_, err := client.CoreV1().Services("challenge-test").Get(ctx, tcpRouteName(name), metav1.GetOptions{})
	return err
}

func getNetworkPolicyError(ctx context.Context, client *fake.Clientset, name string) error {
	_, err := client.NetworkingV1().NetworkPolicies("challenge-test").Get(ctx, networkPolicyName(name), metav1.GetOptions{})
	return err
}
