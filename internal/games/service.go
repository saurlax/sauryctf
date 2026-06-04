package games

import (
	"errors"
	"time"

	"gorm.io/gorm"

	"github.com/saurlax/sauryctf/internal/models"
	"github.com/saurlax/sauryctf/internal/scoring"
)

const (
	RegistrationModeReview     = "review"
	RegistrationModeAutoAccept = "auto_accept"
)

type Service struct {
	db *gorm.DB
}

func NewService(db *gorm.DB) *Service {
	return &Service{db: db}
}

func effectiveGameStatus(game *models.Game) string {
	if game.Status == "active" && time.Now().After(game.EndTime) {
		return "ended"
	}
	return game.Status
}

func normalizeRegistrationMode(mode string) (string, error) {
	switch mode {
	case "", RegistrationModeReview:
		return RegistrationModeReview, nil
	case RegistrationModeAutoAccept:
		return RegistrationModeAutoAccept, nil
	default:
		return "", errors.New("invalid registration mode")
	}
}

func normalizeMaxTeamMembers(limit int) (int, error) {
	if limit < 0 {
		return 0, errors.New("invalid max team members")
	}
	return limit, nil
}

func validateGameTimeline(startTime, endTime time.Time, freezeAt *time.Time) error {
	if !endTime.After(startTime) {
		return errors.New("invalid game timeline")
	}
	if freezeAt != nil {
		if freezeAt.Before(startTime) || freezeAt.After(endTime) {
			return errors.New("invalid scoreboard freeze time")
		}
	}
	return nil
}

func (s *Service) CreateGame(req CreateGameRequest, createdBy uint) (*GameResponse, error) {
	registrationMode, err := normalizeRegistrationMode(req.RegistrationMode)
	if err != nil {
		return nil, err
	}
	maxTeamMembers, err := normalizeMaxTeamMembers(req.MaxTeamMembers)
	if err != nil {
		return nil, err
	}
	if err := validateGameTimeline(req.StartTime, req.EndTime, req.ScoreboardFreezeAt); err != nil {
		return nil, err
	}

	game := &models.Game{
		Name:             req.Name,
		Description:      req.Description,
		Notice:           req.Notice,
		StartTime:        req.StartTime,
		EndTime:          req.EndTime,
		ScoreboardFreezeAt: req.ScoreboardFreezeAt,
		Status:           "draft",
		RegistrationMode: registrationMode,
		MaxTeamMembers:   maxTeamMembers,
		CreatedBy:        createdBy,
	}
	if req.IsPublic != nil {
		game.IsPublic = *req.IsPublic
	}

	if err := s.db.Select(
		"Name", "Description", "Notice", "StartTime", "EndTime", "ScoreboardFreezeAt", "Status", "RegistrationMode", "MaxTeamMembers", "IsPublic", "CreatedBy",
	).Create(game).Error; err != nil {
		return nil, err
	}

	return toResponse(game), nil
}

func (s *Service) GetGame(id uint) (*GameResponse, error) {
	var game models.Game
	if err := s.db.First(&game, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("game not found")
		}
		return nil, err
	}
	return toResponse(&game), nil
}

func (s *Service) ListGames(showAll bool) ([]GameResponse, error) {
	var games []models.Game
	q := s.db.Model(&models.Game{})
	if !showAll {
		q = q.Where("is_public = ? AND status <> ?", true, "draft")
	}
	if err := q.Order("start_time DESC").Find(&games).Error; err != nil {
		return nil, err
	}

	result := make([]GameResponse, len(games))
	for i, g := range games {
		result[i] = *toResponse(&g)
	}
	return result, nil
}

func (s *Service) GetPublicGame(id uint) (*GameResponse, error) {
	game, err := s.GetGame(id)
	if err != nil {
		return nil, err
	}
	if !game.IsPublic || game.Status == "draft" {
		return nil, errors.New("game not found")
	}
	return game, nil
}

