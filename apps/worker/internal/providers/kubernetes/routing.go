package kubernetes

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"

	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	utilvalidation "k8s.io/apimachinery/pkg/util/validation"

	"github.com/saurlax/sauryctf/apps/worker/internal/contracts"
	"github.com/saurlax/sauryctf/apps/worker/internal/jobs"
	"github.com/saurlax/sauryctf/apps/worker/internal/providers"
)

const AnnotationEntrypoints = "sauryctf.io/entrypoints"

// RouteConfig enables only explicit, bounded public entrypoint mechanisms.
// HTTP uses an Ingress host below HTTPDomain. TCP uses one dedicated
// LoadBalancer Service with ports allocated consecutively from TCPPortStart;
// Kubernetes NodePort allocation is always disabled for that Service.
type RouteConfig struct {
	HTTPDomain        string
	IngressClassName  string
	TLSSecretName     string
	TCPPortStart      int32
	LoadBalancerClass string
}

func (config RouteConfig) Validate() error {
	var problems []error
	if config.HTTPDomain != "" {
		if messages := utilvalidation.IsDNS1123Subdomain(config.HTTPDomain); len(messages) != 0 {
			problems = append(problems, fmt.Errorf("HTTP domain: %s", strings.Join(messages, "; ")))
		}
	}
	if config.IngressClassName != "" {
		if messages := utilvalidation.IsDNS1123Subdomain(config.IngressClassName); len(messages) != 0 {
			problems = append(problems, fmt.Errorf("Ingress class: %s", strings.Join(messages, "; ")))
		}
	}
	if config.TLSSecretName != "" {
		if config.HTTPDomain == "" {
			problems = append(problems, errors.New("TLS secret requires an HTTP domain"))
		}
		if messages := utilvalidation.IsDNS1123Subdomain(config.TLSSecretName); len(messages) != 0 {
			problems = append(problems, fmt.Errorf("TLS secret: %s", strings.Join(messages, "; ")))
		}
	}
	if config.TCPPortStart != 0 && (config.TCPPortStart < 1024 || config.TCPPortStart > 65520) {
		problems = append(problems, errors.New("TCP port start must be between 1024 and 65520"))
	}
	if config.LoadBalancerClass != "" {
		if messages := utilvalidation.IsQualifiedName(config.LoadBalancerClass); len(messages) != 0 {
			problems = append(problems, fmt.Errorf("load balancer class: %s", strings.Join(messages, "; ")))
		}
	}
	return errors.Join(problems...)
}

func (config RouteConfig) ValidateEntrypoints(entrypoints []contracts.InstanceEntrypointSpec) error {
	httpCount := 0
	tcpCount := 0
	for _, entrypoint := range entrypoints {
		switch entrypoint.Protocol {
		case "http":
			httpCount++
			if config.HTTPDomain != "" && len(entrypointHost("route", entrypoint.Name, config.HTTPDomain)) > 253 {
				return fmt.Errorf("HTTP entrypoint %q produces a host longer than 253 characters", entrypoint.Name)
			}
		case "tcp":
			tcpCount++
		}
	}
	if httpCount > 0 && config.HTTPDomain == "" {
		return errors.New("HTTP entrypoints require an Ingress domain")
	}
	if tcpCount > 0 && config.TCPPortStart == 0 {
		return errors.New("TCP entrypoints require an explicitly enabled port range")
	}
	if tcpCount > 0 && int64(config.TCPPortStart)+int64(tcpCount)-1 > 65535 {
		return errors.New("TCP entrypoints exceed the configured port range")
	}
	return nil
}

func (provider *Provider) ensureRoutes(ctx context.Context, name string, spec providers.InstanceSpec) error {
	httpEntrypoints := protocolEntrypoints(spec.Runtime.Entrypoints, "http")
	if len(httpEntrypoints) > 0 {
		if err := provider.ensureIngress(ctx, name, spec.Key, httpEntrypoints); err != nil {
			return err
		}
	}
	tcpEntrypoints := protocolEntrypoints(spec.Runtime.Entrypoints, "tcp")
	if len(tcpEntrypoints) > 0 {
		if err := provider.ensureTCPService(ctx, name, spec.Key, tcpEntrypoints); err != nil {
			return err
		}
	}
	return nil
}

