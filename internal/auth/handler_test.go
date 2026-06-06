package auth

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"

	"github.com/saurlax/sauryctf/internal/models"
)

func setupAuthRouter(mock *MockService) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := NewHandler(mock)

	api := r.Group("/api")
	// Public routes
	api.GET("/auth/setup-status", func(c *gin.Context) {
		if token, err := c.Cookie("token"); err == nil && token != "" {
			if user, err := mock.ValidateToken(token); err == nil {
				c.Set("user_id", user.ID)
				c.Set("user_role", string(user.Role))
			}
		}
		h.SetupStatus(c)
	})
	api.POST("/auth/register", h.Register)
	api.POST("/auth/login", h.Login)

	// Protected routes (simulate auth middleware via cookie)
	protected := api.Group("")
	protected.Use(func(c *gin.Context) {
		token, err := c.Cookie("token")
		if err != nil || token == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			return
		}
		user, err := mock.ValidateToken(token)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			return
		}
		c.Set("user_id", user.ID)
		c.Set("user_role", string(user.Role))
		c.Next()
	})
	protected.POST("/auth/logout", h.Logout)
	protected.GET("/auth/me", h.GetMe)
	protected.GET("/auth/security-status", h.SecurityStatus)
	protected.POST("/auth/change-password", h.ChangePassword)
	protected.GET("/admin/users", h.ListUsers)
	protected.PUT("/admin/users/:userId", func(c *gin.Context) {
		var userId int
		_, _ = fmt.Sscan(c.Param("userId"), &userId)
		h.UpdateUserAccount(c, userId)
	})

	return r
}

func TestHandler_Register(t *testing.T) {
	mock := NewMockService()
	r := setupAuthRouter(mock)

	t.Run("success", func(t *testing.T) {
		body := `{"username":"alice","email":"alice@test.com","password":"123456"}`
		req := httptest.NewRequest("POST", "/api/auth/register", bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusCreated, w.Code)
		var resp map[string]interface{}
		json.Unmarshal(w.Body.Bytes(), &resp)
		assert.NotNil(t, resp["user"])
		// token is now in Set-Cookie header, not in response body
		assert.NotEmpty(t, w.Header().Get("Set-Cookie"))
	})

	t.Run("bad request", func(t *testing.T) {
		body := `{"username":"a"}`
		req := httptest.NewRequest("POST", "/api/auth/register", bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusBadRequest, w.Code)
	})

	t.Run("duplicate", func(t *testing.T) {
		body := `{"username":"alice","email":"alice@test.com","password":"123456"}`
		req := httptest.NewRequest("POST", "/api/auth/register", bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusConflict, w.Code)
	})
}

func TestHandler_Login(t *testing.T) {
	mock := NewMockService()
	mock.Users["alice@test.com"] = &models.User{ID: 1, Username: "alice", Email: "alice@test.com", Role: models.RoleUser, Status: models.StatusActive}
	r := setupAuthRouter(mock)

	t.Run("success with username", func(t *testing.T) {
		body := `{"username":"alice","password":"123456"}`
		req := httptest.NewRequest("POST", "/api/auth/login", bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		// token is now in Set-Cookie header
		assert.NotEmpty(t, w.Header().Get("Set-Cookie"))
	})

	t.Run("success with email", func(t *testing.T) {
		body := `{"username":"alice@test.com","password":"123456"}`
		req := httptest.NewRequest("POST", "/api/auth/login", bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		assert.NotEmpty(t, w.Header().Get("Set-Cookie"))
	})

	t.Run("bad request", func(t *testing.T) {
		body := `{}`
		req := httptest.NewRequest("POST", "/api/auth/login", bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusBadRequest, w.Code)
	})

	t.Run("wrong credentials", func(t *testing.T) {
		body := `{"username":"nobody","password":"123456"}`
		req := httptest.NewRequest("POST", "/api/auth/login", bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusUnauthorized, w.Code)
	})
}

func TestHandler_Me(t *testing.T) {
	mock := NewMockService()
	user := &models.User{ID: 1, Username: "alice", Email: "alice@test.com", Role: models.RoleUser, Status: models.StatusActive}
	mock.Users["alice@test.com"] = user
	token := "mock-token-alice"
	mock.Tokens[token] = user
	r := setupAuthRouter(mock)

	t.Run("success", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/auth/me", nil)
		req.AddCookie(&http.Cookie{Name: "token", Value: token})
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
	})

	t.Run("no token", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/auth/me", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusUnauthorized, w.Code)
	})
}