func (s *Service) UpdateGame(id uint, req UpdateGameRequest) (*GameResponse, error) {
	var game models.Game
	if err := s.db.First(&game, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("game not found")
		}
		return nil, err
	}

	nextStartTime := game.StartTime
	if req.StartTime != nil {
		nextStartTime = *req.StartTime
	}
	nextEndTime := game.EndTime
	if req.EndTime != nil {
		nextEndTime = *req.EndTime
	}
	nextFreezeAt := game.ScoreboardFreezeAt
	if req.ClearScoreboardFreeze {
		nextFreezeAt = nil
	}
	if req.ScoreboardFreezeAt != nil {
		nextFreezeAt = req.ScoreboardFreezeAt
	}
	if err := validateGameTimeline(nextStartTime, nextEndTime, nextFreezeAt); err != nil {
		return nil, err
	}

	updates := map[string]interface{}{}
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.Description != nil {
		updates["description"] = *req.Description
	}
	if req.Notice != nil {
		updates["notice"] = *req.Notice
	}
	if req.StartTime != nil {
		updates["start_time"] = *req.StartTime
	}
	if req.EndTime != nil {
		updates["end_time"] = *req.EndTime
	}
	if req.ClearScoreboardFreeze {
		updates["scoreboard_freeze_at"] = nil
	}
	if req.ScoreboardFreezeAt != nil {
		updates["scoreboard_freeze_at"] = *req.ScoreboardFreezeAt
	}
	if req.Status != nil {
		updates["status"] = *req.Status
	}
	if req.RegistrationMode != nil {
		registrationMode, err := normalizeRegistrationMode(*req.RegistrationMode)
		if err != nil {
			return nil, err
		}
		updates["registration_mode"] = registrationMode
	}
	if req.MaxTeamMembers != nil {
		maxTeamMembers, err := normalizeMaxTeamMembers(*req.MaxTeamMembers)
		if err != nil {
			return nil, err
		}
		updates["max_team_members"] = maxTeamMembers
	}
	if req.IsPublic != nil {
		updates["is_public"] = *req.IsPublic
	}

	if len(updates) > 0 {
		if err := s.db.Model(&game).Updates(updates).Error; err != nil {
			return nil, err
		}
	}

	return s.GetGame(id)
}

func (s *Service) DeleteGame(id uint) error {
	var game models.Game
	if err := s.db.First(&game, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errors.New("game not found")
		}
		return err
	}

	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("game_id = ?", id).Delete(&models.Participation{}).Error; err != nil {
			return err
		}
		if err := tx.Where("game_id = ?", id).Delete(&models.Solve{}).Error; err != nil {
			return err
		}
		if err := tx.Where("game_id = ?", id).Delete(&models.GameChallenge{}).Error; err != nil {
			return err
		}
		if err := tx.Delete(&game).Error; err != nil {
			return err
		}
		return nil
	})
}

func (s *Service) AddChallenge(gameID uint, challengeID uint, scoreOverride int) error {
	var game models.Game
	if err := s.db.First(&game, gameID).Error; err != nil {
		return errors.New("game not found")
	}

	var ch models.Challenge
	if err := s.db.First(&ch, challengeID).Error; err != nil {
		return errors.New("challenge not found")
	}

	gc := &models.GameChallenge{
		GameID:        gameID,
		ChallengeID:   challengeID,
		ScoreOverride: scoreOverride,
	}
	return s.db.Create(gc).Error
}

func (s *Service) RemoveChallenge(gameID uint, challengeID uint) error {
	result := s.db.Where("game_id = ? AND challenge_id = ?", gameID, challengeID).
		Delete(&models.GameChallenge{})
	if result.RowsAffected == 0 {
		return errors.New("challenge not in game")
	}
	return result.Error
}

