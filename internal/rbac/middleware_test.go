package rbac

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"

	"github.com/saurlax/sauryctf/internal/models"
)

// mockAuth implements auth.ServiceInterface for middleware tests.
type mockAuth struct {
	users  map[string]*models.User  // token -> user
	failID bool
}

func newMockAuth() *mockAuth {
	return &mockAuth{users: make(map[string]*models.User)}
}

func (m *mockAuth) Register(_, _, _ string) (*models.User, error) { return nil, nil }
func (m *mockAuth) Login(_, _ string) (string, *models.User, error) { return "", nil, nil }
func (m *mockAuth) Logout(_ string) error { return nil }
func (m *mockAuth) GetUserByID(_ uint) (*models.User, error) { return nil, nil }
func (m *mockAuth) ValidateToken(token string) (*models.User, error) {
	if u, ok := m.users[token]; ok {
		return u, nil
	}
	return nil, assert.AnError
}

func (m *mockAuth) addUser(token string, user *models.User) {
	m.users[token] = user
}

func TestAuthMiddleware(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mock := newMockAuth()
	middleware := AuthMiddleware(mock)

	user := &models.User{ID: 1, Username: "alice", Role: models.RoleUser, Status: models.StatusActive}
	mock.addUser("valid-token", user)

	t.Run("no token returns 401", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, r := gin.CreateTestContext(w)
		r.GET("/test", middleware, func(c *gin.Context) {
			c.JSON(200, gin.H{"ok": true})
		})

		c.Request, _ = http.NewRequest("GET", "/test", nil)
		r.ServeHTTP(w, c.Request)

		assert.Equal(t, http.StatusUnauthorized, w.Code)
	})

	t.Run("invalid token returns 401", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, r := gin.CreateTestContext(w)
		r.GET("/test", middleware, func(c *gin.Context) {
			c.JSON(200, gin.H{"ok": true})
		})

		c.Request, _ = http.NewRequest("GET", "/test", nil)
		c.Request.Header.Set("Authorization", "Bearer invalid-token")
		r.ServeHTTP(w, c.Request)

		assert.Equal(t, http.StatusUnauthorized, w.Code)
	})

	t.Run("valid token sets user context", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, r := gin.CreateTestContext(w)
		r.GET("/test", middleware, func(c *gin.Context) {
			uid, _ := c.Get("user_id")
			role, _ := c.Get("user_role")
			c.JSON(200, gin.H{"user_id": uid, "role": role})
		})

		c.Request, _ = http.NewRequest("GET", "/test", nil)
		c.Request.Header.Set("Authorization", "Bearer valid-token")
		r.ServeHTTP(w, c.Request)

		assert.Equal(t, http.StatusOK, w.Code)

		var resp map[string]interface{}
		json.Unmarshal(w.Body.Bytes(), &resp)
		assert.Equal(t, float64(1), resp["user_id"])
		assert.Equal(t, string(models.RoleUser), resp["role"])
	})
}

func TestRequireRole(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mock := newMockAuth()
	middleware := AuthMiddleware(mock)

	userToken := "user-token"
	adminToken := "admin-token"

	mock.addUser(userToken, &models.User{ID: 1, Username: "alice", Role: models.RoleUser, Status: models.StatusActive})
	mock.addUser(adminToken, &models.User{ID: 2, Username: "admin", Role: models.RoleAdmin, Status: models.StatusActive})

	t.Run("user cannot access admin route", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, r := gin.CreateTestContext(w)
		r.GET("/admin", middleware, RequireRole(models.RoleAdmin), func(c *gin.Context) {
			c.JSON(200, gin.H{"ok": true})
		})

		c.Request, _ = http.NewRequest("GET", "/admin", nil)
		c.Request.Header.Set("Authorization", "Bearer "+userToken)
		r.ServeHTTP(w, c.Request)

		assert.Equal(t, http.StatusForbidden, w.Code)
	})

	t.Run("admin can access admin route", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, r := gin.CreateTestContext(w)
		r.GET("/admin", middleware, RequireRole(models.RoleAdmin), func(c *gin.Context) {
			c.JSON(200, gin.H{"ok": true})
		})

		c.Request, _ = http.NewRequest("GET", "/admin", nil)
		c.Request.Header.Set("Authorization", "Bearer "+adminToken)
		r.ServeHTTP(w, c.Request)

		assert.Equal(t, http.StatusOK, w.Code)
	})
}
