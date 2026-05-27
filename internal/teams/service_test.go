package teams

import (
	"testing"

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

func createTestUser(t *testing.T, database *gorm.DB, username string) *models.User {
	user := &models.User{
		Username:     username,
		Email:        username + "@example.com",
		PasswordHash: "hashed",
		Role:         models.RoleUser,
		Status:       models.StatusActive,
	}
	require.NoError(t, database.Create(user).Error)
	return user
}

func TestCreateTeam(t *testing.T) {
	database := setupTestDB(t)
	svc := NewService(database)

	user := createTestUser(t, database, "alice")

	t.Run("success", func(t *testing.T) {
		team, err := svc.CreateTeam("AlphaTeam", user.ID)
		assert.NoError(t, err)
		assert.Equal(t, "AlphaTeam", team.Name)
		assert.Equal(t, user.ID, team.CaptainID)
		assert.NotEmpty(t, team.InviteCode)

		// Check captain is also a member
		var member models.TeamMember
		err = database.Where("team_id = ? AND user_id = ?", team.ID, user.ID).First(&member).Error
		assert.NoError(t, err)
		assert.Equal(t, models.MemberRoleCaptain, member.Role)
	})

	t.Run("duplicate name", func(t *testing.T) {
		_, err := svc.CreateTeam("AlphaTeam", user.ID)
		assert.Error(t, err)
	})

	t.Run("user already in team", func(t *testing.T) {
		_, err := svc.CreateTeam("BetaTeam", user.ID)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "already in a team")
	})
}

func TestJoinTeam(t *testing.T) {
	database := setupTestDB(t)
	svc := NewService(database)

	captain := createTestUser(t, database, "captain")
	joiner := createTestUser(t, database, "joiner")

	team, err := svc.CreateTeam("AlphaTeam", captain.ID)
	require.NoError(t, err)

	t.Run("success", func(t *testing.T) {
		err := svc.JoinTeam(team.InviteCode, joiner.ID)
		assert.NoError(t, err)

		var member models.TeamMember
		err = database.Where("team_id = ? AND user_id = ?", team.ID, joiner.ID).First(&member).Error
		assert.NoError(t, err)
		assert.Equal(t, models.MemberRoleMember, member.Role)
	})

	t.Run("invalid invite code", func(t *testing.T) {
		other := createTestUser(t, database, "other")
		err := svc.JoinTeam("invalid-code", other.ID)
		assert.Error(t, err)
	})

	t.Run("already in team", func(t *testing.T) {
		err := svc.JoinTeam(team.InviteCode, joiner.ID)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "already in a team")
	})
}

func TestLeaveTeam(t *testing.T) {
	database := setupTestDB(t)
	svc := NewService(database)

	captain := createTestUser(t, database, "captain")
	member := createTestUser(t, database, "member")

	team, err := svc.CreateTeam("AlphaTeam", captain.ID)
	require.NoError(t, err)

	svc.JoinTeam(team.InviteCode, member.ID)

	t.Run("member can leave", func(t *testing.T) {
		err := svc.LeaveTeam(team.ID, member.ID)
		assert.NoError(t, err)

		var count int64
		database.Model(&models.TeamMember{}).Where("team_id = ? AND user_id = ?", team.ID, member.ID).Count(&count)
		assert.Equal(t, int64(0), count)
	})

	t.Run("captain cannot leave", func(t *testing.T) {
		err := svc.LeaveTeam(team.ID, captain.ID)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "captain")
	})
}

func TestGetUserTeam(t *testing.T) {
	database := setupTestDB(t)
	svc := NewService(database)

	user := createTestUser(t, database, "alice")

	t.Run("no team", func(t *testing.T) {
		_, err := svc.GetUserTeam(user.ID)
		assert.Error(t, err)
	})

	team, _ := svc.CreateTeam("AlphaTeam", user.ID)

	t.Run("has team", func(t *testing.T) {
		found, err := svc.GetUserTeam(user.ID)
		assert.NoError(t, err)
		assert.Equal(t, team.ID, found.ID)
	})
}

func TestRemoveMember(t *testing.T) {
	database := setupTestDB(t)
	svc := NewService(database)

	captain := createTestUser(t, database, "captain")
	member := createTestUser(t, database, "member")

	team, _ := svc.CreateTeam("AlphaTeam", captain.ID)
	svc.JoinTeam(team.InviteCode, member.ID)

	t.Run("captain can remove member", func(t *testing.T) {
		err := svc.RemoveMember(team.ID, member.ID, captain.ID)
		assert.NoError(t, err)
	})

	t.Run("non-captain cannot remove", func(t *testing.T) {
		other := createTestUser(t, database, "other")
		svc.JoinTeam(team.InviteCode, other.ID)

		err := svc.RemoveMember(team.ID, other.ID, member.ID)
		assert.Error(t, err)
	})
}
