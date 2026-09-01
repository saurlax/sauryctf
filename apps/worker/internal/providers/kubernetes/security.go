package kubernetes

import (
	"context"
	"errors"
	"fmt"
	"strings"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	apiequality "k8s.io/apimachinery/pkg/api/equality"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"

	"github.com/saurlax/sauryctf/apps/worker/internal/contracts"
	"github.com/saurlax/sauryctf/apps/worker/internal/jobs"
	"github.com/saurlax/sauryctf/apps/worker/internal/providers"
)

const AnnotationNetworkEgress = "sauryctf.io/network-egress"

var internetEgressExcludedCIDRs = []string{
	"10.0.0.0/8",
	"100.64.0.0/10",
	"127.0.0.0/8",
	"169.254.0.0/16",
	"172.16.0.0/12",
	"192.0.0.0/24",
	"192.0.2.0/24",
	"192.168.0.0/16",
	"198.18.0.0/15",
	"198.51.100.0/24",
	"203.0.113.0/24",
	"224.0.0.0/4",
	"240.0.0.0/4",
}

func securePodSpec(container corev1.Container, limits contracts.InstanceResourceLimits) corev1.PodSpec {
	runAsNonRoot := true
	allowPrivilegeEscalation := false
	readOnlyRootFilesystem := true
	privileged := false
	automountServiceAccountToken := false
	enableServiceLinks := false
	container.SecurityContext = &corev1.SecurityContext{
		AllowPrivilegeEscalation: &allowPrivilegeEscalation,
		Capabilities:             &corev1.Capabilities{Drop: []corev1.Capability{"ALL"}},
		Privileged:               &privileged,
		ReadOnlyRootFilesystem:   &readOnlyRootFilesystem,
		RunAsNonRoot:             &runAsNonRoot,
		SeccompProfile:           &corev1.SeccompProfile{Type: corev1.SeccompProfileTypeRuntimeDefault},
	}
	container.Resources = boundedResources(limits)
	container.VolumeMounts = []corev1.VolumeMount{{Name: "tmp", MountPath: "/tmp"}}
	tmpLimit := *resource.NewQuantity(limits.EphemeralStorageBytes, resource.BinarySI)
	return corev1.PodSpec{
		AutomountServiceAccountToken: &automountServiceAccountToken,
		EnableServiceLinks:           &enableServiceLinks,
		SecurityContext: &corev1.PodSecurityContext{
			RunAsNonRoot:   &runAsNonRoot,
			SeccompProfile: &corev1.SeccompProfile{Type: corev1.SeccompProfileTypeRuntimeDefault},
		},
		Containers: []corev1.Container{container},
		Volumes:    []corev1.Volume{{Name: "tmp", VolumeSource: corev1.VolumeSource{EmptyDir: &corev1.EmptyDirVolumeSource{SizeLimit: &tmpLimit}}}},
	}
}

func boundedResources(limits contracts.InstanceResourceLimits) corev1.ResourceRequirements {
	values := corev1.ResourceList{
		corev1.ResourceCPU:              *resource.NewMilliQuantity(limits.CPUMillicores, resource.DecimalSI),
		corev1.ResourceMemory:           *resource.NewQuantity(limits.MemoryBytes, resource.BinarySI),
		corev1.ResourceEphemeralStorage: *resource.NewQuantity(limits.EphemeralStorageBytes, resource.BinarySI),
	}
	return corev1.ResourceRequirements{Limits: values.DeepCopy(), Requests: values.DeepCopy()}
}

func (provider *Provider) ensureNetworkPolicy(ctx context.Context, name string, spec providers.InstanceSpec) error {
	desired := instanceNetworkPolicy(networkPolicyName(name), provider.namespace, name, spec.Key, spec.Runtime.Entrypoints, spec.Runtime.Network.Egress)
	current, err := provider.client.NetworkingV1().NetworkPolicies(provider.namespace).Get(ctx, desired.Name, metav1.GetOptions{})
	if apierrors.IsNotFound(err) {
		_, err = provider.client.NetworkingV1().NetworkPolicies(provider.namespace).Create(ctx, desired, metav1.CreateOptions{})
		return classifyCreate("network policy", err)
	}
	if err != nil {
		return retryable("get network policy", err)
	}
	if err := validateLabels(current.Labels, spec.Key); err != nil {
		return ownershipError(err)
	}
	desired.ResourceVersion = current.ResourceVersion
	_, err = provider.client.NetworkingV1().NetworkPolicies(provider.namespace).Update(ctx, desired, metav1.UpdateOptions{})
	return classifyUpdate("network policy", err)
}

