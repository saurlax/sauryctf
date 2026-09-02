package main

import (
	"context"
	"fmt"

	kubernetesclient "k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"

	"github.com/saurlax/sauryctf/apps/worker/internal/config"
	"github.com/saurlax/sauryctf/apps/worker/internal/contracts"
	"github.com/saurlax/sauryctf/apps/worker/internal/providers"
	dockerprovider "github.com/saurlax/sauryctf/apps/worker/internal/providers/docker"
	kubernetesprovider "github.com/saurlax/sauryctf/apps/worker/internal/providers/kubernetes"
)

func buildProviderBackend(workerConfig config.Config) (providers.Backend, error) {
	implementations := make([]providers.Provider, 0, len(workerConfig.EnabledProviders))
	for _, kind := range workerConfig.EnabledProviders {
		switch kind {
		case contracts.ProviderDocker:
			engine, err := dockerprovider.NewHTTPClient(workerConfig.DockerEndpoint, workerConfig.DockerAPIVersion)
			if err != nil {
				return nil, fmt.Errorf("initialize Docker Engine client: %w", err)
			}
			implementation, err := dockerprovider.New(engine, workerConfig.DockerPublicHost)
			if err != nil {
				return nil, fmt.Errorf("initialize Docker provider: %w", err)
			}
			implementations = append(implementations, implementation)
		case contracts.ProviderKubernetes:
			restConfig, err := rest.InClusterConfig()
			if err != nil {
				return nil, fmt.Errorf("load in-cluster Kubernetes configuration: %w", err)
			}
			client, err := kubernetesclient.NewForConfig(restConfig)
			if err != nil {
				return nil, fmt.Errorf("initialize Kubernetes client: %w", err)
			}
			implementation, err := kubernetesprovider.New(client, workerConfig.KubernetesNamespace, kubernetesprovider.RouteConfig{
				HTTPDomain: workerConfig.KubernetesHTTPDomain, IngressClassName: workerConfig.KubernetesIngressClass,
				TLSSecretName: workerConfig.KubernetesTLSSecret, TCPPortStart: workerConfig.KubernetesTCPPortStart,
				LoadBalancerClass: workerConfig.KubernetesLBClass,
			})
			if err != nil {
				return nil, fmt.Errorf("initialize Kubernetes provider: %w", err)
			}
			implementations = append(implementations, implementation)
		default:
			return nil, fmt.Errorf("unsupported enabled provider %q", kind)
		}
	}
	registry, err := providers.NewRegistry(workerConfig.PlatformID, implementations...)
	if err != nil {
		return nil, fmt.Errorf("initialize provider registry: %w", err)
	}
	backend, err := providers.NewSensitiveBackend(registry, workerConfig.InstanceSecretKeyring)
	if err != nil {
		return nil, fmt.Errorf("initialize sensitive provider boundary: %w", err)
	}
	return backend, nil
}

type backendReadiness struct {
	backend providers.Backend
}

func (readiness backendReadiness) Ready(ctx context.Context) error {
	if _, err := readiness.backend.ListResources(ctx); err != nil {
		return fmt.Errorf("list managed provider resources: %w", err)
	}
	return nil
}
