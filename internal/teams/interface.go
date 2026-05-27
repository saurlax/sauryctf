package teams

import "github.com/saurlax/sauryctf/internal/models"

// ServiceInterface abstracts team operations for testing and dependency injection.
type ServiceInterface interface {
	CreateTeam(name string, captainID uint) (*models.Team, error)
	JoinTeam(inviteCode string, userID uint) error
	LeaveTeam(teamID, userID uint) error
	GetUserTeam(userID uint) (*models.Team, error)
	RemoveMember(teamID, memberID, requesterID uint) error
}