// JoinGame registers a team to a game.
// Depending on the game configuration, registrations are either created as
// pending for review or directly accepted for small local events.
func (s *Service) JoinGame(gameID uint, teamID uint, userID uint) error {
	var game models.Game
	if err := s.db.First(&game, gameID).Error; err != nil {
		return errors.New("game not found")
	}
	if game.Status != "active" {
		return errors.New("game is not open for registration")
	}
	if time.Now().After(game.EndTime) {
		return errors.New("game has already ended")
	}

	// Prevent duplicate participation
	var existing models.Participation
	err := s.db.Where("game_id = ? AND team_id = ?", gameID, teamID).First(&existing).Error
	if err == nil {
		return errors.New("team already joined this game")
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}

	if game.MaxTeamMembers > 0 {
		var memberCount int64
		if err := s.db.Model(&models.TeamMember{}).Where("team_id = ?", teamID).Count(&memberCount).Error; err != nil {
			return err
		}
		if memberCount > int64(game.MaxTeamMembers) {
			return errors.New("team exceeds the maximum member limit for this game")
		}
	}

	status := models.ParticipationPending
	if game.RegistrationMode == RegistrationModeAutoAccept {
		status = models.ParticipationAccepted
	}

	part := &models.Participation{
		GameID: gameID,
		TeamID: teamID,
		UserID: userID,
		Status: status,
	}
	return s.db.Create(part).Error
}

// LeaveGame removes a team's participation from a game.
// Pending or rejected registrations can be withdrawn.
// Accepted registrations are locked and cannot be withdrawn anymore.
func (s *Service) LeaveGame(gameID uint, teamID uint, userID uint) error {
	var game models.Game
	if err := s.db.First(&game, gameID).Error; err != nil {
		return errors.New("game not found")
	}

	var participation models.Participation
	if err := s.db.Where("game_id = ? AND team_id = ?", gameID, teamID).First(&participation).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errors.New("not joined this game")
		}
		return err
	}

	if participation.Status == models.ParticipationAccepted {
		return errors.New("accepted participation cannot be withdrawn")
	}

	result := s.db.Where("game_id = ? AND team_id = ?", gameID, teamID).Delete(&models.Participation{})
	return result.Error
}

func (s *Service) GetParticipation(gameID uint, teamID uint) (*models.Participation, error) {
	var part models.Participation
	if err := s.db.Where("game_id = ? AND team_id = ?", gameID, teamID).First(&part).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("participation not found")
		}
		return nil, err
	}
	return &part, nil
}

func (s *Service) GetParticipationStatus(gameID uint, userID uint) (*GameParticipationResponse, error) {
	var game models.Game
	if err := s.db.First(&game, gameID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("game not found")
		}
		return nil, err
	}

	var member models.TeamMember
	if err := s.db.Where("user_id = ?", userID).First(&member).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return &GameParticipationResponse{
				HasTeam:      false,
				Participated: false,
			}, nil
		}
		return nil, err
	}

	var team models.Team
	if err := s.db.First(&team, member.TeamID).Error; err != nil {
		return nil, err
	}

	response := &GameParticipationResponse{
		HasTeam: true,
		Team: &GameParticipationTeam{
			ID:   team.ID,
			Name: team.Name,
		},
	}

	var participation models.Participation
	if err := s.db.Where("game_id = ? AND team_id = ?", gameID, team.ID).First(&participation).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			response.Participated = false
			return response, nil
		}
		return nil, err
	}

	response.Participated = true
	response.Status = string(participation.Status)
	return response, nil
}

// GetGameChallenges returns challenges for a game with solve counts and team solve status.
func (s *Service) GetGameChallenges(gameID uint) ([]GameChallengeDetail, error) {
	return s.getGameChallenges(gameID, false)
}

func (s *Service) GetAdminGameChallenges(gameID uint) ([]GameChallengeDetail, error) {
	return s.getGameChallenges(gameID, true)
}

