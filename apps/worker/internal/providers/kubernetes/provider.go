package kubernetes

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/kubernetes"

	"github.com/saurlax/sauryctf/apps/worker/internal/contracts"
	"github.com/saurlax/sauryctf/apps/worker/internal/jobs"
	"github.com/saurlax/sauryctf/apps/worker/internal/providers"
)

var namespacePattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`)

type Provider struct {
	client    kubernetes.Interface
	namespace string
	routes    RouteConfig
}

func New(client kubernetes.Interface, namespace string, routeConfig ...RouteConfig) (*Provider, error) {
	if client == nil || !namespacePattern.MatchString(namespace) {
		return nil, errors.New("Kubernetes provider requires a client and DNS-label namespace")
	}
	if len(routeConfig) > 1 {
		return nil, errors.New("Kubernetes provider accepts at most one route configuration")
	}
	routes := RouteConfig{}
	if len(routeConfig) == 1 {
		routes = routeConfig[0]
		if err := routes.Validate(); err != nil {
			return nil, fmt.Errorf("validate Kubernetes route configuration: %w", err)
		}
	}
	return &Provider{client: client, namespace: namespace, routes: routes}, nil
}

func (provider *Provider) Kind() contracts.InstanceProvider { return contracts.ProviderKubernetes }

func (provider *Provider) Ensure(ctx context.Context, spec providers.InstanceSpec) (jobs.Observation, error) {
	if err := spec.Validate(); err != nil || spec.Key.Provider != contracts.ProviderKubernetes {
		return jobs.Observation{}, jobs.PermanentError("provider.invalid_spec", "Kubernetes instance configuration is invalid", err)
	}
	if err := provider.routes.ValidateEntrypoints(spec.Runtime.Entrypoints); err != nil {
		return jobs.Observation{}, jobs.PermanentError("provider.routes_unavailable", "Kubernetes entrypoint routing is not configured", err)
	}
	name, _ := spec.Key.ResourceName()
	if err := provider.ensureSecret(ctx, name, spec); err != nil {
		return jobs.Observation{}, err
	}
	if err := provider.ensureService(ctx, name, spec); err != nil {
		return jobs.Observation{}, err
	}
	if err := provider.ensureDeployment(ctx, name, spec); err != nil {
		return jobs.Observation{}, err
	}
	if err := provider.ensureNetworkPolicy(ctx, name, spec); err != nil {
		return jobs.Observation{}, err
	}
	if err := provider.ensureRoutes(ctx, name, spec); err != nil {
		return jobs.Observation{}, err
	}
	return provider.Inspect(ctx, spec.Key)
}

func (provider *Provider) Inspect(ctx context.Context, key providers.InstanceKey) (jobs.Observation, error) {
	if err := validateKey(key); err != nil {
		return jobs.Observation{}, jobs.PermanentError("provider.invalid_key", "Kubernetes instance identity is invalid", err)
	}
	name, _ := key.ResourceName()
	deployment, err := provider.client.AppsV1().Deployments(provider.namespace).Get(ctx, name, metav1.GetOptions{})
	if apierrors.IsNotFound(err) {
		return jobs.Observation{State: jobs.ObservedUnknown, ErrorCode: "provider.resource_missing", ErrorSummary: "Kubernetes workload is missing"}, nil
	}
	if err != nil {
		return jobs.Observation{}, retryable("inspect deployment", err)
	}
	if err := validateLabels(deployment.Labels, key); err != nil {
		return jobs.Observation{}, ownershipError(err)
	}
	service, err := provider.client.CoreV1().Services(provider.namespace).Get(ctx, name, metav1.GetOptions{})
	if apierrors.IsNotFound(err) {
		return jobs.Observation{State: jobs.ObservedStarting, ProviderResourceID: resourceID(provider.namespace, name)}, nil
	}
	if err != nil {
		return jobs.Observation{}, retryable("inspect service", err)
	}
	if err := validateLabels(service.Labels, key); err != nil {
		return jobs.Observation{}, ownershipError(err)
	}
	if err := validateDeploymentSecurity(deployment); err != nil {
		return jobs.Observation{}, jobs.PermanentError("provider.security_policy_drift", "Kubernetes workload no longer matches the required security policy", err)
	}
	entrypointSpecs, err := deploymentEntrypoints(deployment)
	if err != nil {
		return jobs.Observation{}, jobs.PermanentError("provider.invalid_entrypoints", "Kubernetes workload entrypoint metadata is invalid", err)
	}
	egress, err := deploymentNetworkPolicy(deployment)
	if err != nil {
		return jobs.Observation{}, jobs.PermanentError("provider.security_policy_drift", "Kubernetes workload network policy metadata is invalid", err)
	}
	policyReady, err := provider.inspectNetworkPolicy(ctx, name, key, entrypointSpecs, egress)
	if err != nil {
		return jobs.Observation{}, err
	}
	if !policyReady {
		return jobs.Observation{State: jobs.ObservedStarting, ProviderResourceID: resourceID(provider.namespace, name)}, nil
	}
	if !deploymentReady(deployment) {
		return jobs.Observation{State: jobs.ObservedStarting, ProviderResourceID: resourceID(provider.namespace, name)}, nil
	}
	entrypoints, ready, err := provider.inspectRoutes(ctx, name, key, entrypointSpecs)
	if err != nil {
		return jobs.Observation{}, err
	}
	if !ready {
		return jobs.Observation{State: jobs.ObservedStarting, ProviderResourceID: resourceID(provider.namespace, name)}, nil
	}
	return jobs.Observation{State: jobs.ObservedRunning, ProviderResourceID: resourceID(provider.namespace, name), Entrypoints: entrypoints}, nil
}

func (provider *Provider) Destroy(ctx context.Context, key providers.InstanceKey) (jobs.Observation, error) {
	if err := validateKey(key); err != nil {
		return jobs.Observation{}, jobs.PermanentError("provider.invalid_key", "Kubernetes instance identity is invalid", err)
	}
	name, _ := key.ResourceName()
	if err := provider.verifyOwnedObjects(ctx, name, key); err != nil {
		return jobs.Observation{}, err
	}
	policy := metav1.DeletePropagationBackground
	for kind, remove := range map[string]func() error{
		"deployment": func() error {
			return provider.client.AppsV1().Deployments(provider.namespace).Delete(ctx, name, metav1.DeleteOptions{PropagationPolicy: &policy})
		},
		"service": func() error {
			return provider.client.CoreV1().Services(provider.namespace).Delete(ctx, name, metav1.DeleteOptions{})
		},
		"secret": func() error {
			return provider.client.CoreV1().Secrets(provider.namespace).Delete(ctx, name, metav1.DeleteOptions{})
		},
		"http ingress": func() error {
			return provider.client.NetworkingV1().Ingresses(provider.namespace).Delete(ctx, httpRouteName(name), metav1.DeleteOptions{})
		},
		"tcp service": func() error {
			return provider.client.CoreV1().Services(provider.namespace).Delete(ctx, tcpRouteName(name), metav1.DeleteOptions{})
		},
		"network policy": func() error {
			return provider.client.NetworkingV1().NetworkPolicies(provider.namespace).Delete(ctx, networkPolicyName(name), metav1.DeleteOptions{})
		},
	} {
		if err := remove(); err != nil && !apierrors.IsNotFound(err) {
			return jobs.Observation{}, retryable("delete "+kind, err)
		}
	}
	return jobs.Observation{State: jobs.ObservedStopped}, nil
}

func (provider *Provider) List(ctx context.Context, platformID string) ([]providers.Resource, error) {
	selector := labels.Set{providers.LabelPlatform: platformID}.AsSelector().String()
	deployments, err := provider.client.AppsV1().Deployments(provider.namespace).List(ctx, metav1.ListOptions{LabelSelector: selector})
	if err != nil {
		return nil, retryable("list deployments", err)
	}
	result := make([]providers.Resource, 0, len(deployments.Items))
	for _, deployment := range deployments.Items {
		result = append(result, providers.Resource{Provider: contracts.ProviderKubernetes, ResourceID: resourceID(provider.namespace, deployment.Name), Labels: deployment.Labels})
	}
	return result, nil
}

func (provider *Provider) ensureDeployment(ctx context.Context, name string, spec providers.InstanceSpec) error {
	desired := deployment(name, provider.namespace, spec)
	current, err := provider.client.AppsV1().Deployments(provider.namespace).Get(ctx, name, metav1.GetOptions{})
	if apierrors.IsNotFound(err) {
		_, err = provider.client.AppsV1().Deployments(provider.namespace).Create(ctx, desired, metav1.CreateOptions{})
		return classifyCreate("deployment", err)
	}
	if err != nil {
		return retryable("get deployment", err)
	}
	if err := validateLabels(current.Labels, spec.Key); err != nil {
		return ownershipError(err)
	}
	desired.ResourceVersion = current.ResourceVersion
	_, err = provider.client.AppsV1().Deployments(provider.namespace).Update(ctx, desired, metav1.UpdateOptions{})
	return classifyUpdate("deployment", err)
}

func (provider *Provider) ensureService(ctx context.Context, name string, spec providers.InstanceSpec) error {
	desired := service(name, provider.namespace, spec)
	current, err := provider.client.CoreV1().Services(provider.namespace).Get(ctx, name, metav1.GetOptions{})
	if apierrors.IsNotFound(err) {
		_, err = provider.client.CoreV1().Services(provider.namespace).Create(ctx, desired, metav1.CreateOptions{})
		return classifyCreate("service", err)
	}
	if err != nil {
		return retryable("get service", err)
	}
	if err := validateLabels(current.Labels, spec.Key); err != nil {
		return ownershipError(err)
	}
	desired.ResourceVersion, desired.Spec.ClusterIP, desired.Spec.ClusterIPs = current.ResourceVersion, current.Spec.ClusterIP, current.Spec.ClusterIPs
	desired.Spec.IPFamilies, desired.Spec.IPFamilyPolicy = current.Spec.IPFamilies, current.Spec.IPFamilyPolicy
	_, err = provider.client.CoreV1().Services(provider.namespace).Update(ctx, desired, metav1.UpdateOptions{})
	return classifyUpdate("service", err)
}

func (provider *Provider) ensureSecret(ctx context.Context, name string, spec providers.InstanceSpec) error {
	if spec.Runtime.SecretEnvelope == nil {
		return nil
	}
	payload, err := json.Marshal(spec.Runtime.SecretEnvelope)
	if err != nil {
		return jobs.PermanentError("provider.invalid_secret", "Kubernetes secret envelope is invalid", err)
	}
	desired := &corev1.Secret{ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: provider.namespace, Labels: spec.Key.Labels()}, Type: corev1.SecretTypeOpaque, Data: map[string][]byte{"envelope.json": payload}}
	current, err := provider.client.CoreV1().Secrets(provider.namespace).Get(ctx, name, metav1.GetOptions{})
	if apierrors.IsNotFound(err) {
		_, err = provider.client.CoreV1().Secrets(provider.namespace).Create(ctx, desired, metav1.CreateOptions{})
		return classifyCreate("secret", err)
	}
	if err != nil {
		return retryable("get secret", err)
	}
	if err := validateLabels(current.Labels, spec.Key); err != nil {
		return ownershipError(err)
	}
	desired.ResourceVersion = current.ResourceVersion
	_, err = provider.client.CoreV1().Secrets(provider.namespace).Update(ctx, desired, metav1.UpdateOptions{})
	return classifyUpdate("secret", err)
}

func deployment(name, namespace string, spec providers.InstanceSpec) *appsv1.Deployment {
	replicas := int32(1)
	podLabels := spec.Key.Labels()
	podLabels["sauryctf.io/resource-name"] = name
	ports := make([]corev1.ContainerPort, 0, len(spec.Runtime.Entrypoints))
	env := make([]corev1.EnvVar, 0, len(spec.Runtime.Environment))
	for _, item := range spec.Runtime.Entrypoints {
		ports = append(ports, corev1.ContainerPort{Name: item.Name, ContainerPort: int32(item.ContainerPort), Protocol: corev1.ProtocolTCP})
	}
	for _, item := range spec.Runtime.Environment {
		env = append(env, corev1.EnvVar{Name: item.Name, Value: item.Value})
	}
	entrypoints, _ := json.Marshal(spec.Runtime.Entrypoints)
	container := corev1.Container{Name: "challenge", Image: spec.Runtime.Image, Env: env, Ports: ports}
	return &appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: namespace, Labels: spec.Key.Labels(), Annotations: map[string]string{AnnotationEntrypoints: string(entrypoints), AnnotationNetworkEgress: spec.Runtime.Network.Egress}}, Spec: appsv1.DeploymentSpec{Replicas: &replicas, Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"sauryctf.io/resource-name": name}}, Template: corev1.PodTemplateSpec{ObjectMeta: metav1.ObjectMeta{Labels: podLabels}, Spec: securePodSpec(container, spec.Runtime.Resources)}}}
}

func service(name, namespace string, spec providers.InstanceSpec) *corev1.Service {
	ports := make([]corev1.ServicePort, 0, len(spec.Runtime.Entrypoints))
	for _, item := range spec.Runtime.Entrypoints {
		ports = append(ports, corev1.ServicePort{Name: item.Name, Port: int32(item.ContainerPort), TargetPort: intstr.FromString(item.Name), Protocol: corev1.ProtocolTCP})
	}
	return &corev1.Service{ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: namespace, Labels: spec.Key.Labels()}, Spec: corev1.ServiceSpec{Selector: map[string]string{"sauryctf.io/resource-name": name}, Ports: ports, Type: corev1.ServiceTypeClusterIP}}
}

func deploymentReady(deployment *appsv1.Deployment) bool {
	if deployment.DeletionTimestamp != nil || deployment.Status.ObservedGeneration < deployment.Generation {
		return false
	}
	desiredReplicas := int32(1)
	if deployment.Spec.Replicas != nil {
		desiredReplicas = *deployment.Spec.Replicas
	}
	if desiredReplicas < 1 || deployment.Status.ReadyReplicas < desiredReplicas || deployment.Status.AvailableReplicas < desiredReplicas {
		return false
	}
	for _, condition := range deployment.Status.Conditions {
		if condition.Type == appsv1.DeploymentAvailable && condition.Status == corev1.ConditionTrue {
			return true
		}
	}
	return false
}

func (provider *Provider) verifyOwnedObjects(ctx context.Context, name string, key providers.InstanceKey) error {
	objects := []struct {
		name   string
		labels func() (map[string]string, error)
	}{
		{"deployment", func() (map[string]string, error) {
			o, e := provider.client.AppsV1().Deployments(provider.namespace).Get(ctx, name, metav1.GetOptions{})
			if apierrors.IsNotFound(e) {
				return nil, nil
			}
			if e != nil {
				return nil, e
			}
			return o.Labels, nil
		}},
		{"service", func() (map[string]string, error) {
			o, e := provider.client.CoreV1().Services(provider.namespace).Get(ctx, name, metav1.GetOptions{})
			if apierrors.IsNotFound(e) {
				return nil, nil
			}
			if e != nil {
				return nil, e
			}
			return o.Labels, nil
		}},
		{"secret", func() (map[string]string, error) {
			o, e := provider.client.CoreV1().Secrets(provider.namespace).Get(ctx, name, metav1.GetOptions{})
			if apierrors.IsNotFound(e) {
				return nil, nil
			}
			if e != nil {
				return nil, e
			}
			return o.Labels, nil
		}},
		{"http ingress", func() (map[string]string, error) {
			o, e := provider.client.NetworkingV1().Ingresses(provider.namespace).Get(ctx, httpRouteName(name), metav1.GetOptions{})
			if apierrors.IsNotFound(e) {
				return nil, nil
			}
			if e != nil {
				return nil, e
			}
			return o.Labels, nil
		}},
		{"tcp service", func() (map[string]string, error) {
			o, e := provider.client.CoreV1().Services(provider.namespace).Get(ctx, tcpRouteName(name), metav1.GetOptions{})
			if apierrors.IsNotFound(e) {
				return nil, nil
			}
			if e != nil {
				return nil, e
			}
			return o.Labels, nil
		}},
		{"network policy", func() (map[string]string, error) {
			o, e := provider.client.NetworkingV1().NetworkPolicies(provider.namespace).Get(ctx, networkPolicyName(name), metav1.GetOptions{})
			if apierrors.IsNotFound(e) {
				return nil, nil
			}
			if e != nil {
				return nil, e
			}
			return o.Labels, nil
		}},
	}
	for _, object := range objects {
		value, err := object.labels()
		if err != nil {
			return retryable("inspect "+object.name, err)
		}
		if value != nil {
			if err := validateLabels(value, key); err != nil {
				return ownershipError(err)
			}
		}
	}
	return nil
}

func validateKey(key providers.InstanceKey) error {
	if err := key.Validate(); err != nil {
		return err
	}
	if key.Provider != contracts.ProviderKubernetes {
		return errors.New("instance key does not target Kubernetes")
	}
	return nil
}
func validateLabels(value map[string]string, key providers.InstanceKey) error {
	parsed, err := providers.ParseInstanceKey(value, key.Platform, contracts.ProviderKubernetes)
	if err != nil {
		return err
	}
	if parsed != key {
		return errors.New("resource ownership labels do not match requested instance")
	}
	return nil
}
func resourceID(namespace, name string) string { return "kubernetes/" + namespace + "/" + name }
func ownershipError(err error) error {
	return jobs.PermanentError("provider.ownership_conflict", "Kubernetes resource ownership does not permit mutation", err)
}
func retryable(operation string, err error) error {
	return jobs.RetryableError("provider.kubernetes_unavailable", "Kubernetes "+operation+" is temporarily unavailable", err)
}
func classifyCreate(kind string, err error) error {
	if err == nil {
		return nil
	}
	if apierrors.IsInvalid(err) || apierrors.IsForbidden(err) {
		return jobs.PermanentError("provider.kubernetes_rejected", "Kubernetes rejected the "+kind+" configuration", err)
	}
	return retryable("create "+kind, err)
}
func classifyUpdate(kind string, err error) error {
	if err == nil {
		return nil
	}
	if apierrors.IsInvalid(err) || apierrors.IsForbidden(err) {
		return jobs.PermanentError("provider.kubernetes_rejected", "Kubernetes rejected the "+kind+" configuration", err)
	}
	return retryable("update "+kind, err)
}
