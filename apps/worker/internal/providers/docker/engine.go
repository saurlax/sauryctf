package docker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const DefaultAPIVersion = "v1.47"

var (
	ErrNotFound       = errors.New("docker resource was not found")
	apiVersionPattern = regexp.MustCompile(`^v1\.[0-9]{2}$`)
)

type APIError struct {
	StatusCode int
	Message    string
}

func (err *APIError) Error() string {
	return fmt.Sprintf("docker engine returned status %d: %s", err.StatusCode, err.Message)
}

type PortBinding struct {
	HostIP   string `json:"HostIp"`
	HostPort string `json:"HostPort"`
}

type HostConfig struct {
	Memory       int64                    `json:"Memory"`
	NanoCPUs     int64                    `json:"NanoCpus"`
	StorageOpt   map[string]string        `json:"StorageOpt,omitempty"`
	PortBindings map[string][]PortBinding `json:"PortBindings,omitempty"`
}

type CreateRequest struct {
	Image        string              `json:"Image"`
	Env          []string            `json:"Env,omitempty"`
	Labels       map[string]string   `json:"Labels"`
	ExposedPorts map[string]struct{} `json:"ExposedPorts,omitempty"`
	HostConfig   HostConfig          `json:"HostConfig"`
}

type Container struct {
	ID             string
	Name           string
	Image          string
	Environment    []string
	Labels         map[string]string
	Running        bool
	Health         string
	PublishedPorts map[string][]PortBinding
}

type Engine interface {
	Inspect(context.Context, string) (Container, error)
	PullImage(context.Context, string) error
	Create(context.Context, string, CreateRequest) (string, error)
	Start(context.Context, string) error
	Remove(context.Context, string) error
	List(context.Context, string, string) ([]Container, error)
}

type HTTPClient struct {
	client     *http.Client
	baseURL    *url.URL
	apiVersion string
}

// NewHTTPClient creates a typed Docker Engine API client. It supports the
// standard unix socket and explicit HTTP(S) endpoints without invoking a CLI.
func NewHTTPClient(endpoint, apiVersion string) (*HTTPClient, error) {
	if apiVersion == "" {
		apiVersion = DefaultAPIVersion
	}
	if !apiVersionPattern.MatchString(apiVersion) {
		return nil, errors.New("docker API version must look like v1.47")
	}
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return nil, errors.New("parse Docker Engine endpoint")
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	var baseURL *url.URL
	switch parsed.Scheme {
	case "unix":
		if parsed.Path == "" || parsed.Host != "" || parsed.RawQuery != "" {
			return nil, errors.New("unix Docker endpoint must contain only an absolute socket path")
		}
		socketPath := parsed.Path
		transport.DialContext = func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "unix", socketPath)
		}
		baseURL = &url.URL{Scheme: "http", Host: "docker-engine"}
	case "http", "https":
		if parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
			return nil, errors.New("Docker HTTP endpoint must be an origin without credentials, query, or fragment")
		}
		parsed.Path = strings.TrimRight(parsed.Path, "/")
		baseURL = parsed
	default:
		return nil, errors.New("Docker Engine endpoint must use unix, http, or https")
	}
	return &HTTPClient{
		client:  &http.Client{Transport: transport, Timeout: 5 * time.Minute},
		baseURL: baseURL, apiVersion: apiVersion,
	}, nil
}

func (client *HTTPClient) Inspect(ctx context.Context, name string) (Container, error) {
	var response inspectResponse
	if err := client.doJSON(ctx, http.MethodGet, "/containers/"+url.PathEscape(name)+"/json", nil, nil, &response); err != nil {
		return Container{}, err
	}
	return response.container(), nil
}

func (client *HTTPClient) PullImage(ctx context.Context, image string) error {
	query := url.Values{"fromImage": []string{image}}
	response, err := client.do(ctx, http.MethodPost, "/images/create", query, nil)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	decoder := json.NewDecoder(response.Body)
	for {
		var event struct {
			Error       string `json:"error"`
			ErrorDetail struct {
				Message string `json:"message"`
			} `json:"errorDetail"`
		}
		if err := decoder.Decode(&event); errors.Is(err, io.EOF) {
			return nil
		} else if err != nil {
			return &APIError{StatusCode: http.StatusBadGateway, Message: "invalid image pull stream"}
		}
		if event.Error != "" || event.ErrorDetail.Message != "" {
			return &APIError{StatusCode: http.StatusBadGateway, Message: "image pull failed"}
		}
	}
}

