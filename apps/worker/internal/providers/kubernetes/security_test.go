package kubernetes

import (
	"context"
	"reflect"
	"testing"

	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/saurlax/sauryctf/apps/worker/internal/jobs"
)

type secureResourceSnapshot struct {
	AutomountServiceAccountToken bool
	EnableServiceLinks           bool
	HostNetwork                  bool
	HostPID                      bool
	HostIPC                      bool
	PodRunAsNonRoot              bool
	PodSeccomp                   corev1.SeccompProfileType
	ContainerPrivileged          bool
	AllowPrivilegeEscalation     bool
	ReadOnlyRootFilesystem       bool
	ContainerRunAsNonRoot        bool
	ContainerSeccomp             corev1.SeccompProfileType
	DroppedCapabilities          []corev1.Capability
	Requests                     map[corev1.ResourceName]string
	Limits                       map[corev1.ResourceName]string
	TemporaryVolume              string
	TemporaryMount               string
	NetworkSelector              map[string]string
	NetworkPolicyTypes           []networkingv1.PolicyType
	IngressPorts                 []int32
	EgressRuleCount              int
}

func TestSecureResourceSnapshot(t *testing.T) {
	spec := kubernetesTestSpec()
	name, _ := spec.Key.ResourceName()
	workload := deployment(name, "challenge-test", spec)
	policy := instanceNetworkPolicy(networkPolicyName(name), "challenge-test", name, spec.Key, spec.Runtime.Entrypoints, spec.Runtime.Network.Egress)

	actual := snapshotSecurityResources(workload.Spec.Template.Spec, policy.Spec)
	expected := secureResourceSnapshot{
		AutomountServiceAccountToken: false,
		EnableServiceLinks:           false,
		HostNetwork:                  false,
		HostPID:                      false,
		HostIPC:                      false,
		PodRunAsNonRoot:              true,
		PodSeccomp:                   corev1.SeccompProfileTypeRuntimeDefault,
		ContainerPrivileged:          false,
		AllowPrivilegeEscalation:     false,
		ReadOnlyRootFilesystem:       true,
		ContainerRunAsNonRoot:        true,
		ContainerSeccomp:             corev1.SeccompProfileTypeRuntimeDefault,
		DroppedCapabilities:          []corev1.Capability{"ALL"},
		Requests: map[corev1.ResourceName]string{
			corev1.ResourceCPU: "500m", corev1.ResourceMemory: "256Mi", corev1.ResourceEphemeralStorage: "512Mi",
		},
		Limits: map[corev1.ResourceName]string{
			corev1.ResourceCPU: "500m", corev1.ResourceMemory: "256Mi", corev1.ResourceEphemeralStorage: "512Mi",
		},
		TemporaryVolume:    "tmp:512Mi",
		TemporaryMount:     "tmp:/tmp",
		NetworkSelector:    map[string]string{"sauryctf.io/resource-name": name},
		NetworkPolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeIngress, networkingv1.PolicyTypeEgress},
		IngressPorts:       []int32{8080, 31337},
		EgressRuleCount:    0,
	}
	if !reflect.DeepEqual(actual, expected) {
		t.Fatalf("secure resource snapshot changed\nactual:   %#v\nexpected: %#v", actual, expected)
	}
}

