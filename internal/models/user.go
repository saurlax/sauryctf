package models

import "time"

type UserRole string

const (
	RoleUser      UserRole = "user"
	RoleTeamCaptain UserRole = "team_captain"
	RoleJudge     UserRole = "judge"
	RoleAdmin     UserRole = "admin"
	RoleSuperAdmin UserRole = "super_admin"
)

type UserStatus string

const (
	StatusActive  UserStatus = "active"
	StatusBanned  UserStatus = "banned"
)

type User struct {
	ID           uint       `gorm:"primaryKey" json:"id"`
	Username     string     `gorm:"uniqueIndex;size:64;not null" json:"username"`
	Email        string     `gorm:"uniqueIndex;size:255;not null" json:"email"`
	PasswordHash string     `gorm:"size:255;not null" json:"-"`
	Role         UserRole   `gorm:"size:32;default:user;not null" json:"role"`
	Status       UserStatus `gorm:"size:32;default:active;not null" json:"status"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}
