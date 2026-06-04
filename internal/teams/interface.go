package teams

import (
	"time"

	"github.com/saurlax/sauryctf/internal/models"
)

// ServiceInterface abstracts team operations for testing and dependency injection.
type ServiceInterface interface {
	CreateTeam(name string, captainID uint) (*models.Team, error)
	JoinTeam(inviteCode string, userID uint) error
	LeaveTeam(teamID, userID uint) error
	GetUserTeam(userID uint) (*TeamView, error)
	RemoveMember(teamID, memberID, requesterID uint) error
}

type TeamLockGame struct {
	GameID    uint      `json:"game_id"`
	Name      string    `json:"name"`
	StartTime time.Time `json:"start_time"`
	EndTime   time.Time `json:"end_time"`
}

type TeamLockSummary struct {
	Locked bool           `json:"locked"`
	Reason string         `json:"reason,omitempty"`
	Games  []TeamLockGame `json:"games,omitempty"`
}

type TeamView struct {
	models.Team
	Lock *TeamLockSummary `json:"lock,omitempty"`
}