func TestInternetNetworkPolicyUsesBoundedPublicEgressAndDNS(t *testing.T) {
	spec := kubernetesTestSpec()
	name, _ := spec.Key.ResourceName()
	policy := instanceNetworkPolicy(networkPolicyName(name), "challenge-test", name, spec.Key, spec.Runtime.Entrypoints, "internet")
	if len(policy.Spec.Egress) != 2 {
		t.Fatalf("egress rules = %+v", policy.Spec.Egress)
	}
	ipBlock := policy.Spec.Egress[0].To[0].IPBlock
	if ipBlock == nil || ipBlock.CIDR != "0.0.0.0/0" || !reflect.DeepEqual(ipBlock.Except, internetEgressExcludedCIDRs) {
		t.Fatalf("internet IPBlock = %+v", ipBlock)
	}
	dnsPorts := policy.Spec.Egress[1].Ports
	if len(dnsPorts) != 2 || dnsPorts[0].Protocol == nil || *dnsPorts[0].Protocol != corev1.ProtocolUDP || dnsPorts[1].Protocol == nil || *dnsPorts[1].Protocol != corev1.ProtocolTCP || dnsPorts[0].Port == nil || dnsPorts[0].Port.IntVal != 53 || dnsPorts[1].Port == nil || dnsPorts[1].Port.IntVal != 53 {
		t.Fatalf("DNS egress ports = %+v", dnsPorts)
	}
}

func TestInspectRejectsDangerousWorkloadDrift(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*corev1.PodSpec)
	}{
		{name: "privileged container", mutate: func(pod *corev1.PodSpec) { value := true; pod.Containers[0].SecurityContext.Privileged = &value }},
		{name: "ServiceAccount token", mutate: func(pod *corev1.PodSpec) { value := true; pod.AutomountServiceAccountToken = &value }},
		{name: "host network", mutate: func(pod *corev1.PodSpec) { pod.HostNetwork = true }},
		{name: "unbounded CPU request", mutate: func(pod *corev1.PodSpec) { delete(pod.Containers[0].Resources.Requests, corev1.ResourceCPU) }},
		{name: "plaintext platform secret", mutate: func(pod *corev1.PodSpec) {
			pod.Containers[0].Env[len(pod.Containers[0].Env)-1].ValueFrom = nil
			pod.Containers[0].Env[len(pod.Containers[0].Env)-1].Value = "flag{unsafe-plaintext}"
		}},
		{name: "host path", mutate: func(pod *corev1.PodSpec) {
			pod.Volumes = []corev1.Volume{{Name: "tmp", VolumeSource: corev1.VolumeSource{HostPath: &corev1.HostPathVolumeSource{Path: "/"}}}}
		}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			provider, client, spec, name := readyFakeKubernetesProvider(t)
			ctx := context.Background()
			workload, _ := client.AppsV1().Deployments("challenge-test").Get(ctx, name, metav1.GetOptions{})
			testCase.mutate(&workload.Spec.Template.Spec)
			if _, err := client.AppsV1().Deployments("challenge-test").Update(ctx, workload, metav1.UpdateOptions{}); err != nil {
				t.Fatal(err)
			}
			if _, err := provider.Inspect(ctx, spec.Key); jobs.ClassifyFailure(err).Code != "provider.security_policy_drift" {
				t.Fatalf("Inspect() error = %v", err)
			}
		})
	}
}

func TestInspectRequiresOwnedRuntimeSecretForSensitiveReferences(t *testing.T) {
	provider, client, spec, name := readyFakeKubernetesProvider(t)
	ctx := context.Background()
	if err := client.CoreV1().Secrets("challenge-test").Delete(ctx, name, metav1.DeleteOptions{}); err != nil {
		t.Fatal(err)
	}
	observation, err := provider.Inspect(ctx, spec.Key)
	if err != nil || observation.State != jobs.ObservedStarting || len(observation.Entrypoints) != 0 {
		t.Fatalf("Inspect() without runtime Secret = %+v/%v", observation, err)
	}

	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: "challenge-test", Labels: spec.Key.Labels()},
		Type:       corev1.SecretTypeOpaque,
		Data:       map[string][]byte{"SAURYCTF_FLAG": []byte("flag{restored}"), "UNEXPECTED": []byte("unsafe")},
	}
	if _, err := client.CoreV1().Secrets("challenge-test").Create(ctx, secret, metav1.CreateOptions{}); err != nil {
		t.Fatal(err)
	}
	if _, err := provider.Inspect(ctx, spec.Key); jobs.ClassifyFailure(err).Code != "provider.security_policy_drift" {
		t.Fatalf("Inspect() accepted broadened runtime Secret: %v", err)
	}
}