func (provider *Provider) inspectNetworkPolicy(ctx context.Context, name string, key providers.InstanceKey, entrypoints []contracts.InstanceEntrypointSpec, egress string) (bool, error) {
	current, err := provider.client.NetworkingV1().NetworkPolicies(provider.namespace).Get(ctx, networkPolicyName(name), metav1.GetOptions{})
	if apierrors.IsNotFound(err) {
		return false, nil
	}
	if err != nil {
		return false, retryable("inspect network policy", err)
	}
	if err := validateLabels(current.Labels, key); err != nil {
		return false, ownershipError(err)
	}
	if current.DeletionTimestamp != nil {
		return false, nil
	}
	expected := instanceNetworkPolicy(current.Name, provider.namespace, name, key, entrypoints, egress)
	if !apiequality.Semantic.DeepEqual(current.Spec, expected.Spec) {
		return false, jobs.PermanentError("provider.security_policy_drift", "Kubernetes NetworkPolicy no longer matches the required isolation policy", nil)
	}
	return true, nil
}

func instanceNetworkPolicy(name, namespace, workloadName string, key providers.InstanceKey, entrypoints []contracts.InstanceEntrypointSpec, egress string) *networkingv1.NetworkPolicy {
	protocol := corev1.ProtocolTCP
	ingressPorts := make([]networkingv1.NetworkPolicyPort, 0, len(entrypoints))
	for _, entrypoint := range entrypoints {
		port := intstr.FromInt32(int32(entrypoint.ContainerPort))
		ingressPorts = append(ingressPorts, networkingv1.NetworkPolicyPort{Protocol: &protocol, Port: &port})
	}
	policy := &networkingv1.NetworkPolicy{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: namespace, Labels: key.Labels()},
		Spec: networkingv1.NetworkPolicySpec{
			PodSelector: metav1.LabelSelector{MatchLabels: map[string]string{"sauryctf.io/resource-name": workloadName}},
			PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeIngress, networkingv1.PolicyTypeEgress},
			Ingress:     []networkingv1.NetworkPolicyIngressRule{{Ports: ingressPorts}},
		},
	}
	if egress == "internet" {
		port53 := intstr.FromInt32(53)
		udp := corev1.ProtocolUDP
		tcp := corev1.ProtocolTCP
		policy.Spec.Egress = []networkingv1.NetworkPolicyEgressRule{
			{To: []networkingv1.NetworkPolicyPeer{{IPBlock: &networkingv1.IPBlock{CIDR: "0.0.0.0/0", Except: append([]string(nil), internetEgressExcludedCIDRs...)}}}},
			{Ports: []networkingv1.NetworkPolicyPort{{Protocol: &udp, Port: &port53}, {Protocol: &tcp, Port: &port53}}},
		}
	}
	return policy
}