func (s *Service) getGameChallenges(gameID uint, includeHidden bool) ([]GameChallengeDetail, error) {
	type row struct {
		ChallengeID   uint
		ScoreOverride int
		Title         string
		Description   string
		Category      string
		Type          string
		Difficulty    string
		Hints         string
		Attachments   string
		BaseScore     int
		IsVisible     bool
	}

	query := s.db.Table("game_challenges").
		Select("game_challenges.challenge_id, game_challenges.score_override, "+
			"challenges.title, challenges.description, challenges.category, challenges.type, challenges.difficulty, "+
			"challenges.hints, challenges.attachments, "+
			"challenges.base_score, challenges.is_visible").
		Joins("JOIN challenges ON challenges.id = game_challenges.challenge_id").
		Where("game_challenges.game_id = ?", gameID)
	if !includeHidden {
		query = query.Where("challenges.is_visible = ?", true)
	}

	var rows []row
	if err := query.Scan(&rows).Error; err != nil {
		return nil, err
	}

	// Count solves per challenge in this game
	type solveCount struct {
		ChallengeID uint
		Count       int
	}
	var counts []solveCount
	s.db.Table("solves").
		Select("challenge_id, count(*) as count").
		Where("game_id = ?", gameID).
		Group("challenge_id").
		Scan(&counts)

	countMap := map[uint]int{}
	for _, c := range counts {
		countMap[c.ChallengeID] = c.Count
	}

	result := make([]GameChallengeDetail, 0, len(rows))
	for _, r := range rows {
		score := r.BaseScore
		if r.ScoreOverride > 0 {
			score = r.ScoreOverride
		}
		result = append(result, GameChallengeDetail{
			ID:          r.ChallengeID,
			Title:       r.Title,
			Description: r.Description,
			Category:    r.Category,
			Type:        r.Type,
			Difficulty:  r.Difficulty,
			Hints:       r.Hints,
			Attachments: r.Attachments,
			Score:       score,
			SolveCount:  countMap[r.ChallengeID],
		})
	}
	return result, nil
}

func (s *Service) GetGameChallengesForTeam(gameID uint, teamID uint) ([]GameChallengeDetail, error) {
	challenges, err := s.GetGameChallenges(gameID)
	if err != nil {
		return nil, err
	}

	var solves []models.Solve
	if err := s.db.Where("game_id = ? AND team_id = ?", gameID, teamID).Find(&solves).Error; err != nil {
		return nil, err
	}

	solvedMap := make(map[uint]models.Solve, len(solves))
	for _, solve := range solves {
		solvedMap[solve.ChallengeID] = solve
	}

	type bloodRow struct {
		ChallengeID uint
		TeamName    string
	}
	var bloodRows []bloodRow
	if err := s.db.Table("solves").
		Select("solves.challenge_id, teams.name as team_name").
		Joins("JOIN teams ON teams.id = solves.team_id").
		Where("solves.game_id = ? AND solves.blood_type = ?", gameID, "first").
		Scan(&bloodRows).Error; err != nil {
		return nil, err
	}

	bloodMap := map[uint]string{}
	for _, row := range bloodRows {
		bloodMap[row.ChallengeID] = row.TeamName
	}

	for i := range challenges {
		if _, ok := solvedMap[challenges[i].ID]; ok {
			challenges[i].Solved = true
		}
		if teamName, ok := bloodMap[challenges[i].ID]; ok {
			challenges[i].BloodTeam = teamName
		}
	}

	return challenges, nil
}

