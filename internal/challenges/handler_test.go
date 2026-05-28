package challenges_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"

	"github.com/saurlax/sauryctf/internal/challenges"
)

func setupTestRouter(svc challenges.ServiceInterface) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()

	// Simulate auth middleware
	r.Use(func(c *gin.Context) {
		c.Set("user_id", uint(1))
		c.Set("team_id", uint(1))
		c.Next()
	})

	h := challenges.NewHandler(svc)
	api := r.Group("/api")
	h.RegisterRoutes(api, api)
	return r
}

func TestCreateChallenge_Success(t *testing.T) {
	svc := challenges.NewMockService()
	r := setupTestRouter(svc)

	visible := true
	body := challenges.CreateChallengeRequest{
		Title:     "SQL Injection",
		Category:  "web",
		Flag:      "flag{sql_injection}",
		IsVisible: &visible,
	}
	b, _ := json.Marshal(body)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/api/challenges", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusCreated, w.Code)

	var ch map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &ch)
	assert.NoError(t, err)
	assert.Equal(t, "SQL Injection", ch["title"])
	assert.Equal(t, "web", ch["category"])
	assert.Equal(t, float64(100), ch["base_score"])
}

func TestCreateChallenge_MissingFields(t *testing.T) {
	svc := challenges.NewMockService()
	r := setupTestRouter(svc)

	body := map[string]string{"title": "test"}
	b, _ := json.Marshal(body)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/api/challenges", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestGetChallenge_Success(t *testing.T) {
	svc := challenges.NewMockService()
	r := setupTestRouter(svc)

	visible := true
	svc.CreateChallenge(challenges.CreateChallengeRequest{
		Title:     "Test Challenge",
		Category:  "web",
		Flag:      "flag{test}",
		IsVisible: &visible,
	}, 1)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/challenges/1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var ch map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &ch)
	assert.Equal(t, "Test Challenge", ch["title"])
}

func TestGetChallenge_NotFound(t *testing.T) {
	svc := challenges.NewMockService()
	r := setupTestRouter(svc)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/challenges/999", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestListChallenges_Filtered(t *testing.T) {
	svc := challenges.NewMockService()
	r := setupTestRouter(svc)

	visible := true
	svc.CreateChallenge(challenges.CreateChallengeRequest{
		Title: "Web Challenge", Category: "web", Flag: "flag{web}", IsVisible: &visible,
	}, 1)
	svc.CreateChallenge(challenges.CreateChallengeRequest{
		Title: "Pwn Challenge", Category: "pwn", Flag: "flag{pwn}", IsVisible: &visible,
	}, 1)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/challenges?category=web", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var chs []map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &chs)
	assert.Len(t, chs, 1)
	assert.Equal(t, "Web Challenge", chs[0]["title"])
}

func TestUpdateChallenge_Success(t *testing.T) {
	svc := challenges.NewMockService()
	r := setupTestRouter(svc)

	visible := true
	svc.CreateChallenge(challenges.CreateChallengeRequest{
		Title: "Old Title", Category: "web", Flag: "flag{test}", IsVisible: &visible,
	}, 1)

	newTitle := "New Title"
	body := challenges.UpdateChallengeRequest{Title: &newTitle}
	b, _ := json.Marshal(body)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("PUT", "/api/challenges/1", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var ch map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &ch)
	assert.Equal(t, "New Title", ch["title"])
}

func TestDeleteChallenge_Success(t *testing.T) {
	svc := challenges.NewMockService()
	r := setupTestRouter(svc)

	visible := true
	svc.CreateChallenge(challenges.CreateChallengeRequest{
		Title: "To Delete", Category: "web", Flag: "flag{del}", IsVisible: &visible,
	}, 1)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("DELETE", "/api/challenges/1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestSubmitFlag_Correct(t *testing.T) {
	svc := challenges.NewMockService()
	r := setupTestRouter(svc)

	visible := true
	svc.CreateChallenge(challenges.CreateChallengeRequest{
		Title: "Test", Category: "web", Flag: "flag{correct}", IsVisible: &visible,
	}, 1)

	body := map[string]interface{}{"flag": "flag{correct}", "game_id": 1}
	b, _ := json.Marshal(body)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/api/challenges/1/submit", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var result map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &result)
	assert.Equal(t, true, result["correct"])
}

func TestSubmitFlag_Wrong(t *testing.T) {
	svc := challenges.NewMockService()
	r := setupTestRouter(svc)

	visible := true
	svc.CreateChallenge(challenges.CreateChallengeRequest{
		Title: "Test", Category: "web", Flag: "flag{correct}", IsVisible: &visible,
	}, 1)

	body := map[string]interface{}{"flag": "flag{wrong}", "game_id": 1}
	b, _ := json.Marshal(body)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/api/challenges/1/submit", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusForbidden, w.Code)

	var result map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &result)
	assert.Equal(t, false, result["correct"])
}
