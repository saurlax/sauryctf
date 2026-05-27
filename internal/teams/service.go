package teams

import (
	"crypto/rand"
	"encoding/hex"
	"errors"

	"gorm.io/gorm"

	"github.com/saurlax/sauryctf/internal/models"
)

type Service struct {
	db *gorm.DB
}

func NewService(db *gorm.DB) *Service {
	return &Service{db: db}
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
	return team, nil
}

func (s *Service) JoinTeam(inviteCode string, userID uint) error {
	var team models.Team
	if err := s.db.Where("invite_code = ?", inviteCode).First(&team).Error; err != nil {
		return errors.New("invalid invite code")
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

	if team.CaptainID == userID {
		return errors.New("captain cannot leave the team")
	}

	return s.db.Where("team_id = ? AND user_id = ?", teamID, userID).Delete(&models.TeamMember{}).Error
}

func (s *Service) GetUserTeam(userID uint) (*models.Team, error) {
	var member models.TeamMember
	if err := s.db.Where("user_id = ?", userID).First(&member).Error; err != nil {
		return nil, errors.New("user not in any team")
	}

	var team models.Team
	if err := s.db.Preload("Members").Preload("Members.User").First(&team, member.TeamID).Error; err != nil {
		return nil, err
	}

	return &team, nil
}

func (s *Service) RemoveMember(teamID, memberID, requesterID uint) error {
	var team models.Team
	if err := s.db.First(&team, teamID).Error; err != nil {
		return errors.New("team not found")
	}

	if team.CaptainID != requesterID {
		return errors.New("only captain can remove members")
	}

	if memberID == requesterID {
		return errors.New("captain cannot remove themselves")
	}

	return s.db.Where("team_id = ? AND user_id = ?", teamID, memberID).Delete(&models.TeamMember{}).Error
}

func generateInviteCode() (string, error) {
	bytes := make([]byte, 6)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}