// SubmitFlag handles flag submission scoped to a game.
// Uses exponential decay scoring identical to the standalone challenges service.
func (s *Service) SubmitFlag(gameID uint, challengeID uint, userID uint, teamID uint, flag string) (*SubmitResult, error) {
	var game models.Game
	if err := s.db.First(&game, gameID).Error; err != nil {
		return nil, errors.New("game not found")
	}
	if game.Status != "active" {
		return nil, errors.New("game is not active")
	}
	if time.Now().Before(game.StartTime) {
		return nil, errors.New("game has not started yet")
	}
	if time.Now().After(game.EndTime) {
		return nil, errors.New("game has already ended")
	}

	// Verify game exists and team has joined
	var part models.Participation
	if err := s.db.Where("game_id = ? AND team_id = ?", gameID, teamID).First(&part).Error; err != nil {
		return nil, errors.New("team has not joined this game")
	}
	if part.Status != models.ParticipationAccepted {
		return nil, errors.New("team is not approved for this game yet")
	}

	// Verify challenge is in this game
	var gc models.GameChallenge
	if err := s.db.Where("game_id = ? AND challenge_id = ?", gameID, challengeID).First(&gc).Error; err != nil {
		return nil, errors.New("challenge not in this game")
	}

	var ch models.Challenge
	if err := s.db.First(&ch, challengeID).Error; err != nil {
		return nil, errors.New("challenge not found")
	}

	// Check flag
	if ch.Flag != flag {
		return &SubmitResult{Correct: false, Message: "wrong flag"}, nil
	}

	// Idempotent: already solved?
	var existing models.Solve
	err := s.db.Where("challenge_id = ? AND team_id = ? AND game_id = ?", challengeID, teamID, gameID).
		First(&existing).Error
	if err == nil {
		return &SubmitResult{Correct: true, Score: existing.Score, Message: "already solved"}, nil
	}

	// Count how many teams solved this before us
	var solvesBefore int64
	s.db.Model(&models.Solve{}).Where("challenge_id = ? AND game_id = ?", challengeID, gameID).Count(&solvesBefore)

	bloodType := scoring.BloodType(int(solvesBefore))
	score := scoring.ComputeScore(ch, int(solvesBefore))

	solve := &models.Solve{
		ChallengeID: challengeID,
		UserID:      userID,
		TeamID:      teamID,
		GameID:      gameID,
		Score:       score,
		BloodType:   bloodType,
	}
	if err := s.db.Create(solve).Error; err != nil {
		return nil, err
	}

	return &SubmitResult{Correct: true, Score: score, BloodType: bloodType, Message: "correct"}, nil
}

