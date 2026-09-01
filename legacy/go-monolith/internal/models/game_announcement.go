package models

import "time"

type GameAnnouncement struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	GameID    uint      `gorm:"not null;index" json:"game_id"`
	Content   string    `gorm:"type:text;not null" json:"content"`
	CreatedBy uint      `gorm:"not null;index" json:"created_by"`
	CreatedAt time.Time `json:"created_at"`

	Game    Game `gorm:"foreignKey:GameID" json:"-"`
	Creator User `gorm:"foreignKey:CreatedBy" json:"creator,omitempty"`
}
