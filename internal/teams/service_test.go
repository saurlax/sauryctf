package teams

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

	t.Run("accepted contest team cannot add new members", func(t *testing.T) {
		lateUser := createTestUser(t, database, "late-joiner")
		game := &models.Game{
			Name:      "Locked Contest",
			StartTime: time.Now().Add(-time.Hour),
			EndTime:   time.Now().Add(time.Hour),
			Status:    "active",
			IsPublic:  true,
			CreatedBy: captain.ID,
		}
		require.NoError(t, database.Create(game).Error)
		require.NoError(t, database.Create(&models.Participation{
			GameID: game.ID, TeamID: team.ID, UserID: captain.ID, Status: models.ParticipationAccepted,
		}).Error)

		err := svc.JoinTeam(team.InviteCode, lateUser.ID)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "locked for an accepted game")
	})

	t.Run("ended contest team can add members again", func(t *testing.T) {
		finishedCaptain := createTestUser(t, database, "finished-captain")
		finishedJoiner := createTestUser(t, database, "finished-joiner")
		lateUser := createTestUser(t, database, "finished-late-user")
		finishedTeam, err := svc.CreateTeam("FinishedTeam", finishedCaptain.ID)
		require.NoError(t, err)
		require.NoError(t, svc.JoinTeam(finishedTeam.InviteCode, finishedJoiner.ID))

		game := &models.Game{
			Name:      "Finished Contest",
			StartTime: time.Now().Add(-2 * time.Hour),
			EndTime:   time.Now().Add(-time.Hour),
			Status:    "active",
			IsPublic:  true,
			CreatedBy: finishedCaptain.ID,
		}
		require.NoError(t, database.Create(game).Error)
		require.NoError(t, database.Create(&models.Participation{
			GameID: game.ID, TeamID: finishedTeam.ID, UserID: finishedCaptain.ID, Status: models.ParticipationAccepted,
		}).Error)

		err = svc.JoinTeam(finishedTeam.InviteCode, lateUser.ID)
		assert.NoError(t, err)
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

	t.Run("accepted contest member cannot leave", func(t *testing.T) {
		lockedMember := createTestUser(t, database, "locked-member")
		lockedTeam, err := svc.CreateTeam("LockedTeam", lockedMember.ID)
		require.NoError(t, err)
		otherMember := createTestUser(t, database, "locked-other")
		require.NoError(t, svc.JoinTeam(lockedTeam.InviteCode, otherMember.ID))

		game := &models.Game{
			Name:      "Locked Leave Contest",
			StartTime: time.Now().Add(-time.Hour),
			EndTime:   time.Now().Add(time.Hour),
			Status:    "active",
			IsPublic:  true,
			CreatedBy: lockedMember.ID,
		}
		require.NoError(t, database.Create(game).Error)
		require.NoError(t, database.Create(&models.Participation{
			GameID: game.ID, TeamID: lockedTeam.ID, UserID: lockedMember.ID, Status: models.ParticipationAccepted,
		}).Error)

		err = svc.LeaveTeam(lockedTeam.ID, otherMember.ID)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "locked for an accepted game")
	})

	t.Run("ended contest member can leave again", func(t *testing.T) {
		finishedCaptain := createTestUser(t, database, "leave-finished-captain")
		finishedMember := createTestUser(t, database, "leave-finished-member")
		finishedTeam, err := svc.CreateTeam("LeaveFinishedTeam", finishedCaptain.ID)
		require.NoError(t, err)
		require.NoError(t, svc.JoinTeam(finishedTeam.InviteCode, finishedMember.ID))

		game := &models.Game{
			Name:      "Finished Leave Contest",
			StartTime: time.Now().Add(-2 * time.Hour),
			EndTime:   time.Now().Add(-time.Hour),
			Status:    "active",
			IsPublic:  true,
			CreatedBy: finishedCaptain.ID,
		}
		require.NoError(t, database.Create(game).Error)
		require.NoError(t, database.Create(&models.Participation{
			GameID: game.ID, TeamID: finishedTeam.ID, UserID: finishedCaptain.ID, Status: models.ParticipationAccepted,
		}).Error)

		err = svc.LeaveTeam(finishedTeam.ID, finishedMember.ID)
		assert.NoError(t, err)
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
		require.NotNil(t, found.Lock)
		assert.False(t, found.Lock.Locked)
		assert.Empty(t, found.Lock.Games)
	})

	t.Run("accepted ongoing contest exposes lock summary", func(t *testing.T) {
		game := &models.Game{
			Name:      "Locked Team Summary Contest",
			StartTime: time.Now().Add(-time.Hour),
			EndTime:   time.Now().Add(time.Hour),
			Status:    "active",
			IsPublic:  true,
			CreatedBy: user.ID,
		}
		require.NoError(t, database.Create(game).Error)
		require.NoError(t, database.Create(&models.Participation{
			GameID: game.ID, TeamID: team.ID, UserID: user.ID, Status: models.ParticipationAccepted,
		}).Error)

		found, err := svc.GetUserTeam(user.ID)
		assert.NoError(t, err)
		require.NotNil(t, found.Lock)
		assert.True(t, found.Lock.Locked)
		assert.Equal(t, "team is locked for an accepted game", found.Lock.Reason)
		require.Len(t, found.Lock.Games, 1)
		assert.Equal(t, game.ID, found.Lock.Games[0].GameID)
		assert.Equal(t, game.Name, found.Lock.Games[0].Name)
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

	t.Run("captain cannot remove member after accepted contest lock", func(t *testing.T) {
		lockedCaptain := createTestUser(t, database, "locked-captain")
		lockedMember := createTestUser(t, database, "locked-member-remove")
		lockedTeam, err := svc.CreateTeam("LockedRemoveTeam", lockedCaptain.ID)
		require.NoError(t, err)
		require.NoError(t, svc.JoinTeam(lockedTeam.InviteCode, lockedMember.ID))

		game := &models.Game{
			Name:      "Locked Remove Contest",
			StartTime: time.Now().Add(-time.Hour),
			EndTime:   time.Now().Add(time.Hour),
			Status:    "active",
			IsPublic:  true,
			CreatedBy: lockedCaptain.ID,
		}
		require.NoError(t, database.Create(game).Error)
		require.NoError(t, database.Create(&models.Participation{
			GameID: game.ID, TeamID: lockedTeam.ID, UserID: lockedCaptain.ID, Status: models.ParticipationAccepted,
		}).Error)

		err = svc.RemoveMember(lockedTeam.ID, lockedMember.ID, lockedCaptain.ID)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "locked for an accepted game")
	})

	t.Run("ended contest captain can remove member again", func(t *testing.T) {
		finishedCaptain := createTestUser(t, database, "remove-finished-captain")
		finishedMember := createTestUser(t, database, "remove-finished-member")
		finishedTeam, err := svc.CreateTeam("RemoveFinishedTeam", finishedCaptain.ID)
		require.NoError(t, err)
		require.NoError(t, svc.JoinTeam(finishedTeam.InviteCode, finishedMember.ID))

		game := &models.Game{
			Name:      "Finished Remove Contest",
			StartTime: time.Now().Add(-2 * time.Hour),
			EndTime:   time.Now().Add(-time.Hour),
			Status:    "active",
			IsPublic:  true,
			CreatedBy: finishedCaptain.ID,
		}
		require.NoError(t, database.Create(game).Error)
		require.NoError(t, database.Create(&models.Participation{
			GameID: game.ID, TeamID: finishedTeam.ID, UserID: finishedCaptain.ID, Status: models.ParticipationAccepted,
		}).Error)

		err = svc.RemoveMember(finishedTeam.ID, finishedMember.ID, finishedCaptain.ID)
		assert.NoError(t, err)
	})
}