func (provider *Provider) inspectRoutes(ctx context.Context, name string, key providers.InstanceKey, specs []contracts.InstanceEntrypointSpec) ([]jobs.Entrypoint, bool, error) {
	if err := provider.routes.ValidateEntrypoints(specs); err != nil {
		return nil, false, jobs.PermanentError("provider.routes_unavailable", "Kubernetes entrypoint routing is not configured", err)
	}
	resolved := make(map[string]jobs.Entrypoint, len(specs))
	httpEntrypoints := protocolEntrypoints(specs, "http")
	if len(httpEntrypoints) > 0 {
		entrypoints, ready, err := provider.inspectIngress(ctx, name, key, httpEntrypoints)
		if err != nil || !ready {
			return nil, ready, err
		}
		for _, entrypoint := range entrypoints {
			resolved[entrypoint.Name] = entrypoint
		}
	}
	tcpEntrypoints := protocolEntrypoints(specs, "tcp")
	if len(tcpEntrypoints) > 0 {
		entrypoints, ready, err := provider.inspectTCPService(ctx, name, key, tcpEntrypoints)
		if err != nil || !ready {
			return nil, ready, err
		}
		for _, entrypoint := range entrypoints {
			resolved[entrypoint.Name] = entrypoint
		}
	}
	result := make([]jobs.Entrypoint, 0, len(specs))
	for _, spec := range specs {
		entrypoint, exists := resolved[spec.Name]
		if !exists {
			return nil, false, jobs.PermanentError("provider.invalid_route", "Kubernetes route omitted an expected entrypoint", nil)
		}
		result = append(result, entrypoint)
	}
	return result, true, nil
}

func (provider *Provider) ensureIngress(ctx context.Context, name string, key providers.InstanceKey, entrypoints []contracts.InstanceEntrypointSpec) error {
	desired := ingress(httpRouteName(name), provider.namespace, name, key, provider.routes, entrypoints)
	current, err := provider.client.NetworkingV1().Ingresses(provider.namespace).Get(ctx, desired.Name, metav1.GetOptions{})
	if apierrors.IsNotFound(err) {
		_, err = provider.client.NetworkingV1().Ingresses(provider.namespace).Create(ctx, desired, metav1.CreateOptions{})
		return classifyCreate("http ingress", err)
	}
	if err != nil {
		return retryable("get http ingress", err)
	}
	if err := validateLabels(current.Labels, key); err != nil {
		return ownershipError(err)
	}
	desired.ResourceVersion = current.ResourceVersion
	_, err = provider.client.NetworkingV1().Ingresses(provider.namespace).Update(ctx, desired, metav1.UpdateOptions{})
	return classifyUpdate("http ingress", err)
}

func (provider *Provider) ensureTCPService(ctx context.Context, name string, key providers.InstanceKey, entrypoints []contracts.InstanceEntrypointSpec) error {
	desired := tcpService(tcpRouteName(name), provider.namespace, name, key, provider.routes, entrypoints)
	current, err := provider.client.CoreV1().Services(provider.namespace).Get(ctx, desired.Name, metav1.GetOptions{})
	if apierrors.IsNotFound(err) {
		_, err = provider.client.CoreV1().Services(provider.namespace).Create(ctx, desired, metav1.CreateOptions{})
		return classifyCreate("tcp service", err)
	}
	if err != nil {
		return retryable("get tcp service", err)
	}
	if err := validateLabels(current.Labels, key); err != nil {
		return ownershipError(err)
	}
	desired.ResourceVersion = current.ResourceVersion
	preserveServiceAllocation(desired, current)
	_, err = provider.client.CoreV1().Services(provider.namespace).Update(ctx, desired, metav1.UpdateOptions{})
	return classifyUpdate("tcp service", err)
}

func (provider *Provider) inspectIngress(ctx context.Context, name string, key providers.InstanceKey, specs []contracts.InstanceEntrypointSpec) ([]jobs.Entrypoint, bool, error) {
	current, err := provider.client.NetworkingV1().Ingresses(provider.namespace).Get(ctx, httpRouteName(name), metav1.GetOptions{})
	if apierrors.IsNotFound(err) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, retryable("inspect http ingress", err)
	}
	if err := validateLabels(current.Labels, key); err != nil {
		return nil, false, ownershipError(err)
	}
	if !ingressReady(current) {
		return nil, false, nil
	}
	routes := make(map[string]string, len(current.Spec.Rules))
	for _, rule := range current.Spec.Rules {
		if rule.HTTP == nil {
			continue
		}
		for _, path := range rule.HTTP.Paths {
			if path.Backend.Service != nil && path.Backend.Service.Name == name && path.Backend.Service.Port.Name != "" {
				routes[path.Backend.Service.Port.Name] = rule.Host
			}
		}
	}
	result := make([]jobs.Entrypoint, 0, len(specs))
	for _, spec := range specs {
		host := routes[spec.Name]
		if host == "" || host != entrypointHost(name, spec.Name, provider.routes.HTTPDomain) {
			return nil, false, jobs.PermanentError("provider.invalid_route", "Kubernetes Ingress omitted an expected backend", nil)
		}
		scheme := "http"
		port := 80
		usesTLS := ingressHostUsesTLS(current, host)
		if usesTLS != (provider.routes.TLSSecretName != "") {
			return nil, false, jobs.PermanentError("provider.invalid_route", "Kubernetes Ingress TLS policy does not match the configured route", nil)
		}
		if usesTLS {
			scheme = "https"
			port = 443
		}
		result = append(result, jobs.Entrypoint{Name: spec.Name, Protocol: spec.Protocol, Host: host, Port: port, URL: (&url.URL{Scheme: scheme, Host: host}).String()})
	}
	return result, true, nil
}

