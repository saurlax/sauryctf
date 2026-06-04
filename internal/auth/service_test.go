package auth

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/saurlax/sauryctf/internal/db"
	"github.com/saurlax/sauryctf/internal/models"
)

func setupTestDB(t *testing.T) *gorm.DB {
	database, err := db.ConnectTest()
	require.NoError(t, err)
	require.NoError(t, db.Migrate(database))
	db.CleanTables(database)
	return database
}

func TestRegister(t *testing.T) {
	database := setupTestDB(t)
	svc := NewService(database, "test-secret")

	t.Run("success", func(t *testing.T) {
		user, err := svc.Register("alice", "alice@example.com", "password123")
		assert.NoError(t, err)
		assert.Equal(t, "alice", user.Username)
		assert.Equal(t, "alice@example.com", user.Email)
		assert.Equal(t, models.RoleUser, user.Role)
		assert.NotEmpty(t, user.PasswordHash)
	})

	t.Run("duplicate username", func(t *testing.T) {
		_, err := svc.Register("alice", "other@example.com", "password123")
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "username")
	})

	t.Run("duplicate email", func(t *testing.T) {
		_, err := svc.Register("bob", "alice@example.com", "password123")
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "email")
	})
}

func TestEnsureBootstrapAdmin(t *testing.T) {
	database := setupTestDB(t)
	svc := NewService(database, "test-secret")

	t.Run("creates default admin for empty database", func(t *testing.T) {
		user, created, err := svc.EnsureBootstrapAdmin()
		require.NoError(t, err)
		require.True(t, created)
		require.NotNil(t, user)
		assert.Equal(t, defaultAdminUsername, user.Username)
		assert.Equal(t, defaultAdminEmail, user.Email)
		assert.Equal(t, models.RoleAdmin, user.Role)

		_, loggedInUser, err := svc.Login(defaultAdminUsername, defaultAdminPassword)
		require.NoError(t, err)
		assert.Equal(t, user.ID, loggedInUser.ID)
	})

	t.Run("does not create a second bootstrap admin", func(t *testing.T) {
		user, created, err := svc.EnsureBootstrapAdmin()
		require.NoError(t, err)
		assert.False(t, created)
		assert.Nil(t, user)

		var count int64
		require.NoError(t, database.Model(&models.User{}).Count(&count).Error)
		assert.EqualValues(t, 1, count)
	})

	t.Run("does not create bootstrap admin when database already has users", func(t *testing.T) {
		database2 := setupTestDB(t)
		svc2 := NewService(database2, "test-secret")

		_, err := svc2.Register("alice", "alice@example.com", "password123")
		require.NoError(t, err)

		user, created, err := svc2.EnsureBootstrapAdmin()
		require.NoError(t, err)
		assert.False(t, created)
		assert.Nil(t, user)

		var count int64
		require.NoError(t, database2.Model(&models.User{}).Count(&count).Error)
		assert.EqualValues(t, 1, count)
	})
}

func TestLogin(t *testing.T) {
	database := setupTestDB(t)
	svc := NewService(database, "test-secret")

	_, err := svc.Register("alice", "alice@example.com", "password123")
	require.NoError(t, err)

	t.Run("success", func(t *testing.T) {
		token, user, err := svc.Login("alice@example.com", "password123")
		assert.NoError(t, err)
		assert.NotEmpty(t, token)
		assert.Equal(t, "alice", user.Username)
	})

	t.Run("repeat login generates unique session token", func(t *testing.T) {
		firstToken, _, err := svc.Login("alice@example.com", "password123")
		require.NoError(t, err)

		secondToken, _, err := svc.Login("alice@example.com", "password123")
		require.NoError(t, err)

		assert.NotEqual(t, firstToken, secondToken)

		var sessionCount int64
		require.NoError(t, database.Model(&models.Session{}).Where("user_id = ?", 1).Count(&sessionCount).Error)
		assert.GreaterOrEqual(t, sessionCount, int64(2))
	})

	t.Run("wrong password", func(t *testing.T) {
		_, _, err := svc.Login("alice@example.com", "wrongpassword")
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "invalid")
	})

	t.Run("nonexistent user", func(t *testing.T) {
		_, _, err := svc.Login("nobody@example.com", "password123")
		assert.Error(t, err)
	})

	t.Run("banned user", func(t *testing.T) {
		// Ban the user
		database.Model(&models.User{}).Where("username = ?", "alice").Update("status", string(models.StatusBanned))
		_, _, err := svc.Login("alice@example.com", "password123")
		assert.Error(t, err)
	})
}

func TestValidateToken(t *testing.T) {
	database := setupTestDB(t)
	svc := NewService(database, "test-secret")

	_, err := svc.Register("alice", "alice@example.com", "password123")
	require.NoError(t, err)

	token, _, err := svc.Login("alice@example.com", "password123")
	require.NoError(t, err)

	t.Run("valid token", func(t *testing.T) {
		user, err := svc.ValidateToken(token)
		assert.NoError(t, err)
		assert.Equal(t, "alice", user.Username)
	})

	t.Run("invalid token", func(t *testing.T) {
		_, err := svc.ValidateToken("invalid-token")
		assert.Error(t, err)
	})

	t.Run("expired token", func(t *testing.T) {
		// Use the existing valid token's user, generate a new expired token directly
		user2, err := svc.ValidateToken(token)
		require.NoError(t, err)
		shortSvc := &Service{db: database, jwtSecret: "test-secret", tokenTTL: -1 * time.Hour}
		expiredToken, err := shortSvc.generateToken(user2)
		require.NoError(t, err)
		_, err = shortSvc.ValidateToken(expiredToken)
		assert.Error(t, err)
	})
}

func TestLogout(t *testing.T) {
	database := setupTestDB(t)
	svc := NewService(database, "test-secret")

	_, err := svc.Register("alice", "alice@example.com", "password123")
	require.NoError(t, err)

	token, _, err := svc.Login("alice@example.com", "password123")
	require.NoError(t, err)

	t.Run("success", func(t *testing.T) {
		err := svc.Logout(token)
		assert.NoError(t, err)

		_, err = svc.ValidateToken(token)
		assert.Error(t, err)
	})
}

func TestGetUserByID(t *testing.T) {
	database := setupTestDB(t)
	svc := NewService(database, "test-secret")

	user, err := svc.Register("alice", "alice@example.com", "password123")
	require.NoError(t, err)

	t.Run("found", func(t *testing.T) {
		found, err := svc.GetUserByID(user.ID)
		assert.NoError(t, err)
		assert.Equal(t, "alice", found.Username)
	})

	t.Run("not found", func(t *testing.T) {
		_, err := svc.GetUserByID(99999)
		assert.Error(t, err)
	})
}
