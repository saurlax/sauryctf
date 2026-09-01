package kubernetes

import (
	"context"
	"crypto/rand"
	"fmt"
	"os"
	"testing"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/wait"
	"k8s.io/client-go/kubernetes"
	"sigs.k8s.io/controller-runtime/pkg/envtest"

	"github.com/saurlax/sauryctf/apps/worker/internal/contracts"
	"github.com/saurlax/sauryctf/apps/worker/internal/jobs"
)

func TestProviderAgainstEnvtest(t *testing.T) {
	if os.Getenv("TEST_KUBERNETES_ENVTEST") != "1" {
		t.Skip("TEST_KUBERNETES_ENVTEST=1 is required for the Kubernetes API integration test")
	}

	testEnvironment := &envtest.Environment{}
	restConfig, err := testEnvironment.Start()
	if err != nil {
		t.Fatalf("start envtest: %v", err)
	}
	t.Cleanup(func() {
		if err := testEnvironment.Stop(); err != nil {
			t.Errorf("stop envtest: %v", err)
		}
	})
	client, err := kubernetes.NewForConfig(restConfig)
	if err != nil {
		t.Fatal(err)
	}
	const namespace = "sauryctf-provider-test"
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if _, err := client.CoreV1().Namespaces().Create(ctx, &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: namespace}}, metav1.CreateOptions{}); err != nil {
		t.Fatalf("create test namespace: %v", err)
	}
	provider, err := New(client, namespace, kubernetesTestRouteConfig())
	if err != nil {
		t.Fatal(err)
	}
	spec := kubernetesTestSpec()
	spec.Key.Platform = "sauryctf-envtest"
	spec.Key.Contest = randomEnvtestUUID(t)
	spec.Key.Challenge = randomEnvtestUUID(t)
	spec.Key.Team = randomEnvtestUUID(t)
	spec.Key.Instance = randomEnvtestUUID(t)
	spec.Runtime.Image = "registry.example.test/challenges/envtest:immutable"
	name, _ := spec.Key.ResourceName()

	created, err := provider.Ensure(ctx, spec)
	if err != nil || created.State != jobs.ObservedStarting || created.ProviderResourceID != resourceID(namespace, name) {
		t.Fatalf("Ensure() = %+v/%v", created, err)
	}
	workload, err := client.AppsV1().Deployments(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		t.Fatalf("get Deployment: %v", err)
	}
	if _, err := client.CoreV1().Services(namespace).Get(ctx, name, metav1.GetOptions{}); err != nil {
		t.Fatalf("get Service: %v", err)
	}
	if _, err := client.CoreV1().Secrets(namespace).Get(ctx, name, metav1.GetOptions{}); err != nil {
		t.Fatalf("get Secret: %v", err)
	}
	if _, err := client.NetworkingV1().NetworkPolicies(namespace).Get(ctx, networkPolicyName(name), metav1.GetOptions{}); err != nil {
		t.Fatalf("get NetworkPolicy: %v", err)
	}
	httpIngress, err := client.NetworkingV1().Ingresses(namespace).Get(ctx, httpRouteName(name), metav1.GetOptions{})
	if err != nil {
		t.Fatalf("get Ingress: %v", err)
	}
	tcpService, err := client.CoreV1().Services(namespace).Get(ctx, tcpRouteName(name), metav1.GetOptions{})
	if err != nil {
		t.Fatalf("get TCP Service: %v", err)
	}
	if tcpService.Spec.AllocateLoadBalancerNodePorts == nil || *tcpService.Spec.AllocateLoadBalancerNodePorts || tcpService.Spec.Ports[0].NodePort != 0 {
		t.Fatalf("TCP Service allocated a NodePort: %+v", tcpService.Spec)
	}

	workload.Status.ObservedGeneration = workload.Generation
	workload.Status.Replicas = 1
	workload.Status.ReadyReplicas = 1
	workload.Status.AvailableReplicas = 1
	workload.Status.Conditions = []appsv1.DeploymentCondition{{
		Type:               appsv1.DeploymentAvailable,
		Status:             corev1.ConditionTrue,
		LastUpdateTime:     metav1.Now(),
		LastTransitionTime: metav1.Now(),
		Reason:             "EnvtestReady",
	}}
	if _, err := client.AppsV1().Deployments(namespace).UpdateStatus(ctx, workload, metav1.UpdateOptions{}); err != nil {
		t.Fatalf("mark Deployment ready: %v", err)
	}
	httpIngress.Status.LoadBalancer.Ingress = []networkingv1.IngressLoadBalancerIngress{{Hostname: "ingress.envtest.example"}}
	if _, err := client.NetworkingV1().Ingresses(namespace).UpdateStatus(ctx, httpIngress, metav1.UpdateOptions{}); err != nil {
		t.Fatalf("mark Ingress ready: %v", err)
	}
	tcpService.Status.LoadBalancer.Ingress = []corev1.LoadBalancerIngress{{IP: "192.0.2.60"}}
	if _, err := client.CoreV1().Services(namespace).UpdateStatus(ctx, tcpService, metav1.UpdateOptions{}); err != nil {
		t.Fatalf("mark TCP Service ready: %v", err)
	}
	inspected, err := provider.Inspect(ctx, spec.Key)
	if err != nil || inspected.State != jobs.ObservedRunning || len(inspected.Entrypoints) != 2 {
		t.Fatalf("Inspect() ready workload and routes = %+v/%v", inspected, err)
	}
	resources, err := provider.List(ctx, spec.Key.Platform)
	if err != nil || len(resources) != 1 || resources[0].ResourceID != resourceID(namespace, name) {
		t.Fatalf("List() = %+v/%v", resources, err)
	}
	if stopped, err := provider.Destroy(ctx, spec.Key); err != nil || stopped.State != jobs.ObservedStopped {
		t.Fatalf("Destroy() = %+v/%v", stopped, err)
	}
	if err := wait.PollUntilContextTimeout(ctx, 20*time.Millisecond, 5*time.Second, true, func(ctx context.Context) (bool, error) {
		_, deploymentErr := client.AppsV1().Deployments(namespace).Get(ctx, name, metav1.GetOptions{})
		_, serviceErr := client.CoreV1().Services(namespace).Get(ctx, name, metav1.GetOptions{})
		_, secretErr := client.CoreV1().Secrets(namespace).Get(ctx, name, metav1.GetOptions{})
		_, ingressErr := client.NetworkingV1().Ingresses(namespace).Get(ctx, httpRouteName(name), metav1.GetOptions{})
		_, tcpServiceErr := client.CoreV1().Services(namespace).Get(ctx, tcpRouteName(name), metav1.GetOptions{})
		_, networkPolicyErr := client.NetworkingV1().NetworkPolicies(namespace).Get(ctx, networkPolicyName(name), metav1.GetOptions{})
		return apierrors.IsNotFound(deploymentErr) && apierrors.IsNotFound(serviceErr) && apierrors.IsNotFound(secretErr) && apierrors.IsNotFound(ingressErr) && apierrors.IsNotFound(tcpServiceErr) && apierrors.IsNotFound(networkPolicyErr), nil
	}); err != nil {
		t.Fatalf("wait for resource deletion: %v", err)
	}
	if stopped, err := provider.Destroy(ctx, spec.Key); err != nil || stopped.State != jobs.ObservedStopped {
		t.Fatalf("second Destroy() = %+v/%v", stopped, err)
	}
}

func randomEnvtestUUID(t *testing.T) contracts.UUID {
	t.Helper()
	var source [16]byte
	if _, err := rand.Read(source[:]); err != nil {
		t.Fatal(err)
	}
	source[6] = source[6]&0x0f | 0x40
	source[8] = source[8]&0x3f | 0x80
	return contracts.UUID(fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		source[0:4], source[4:6], source[6:8], source[8:10], source[10:16]))
}