// GetScoreboard aggregates solve data into a ranked scoreboard.
func (s *Service) GetScoreboard(gameID uint) (*ScoreboardResponse, error) {
	var game models.Game
	if err := s.db.First(&game, gameID).Error; err != nil {
		return nil, errors.New("game not found")
	}

	type teamScore struct {
		TeamID     uint
		TeamName   string
		TotalScore int
		SolveCount int
		LastSolve  time.Time
	}

	var participationRows []struct {
		TeamID   uint
		TeamName string
	}
	if err := s.db.Table("participations").
		Select("participations.team_id, teams.name as team_name").
		Joins("JOIN teams ON teams.id = participations.team_id").
		Where("participations.game_id = ? AND participations.status = ?", gameID, models.ParticipationAccepted).
		Scan(&participationRows).Error; err != nil {
		return nil, err
	}

	teamMap := map[uint]*teamScore{}
	for _, row := range participationRows {
		teamMap[row.TeamID] = &teamScore{
			TeamID:   row.TeamID,
			TeamName: row.TeamName,
		}
	}

	var rows []struct {
		TeamID   uint
		TeamName string
		Score    int
		SolvedAt time.Time
	}

	scoreRowsQuery := s.db.Table("solves").
		Select("solves.team_id, teams.name as team_name, solves.score, solves.solved_at").
		Joins("JOIN teams ON teams.id = solves.team_id").
		Where("solves.game_id = ?", gameID)

	isFrozen := false
	if game.ScoreboardFreezeAt != nil && time.Now().After(*game.ScoreboardFreezeAt) {
		isFrozen = true
		scoreRowsQuery = scoreRowsQuery.Where("solves.solved_at <= ?", *game.ScoreboardFreezeAt)
	}

	if err := scoreRowsQuery.
		Order("solves.solved_at ASC").
		Scan(&rows).Error; err != nil {
		return nil, err
	}

	for _, r := range rows {
		entry, exists := teamMap[r.TeamID]
		if !exists {
			entry = &teamScore{TeamID: r.TeamID, TeamName: r.TeamName}
			teamMap[r.TeamID] = entry
		}
		entry.TotalScore += r.Score
		entry.SolveCount++
		if r.SolvedAt.After(entry.LastSolve) {
			entry.LastSolve = r.SolvedAt
		}
	}

	// Sort: higher score first; tie-break by earlier last solve; teams with no solves last among same score.
	entries := make([]ScoreboardEntry, 0, len(teamMap))
	for _, ts := range teamMap {
		entries = append(entries, ScoreboardEntry{
			TeamID:     ts.TeamID,
			TeamName:   ts.TeamName,
			Score:      ts.TotalScore,
			SolveCount: ts.SolveCount,
			LastSolve:  ts.LastSolve,
		})
	}
	// Simple sort
	for i := 0; i < len(entries); i++ {
		for j := i + 1; j < len(entries); j++ {
			a, b := entries[i], entries[j]
			aHasSolve := !a.LastSolve.IsZero()
			bHasSolve := !b.LastSolve.IsZero()
			shouldSwap := false
			if b.Score > a.Score {
				shouldSwap = true
			} else if b.Score == a.Score {
				if aHasSolve && bHasSolve && b.LastSolve.Before(a.LastSolve) {
					shouldSwap = true
				}
				if !aHasSolve && bHasSolve {
					shouldSwap = true
				}
			}
			if shouldSwap {
				entries[i], entries[j] = entries[j], entries[i]
			}
		}
	}
	for i := range entries {
		entries[i].Rank = i + 1
	}

	type challengeRow struct {
		ID            uint
		Title         string
		Category      string
		BaseScore     int
		ScoreOverride int
		SolvedCount   int
		BloodTeam     string
	}

	var challengeRows []challengeRow
	challengeStatsQuery := s.db.Table("game_challenges").
		Select(`
			game_challenges.challenge_id as id,
			challenges.title,
			challenges.category,
			challenges.base_score,
			game_challenges.score_override,
			COUNT(solves.id) as solved_count,
			COALESCE(MAX(CASE WHEN solves.blood_type = 'first' THEN teams.name END), '') as blood_team
		`).
		Joins("JOIN challenges ON challenges.id = game_challenges.challenge_id").
		Joins("LEFT JOIN solves ON solves.challenge_id = game_challenges.challenge_id AND solves.game_id = game_challenges.game_id").
		Joins("LEFT JOIN teams ON teams.id = solves.team_id").
		Where("game_challenges.game_id = ? AND challenges.is_visible = ?", gameID, true)
	if isFrozen && game.ScoreboardFreezeAt != nil {
		challengeStatsQuery = challengeStatsQuery.Where("(solves.id IS NULL OR solves.solved_at <= ?)", *game.ScoreboardFreezeAt)
	}
	if err := challengeStatsQuery.
		Group("game_challenges.challenge_id, challenges.title, challenges.category, challenges.base_score, game_challenges.score_override").
		Order("challenges.category ASC, game_challenges.challenge_id ASC").
		Scan(&challengeRows).Error; err != nil {
		return nil, err
	}

	challengeStats := make([]ScoreboardChallengeStat, 0, len(challengeRows))
	for _, row := range challengeRows {
		score := row.BaseScore
		if row.ScoreOverride > 0 {
			score = row.ScoreOverride
		}
		challengeStats = append(challengeStats, ScoreboardChallengeStat{
			ID:          row.ID,
			Title:       row.Title,
			Category:    row.Category,
			Score:       score,
			SolvedCount: row.SolvedCount,
			BloodTeam:   row.BloodTeam,
		})
	}

	return &ScoreboardResponse{
		GameID:     gameID,
		IsFrozen:   isFrozen,
		FreezeTime: game.ScoreboardFreezeAt,
		Entries:    entries,
		Challenges: challengeStats,
	}, nil
}

