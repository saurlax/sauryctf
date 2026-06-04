package db

import (
	"os"

	"github.com/glebarez/sqlite"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/saurlax/sauryctf/internal/models"
)

// Connect opens a database connection.
// If DATABASE_URL is set, it connects to PostgreSQL; otherwise it uses a local SQLite file.
func Connect() (*gorm.DB, error) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn != "" {
		return gorm.Open(postgres.Open(dsn), &gorm.Config{
			Logger: logger.Default.LogMode(logger.Info),
		})
	}
	// Default: SQLite file at ./sauryctf.db
	return gorm.Open(sqlite.Open("sauryctf.db"), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
}

// ConnectTest opens a test database connection (same logic, silent logging).
func ConnectTest() (*gorm.DB, error) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn != "" {
		return gorm.Open(postgres.Open(dsn), &gorm.Config{
			Logger: logger.Default.LogMode(logger.Silent),
		})
	}
	// Use in-memory SQLite for tests
	return gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
}

func Migrate(db *gorm.DB) error {
	return db.AutoMigrate(
		&models.User{},
		&models.Session{},
		&models.Team{},
		&models.TeamMember{},
		&models.Challenge{},
		&models.Solve{},
		&models.Game{},
		&models.GameChallenge{},
		&models.Participation{},
		&models.GameWriteup{},
	)
}

// CleanTables deletes all rows from all tables (for testing).
// Works with both SQLite and PostgreSQL.
func CleanTables(db *gorm.DB) {
	db.Exec("DELETE FROM participations")
	db.Exec("DELETE FROM game_writeups")
	db.Exec("DELETE FROM solves")
	db.Exec("DELETE FROM game_challenges")
	db.Exec("DELETE FROM games")
	db.Exec("DELETE FROM challenges")
	db.Exec("DELETE FROM team_members")
	db.Exec("DELETE FROM teams")
	db.Exec("DELETE FROM sessions")
	db.Exec("DELETE FROM users")
}
