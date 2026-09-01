package models

import "time"

type AuditLog struct {
	ID            uint      `gorm:"primaryKey" json:"id"`
	ActorUserID   uint      `gorm:"index;not null" json:"actor_user_id"`
	ActorUsername string    `gorm:"size:64;not null" json:"actor_username"`
	Action        string    `gorm:"size:64;index;not null" json:"action"`
	TargetType    string    `gorm:"size:32;index;not null" json:"target_type"`
	TargetID      uint      `gorm:"index;not null" json:"target_id"`
	Summary       string    `gorm:"size:255;not null" json:"summary"`
	Detail        string    `gorm:"type:text" json:"detail"`
	CreatedAt     time.Time `json:"created_at"`
}