func validateDeploymentSecurity(deployment *appsv1.Deployment) error {
	pod := deployment.Spec.Template.Spec
	if pod.AutomountServiceAccountToken == nil || *pod.AutomountServiceAccountToken || pod.EnableServiceLinks == nil || *pod.EnableServiceLinks {
		return errors.New("ServiceAccount token or service-link injection is enabled")
	}
	if pod.HostNetwork || pod.HostPID || pod.HostIPC || pod.ShareProcessNamespace != nil && *pod.ShareProcessNamespace {
		return errors.New("host or shared process namespaces are enabled")
	}
	if pod.SecurityContext == nil || pod.SecurityContext.RunAsNonRoot == nil || !*pod.SecurityContext.RunAsNonRoot || pod.SecurityContext.SeccompProfile == nil || pod.SecurityContext.SeccompProfile.Type != corev1.SeccompProfileTypeRuntimeDefault {
		return errors.New("Pod non-root or seccomp defaults are missing")
	}
	if len(pod.Containers) != 1 {
		return errors.New("workload must contain exactly one challenge container")
	}
	container := pod.Containers[0]
	security := container.SecurityContext
	if security == nil || security.Privileged == nil || *security.Privileged || security.AllowPrivilegeEscalation == nil || *security.AllowPrivilegeEscalation || security.ReadOnlyRootFilesystem == nil || !*security.ReadOnlyRootFilesystem || security.RunAsNonRoot == nil || !*security.RunAsNonRoot {
		return errors.New("container privilege or filesystem policy is unsafe")
	}
	if security.SeccompProfile == nil || security.SeccompProfile.Type != corev1.SeccompProfileTypeRuntimeDefault || security.Capabilities == nil || len(security.Capabilities.Add) != 0 || len(security.Capabilities.Drop) != 1 || security.Capabilities.Drop[0] != "ALL" {
		return errors.New("container seccomp or capability policy is unsafe")
	}
	for _, port := range container.Ports {
		if port.HostPort != 0 || port.HostIP != "" {
			return errors.New("container requests a host port")
		}
	}
	if len(container.EnvFrom) != 0 {
		return errors.New("container uses an unapproved environment source")
	}
	for _, variable := range container.Env {
		if variable.ValueFrom == nil {
			if strings.HasPrefix(variable.Name, "SAURYCTF_") {
				return errors.New("platform-sensitive environment is stored in plaintext")
			}
			continue
		}
		secret := variable.ValueFrom.SecretKeyRef
		if !strings.HasPrefix(variable.Name, "SAURYCTF_") || variable.Value != "" || secret == nil ||
			secret.Name != deployment.Name || secret.Key != variable.Name || secret.Optional != nil && *secret.Optional ||
			variable.ValueFrom.ConfigMapKeyRef != nil || variable.ValueFrom.FieldRef != nil || variable.ValueFrom.ResourceFieldRef != nil {
			return errors.New("container uses an unapproved environment reference")
		}
	}
	for _, name := range []corev1.ResourceName{corev1.ResourceCPU, corev1.ResourceMemory, corev1.ResourceEphemeralStorage} {
		limit, hasLimit := container.Resources.Limits[name]
		request, hasRequest := container.Resources.Requests[name]
		if !hasLimit || !hasRequest || limit.Sign() <= 0 || request.Cmp(limit) != 0 {
			return fmt.Errorf("resource %s must have equal positive request and limit", name)
		}
	}
	if len(pod.Volumes) != 1 || pod.Volumes[0].Name != "tmp" || pod.Volumes[0].EmptyDir == nil || pod.Volumes[0].EmptyDir.SizeLimit == nil || pod.Volumes[0].EmptyDir.SizeLimit.Sign() <= 0 {
		return errors.New("writable temporary storage is not safely bounded")
	}
	if len(container.VolumeMounts) != 1 || container.VolumeMounts[0].Name != "tmp" || container.VolumeMounts[0].MountPath != "/tmp" || container.VolumeMounts[0].SubPath != "" {
		return errors.New("container volume mounts are outside the allowed temporary storage")
	}
	return nil
}

func deploymentNetworkPolicy(deployment metav1.Object) (string, error) {
	egress := deployment.GetAnnotations()[AnnotationNetworkEgress]
	policy := contracts.InstanceNetworkPolicy{Egress: egress}
	if err := policy.Validate(); err != nil {
		return "", err
	}
	return egress, nil
}

func (provider *Provider) inspectRuntimeSecret(ctx context.Context, name string, key providers.InstanceKey, deployment *appsv1.Deployment) (bool, error) {
	expected := make(map[string]struct{})
	for _, variable := range deployment.Spec.Template.Spec.Containers[0].Env {
		if variable.ValueFrom != nil && variable.ValueFrom.SecretKeyRef != nil {
			expected[variable.Name] = struct{}{}
		}
	}
	if len(expected) == 0 {
		return true, nil
	}
	secret, err := provider.client.CoreV1().Secrets(provider.namespace).Get(ctx, name, metav1.GetOptions{})
	if apierrors.IsNotFound(err) {
		return false, nil
	}
	if err != nil {
		return false, retryable("inspect secret", err)
	}
	if err := validateLabels(secret.Labels, key); err != nil {
		return false, ownershipError(err)
	}
	if secret.DeletionTimestamp != nil {
		return false, nil
	}
	if secret.Type != corev1.SecretTypeOpaque || len(secret.Data) != len(expected) {
		return false, jobs.PermanentError("provider.security_policy_drift", "Kubernetes runtime Secret no longer matches the required injection policy", nil)
	}
	for name := range expected {
		if len(secret.Data[name]) == 0 {
			return false, jobs.PermanentError("provider.security_policy_drift", "Kubernetes runtime Secret no longer matches the required injection policy", nil)
		}
	}
	return true, nil
}

func networkPolicyName(name string) string { return relatedResourceName(name, 'n') }
