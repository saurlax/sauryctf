package models

import "time"

type ChallengeCategory string

const (
	CategoryWeb       ChallengeCategory = "web"
	CategoryPwn       ChallengeCategory = "pwn"
	CategoryCrypto    ChallengeCategory = "crypto"
	CategoryReverse   ChallengeCategory = "reverse"
	CategoryMisc      ChallengeCategory = "misc"
	CategoryForensics ChallengeCategory = "forensics"
	CategoryAWD       ChallengeCategory = "awd"
)

type ChallengeType string

const (
	TypeStatic  ChallengeType = "static"  // Traditional static challenge
	TypeDynamic ChallengeType = "dynamic" // Dynamic container-based challenge
)

type DifficultyLevel string

const (
	DifficultyEasy   DifficultyLevel = "easy"
	DifficultyMedium DifficultyLevel = "medium"
	DifficultyHard   DifficultyLevel = "hard"
)

type Challenge struct {
	ID            uint              `gorm:"primaryKey" json:"id"`
	Title         string            `gorm:"size:255;not null" json:"title"`
	Description   string            `gorm:"type:text" json:"description"`
	Category      ChallengeCategory `gorm:"size:32;not null;index" json:"category"`
	Type          ChallengeType     `gorm:"size:32;not null;default:static" json:"type"`
	Difficulty    DifficultyLevel   `gorm:"size:32;not null;default:easy" json:"difficulty"`
	Flag          string            `gorm:"size:512;not null" json:"-"`
	FlagFormat    string            `gorm:"size:128" json:"flag_format"` // e.g. "flag{...}"
	BaseScore     int               `gorm:"not null;default:100" json:"base_score"`
	MinScore      int               `gorm:"not null;default:10" json:"min_score"`
	DecayRate     float64           `gorm:"not null;default:0.1" json:"decay_rate"` // Score decay per solve
	MaxAttempts   int               `gorm:"default:0" json:"max_attempts"`          // 0 = unlimited
	Hints         string            `gorm:"type:text" json:"hints"`                 // JSON array of hints
	Attachments   string            `gorm:"type:text" json:"attachments"`           // JSON array of file URLs
	ContainerSpec string            `gorm:"type:text" json:"container_spec"`        // Docker image, ports, env (for dynamic)
	IsVisible     bool              `gorm:"not null" json:"is_visible"`
	CreatedBy     uint              `gorm:"index" json:"created_by"`
	CreatedAt     time.Time         `json:"created_at"`
	UpdatedAt     time.Time         `json:"updated_at"`
}

type Solve struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	ChallengeID uint      `gorm:"not null;index;uniqueIndex:idx_solve_unique" json:"challenge_id"`
	UserID      uint      `gorm:"not null;index;uniqueIndex:idx_solve_unique" json:"user_id"`
	TeamID      uint      `gorm:"not null;index;uniqueIndex:idx_solve_unique" json:"team_id"`
	GameID      uint      `gorm:"not null;index;uniqueIndex:idx_solve_unique" json:"game_id"`
	Score       int       `gorm:"not null" json:"score"`
	BloodType   string    `gorm:"size:16" json:"blood_type"` // first, second, third, or empty
	SolvedAt    time.Time `gorm:"not null" json:"solved_at"`
}

type Game struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	Name        string    `gorm:"size:255;not null" json:"name"`
	Description string    `gorm:"type:text" json:"description"`
	StartTime   time.Time `gorm:"not null" json:"start_time"`
	EndTime     time.Time `gorm:"not null" json:"end_time"`
	Status      string    `gorm:"size:32;not null;default:draft" json:"status"` // draft, active, ended
	IsPublic    bool      `gorm:"not null;default:false" json:"is_public"`
	CreatedBy   uint      `gorm:"index" json:"created_by"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type GameChallenge struct {
	ID          uint `gorm:"primaryKey" json:"id"`
	GameID      uint `gorm:"not null;uniqueIndex:idx_game_challenge" json:"game_id"`
	ChallengeID uint `gorm:"not null;uniqueIndex:idx_game_challenge" json:"challenge_id"`
	// Override base score for this game if needed
	ScoreOverride int `gorm:"default:0" json:"score_override"` // 0 = use challenge base_score
}