func (provider *Provider) inspectTCPService(ctx context.Context, name string, key providers.InstanceKey, specs []contracts.InstanceEntrypointSpec) ([]jobs.Entrypoint, bool, error) {
	current, err := provider.client.CoreV1().Services(provider.namespace).Get(ctx, tcpRouteName(name), metav1.GetOptions{})
	if apierrors.IsNotFound(err) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, retryable("inspect tcp service", err)
	}
	if err := validateLabels(current.Labels, key); err != nil {
		return nil, false, ownershipError(err)
	}
	if current.DeletionTimestamp != nil || current.Spec.Type != corev1.ServiceTypeLoadBalancer || current.Spec.AllocateLoadBalancerNodePorts == nil || *current.Spec.AllocateLoadBalancerNodePorts || current.Spec.Selector["sauryctf.io/resource-name"] != name {
		return nil, false, jobs.PermanentError("provider.invalid_route", "Kubernetes TCP Service exposure policy is invalid", nil)
	}
	host := loadBalancerHost(current.Status.LoadBalancer.Ingress)
	if host == "" {
		return nil, false, nil
	}
	ports := make(map[string]corev1.ServicePort, len(current.Spec.Ports))
	for _, port := range current.Spec.Ports {
		ports[port.Name] = port
	}
	result := make([]jobs.Entrypoint, 0, len(specs))
	for index, spec := range specs {
		port, exists := ports[spec.Name]
		expectedPort := provider.routes.TCPPortStart + int32(index)
		if !exists || port.Protocol != corev1.ProtocolTCP || port.Port != expectedPort || port.TargetPort.StrVal != spec.Name || port.NodePort != 0 {
			return nil, false, jobs.PermanentError("provider.invalid_route", "Kubernetes TCP Service omitted an expected port", nil)
		}
		result = append(result, jobs.Entrypoint{Name: spec.Name, Protocol: spec.Protocol, Host: host, Port: int(port.Port)})
	}
	return result, true, nil
}

func ingress(name, namespace, serviceName string, key providers.InstanceKey, config RouteConfig, entrypoints []contracts.InstanceEntrypointSpec) *networkingv1.Ingress {
	pathType := networkingv1.PathTypePrefix
	rules := make([]networkingv1.IngressRule, 0, len(entrypoints))
	hosts := make([]string, 0, len(entrypoints))
	for _, entrypoint := range entrypoints {
		host := entrypointHost(serviceName, entrypoint.Name, config.HTTPDomain)
		hosts = append(hosts, host)
		rules = append(rules, networkingv1.IngressRule{Host: host, IngressRuleValue: networkingv1.IngressRuleValue{HTTP: &networkingv1.HTTPIngressRuleValue{Paths: []networkingv1.HTTPIngressPath{{Path: "/", PathType: &pathType, Backend: networkingv1.IngressBackend{Service: &networkingv1.IngressServiceBackend{Name: serviceName, Port: networkingv1.ServiceBackendPort{Name: entrypoint.Name}}}}}}}})
	}
	desired := &networkingv1.Ingress{ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: namespace, Labels: key.Labels()}, Spec: networkingv1.IngressSpec{Rules: rules}}
	if config.IngressClassName != "" {
		desired.Spec.IngressClassName = &config.IngressClassName
	}
	if config.TLSSecretName != "" {
		desired.Spec.TLS = []networkingv1.IngressTLS{{Hosts: hosts, SecretName: config.TLSSecretName}}
	}
	return desired
}