func (client *HTTPClient) Create(ctx context.Context, name string, request CreateRequest) (string, error) {
	query := url.Values{"name": []string{name}}
	var response struct {
		ID string `json:"Id"`
	}
	if err := client.doJSON(ctx, http.MethodPost, "/containers/create", query, request, &response); err != nil {
		return "", err
	}
	if response.ID == "" {
		return "", &APIError{StatusCode: http.StatusBadGateway, Message: "create response omitted container id"}
	}
	return response.ID, nil
}

func (client *HTTPClient) Start(ctx context.Context, name string) error {
	response, err := client.do(ctx, http.MethodPost, "/containers/"+url.PathEscape(name)+"/start", nil, nil)
	if err != nil {
		return err
	}
	return response.Body.Close()
}

func (client *HTTPClient) Remove(ctx context.Context, name string) error {
	query := url.Values{"force": []string{"1"}, "v": []string{"1"}}
	response, err := client.do(ctx, http.MethodDelete, "/containers/"+url.PathEscape(name), query, nil)
	if err != nil {
		return err
	}
	return response.Body.Close()
}

func (client *HTTPClient) List(ctx context.Context, label, value string) ([]Container, error) {
	filters, err := json.Marshal(map[string][]string{"label": {label + "=" + value}})
	if err != nil {
		return nil, err
	}
	query := url.Values{"all": []string{"1"}, "filters": []string{string(filters)}}
	var response []listResponse
	if err := client.doJSON(ctx, http.MethodGet, "/containers/json", query, nil, &response); err != nil {
		return nil, err
	}
	containers := make([]Container, 0, len(response))
	for _, listed := range response {
		name := ""
		if len(listed.Names) > 0 {
			name = strings.TrimPrefix(listed.Names[0], "/")
		}
		containers = append(containers, Container{ID: listed.ID, Name: name, Image: listed.Image, Labels: listed.Labels})
	}
	return containers, nil
}

func (client *HTTPClient) doJSON(ctx context.Context, method, path string, query url.Values, body, target any) error {
	response, err := client.do(ctx, method, path, query, body)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	decoder := json.NewDecoder(io.LimitReader(response.Body, 4*1024*1024))
	if err := decoder.Decode(target); err != nil {
		return &APIError{StatusCode: http.StatusBadGateway, Message: "invalid Docker Engine response"}
	}
	return nil
}

func (client *HTTPClient) do(ctx context.Context, method, path string, query url.Values, body any) (*http.Response, error) {
	endpoint := *client.baseURL
	endpoint.Path = strings.TrimRight(client.baseURL.Path, "/") + "/" + client.apiVersion + path
	endpoint.RawQuery = query.Encode()
	var source io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		source = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, endpoint.String(), source)
	if err != nil {
		return nil, errors.New("build Docker Engine request")
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := client.client.Do(request)
	if err != nil {
		return nil, errors.New("Docker Engine request failed")
	}
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		return response, nil
	}
	defer response.Body.Close()
	var failure struct {
		Message string `json:"message"`
	}
	_ = json.NewDecoder(io.LimitReader(response.Body, 64*1024)).Decode(&failure)
	if response.StatusCode == http.StatusNotFound {
		return nil, ErrNotFound
	}
	message := "request failed"
	if strings.TrimSpace(failure.Message) != "" {
		message = strings.TrimSpace(failure.Message)
	}
	return nil, &APIError{StatusCode: response.StatusCode, Message: message}
}

type inspectResponse struct {
	ID     string `json:"Id"`
	Name   string `json:"Name"`
	Config struct {
		Image  string            `json:"Image"`
		Env    []string          `json:"Env"`
		Labels map[string]string `json:"Labels"`
	} `json:"Config"`
	State struct {
		Running bool `json:"Running"`
		Health  *struct {
			Status string `json:"Status"`
		} `json:"Health"`
	} `json:"State"`
	NetworkSettings struct {
		Ports map[string][]PortBinding `json:"Ports"`
	} `json:"NetworkSettings"`
}

func (response inspectResponse) container() Container {
	health := ""
	if response.State.Health != nil {
		health = response.State.Health.Status
	}
	return Container{
		ID: response.ID, Name: strings.TrimPrefix(response.Name, "/"), Image: response.Config.Image,
		Environment: response.Config.Env, Labels: response.Config.Labels,
		Running: response.State.Running, Health: health,
		PublishedPorts: response.NetworkSettings.Ports,
	}
}

type listResponse struct {
	ID     string            `json:"Id"`
	Names  []string          `json:"Names"`
	Image  string            `json:"Image"`
	Labels map[string]string `json:"Labels"`
}