func TestHandler_SetupStatus(t *testing.T) {
	t.Run("bootstrap admin available on empty state", func(t *testing.T) {
		mock := NewMockService()
		r := setupAuthRouter(mock)

		req := httptest.NewRequest("GET", "/api/auth/setup-status", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		assert.Contains(t, w.Body.String(), `"bootstrap_admin_available":true`)
		assert.NotContains(t, w.Body.String(), `"default_admin_username"`)
		assert.NotContains(t, w.Body.String(), `"default_admin_password"`)
	})

	t.Run("bootstrap admin hidden after users exist", func(t *testing.T) {
		mock := NewMockService()
		mock.Users["alice@test.com"] = &models.User{ID: 1, Username: "alice", Email: "alice@test.com", Role: models.RoleUser, Status: models.StatusActive}
		r := setupAuthRouter(mock)

		req := httptest.NewRequest("GET", "/api/auth/setup-status", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		assert.Contains(t, w.Body.String(), `"bootstrap_admin_available":false`)
		assert.NotContains(t, w.Body.String(), `"default_admin_username"`)
		assert.NotContains(t, w.Body.String(), `"default_admin_password"`)
	})

	t.Run("setup status does not expose password recommendation", func(t *testing.T) {
		mock := NewMockService()
		admin := &models.User{ID: 1, Username: "admin", Email: "admin@test.com", Role: models.RoleAdmin, Status: models.StatusActive}
		mock.Users[admin.Email] = admin
		mock.Passwords[admin.ID] = defaultAdminPassword
		mock.BootstrapPasswordInUseBy[admin.ID] = true
		mock.Tokens["bootstrap-admin-token"] = admin
		r := setupAuthRouter(mock)

		req := httptest.NewRequest("GET", "/api/auth/setup-status", nil)
		req.AddCookie(&http.Cookie{Name: "token", Value: "bootstrap-admin-token"})
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		assert.NotContains(t, w.Body.String(), `"password_change_recommended"`)
	})
}

func TestHandler_SecurityStatus(t *testing.T) {
	t.Run("password change recommendation exposed for bootstrap admin session", func(t *testing.T) {
		mock := NewMockService()
		admin := &models.User{ID: 1, Username: "admin", Email: "admin@test.com", Role: models.RoleAdmin, Status: models.StatusActive}
		mock.Users[admin.Email] = admin
		mock.Passwords[admin.ID] = defaultAdminPassword
		mock.BootstrapPasswordInUseBy[admin.ID] = true
		mock.Tokens["bootstrap-admin-token"] = admin
		r := setupAuthRouter(mock)

		req := httptest.NewRequest("GET", "/api/auth/security-status", nil)
		req.AddCookie(&http.Cookie{Name: "token", Value: "bootstrap-admin-token"})
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		assert.Contains(t, w.Body.String(), `"password_change_recommended":true`)
	})

	t.Run("requires login", func(t *testing.T) {
		mock := NewMockService()
		r := setupAuthRouter(mock)

		req := httptest.NewRequest("GET", "/api/auth/security-status", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusUnauthorized, w.Code)
	})
}

func TestHandler_ChangePassword(t *testing.T) {
	mock := NewMockService()
	user := &models.User{ID: 1, Username: "alice", Email: "alice@test.com", Role: models.RoleUser, Status: models.StatusActive}
	mock.Users[user.Email] = user
	mock.Passwords[user.ID] = "123456"
	mock.Tokens["mock-token-alice"] = user
	r := setupAuthRouter(mock)

	t.Run("success", func(t *testing.T) {
		body := `{"current_password":"123456","new_password":"654321"}`
		req := httptest.NewRequest("POST", "/api/auth/change-password", bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(&http.Cookie{Name: "token", Value: "mock-token-alice"})
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, "654321", mock.Passwords[user.ID])
	})

	t.Run("bad request", func(t *testing.T) {
		body := `{}`
		req := httptest.NewRequest("POST", "/api/auth/change-password", bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(&http.Cookie{Name: "token", Value: "mock-token-alice"})
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusBadRequest, w.Code)
	})

	t.Run("wrong password", func(t *testing.T) {
		body := `{"current_password":"wrong123","new_password":"another123"}`
		req := httptest.NewRequest("POST", "/api/auth/change-password", bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(&http.Cookie{Name: "token", Value: "mock-token-alice"})
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusConflict, w.Code)
	})
}

func TestHandler_AdminUsers(t *testing.T) {
	mock := NewMockService()
	admin := &models.User{ID: 1, Username: "admin", Email: "admin@test.com", Role: models.RoleAdmin, Status: models.StatusActive}
	user := &models.User{ID: 2, Username: "alice", Email: "alice@test.com", Role: models.RoleUser, Status: models.StatusActive}
	mock.Users[admin.Email] = admin
	mock.Users[user.Email] = user
	mock.Tokens["admin-token"] = admin
	r := setupAuthRouter(mock)

	t.Run("list users", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/admin/users", nil)
		req.AddCookie(&http.Cookie{Name: "token", Value: "admin-token"})
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		assert.Contains(t, w.Body.String(), `"username":"admin"`)
		assert.Contains(t, w.Body.String(), `"username":"alice"`)
	})

	t.Run("update user status and role", func(t *testing.T) {
		body := `{"role":"judge","status":"banned"}`
		req := httptest.NewRequest("PUT", "/api/admin/users/2", bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(&http.Cookie{Name: "token", Value: "admin-token"})
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, models.RoleJudge, mock.Users[user.Email].Role)
		assert.Equal(t, models.StatusBanned, mock.Users[user.Email].Status)
	})
}