func (s *Service) GetParticipants(gameID uint) ([]GameParticipantEntry, error) {
	var game models.Game
	if err := s.db.First(&game, gameID).Error; err != nil {
		return nil, errors.New("game not found")
	}

	type participantRow struct {
		TeamID     uint
		TeamName   string
		Status     string
		JoinedAt   time.Time
		Score      int
		SolveCount int
	}

	var rows []participantRow
	if err := s.db.Table("participations").
		Select(`
			participations.team_id,
			teams.name as team_name,
			participations.status,
			participations.created_at as joined_at,
			COALESCE(SUM(solves.score), 0) as score,
			COUNT(solves.id) as solve_count
		`).
		Joins("JOIN teams ON teams.id = participations.team_id").
		Joins("LEFT JOIN solves ON solves.team_id = participations.team_id AND solves.game_id = participations.game_id").
		Where("participations.game_id = ?", gameID).
		Group("participations.team_id, teams.name, participations.status, participations.created_at").
		Order("participations.created_at ASC").
		Scan(&rows).Error; err != nil {
		return nil, err
	}

	result := make([]GameParticipantEntry, 0, len(rows))
	for _, row := range rows {
		result = append(result, GameParticipantEntry{
			TeamID:     row.TeamID,
			TeamName:   row.TeamName,
			Status:     row.Status,
			JoinedAt:   row.JoinedAt,
			Score:      row.Score,
			SolveCount: row.SolveCount,
		})
	}

	return result, nil
}

func (s *Service) UpdateParticipationStatus(gameID uint, teamID uint, status string) (*GameParticipantEntry, error) {
	var game models.Game
	if err := s.db.First(&game, gameID).Error; err != nil {
		return nil, errors.New("game not found")
	}

	nextStatus := models.ParticipationStatus(status)
	switch nextStatus {
	case models.ParticipationPending, models.ParticipationAccepted, models.ParticipationRejected:
	default:
		return nil, errors.New("invalid participation status")
	}

	var participation models.Participation
	if err := s.db.Where("game_id = ? AND team_id = ?", gameID, teamID).First(&participation).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("participation not found")
		}
		return nil, err
	}

	if err := s.db.Model(&participation).Update("status", nextStatus).Error; err != nil {
		return nil, err
	}

	entries, err := s.GetParticipants(gameID)
	if err != nil {
		return nil, err
	}
	for i := range entries {
		if entries[i].TeamID == teamID {
			return &entries[i], nil
		}
	}

	return nil, errors.New("participation not found")
}

func (s *Service) RemoveParticipation(gameID uint, teamID uint) error {
	var game models.Game
	if err := s.db.First(&game, gameID).Error; err != nil {
		return errors.New("game not found")
	}

	result := s.db.Where("game_id = ? AND team_id = ?", gameID, teamID).Delete(&models.Participation{})
	if result.RowsAffected == 0 {
		return errors.New("participation not found")
	}

	return result.Error
}

func toResponse(g *models.Game) *GameResponse {
	return &GameResponse{
		ID:               g.ID,
		Name:             g.Name,
		Description:      g.Description,
		Notice:           g.Notice,
		StartTime:        g.StartTime,
		EndTime:          g.EndTime,
		ScoreboardFreezeAt: g.ScoreboardFreezeAt,
		Status:           effectiveGameStatus(g),
		RegistrationMode: g.RegistrationMode,
		MaxTeamMembers:   g.MaxTeamMembers,
		IsPublic:         g.IsPublic,
		CreatedBy:        g.CreatedBy,
		CreatedAt:        g.CreatedAt,
	}
}