func TestInspectRequiresUntamperedNetworkPolicy(t *testing.T) {
	provider, client, spec, name := readyFakeKubernetesProvider(t)
	ctx := context.Background()
	policy, _ := client.NetworkingV1().NetworkPolicies("challenge-test").Get(ctx, networkPolicyName(name), metav1.GetOptions{})
	policy.Spec.Egress = []networkingv1.NetworkPolicyEgressRule{{}}
	if _, err := client.NetworkingV1().NetworkPolicies("challenge-test").Update(ctx, policy, metav1.UpdateOptions{}); err != nil {
		t.Fatal(err)
	}
	if _, err := provider.Inspect(ctx, spec.Key); jobs.ClassifyFailure(err).Code != "provider.security_policy_drift" {
		t.Fatalf("Inspect() drift error = %v", err)
	}

	if err := client.NetworkingV1().NetworkPolicies("challenge-test").Delete(ctx, networkPolicyName(name), metav1.DeleteOptions{}); err != nil {
		t.Fatal(err)
	}
	observation, err := provider.Inspect(ctx, spec.Key)
	if err != nil || observation.State != jobs.ObservedStarting || len(observation.Entrypoints) != 0 {
		t.Fatalf("Inspect() without NetworkPolicy = %+v/%v", observation, err)
	}
}

func snapshotSecurityResources(pod corev1.PodSpec, policy networkingv1.NetworkPolicySpec) secureResourceSnapshot {
	container := pod.Containers[0]
	requests := make(map[corev1.ResourceName]string, len(container.Resources.Requests))
	limits := make(map[corev1.ResourceName]string, len(container.Resources.Limits))
	for name, quantity := range container.Resources.Requests {
		requests[name] = quantity.String()
	}
	for name, quantity := range container.Resources.Limits {
		limits[name] = quantity.String()
	}
	ingressPorts := make([]int32, 0, len(policy.Ingress[0].Ports))
	for _, port := range policy.Ingress[0].Ports {
		ingressPorts = append(ingressPorts, port.Port.IntVal)
	}
	return secureResourceSnapshot{
		AutomountServiceAccountToken: *pod.AutomountServiceAccountToken,
		EnableServiceLinks:           *pod.EnableServiceLinks,
		HostNetwork:                  pod.HostNetwork,
		HostPID:                      pod.HostPID,
		HostIPC:                      pod.HostIPC,
		PodRunAsNonRoot:              *pod.SecurityContext.RunAsNonRoot,
		PodSeccomp:                   pod.SecurityContext.SeccompProfile.Type,
		ContainerPrivileged:          *container.SecurityContext.Privileged,
		AllowPrivilegeEscalation:     *container.SecurityContext.AllowPrivilegeEscalation,
		ReadOnlyRootFilesystem:       *container.SecurityContext.ReadOnlyRootFilesystem,
		ContainerRunAsNonRoot:        *container.SecurityContext.RunAsNonRoot,
		ContainerSeccomp:             container.SecurityContext.SeccompProfile.Type,
		DroppedCapabilities:          append([]corev1.Capability(nil), container.SecurityContext.Capabilities.Drop...),
		Requests:                     requests,
		Limits:                       limits,
		TemporaryVolume:              pod.Volumes[0].Name + ":" + pod.Volumes[0].EmptyDir.SizeLimit.String(),
		TemporaryMount:               container.VolumeMounts[0].Name + ":" + container.VolumeMounts[0].MountPath,
		NetworkSelector:              policy.PodSelector.MatchLabels,
		NetworkPolicyTypes:           append([]networkingv1.PolicyType(nil), policy.PolicyTypes...),
		IngressPorts:                 ingressPorts,
		EgressRuleCount:              len(policy.Egress),
	}
}
