package models

import "time"

type GameInstanceLease struct {
	ID            uint       `gorm:"primaryKey" json:"id"`
	GameID        uint       `gorm:"not null;uniqueIndex:idx_game_instance_lease" json:"game_id"`
	ChallengeID   uint       `gorm:"not null;uniqueIndex:idx_game_instance_lease" json:"challenge_id"`
	TeamID        uint       `gorm:"not null;uniqueIndex:idx_game_instance_lease" json:"team_id"`
	UserID        uint       `gorm:"not null" json:"user_id"`
	Status        string     `gorm:"size:32;not null;default:running" json:"status"`
	Provider      string     `gorm:"size:64" json:"provider"`
	Image         string     `gorm:"size:255" json:"image"`
	LaunchURL     string     `gorm:"size:512" json:"launch_url"`
	Host          string     `gorm:"size:255" json:"host"`
	Port          string     `gorm:"size:64" json:"port"`
	Command       string     `gorm:"type:text" json:"command"`
	Note          string     `gorm:"type:text" json:"note"`
	StartedAt     time.Time  `gorm:"not null" json:"started_at"`
	LastRenewedAt time.Time  `gorm:"not null" json:"last_renewed_at"`
	ExpiresAt     time.Time  `gorm:"not null;index" json:"expires_at"`
	StoppedAt     *time.Time `json:"stopped_at"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}
