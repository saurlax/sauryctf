package models

import "time"

type ParticipationStatus string

const (
	ParticipationPending  ParticipationStatus = "pending"
	ParticipationAccepted ParticipationStatus = "accepted"
	ParticipationRejected ParticipationStatus = "rejected"
)

// Participation records a team's registration in a game.
// Compared to GZCTF, this is a simplified version without division support.
// One team can only have one participation per game.
type Participation struct {
	ID        uint                `gorm:"primaryKey" json:"id"`
	GameID    uint                `gorm:"not null;uniqueIndex:idx_game_team" json:"game_id"`
	TeamID    uint                `gorm:"not null;uniqueIndex:idx_game_team" json:"team_id"`
	UserID    uint                `gorm:"not null" json:"user_id"` // the user who registered
	Status    ParticipationStatus `gorm:"size:32;default:accepted;not null" json:"status"`
	CreatedAt time.Time           `json:"created_at"`

	Game Game `gorm:"foreignKey:GameID" json:"-"`
	Team Team `gorm:"foreignKey:TeamID" json:"team,omitempty"`
}
