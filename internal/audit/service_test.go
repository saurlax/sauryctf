package audit

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/saurlax/sauryctf/internal/db"
	"github.com/saurlax/sauryctf/internal/models"
)

func setupAuditTestDB(t *testing.T) *Service {
	database, err := db.ConnectTest()
	require.NoError(t, err)
	require.NoError(t, db.Migrate(database))
	db.CleanTables(database)
	return NewService(database)
}

func createAuditLog(t *testing.T, svc *Service, actorUserID uint, action string, targetType string, targetID uint) {
	t.Helper()
	require.NoError(t, CreateLog(svc.db, LogEntry{
		ActorUserID:   actorUserID,
		ActorUsername: "tester",
		Action:        action,
		TargetType:    targetType,
		TargetID:      targetID,
		Summary:       action,
		Detail:        "{}",
	}))
}

func TestService_ListLogs(t *testing.T) {
	svc := setupAuditTestDB(t)

	createAuditLog(t, svc, 1, "admin.game.update", "game", 10)
	time.Sleep(time.Millisecond)
	createAuditLog(t, svc, 2, "admin.game.review_writeup", "game", 11)
	time.Sleep(time.Millisecond)
	createAuditLog(t, svc, 1, "admin.user.update", "user", 12)

	t.Run("filters by action", func(t *testing.T) {
		logs, err := svc.ListLogs(nil, "", "admin.game.review_writeup", 20)
		require.NoError(t, err)
		require.Len(t, logs, 1)
		assert.Equal(t, "admin.game.review_writeup", logs[0].Action)
	})

	t.Run("combines actor target and action filters", func(t *testing.T) {
		actorUserID := uint(1)
		logs, err := svc.ListLogs(&actorUserID, "game", "admin.game.update", 20)
		require.NoError(t, err)
		require.Len(t, logs, 1)
		assert.Equal(t, uint(1), logs[0].ActorUserID)
		assert.Equal(t, "game", logs[0].TargetType)
		assert.Equal(t, "admin.game.update", logs[0].Action)
	})

	t.Run("returns newest first after filtering", func(t *testing.T) {
		logs, err := svc.ListLogs(nil, "", "", 20)
		require.NoError(t, err)
		require.Len(t, logs, 3)
		assert.Equal(t, "admin.user.update", logs[0].Action)
		assert.Equal(t, "admin.game.review_writeup", logs[1].Action)
		assert.Equal(t, "admin.game.update", logs[2].Action)
	})

	t.Run("returns typed models", func(t *testing.T) {
		logs, err := svc.ListLogs(nil, "user", "", 20)
		require.NoError(t, err)
		require.Len(t, logs, 1)
		assert.IsType(t, models.AuditLog{}, logs[0])
	})
}