func tcpService(name, namespace, workloadName string, key providers.InstanceKey, config RouteConfig, entrypoints []contracts.InstanceEntrypointSpec) *corev1.Service {
	ports := make([]corev1.ServicePort, 0, len(entrypoints))
	for index, entrypoint := range entrypoints {
		ports = append(ports, corev1.ServicePort{Name: entrypoint.Name, Protocol: corev1.ProtocolTCP, Port: config.TCPPortStart + int32(index), TargetPort: intstr.FromString(entrypoint.Name)})
	}
	allocateNodePorts := false
	desired := &corev1.Service{ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: namespace, Labels: key.Labels()}, Spec: corev1.ServiceSpec{Type: corev1.ServiceTypeLoadBalancer, AllocateLoadBalancerNodePorts: &allocateNodePorts, Selector: map[string]string{"sauryctf.io/resource-name": workloadName}, Ports: ports}}
	if config.LoadBalancerClass != "" {
		desired.Spec.LoadBalancerClass = &config.LoadBalancerClass
	}
	return desired
}

func preserveServiceAllocation(desired, current *corev1.Service) {
	desired.Spec.ClusterIP = current.Spec.ClusterIP
	desired.Spec.ClusterIPs = current.Spec.ClusterIPs
	desired.Spec.IPFamilies = current.Spec.IPFamilies
	desired.Spec.IPFamilyPolicy = current.Spec.IPFamilyPolicy
}

func deploymentEntrypoints(deployment metav1.Object) ([]contracts.InstanceEntrypointSpec, error) {
	raw := deployment.GetAnnotations()[AnnotationEntrypoints]
	if raw == "" {
		return nil, errors.New("entrypoint annotation is missing")
	}
	var entrypoints []contracts.InstanceEntrypointSpec
	if err := json.Unmarshal([]byte(raw), &entrypoints); err != nil {
		return nil, fmt.Errorf("decode entrypoints: %w", err)
	}
	if len(entrypoints) < 1 || len(entrypoints) > 16 {
		return nil, errors.New("entrypoint annotation must contain 1-16 items")
	}
	names := make(map[string]struct{}, len(entrypoints))
	sockets := make(map[string]struct{}, len(entrypoints))
	for index, entrypoint := range entrypoints {
		if err := entrypoint.Validate(); err != nil {
			return nil, fmt.Errorf("entrypoints[%d]: %w", index, err)
		}
		if _, exists := names[entrypoint.Name]; exists {
			return nil, fmt.Errorf("entrypoints[%d]: duplicate name %q", index, entrypoint.Name)
		}
		socket := fmt.Sprintf("%s:%d", entrypoint.Protocol, entrypoint.ContainerPort)
		if _, exists := sockets[socket]; exists {
			return nil, fmt.Errorf("entrypoints[%d]: duplicate socket %q", index, socket)
		}
		names[entrypoint.Name] = struct{}{}
		sockets[socket] = struct{}{}
	}
	return entrypoints, nil
}

func protocolEntrypoints(entrypoints []contracts.InstanceEntrypointSpec, protocol string) []contracts.InstanceEntrypointSpec {
	result := make([]contracts.InstanceEntrypointSpec, 0, len(entrypoints))
	for _, entrypoint := range entrypoints {
		if entrypoint.Protocol == protocol {
			result = append(result, entrypoint)
		}
	}
	return result
}

func httpRouteName(name string) string { return relatedResourceName(name, 'h') }
func tcpRouteName(name string) string  { return relatedResourceName(name, 't') }

func relatedResourceName(name string, prefix byte) string {
	if len(name) < 1 {
		return string(prefix)
	}
	return string(prefix) + name[1:]
}

func entrypointHost(resourceName, entrypointName, domain string) string {
	digest := sha256.Sum256([]byte(resourceName + "/" + entrypointName))
	return fmt.Sprintf("%s-%x.%s", entrypointName, digest[:6], domain)
}

func ingressReady(ingress *networkingv1.Ingress) bool {
	return ingress.DeletionTimestamp == nil && loadBalancerIngressHost(ingress.Status.LoadBalancer.Ingress) != ""
}

func loadBalancerIngressHost(values []networkingv1.IngressLoadBalancerIngress) string {
	for _, value := range values {
		if host := strings.TrimSpace(value.Hostname); host != "" {
			return host
		}
		if ip := strings.TrimSpace(value.IP); ip != "" {
			return ip
		}
	}
	return ""
}

func loadBalancerHost(values []corev1.LoadBalancerIngress) string {
	for _, value := range values {
		if host := strings.TrimSpace(value.Hostname); host != "" {
			return host
		}
		if ip := strings.TrimSpace(value.IP); ip != "" {
			return ip
		}
	}
	return ""
}

func ingressHostUsesTLS(ingress *networkingv1.Ingress, host string) bool {
	for _, tls := range ingress.Spec.TLS {
		for _, candidate := range tls.Hosts {
			if candidate == host {
				return true
			}
		}
	}
	return false
}
