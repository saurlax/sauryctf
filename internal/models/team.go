package models

import "time"

type TeamStatus string

const (
	TeamStatusActive TeamStatus = "active"
	TeamStatusLocked TeamStatus = "locked"
)

type Team struct {
	ID         uint       `gorm:"primaryKey" json:"id"`
	Name       string     `gorm:"uniqueIndex;size:128;not null" json:"name"`
	InviteCode string     `gorm:"uniqueIndex;size:32;not null" json:"invite_code"`
	CaptainID  uint       `gorm:"index;not null" json:"captain_id"`
	Status     TeamStatus `gorm:"size:32;default:active;not null" json:"status"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
	Captain    User       `gorm:"foreignKey:CaptainID" json:"captain,omitempty"`
	Members    []TeamMember `gorm:"foreignKey:TeamID" json:"members,omitempty"`
}
