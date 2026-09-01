package docker

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHTTPClientUsesVersionedDockerEngineAPI(t *testing.T) {
	var created CreateRequest
	var calls []string
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		calls = append(calls, request.Method+" "+request.URL.Path)
		if !strings.HasPrefix(request.URL.Path, "/v1.47/") {
			t.Errorf("request path = %q, want versioned API", request.URL.Path)
		}
		switch request.Method + " " + request.URL.Path {
		case "POST /v1.47/images/create":
			if request.URL.Query().Get("fromImage") != "registry.example.test/challenge@sha256:abc" {
				t.Errorf("pull query = %q", request.URL.RawQuery)
			}
			_, _ = response.Write([]byte("{\"status\":\"pulling\"}\n{\"status\":\"done\"}\n"))
		case "POST /v1.47/containers/create":
			if request.URL.Query().Get("name") != "container-name" {
				t.Errorf("create name = %q", request.URL.Query().Get("name"))
			}
			if err := json.NewDecoder(request.Body).Decode(&created); err != nil {
				t.Error(err)
			}
			response.Header().Set("Content-Type", "application/json")
			_, _ = response.Write([]byte(`{"Id":"container-id"}`))
		case "GET /v1.47/containers/container-name/json":
			response.Header().Set("Content-Type", "application/json")
			_, _ = response.Write([]byte(`{
                  "Id":"container-id","Name":"/container-name",
                  "Config":{"Image":"image","Env":["A=B"],"Labels":{"owner":"platform"}},
                  "State":{"Running":true,"Health":{"Status":"healthy"}},
                  "NetworkSettings":{"Ports":{"8080/tcp":[{"HostIp":"0.0.0.0","HostPort":"32080"}]}}
                }`))
		case "POST /v1.47/containers/container-name/start", "DELETE /v1.47/containers/container-name":
			response.WriteHeader(http.StatusNoContent)
		case "GET /v1.47/containers/json":
			filters := map[string][]string{}
			if err := json.Unmarshal([]byte(request.URL.Query().Get("filters")), &filters); err != nil {
				t.Error(err)
			}
			if len(filters["label"]) != 1 || filters["label"][0] != "owner=platform" {
				t.Errorf("list filters = %#v", filters)
			}
			_, _ = response.Write([]byte(`[{"Id":"container-id","Names":["/container-name"],"Image":"image","Labels":{"owner":"platform"}}]`))
		default:
			http.Error(response, `{"message":"unexpected request"}`, http.StatusNotFound)
		}
	}))
	defer server.Close()

	client, err := NewHTTPClient(server.URL, DefaultAPIVersion)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err := client.PullImage(ctx, "registry.example.test/challenge@sha256:abc"); err != nil {
		t.Fatalf("PullImage() error = %v", err)
	}
	request := CreateRequest{
		Image: "image", Env: []string{"A=B"}, Labels: map[string]string{"owner": "platform"},
		ExposedPorts: map[string]struct{}{"8080/tcp": {}},
		HostConfig:   HostConfig{Memory: 1024, NanoCPUs: 500_000_000, StorageOpt: map[string]string{"size": "2048"}, PortBindings: map[string][]PortBinding{"8080/tcp": {{}}}},
	}
	id, err := client.Create(ctx, "container-name", request)
	if err != nil || id != "container-id" {
		t.Fatalf("Create() = %q/%v", id, err)
	}
	if created.HostConfig.Memory != request.HostConfig.Memory || created.HostConfig.NanoCPUs != request.HostConfig.NanoCPUs || created.HostConfig.StorageOpt["size"] != "2048" {
		t.Fatalf("decoded create request = %+v", created)
	}
	container, err := client.Inspect(ctx, "container-name")
	if err != nil || !container.Running || container.Health != "healthy" || container.PublishedPorts["8080/tcp"][0].HostPort != "32080" {
		t.Fatalf("Inspect() = %+v/%v", container, err)
	}
	if err := client.Start(ctx, "container-name"); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	containers, err := client.List(ctx, "owner", "platform")
	if err != nil || len(containers) != 1 || containers[0].Name != "container-name" {
		t.Fatalf("List() = %+v/%v", containers, err)
	}
	if err := client.Remove(ctx, "container-name"); err != nil {
		t.Fatalf("Remove() error = %v", err)
	}
	if len(calls) != 6 {
		t.Fatalf("Engine API calls = %v", calls)
	}
}

func TestHTTPClientMapsNotFoundAndRejectsUnsafeEndpoints(t *testing.T) {
	server := httptest.NewServer(http.NotFoundHandler())
	defer server.Close()
	client, err := NewHTTPClient(server.URL, DefaultAPIVersion)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.Inspect(context.Background(), "missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Inspect() error = %v, want ErrNotFound", err)
	}
	for _, endpoint := range []string{"", "tcp://127.0.0.1:2375", "http://user:secret@localhost:2375", "unix://relative.sock"} {
		if _, err := NewHTTPClient(endpoint, DefaultAPIVersion); err == nil {
			t.Fatalf("NewHTTPClient(%q) succeeded", endpoint)
		}
	}
	if _, err := NewHTTPClient(server.URL, "latest"); err == nil {
		t.Fatal("NewHTTPClient() accepted an unversioned API")
	}
}

func TestCreateRequestUsesDockerJSONFieldNames(t *testing.T) {
	encoded, err := json.Marshal(CreateRequest{HostConfig: HostConfig{NanoCPUs: 500_000_000}})
	if err != nil {
		t.Fatal(err)
	}
	values := map[string]any{}
	if err := json.Unmarshal(encoded, &values); err != nil {
		t.Fatal(err)
	}
	host := values["HostConfig"].(map[string]any)
	if host["NanoCpus"] != float64(500_000_000) {
		t.Fatalf("Docker create JSON = %s", encoded)
	}
}
