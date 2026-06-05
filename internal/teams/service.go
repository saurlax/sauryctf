package teams

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"time"

	"gorm.io/gorm"

	"github.com/saurlax/sauryctf/internal/models"
)

type Service struct {
	db *gorm.DB
}

func NewService(db *gorm.DB) *Service {
	return &Service{db: db}
}

func (s *Service) getTeamLockSummary(teamID uint) (*TeamLockSummary, error) {
	var rows []TeamLockGame
	if err := s.db.Model(&models.Participation{}).
		Select("games.id as game_id, games.name, games.start_time, games.end_time").
		Joins("JOIN games ON games.id = participations.game_id").
		Where("participations.team_id = ? AND participations.status = ?", teamID, models.ParticipationAccepted).
		Where("games.end_time > ?", time.Now()).
		Order("games.start_time ASC").
		Find(&rows).Error; err != nil {
		return nil, err
	}

	if len(rows) == 0 {
		return &TeamLockSummary{Locked: false, Games: []TeamLockGame{}}, nil
	}

	return &TeamLockSummary{
		Locked: true,
		Reason: "team is locked for an accepted game",
		Games:  rows,
	}, nil
}

func (s *Service) ensureTeamUnlocked(teamID uint) error {
	summary, err := s.getTeamLockSummary(teamID)
	if err != nil {
		return err
	}
	if summary.Locked {
		return errors.New(summary.Reason)
	}
	return nil
}

func (s *Service) CreateTeam(name string, captainID uint) (*models.Team, error) {
	// Check user not already in a team
	var count int64
	s.db.Model(&models.TeamMember{}).Where("user_id = ?", captainID).Count(&count)
	if count > 0 {
		return nil, errors.New("user already in a team")
	}

	inviteCode, err := generateInviteCode()
	if err != nil {
		return nil, err
	}

	team := &models.Team{
		Name:       name,
		InviteCode: inviteCode,
		CaptainID:  captainID,
		Status:     models.TeamStatusActive,
	}

	err = s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(team).Error; err != nil {
			return err
		}

		member := &models.TeamMember{
			TeamID: team.ID,
			UserID: captainID,
			Role:   models.MemberRoleCaptain,
		}
		return tx.Create(member).Error
	})

	if err != nil {
		return nil, err
	}

	if err := s.db.Preload("Captain").Preload("Members").Preload("Members.User").First(team, team.ID).Error; err != nil {
		return nil, err
	}

	return team, nil
}

func (s *Service) JoinTeam(inviteCode string, userID uint) error {
	var team models.Team
	if err := s.db.Where("invite_code = ?", inviteCode).First(&team).Error; err != nil {
		return errors.New("invalid invite code")
	}
	if err := s.ensureTeamUnlocked(team.ID); err != nil {
		return err
	}

	// Check user not already in a team
	var count int64
	s.db.Model(&models.TeamMember{}).Where("user_id = ?", userID).Count(&count)
	if count > 0 {
		return errors.New("user already in a team")
	}

	member := &models.TeamMember{
		TeamID: team.ID,
		UserID: userID,
		Role:   models.MemberRoleMember,
	}
	return s.db.Create(member).Error
}

func (s *Service) LeaveTeam(teamID, userID uint) error {
	// Check if user is captain
	var team models.Team
	if err := s.db.First(&team, teamID).Error; err != nil {
		return errors.New("team not found")
	}
	if err := s.ensureTeamUnlocked(teamID); err != nil {
		return err
	}

	if team.CaptainID == userID {
		return errors.New("captain cannot leave the team")
	}

	return s.db.Where("team_id = ? AND user_id = ?", teamID, userID).Delete(&models.TeamMember{}).Error
}

func (s *Service) GetUserTeam(userID uint) (*TeamView, error) {
	var member models.TeamMember
	if err := s.db.Where("user_id = ?", userID).First(&member).Error; err != nil {
		return nil, errors.New("user not in any team")
	}

	var team models.Team
	if err := s.db.Preload("Members").Preload("Members.User").First(&team, member.TeamID).Error; err != nil {
		return nil, err
	}

	lock, err := s.getTeamLockSummary(team.ID)
	if err != nil {
		return nil, err
	}

	return &TeamView{
		Team: team,
		Lock: lock,
	}, nil
}

func (s *Service) RemoveMember(teamID, memberID, requesterID uint) error {
	var team models.Team
	if err := s.db.First(&team, teamID).Error; err != nil {
		return errors.New("team not found")
	}
	if err := s.ensureTeamUnlocked(teamID); err != nil {
		return err
	}

	if team.CaptainID != requesterID {
		return errors.New("only captain can remove members")
	}

	if memberID == requesterID {
		return errors.New("captain cannot remove themselves")
	}

	return s.db.Where("team_id = ? AND user_id = ?", teamID, memberID).Delete(&models.TeamMember{}).Error
}

func (s *Service) TransferCaptain(teamID, targetUserID, requesterID uint) error {
	var team models.Team
	if err := s.db.First(&team, teamID).Error; err != nil {
		return errors.New("team not found")
	}
	if err := s.ensureTeamUnlocked(teamID); err != nil {
		return err
	}

	if team.CaptainID != requesterID {
		return errors.New("only captain can transfer captain role")
	}
	if targetUserID == requesterID {
		return errors.New("captain already owns this team")
	}

	var targetMember models.TeamMember
	if err := s.db.Where("team_id = ? AND user_id = ?", teamID, targetUserID).First(&targetMember).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errors.New("target user is not a team member")
		}
		return err
	}

	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&models.Team{}).Where("id = ?", teamID).Update("captain_id", targetUserID).Error; err != nil {
			return err
		}
		if err := tx.Model(&models.TeamMember{}).
			Where("team_id = ? AND user_id = ?", teamID, requesterID).
			Update("role", models.MemberRoleMember).Error; err != nil {
			return err
		}
		if err := tx.Model(&models.TeamMember{}).
			Where("team_id = ? AND user_id = ?", teamID, targetUserID).
			Update("role", models.MemberRoleCaptain).Error; err != nil {
			return err
		}
		return nil
	})
}

func (s *Service) ResetInviteCode(teamID, requesterID uint) (string, error) {
	var team models.Team
	if err := s.db.First(&team, teamID).Error; err != nil {
		return "", errors.New("team not found")
	}

	if team.CaptainID != requesterID {
		return "", errors.New("only captain can reset invite code")
	}

	for attempt := 0; attempt < 5; attempt++ {
		inviteCode, err := generateInviteCode()
		if err != nil {
			return "", err
		}
		result := s.db.Model(&models.Team{}).
			Where("id = ? AND invite_code <> ?", teamID, inviteCode).
			Update("invite_code", inviteCode)
		if result.Error != nil {
			return "", result.Error
		}
		if result.RowsAffected == 1 {
			return inviteCode, nil
		}
	}

	return "", errors.New("failed to rotate invite code")
}

func generateInviteCode() (string, error) {
	bytes := make([]byte, 6)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}
