package models

import "time"

type TeamMemberRole string

const (
	MemberRoleCaptain TeamMemberRole = "captain"
	MemberRoleMember  TeamMemberRole = "member"
)

type TeamMember struct {
	ID       uint           `gorm:"primaryKey" json:"id"`
	TeamID   uint           `gorm:"index:idx_team_user,unique;not null" json:"team_id"`
	UserID   uint           `gorm:"index:idx_team_user,unique;not null" json:"user_id"`
	Role     TeamMemberRole `gorm:"size:32;default:member;not null" json:"role"`
	JoinedAt time.Time      `gorm:"not null" json:"joined_at"`
	Team     Team           `gorm:"foreignKey:TeamID" json:"team,omitempty"`
	User     User           `gorm:"foreignKey:UserID" json:"user,omitempty"`
}
