package models

import "time"

type ParticipationStatus string

const (
	ParticipationPending  ParticipationStatus = "pending"
	ParticipationAccepted ParticipationStatus = "accepted"
	ParticipationRejected ParticipationStatus = "rejected"
)

type WriteupStatus string

const (
	WriteupStatusSubmitted WriteupStatus = "submitted"
	WriteupStatusApproved  WriteupStatus = "approved"
	WriteupStatusRejected  WriteupStatus = "rejected"
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

type GameWriteup struct {
	ID           uint          `gorm:"primaryKey" json:"id"`
	GameID       uint          `gorm:"not null;uniqueIndex:idx_game_writeup_team" json:"game_id"`
	TeamID       uint          `gorm:"not null;uniqueIndex:idx_game_writeup_team" json:"team_id"`
	SubmittedBy  uint          `gorm:"not null" json:"submitted_by"`
	Content      string        `gorm:"type:text;not null" json:"content"`
	Status       WriteupStatus `gorm:"size:32;not null;default:submitted" json:"status"`
	ReviewerID   *uint         `json:"reviewer_id"`
	ReviewRemark string        `gorm:"type:text" json:"review_remark"`
	SubmittedAt  time.Time     `gorm:"not null" json:"submitted_at"`
	ReviewedAt   *time.Time    `json:"reviewed_at"`
	CreatedAt    time.Time     `json:"created_at"`
	UpdatedAt    time.Time     `json:"updated_at"`

	Game       Game  `gorm:"foreignKey:GameID" json:"-"`
	Team       Team  `gorm:"foreignKey:TeamID" json:"team,omitempty"`
	Submitter  User  `gorm:"foreignKey:SubmittedBy" json:"submitter,omitempty"`
	Reviewer   *User `gorm:"foreignKey:ReviewerID" json:"reviewer,omitempty"`
}
