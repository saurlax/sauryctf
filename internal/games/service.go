package games

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/saurlax/sauryctf/internal/models"
	"github.com/saurlax/sauryctf/internal/scoring"
)

const (
	RegistrationModeReview     = "review"
	RegistrationModeAutoAccept = "auto_accept"
	exportAttachmentDir        = "attachments"
	instanceLeaseDuration      = 30 * time.Minute
)

type Service struct {
	db                *gorm.DB
	instanceProviders map[string]ChallengeInstanceProvider
}

type exportedAttachmentPayload struct {
	zipPath string
	data    []byte
}

type parsedInstanceSpec struct {
	Provider string
	Image    string
	LaunchURL string
	Host     string
	Port     string
	Command  string
	Note     string
}

func NewService(db *gorm.DB) *Service {
	return NewServiceWithInstanceProviders(db, nil)
}

func NewServiceWithInstanceProviders(db *gorm.DB, providers map[string]ChallengeInstanceProvider) *Service {
	return &Service{
		db:                db,
		instanceProviders: cloneChallengeInstanceProviders(providers),
	}
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

func normalizeInvitationCode(code string) string {
	return strings.TrimSpace(code)
}

func normalizeStringValue(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case float64:
		if typed == float64(int64(typed)) {
			return fmt.Sprintf("%d", int64(typed))
		}
		return strings.TrimSpace(fmt.Sprintf("%v", typed))
	default:
		if typed == nil {
			return ""
		}
		return strings.TrimSpace(fmt.Sprintf("%v", typed))
	}
}

func parseManagedInstanceSpec(raw string) *parsedInstanceSpec {
	if strings.TrimSpace(raw) == "" {
		return nil
	}

	var parsed map[string]any
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return &parsedInstanceSpec{
			Note: strings.TrimSpace(raw),
		}
	}

	connection, _ := parsed["connection"].(map[string]any)
	runtime, _ := parsed["runtime"].(map[string]any)

	return &parsedInstanceSpec{
		Provider:  normalizeStringValue(runtime["provider"]),
		Image:     normalizeStringValue(runtime["image"]),
		LaunchURL: normalizeStringValue(connection["url"]),
		Host:      normalizeStringValue(connection["host"]),
		Port:      normalizeStringValue(connection["port"]),
		Command:   normalizeStringValue(connection["command"]),
		Note:      normalizeStringValue(connection["note"]),
	}
}

func toChallengeInstanceRuntimeSpec(spec *parsedInstanceSpec) ChallengeInstanceRuntimeSpec {
	if spec == nil {
		return ChallengeInstanceRuntimeSpec{}
	}

	return ChallengeInstanceRuntimeSpec{
		Provider:  spec.Provider,
		Image:     spec.Image,
		LaunchURL: spec.LaunchURL,
		Host:      spec.Host,
		Port:      spec.Port,
		Command:   spec.Command,
		Note:      spec.Note,
	}
}

func (s *Service) getAcceptedParticipationForUser(gameID uint, userID uint) (*models.Game, *models.Challenge, *models.Participation, *parsedInstanceSpec, error) {
	var game models.Game
	if err := s.db.First(&game, gameID).Error; err != nil {
		return nil, nil, nil, nil, errors.New("game not found")
	}
	if effectiveGameStatus(&game) == "draft" {
		return nil, nil, nil, nil, errors.New("game is not active")
	}
	if time.Now().Before(game.StartTime) {
		return nil, nil, nil, nil, errors.New("game has not started yet")
	}
	if time.Now().After(game.EndTime) && !game.PracticeMode {
		return nil, nil, nil, nil, errors.New("game has already ended")
	}

	var member models.TeamMember
	if err := s.db.Where("user_id = ?", userID).First(&member).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, nil, nil, errors.New("user has no team")
		}
		return nil, nil, nil, nil, err
	}

	var participation models.Participation
	if err := s.db.Where("game_id = ? AND team_id = ?", gameID, member.TeamID).First(&participation).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, nil, nil, errors.New("team has not joined this game")
		}
		return nil, nil, nil, nil, err
	}
	if participation.Status != models.ParticipationAccepted {
		return nil, nil, nil, nil, errors.New("team is not approved for this game yet")
	}

	return &game, nil, &participation, nil, nil
}

func (s *Service) loadManagedInstanceChallenge(gameID uint, challengeID uint) (*models.Challenge, *parsedInstanceSpec, error) {
	var gc models.GameChallenge
	if err := s.db.Where("game_id = ? AND challenge_id = ?", gameID, challengeID).First(&gc).Error; err != nil {
		return nil, nil, errors.New("challenge not in this game")
	}

	var challenge models.Challenge
	if err := s.db.First(&challenge, challengeID).Error; err != nil {
		return nil, nil, errors.New("challenge not found")
	}

	spec := parseManagedInstanceSpec(challenge.ContainerSpec)
	if challenge.Type != models.TypeDynamic {
		return nil, nil, errors.New("challenge does not support managed instances")
	}
	if spec == nil || (spec.Provider == "" && spec.Image == "") {
		return nil, nil, errors.New("challenge does not define a managed runtime")
	}

	return &challenge, spec, nil
}

func buildInstanceResponse(gameID uint, challengeID uint, teamID uint, lease *models.GameInstanceLease, spec *parsedInstanceSpec) *ChallengeInstanceResponse {
	response := &ChallengeInstanceResponse{
		GameID:      gameID,
		ChallengeID: challengeID,
		TeamID:      teamID,
		Status:      "idle",
		CanStart:    true,
		CanRenew:    false,
		Message:     "当前还没有运行中的实例。",
	}
	if spec != nil {
		response.Provider = spec.Provider
		response.Image = spec.Image
		response.LaunchURL = spec.LaunchURL
		response.Host = spec.Host
		response.Port = spec.Port
		response.Command = spec.Command
		response.Note = spec.Note
	}

	if lease == nil {
		return response
	}

	now := time.Now()
	status := lease.Status
	canRenew := false
	canStart := true
	secondsLeft := 0
	message := "当前实例租约已过期，可以重新启动。"
	if lease.ExpiresAt.After(now) {
		status = "running"
		canRenew = true
		canStart = false
		secondsLeft = int(time.Until(lease.ExpiresAt).Seconds())
		message = fmt.Sprintf("实例运行中，预计还剩 %d 秒。", secondsLeft)
	}

	response.Status = status
	response.Provider = lease.Provider
	response.Image = lease.Image
	response.LaunchURL = lease.LaunchURL
	response.Host = lease.Host
	response.Port = lease.Port
	response.Command = lease.Command
	response.Note = lease.Note
	response.StartedAt = &lease.StartedAt
	response.LastRenewedAt = &lease.LastRenewedAt
	response.ExpiresAt = &lease.ExpiresAt
	response.SecondsLeft = secondsLeft
	response.CanStart = canStart
	response.CanRenew = canRenew
	response.Message = message
	return response
}

func sanitizePublicGameResponse(game *GameResponse) *GameResponse {
	if game == nil {
		return nil
	}
	copy := *game
	copy.InvitationCode = ""
	return &copy
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

func validateWriteupDeadline(endTime time.Time, deadline *time.Time) error {
	if deadline != nil && deadline.Before(endTime) {
		return errors.New("invalid writeup deadline")
	}
	return nil
}

func normalizeDivisions(divisions []string) ([]string, error) {
	if len(divisions) == 0 {
		return nil, nil
	}

	result := make([]string, 0, len(divisions))
	seen := make(map[string]struct{}, len(divisions))
	for _, division := range divisions {
		name := strings.TrimSpace(division)
		if name == "" {
			continue
		}
		if len(name) > 64 {
			return nil, errors.New("invalid divisions")
		}
		key := strings.ToLower(name)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, name)
	}

	if len(result) == 0 {
		return nil, nil
	}
	return result, nil
}

func encodeDivisions(divisions []string) (string, error) {
	normalized, err := normalizeDivisions(divisions)
	if err != nil {
		return "", err
	}
	if len(normalized) == 0 {
		return "", nil
	}
	payload, err := json.Marshal(normalized)
	if err != nil {
		return "", err
	}
	return string(payload), nil
}

func decodeDivisions(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}

	var divisions []string
	if err := json.Unmarshal([]byte(raw), &divisions); err != nil {
		return nil
	}
	normalized, err := normalizeDivisions(divisions)
	if err != nil {
		return nil
	}
	return normalized
}

func divisionAllowed(available []string, division string) bool {
	division = strings.TrimSpace(division)
	if division == "" {
		return true
	}
	for _, item := range available {
		if strings.EqualFold(item, division) {
			return true
		}
	}
	return false
}

func normalizeParticipationDivision(available []string, division string) (string, error) {
	name := strings.TrimSpace(division)
	if name == "" {
		return "", nil
	}
	if !divisionAllowed(available, name) {
		return "", errors.New("invalid participation division")
	}
	for _, item := range available {
		if strings.EqualFold(item, name) {
			return item, nil
		}
	}
	return name, nil
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
	if err := validateWriteupDeadline(req.EndTime, req.WriteupDeadline); err != nil {
		return nil, err
	}
	divisions, err := encodeDivisions(req.Divisions)
	if err != nil {
		return nil, err
	}

	game := &models.Game{
		Name:               req.Name,
		Description:        req.Description,
		Notice:             req.Notice,
		InvitationCode:     normalizeInvitationCode(req.InvitationCode),
		Divisions:          divisions,
		StartTime:          req.StartTime,
		EndTime:            req.EndTime,
		ScoreboardFreezeAt: req.ScoreboardFreezeAt,
		Status:             "draft",
		RegistrationMode:   registrationMode,
		MaxTeamMembers:     maxTeamMembers,
		PracticeMode:       req.PracticeMode,
		WriteupRequired:    req.WriteupRequired,
		WriteupDeadline:    req.WriteupDeadline,
		CreatedBy:          createdBy,
	}
	if req.IsPublic != nil {
		game.IsPublic = *req.IsPublic
	}

	if err := s.db.Select(
		"Name", "Description", "Notice", "InvitationCode", "Divisions", "StartTime", "EndTime", "ScoreboardFreezeAt", "Status", "RegistrationMode", "MaxTeamMembers", "PracticeMode", "WriteupRequired", "WriteupDeadline", "IsPublic", "CreatedBy",
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
		item := toResponse(&g)
		if !showAll {
			item = sanitizePublicGameResponse(item)
		}
		result[i] = *item
	}
	return result, nil
}

func (s *Service) GetAdminDashboardSummary(limit int) (*AdminDashboardSummaryResponse, error) {
	if limit <= 0 {
		limit = 5
	}

	var gameModels []models.Game
	if err := s.db.
		Order("start_time DESC").
		Limit(limit).
		Find(&gameModels).Error; err != nil {
		return nil, err
	}

	resp := &AdminDashboardSummaryResponse{
		Games:               make([]AdminDashboardGameSummary, 0, len(gameModels)),
		PendingParticipants: make([]AdminDashboardParticipantEntry, 0),
		PendingWriteups:     make([]AdminDashboardWriteupEntry, 0),
		LatestAnnouncements: make([]AdminDashboardAnnouncementEntry, 0),
		RecentSubmissions:   make([]AdminDashboardSubmissionEntry, 0),
		CheatClues:          make([]AdminDashboardCheatClueEntry, 0),
	}
	if len(gameModels) == 0 {
		return resp, nil
	}

	gameIDs := make([]uint, 0, len(gameModels))
	gameNameByID := make(map[uint]string, len(gameModels))
	for _, game := range gameModels {
		gameIDs = append(gameIDs, game.ID)
		gameNameByID[game.ID] = game.Name
		resp.Games = append(resp.Games, AdminDashboardGameSummary{
			ID:               game.ID,
			Name:             game.Name,
			StartTime:        game.StartTime,
			EndTime:          game.EndTime,
			Status:           effectiveGameStatus(&game),
			IsPublic:         game.IsPublic,
			RegistrationMode: game.RegistrationMode,
			PracticeMode:     game.PracticeMode,
			WriteupRequired:  game.WriteupRequired,
		})
	}

	var participations []models.Participation
	if err := s.db.
		Preload("Team").
		Where("game_id IN ? AND status = ?", gameIDs, models.ParticipationPending).
		Order("created_at DESC").
		Find(&participations).Error; err != nil {
		return nil, err
	}
	for _, participation := range participations {
		resp.PendingParticipants = append(resp.PendingParticipants, AdminDashboardParticipantEntry{
			GameID:     participation.GameID,
			GameName:   gameNameByID[participation.GameID],
			TeamID:     participation.TeamID,
			TeamName:   participation.Team.Name,
			Status:     string(participation.Status),
			Division:   participation.Division,
			JoinedAt:   participation.CreatedAt,
			Score:      0,
			SolveCount: 0,
		})
	}

	var writeups []models.GameWriteup
	if err := s.db.
		Preload("Team").
		Where("game_id IN ? AND status = ?", gameIDs, models.WriteupStatusSubmitted).
		Order("submitted_at DESC").
		Find(&writeups).Error; err != nil {
		return nil, err
	}
	for _, writeup := range writeups {
		resp.PendingWriteups = append(resp.PendingWriteups, AdminDashboardWriteupEntry{
			GameID:      writeup.GameID,
			GameName:    gameNameByID[writeup.GameID],
			TeamID:      writeup.TeamID,
			TeamName:    writeup.Team.Name,
			SubmittedBy: writeup.SubmittedBy,
			Status:      string(writeup.Status),
			SubmittedAt: writeup.SubmittedAt,
		})
	}

	var announcements []models.GameAnnouncement
	if err := s.db.
		Where("game_id IN ?", gameIDs).
		Order("created_at DESC").
		Limit(limit).
		Find(&announcements).Error; err != nil {
		return nil, err
	}
	for _, announcement := range announcements {
		resp.LatestAnnouncements = append(resp.LatestAnnouncements, AdminDashboardAnnouncementEntry{
			ID:        announcement.ID,
			GameID:    announcement.GameID,
			GameName:  gameNameByID[announcement.GameID],
			Content:   announcement.Content,
			CreatedBy: announcement.CreatedBy,
			CreatedAt: announcement.CreatedAt,
		})
	}

	type recentSubmissionItem struct {
		GameID         uint
		GameName       string
		ChallengeID    uint
		ChallengeTitle string
		TeamID         uint
		TeamName       string
		Result         string
		SubmittedAt    time.Time
	}
	recentSubmissions := make([]recentSubmissionItem, 0)
	for _, gameID := range gameIDs {
		records, err := s.ListSubmissionRecords(gameID, "", limit)
		if err != nil {
			return nil, err
		}
		for _, record := range records {
			recentSubmissions = append(recentSubmissions, recentSubmissionItem{
				GameID:         record.GameID,
				GameName:       gameNameByID[record.GameID],
				ChallengeID:    record.ChallengeID,
				ChallengeTitle: record.ChallengeTitle,
				TeamID:         record.TeamID,
				TeamName:       record.TeamName,
				Result:         record.Result,
				SubmittedAt:    record.SubmittedAt,
			})
		}
	}
	if len(recentSubmissions) > 0 {
		sort.Slice(recentSubmissions, func(i, j int) bool {
			if recentSubmissions[i].SubmittedAt.Equal(recentSubmissions[j].SubmittedAt) {
				if recentSubmissions[i].GameID == recentSubmissions[j].GameID {
					return recentSubmissions[i].ChallengeID > recentSubmissions[j].ChallengeID
				}
				return recentSubmissions[i].GameID > recentSubmissions[j].GameID
			}
			return recentSubmissions[i].SubmittedAt.After(recentSubmissions[j].SubmittedAt)
		})
		if len(recentSubmissions) > limit {
			recentSubmissions = recentSubmissions[:limit]
		}
		for _, item := range recentSubmissions {
			resp.RecentSubmissions = append(resp.RecentSubmissions, AdminDashboardSubmissionEntry{
				GameID:         item.GameID,
				GameName:       item.GameName,
				ChallengeID:    item.ChallengeID,
				ChallengeTitle: item.ChallengeTitle,
				TeamID:         item.TeamID,
				TeamName:       item.TeamName,
				Result:         item.Result,
				SubmittedAt:    item.SubmittedAt,
			})
		}
	}

	type cheatClueItem struct {
		GameID          uint
		GameName        string
		ChallengeID     uint
		ChallengeTitle  string
		SubmittedFlag   string
		TeamCount       int
		SubmissionCount int
		LastSeenAt      time.Time
	}
	cheatClues := make([]cheatClueItem, 0)
	for _, gameID := range gameIDs {
		clues, err := s.ListSubmissionCheatClues(gameID, limit)
		if err != nil {
			return nil, err
		}
		for _, clue := range clues {
			cheatClues = append(cheatClues, cheatClueItem{
				GameID:          gameID,
				GameName:        gameNameByID[gameID],
				ChallengeID:     clue.ChallengeID,
				ChallengeTitle:  clue.ChallengeTitle,
				SubmittedFlag:   clue.SubmittedFlag,
				TeamCount:       clue.TeamCount,
				SubmissionCount: clue.SubmissionCount,
				LastSeenAt:      clue.LastSeenAt,
			})
		}
	}
	if len(cheatClues) > 0 {
		sort.Slice(cheatClues, func(i, j int) bool {
			if cheatClues[i].TeamCount == cheatClues[j].TeamCount {
				if cheatClues[i].SubmissionCount == cheatClues[j].SubmissionCount {
					return cheatClues[i].LastSeenAt.After(cheatClues[j].LastSeenAt)
				}
				return cheatClues[i].SubmissionCount > cheatClues[j].SubmissionCount
			}
			return cheatClues[i].TeamCount > cheatClues[j].TeamCount
		})
		if len(cheatClues) > limit {
			cheatClues = cheatClues[:limit]
		}
		for _, item := range cheatClues {
			resp.CheatClues = append(resp.CheatClues, AdminDashboardCheatClueEntry{
				GameID:          item.GameID,
				GameName:        item.GameName,
				ChallengeID:     item.ChallengeID,
				ChallengeTitle:  item.ChallengeTitle,
				SubmittedFlag:   item.SubmittedFlag,
				TeamCount:       item.TeamCount,
				SubmissionCount: item.SubmissionCount,
				LastSeenAt:      item.LastSeenAt,
			})
		}
	}

	return resp, nil
}

func (s *Service) GetPublicGame(id uint) (*GameResponse, error) {
	game, err := s.GetGame(id)
	if err != nil {
		return nil, err
	}
	if !game.IsPublic || game.Status == "draft" {
		return nil, errors.New("game not found")
	}
	return sanitizePublicGameResponse(game), nil
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
	nextWriteupDeadline := game.WriteupDeadline
	if req.ClearWriteupDeadline {
		nextWriteupDeadline = nil
	}
	if req.WriteupDeadline != nil {
		nextWriteupDeadline = req.WriteupDeadline
	}
	nextDivisions := decodeDivisions(game.Divisions)
	if req.Divisions != nil {
		nextDivisions = *req.Divisions
	}
	if err := validateGameTimeline(nextStartTime, nextEndTime, nextFreezeAt); err != nil {
		return nil, err
	}
	if err := validateWriteupDeadline(nextEndTime, nextWriteupDeadline); err != nil {
		return nil, err
	}
	encodedDivisions, err := encodeDivisions(nextDivisions)
	if err != nil {
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
	if req.InvitationCode != nil {
		updates["invitation_code"] = normalizeInvitationCode(*req.InvitationCode)
	}
	if req.Divisions != nil {
		updates["divisions"] = encodedDivisions
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
	if req.PracticeMode != nil {
		updates["practice_mode"] = *req.PracticeMode
	}
	if req.WriteupRequired != nil {
		updates["writeup_required"] = *req.WriteupRequired
	}
	if req.ClearWriteupDeadline {
		updates["writeup_deadline"] = nil
	}
	if req.WriteupDeadline != nil {
		updates["writeup_deadline"] = *req.WriteupDeadline
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
		if err := tx.Where("game_id = ?", id).Delete(&models.GameWriteup{}).Error; err != nil {
			return err
		}
		if err := tx.Where("game_id = ?", id).Delete(&models.GameSubmission{}).Error; err != nil {
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

func (s *Service) ExportGamePackage(id uint) ([]byte, string, error) {
	var game models.Game
	if err := s.db.First(&game, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, "", errors.New("game not found")
		}
		return nil, "", err
	}

	type exportRow struct {
		ID            uint
		Title         string
		Description   string
		Category      string
		Type          string
		Difficulty    string
		Flag          string
		FlagFormat    string
		Hints         string
		Attachments   string
		ContainerSpec string
		BaseScore     int
		MinScore      int
		DecayRate     float64
		MaxAttempts   int
		IsVisible     bool
		ScoreOverride int
	}

	var rows []exportRow
	if err := s.db.Table("game_challenges").
		Select(`
			challenges.id,
			challenges.title,
			challenges.description,
			challenges.category,
			challenges.type,
			challenges.difficulty,
			challenges.flag,
			challenges.flag_format,
			challenges.hints,
			challenges.attachments,
			challenges.container_spec,
			challenges.base_score,
			challenges.min_score,
			challenges.decay_rate,
			challenges.max_attempts,
			challenges.is_visible,
			game_challenges.score_override
		`).
		Joins("JOIN challenges ON challenges.id = game_challenges.challenge_id").
		Where("game_challenges.game_id = ?", id).
		Order("game_challenges.challenge_id ASC").
		Scan(&rows).Error; err != nil {
		return nil, "", err
	}

	pkg := ExportGamePackage{
		Version:     ExportPackageVersionV2,
		GeneratedAt: time.Now().UTC(),
		Game: ExportGameMetadata{
			ID:                 game.ID,
			Name:               game.Name,
			Description:        game.Description,
			Notice:             game.Notice,
			InvitationCode:     normalizeInvitationCode(game.InvitationCode),
			Divisions:          decodeDivisions(game.Divisions),
			StartTime:          game.StartTime,
			EndTime:            game.EndTime,
			ScoreboardFreezeAt: game.ScoreboardFreezeAt,
			Status:             effectiveGameStatus(&game),
			RegistrationMode:   game.RegistrationMode,
			MaxTeamMembers:     game.MaxTeamMembers,
			PracticeMode:       game.PracticeMode,
			WriteupRequired:    game.WriteupRequired,
			WriteupDeadline:    game.WriteupDeadline,
			IsPublic:           game.IsPublic,
		},
		Challenges: make([]ExportedGameChallenge, 0, len(rows)),
	}

	attachmentFiles := make([]exportedAttachmentPayload, 0)

	for _, row := range rows {
		exportedChallenge := ExportedGameChallenge{
			ID:            row.ID,
			Title:         row.Title,
			Description:   row.Description,
			Category:      row.Category,
			Type:          row.Type,
			Difficulty:    row.Difficulty,
			Flag:          row.Flag,
			FlagFormat:    row.FlagFormat,
			Hints:         row.Hints,
			Attachments:   row.Attachments,
			ContainerSpec: row.ContainerSpec,
			BaseScore:     row.BaseScore,
			MinScore:      row.MinScore,
			DecayRate:     row.DecayRate,
			MaxAttempts:   row.MaxAttempts,
			IsVisible:     row.IsVisible,
			ScoreOverride: row.ScoreOverride,
		}

		embeddedAttachments, files, err := collectEmbeddedAttachments(row.Attachments, row.ID)
		if err != nil {
			return nil, "", err
		}
		exportedChallenge.EmbeddedAttachments = embeddedAttachments
		attachmentFiles = append(attachmentFiles, files...)

		pkg.Challenges = append(pkg.Challenges, exportedChallenge)
	}

	payload, err := json.MarshalIndent(pkg, "", "  ")
	if err != nil {
		return nil, "", err
	}

	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)

	gameFile, err := writer.Create("game.json")
	if err != nil {
		return nil, "", err
	}
	if _, err := gameFile.Write(payload); err != nil {
		return nil, "", err
	}

	for _, file := range attachmentFiles {
		archiveFile, err := writer.Create(file.zipPath)
		if err != nil {
			return nil, "", err
		}
		if _, err := archiveFile.Write(file.data); err != nil {
			return nil, "", err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, "", err
	}

	filename := fmt.Sprintf("game-%d-%s-export.zip", game.ID, sanitizeExportName(game.Name))
	return archive.Bytes(), filename, nil
}

func (s *Service) ExportScoreboardPackage(id uint, division string) ([]byte, string, error) {
	var game models.Game
	if err := s.db.First(&game, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, "", errors.New("game not found")
		}
		return nil, "", err
	}

	scoreboard, err := s.GetScoreboard(id, division)
	if err != nil {
		return nil, "", err
	}

	scoreboardJSON, err := json.MarshalIndent(scoreboard, "", "  ")
	if err != nil {
		return nil, "", err
	}

	rankingsCSV, err := buildScoreboardEntriesCSV(scoreboard.Entries)
	if err != nil {
		return nil, "", err
	}

	challengesCSV, err := buildScoreboardChallengesCSV(scoreboard.Challenges)
	if err != nil {
		return nil, "", err
	}

	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)

	files := []struct {
		name string
		data []byte
	}{
		{name: "scoreboard.json", data: scoreboardJSON},
		{name: "rankings.csv", data: rankingsCSV},
		{name: "challenge-stats.csv", data: challengesCSV},
	}

	for _, file := range files {
		archiveFile, err := writer.Create(file.name)
		if err != nil {
			return nil, "", err
		}
		if _, err := archiveFile.Write(file.data); err != nil {
			return nil, "", err
		}
	}

	if err := writer.Close(); err != nil {
		return nil, "", err
	}

	filename := fmt.Sprintf("game-%d-%s-scoreboard-export.zip", game.ID, sanitizeExportName(game.Name))
	if strings.TrimSpace(scoreboard.Division) != "" {
		filename = fmt.Sprintf("game-%d-%s-scoreboard-%s-export.zip", game.ID, sanitizeExportName(game.Name), sanitizeExportName(scoreboard.Division))
	}

	return archive.Bytes(), filename, nil
}

func (s *Service) ExportWriteupsPackage(id uint) ([]byte, string, error) {
	var game models.Game
	if err := s.db.First(&game, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, "", errors.New("game not found")
		}
		return nil, "", err
	}

	writeups, err := s.ListWriteups(id)
	if err != nil {
		return nil, "", err
	}

	writeupsJSON, err := json.MarshalIndent(writeups, "", "  ")
	if err != nil {
		return nil, "", err
	}

	writeupsCSV, err := buildWriteupsCSV(writeups)
	if err != nil {
		return nil, "", err
	}

	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)

	files := []struct {
		name string
		data []byte
	}{
		{name: "writeups.json", data: writeupsJSON},
		{name: "writeups.csv", data: writeupsCSV},
	}

	for _, file := range files {
		archiveFile, err := writer.Create(file.name)
		if err != nil {
			return nil, "", err
		}
		if _, err := archiveFile.Write(file.data); err != nil {
			return nil, "", err
		}
	}

	for _, writeup := range writeups {
		fileName := fmt.Sprintf(
			"writeups/team-%d-%s.md",
			writeup.TeamID,
			sanitizeExportName(writeup.TeamName),
		)
		archiveFile, err := writer.Create(fileName)
		if err != nil {
			return nil, "", err
		}
		if _, err := archiveFile.Write([]byte(writeup.Content)); err != nil {
			return nil, "", err
		}
	}

	if err := writer.Close(); err != nil {
		return nil, "", err
	}

	filename := fmt.Sprintf("game-%d-%s-writeups-export.zip", game.ID, sanitizeExportName(game.Name))
	return archive.Bytes(), filename, nil
}

func (s *Service) ExportSubmissionsPackage(id uint) ([]byte, string, error) {
	var game models.Game
	if err := s.db.First(&game, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, "", errors.New("game not found")
		}
		return nil, "", err
	}

	submissions, err := s.ListSubmissionRecords(id, "", 0)
	if err != nil {
		return nil, "", err
	}

	submissionsJSON, err := json.MarshalIndent(submissions, "", "  ")
	if err != nil {
		return nil, "", err
	}

	submissionsCSV, err := buildSubmissionsCSV(submissions)
	if err != nil {
		return nil, "", err
	}

	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)

	for _, file := range []struct {
		name string
		data []byte
	}{
		{name: "submissions.json", data: submissionsJSON},
		{name: "submissions.csv", data: submissionsCSV},
	} {
		archiveFile, err := writer.Create(file.name)
		if err != nil {
			return nil, "", err
		}
		if _, err := archiveFile.Write(file.data); err != nil {
			return nil, "", err
		}
	}

	if err := writer.Close(); err != nil {
		return nil, "", err
	}

	filename := fmt.Sprintf("game-%d-%s-submissions-export.zip", game.ID, sanitizeExportName(game.Name))
	return archive.Bytes(), filename, nil
}

func (s *Service) ListAnnouncements(gameID uint) ([]GameAnnouncementResponse, error) {
	var game models.Game
	if err := s.db.First(&game, gameID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("game not found")
		}
		return nil, err
	}

	var rows []models.GameAnnouncement
	if err := s.db.
		Where("game_id = ?", gameID).
		Order("created_at DESC, id DESC").
		Find(&rows).Error; err != nil {
		return nil, err
	}

	result := make([]GameAnnouncementResponse, 0, len(rows))
	for _, row := range rows {
		result = append(result, GameAnnouncementResponse{
			ID:        row.ID,
			GameID:    row.GameID,
			Content:   row.Content,
			CreatedBy: row.CreatedBy,
			CreatedAt: row.CreatedAt,
		})
	}

	return result, nil
}

func (s *Service) CreateAnnouncement(gameID uint, createdBy uint, req CreateGameAnnouncementRequest) (*GameAnnouncementResponse, error) {
	var game models.Game
	if err := s.db.First(&game, gameID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("game not found")
		}
		return nil, err
	}

	content, err := normalizeAnnouncementContent(req.Content)
	if err != nil {
		return nil, err
	}

	announcement := models.GameAnnouncement{
		GameID:    gameID,
		Content:   content,
		CreatedBy: createdBy,
	}
	if err := s.db.Create(&announcement).Error; err != nil {
		return nil, err
	}

	return &GameAnnouncementResponse{
		ID:        announcement.ID,
		GameID:    announcement.GameID,
		Content:   announcement.Content,
		CreatedBy: announcement.CreatedBy,
		CreatedAt: announcement.CreatedAt,
	}, nil
}

func (s *Service) DeleteAnnouncement(gameID uint, announcementID uint) error {
	var announcement models.GameAnnouncement
	if err := s.db.Where("game_id = ? AND id = ?", gameID, announcementID).First(&announcement).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errors.New("announcement not found")
		}
		return err
	}

	return s.db.Delete(&announcement).Error
}

func (s *Service) ImportGamePackage(data []byte, createdBy uint) (*GameResponse, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, errors.New("invalid import package")
	}

	var gameFile *zip.File
	for _, file := range reader.File {
		if file.Name == "game.json" {
			gameFile = file
			break
		}
	}
	if gameFile == nil {
		return nil, errors.New("game.json not found in import package")
	}

	fileReader, err := gameFile.Open()
	if err != nil {
		return nil, err
	}
	defer fileReader.Close()

	payload, err := io.ReadAll(fileReader)
	if err != nil {
		return nil, err
	}

	var pkg ExportGamePackage
	if err := json.Unmarshal(payload, &pkg); err != nil {
		return nil, errors.New("invalid game.json")
	}
	if pkg.Version != ExportPackageVersionV1 && pkg.Version != ExportPackageVersionV2 {
		return nil, errors.New("unsupported import package version")
	}
	if err := validateGameTimeline(pkg.Game.StartTime, pkg.Game.EndTime, pkg.Game.ScoreboardFreezeAt); err != nil {
		return nil, err
	}
	if err := validateWriteupDeadline(pkg.Game.EndTime, pkg.Game.WriteupDeadline); err != nil {
		return nil, err
	}

	registrationMode, err := normalizeRegistrationMode(pkg.Game.RegistrationMode)
	if err != nil {
		return nil, err
	}
	maxTeamMembers, err := normalizeMaxTeamMembers(pkg.Game.MaxTeamMembers)
	if err != nil {
		return nil, err
	}
	divisions, err := encodeDivisions(pkg.Game.Divisions)
	if err != nil {
		return nil, err
	}

	var importedGame *GameResponse
	if err := s.db.Transaction(func(tx *gorm.DB) error {
		game := &models.Game{
			Name:               pkg.Game.Name,
			Description:        pkg.Game.Description,
			Notice:             pkg.Game.Notice,
			InvitationCode:     normalizeInvitationCode(pkg.Game.InvitationCode),
			Divisions:          divisions,
			StartTime:          pkg.Game.StartTime,
			EndTime:            pkg.Game.EndTime,
			ScoreboardFreezeAt: pkg.Game.ScoreboardFreezeAt,
			Status:             "draft",
			RegistrationMode:   registrationMode,
			MaxTeamMembers:     maxTeamMembers,
			PracticeMode:       pkg.Game.PracticeMode,
			WriteupRequired:    pkg.Game.WriteupRequired,
			WriteupDeadline:    pkg.Game.WriteupDeadline,
			IsPublic:           pkg.Game.IsPublic,
			CreatedBy:          createdBy,
		}

		if err := tx.Select(
			"Name", "Description", "Notice", "InvitationCode", "Divisions", "StartTime", "EndTime", "ScoreboardFreezeAt", "Status", "RegistrationMode", "MaxTeamMembers", "PracticeMode", "WriteupRequired", "WriteupDeadline", "IsPublic", "CreatedBy",
		).Create(game).Error; err != nil {
			return err
		}

		for _, item := range pkg.Challenges {
			attachmentURLs, err := parseAttachmentURLs(item.Attachments)
			if err != nil {
				return err
			}
			if pkg.Version == ExportPackageVersionV2 && len(item.EmbeddedAttachments) > 0 {
				attachmentURLs = filterRemoteAttachmentURLs(attachmentURLs)
				restored, err := restoreEmbeddedAttachments(reader, item.EmbeddedAttachments)
				if err != nil {
					return err
				}
				attachmentURLs = mergeAttachmentURLs(attachmentURLs, restored)
			}

			attachments := item.Attachments
			if attachmentURLs != nil {
				encoded, err := json.Marshal(attachmentURLs)
				if err != nil {
					return err
				}
				attachments = string(encoded)
			}

			challenge := &models.Challenge{
				Title:         item.Title,
				Description:   item.Description,
				Category:      models.ChallengeCategory(item.Category),
				Type:          models.ChallengeType(item.Type),
				Difficulty:    models.DifficultyLevel(item.Difficulty),
				Flag:          item.Flag,
				FlagFormat:    item.FlagFormat,
				BaseScore:     item.BaseScore,
				MinScore:      item.MinScore,
				DecayRate:     item.DecayRate,
				MaxAttempts:   item.MaxAttempts,
				Hints:         item.Hints,
				Attachments:   attachments,
				ContainerSpec: item.ContainerSpec,
				IsVisible:     item.IsVisible,
				CreatedBy:     createdBy,
			}

			if challenge.Type == "" {
				challenge.Type = models.TypeStatic
			}
			if challenge.Difficulty == "" {
				challenge.Difficulty = models.DifficultyEasy
			}
			if challenge.BaseScore == 0 {
				challenge.BaseScore = 100
			}
			if challenge.MinScore == 0 {
				challenge.MinScore = 10
			}
			if challenge.DecayRate == 0 {
				challenge.DecayRate = 0.1
			}

			if err := tx.Select(
				"Title", "Description", "Category", "Type", "Difficulty",
				"Flag", "FlagFormat", "BaseScore", "MinScore", "DecayRate",
				"MaxAttempts", "Hints", "Attachments", "ContainerSpec",
				"IsVisible", "CreatedBy",
			).Create(challenge).Error; err != nil {
				return err
			}

			mount := &models.GameChallenge{
				GameID:        game.ID,
				ChallengeID:   challenge.ID,
				ScoreOverride: item.ScoreOverride,
			}
			if err := tx.Create(mount).Error; err != nil {
				return err
			}
		}

		importedGame = toResponse(game)
		return nil
	}); err != nil {
		return nil, err
	}

	return importedGame, nil
}

func collectEmbeddedAttachments(raw string, challengeID uint) ([]ExportedAttachmentFile, []exportedAttachmentPayload, error) {
	urls, err := parseAttachmentURLs(raw)
	if err != nil {
		return nil, nil, err
	}

	embedded := make([]ExportedAttachmentFile, 0)
	files := make([]exportedAttachmentPayload, 0)

	for index, attachmentURL := range urls {
		if !isLocalAttachmentURL(attachmentURL) {
			continue
		}

		sourcePath, fileName, err := resolveLocalAttachmentPath(attachmentURL)
		if err != nil {
			continue
		}

		data, err := os.ReadFile(sourcePath)
		if err != nil {
			continue
		}

		zipPath := fmt.Sprintf("%s/challenge-%d/%02d-%s", exportAttachmentDir, challengeID, index+1, sanitizeAttachmentName(fileName))
		embedded = append(embedded, ExportedAttachmentFile{
			Name:        fileName,
			ZipPath:     zipPath,
			OriginalURL: attachmentURL,
		})
		files = append(files, exportedAttachmentPayload{
			zipPath: zipPath,
			data:    data,
		})
	}

	return embedded, files, nil
}

func parseAttachmentURLs(raw string) ([]string, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}

	var items []string
	if err := json.Unmarshal([]byte(raw), &items); err != nil {
		return nil, errors.New("invalid attachments json")
	}
	return items, nil
}

func isLocalAttachmentURL(raw string) bool {
	return strings.HasPrefix(raw, "/attachments/")
}

func resolveLocalAttachmentPath(raw string) (string, string, error) {
	parsed, err := url.Parse(raw)
	if err != nil {
		return "", "", err
	}
	cleanPath := filepath.Clean(strings.TrimPrefix(parsed.Path, "/"))
	if !strings.HasPrefix(cleanPath, exportAttachmentDir+string(os.PathSeparator)) && cleanPath != exportAttachmentDir {
		return "", "", errors.New("attachment path escapes attachment root")
	}
	fileName := filepath.Base(cleanPath)
	return cleanPath, fileName, nil
}

func restoreEmbeddedAttachments(reader *zip.Reader, attachments []ExportedAttachmentFile) ([]string, error) {
	if err := os.MkdirAll(exportAttachmentDir, 0o755); err != nil {
		return nil, err
	}

	fileMap := make(map[string]*zip.File, len(reader.File))
	for _, file := range reader.File {
		fileMap[file.Name] = file
	}

	restored := make([]string, 0, len(attachments))
	for _, attachment := range attachments {
		source, ok := fileMap[attachment.ZipPath]
		if !ok {
			return nil, fmt.Errorf("embedded attachment missing: %s", attachment.ZipPath)
		}

		fileReader, err := source.Open()
		if err != nil {
			return nil, err
		}
		data, readErr := io.ReadAll(fileReader)
		closeErr := fileReader.Close()
		if readErr != nil {
			return nil, readErr
		}
		if closeErr != nil {
			return nil, closeErr
		}

		targetName := fmt.Sprintf("%d-%s", time.Now().UnixNano(), sanitizeAttachmentName(attachment.Name))
		targetPath := filepath.Join(exportAttachmentDir, targetName)
		if err := os.WriteFile(targetPath, data, 0o644); err != nil {
			return nil, err
		}

		restored = append(restored, "/"+filepath.ToSlash(targetPath))
	}

	return restored, nil
}

func mergeAttachmentURLs(original []string, restored []string) []string {
	merged := make([]string, 0, len(original)+len(restored))
	seen := make(map[string]struct{}, len(original)+len(restored))

	for _, item := range original {
		if _, ok := seen[item]; ok {
			continue
		}
		seen[item] = struct{}{}
		merged = append(merged, item)
	}
	for _, item := range restored {
		if _, ok := seen[item]; ok {
			continue
		}
		seen[item] = struct{}{}
		merged = append(merged, item)
	}

	return merged
}

func filterRemoteAttachmentURLs(items []string) []string {
	filtered := make([]string, 0, len(items))
	for _, item := range items {
		if isLocalAttachmentURL(item) {
			continue
		}
		filtered = append(filtered, item)
	}
	return filtered
}

var (
	exportNameSanitizer = regexp.MustCompile(`[^a-z0-9\-]+`)
	exportNameSpaces    = regexp.MustCompile(`\s+`)
	attachmentNameSanitizer = regexp.MustCompile(`[^a-zA-Z0-9._-]+`)
)

func sanitizeExportName(name string) string {
	normalized := exportNameSpaces.ReplaceAllString(strings.ToLower(name), "-")
	normalized = exportNameSanitizer.ReplaceAllString(normalized, "-")
	normalized = strings.Trim(normalized, "-")
	if normalized == "" {
		return "game"
	}
	return normalized
}

func sanitizeAttachmentName(name string) string {
	sanitized := attachmentNameSanitizer.ReplaceAllString(filepath.Base(name), "-")
	sanitized = strings.Trim(sanitized, "-")
	if sanitized == "" {
		return "attachment.bin"
	}
	return sanitized
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
func (s *Service) JoinGame(gameID uint, teamID uint, userID uint, invitationCode string) error {
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
	if normalizeInvitationCode(game.InvitationCode) != "" && normalizeInvitationCode(invitationCode) != normalizeInvitationCode(game.InvitationCode) {
		return errors.New("invalid game invitation code")
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

	defaultDivision := ""
	divisions := decodeDivisions(game.Divisions)
	if len(divisions) == 1 {
		defaultDivision = divisions[0]
	}

	part := &models.Participation{
		GameID: gameID,
		TeamID: teamID,
		UserID: userID,
		Status: status,
		Division: defaultDivision,
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
				HasTeam:          false,
				Participated:     false,
				WriteupRequired:  game.WriteupRequired,
				WriteupDeadline:  game.WriteupDeadline,
				WriteupDeadlinePassed: game.WriteupDeadline != nil && time.Now().After(*game.WriteupDeadline),
			}, nil
		}
		return nil, err
	}

	var team models.Team
	if err := s.db.First(&team, member.TeamID).Error; err != nil {
		return nil, err
	}

	response := &GameParticipationResponse{
		HasTeam:              true,
		Divisions:            decodeDivisions(game.Divisions),
		WriteupRequired:      game.WriteupRequired,
		WriteupDeadline:      game.WriteupDeadline,
		WriteupDeadlinePassed: game.WriteupDeadline != nil && time.Now().After(*game.WriteupDeadline),
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
	response.Division = participation.Division

	var writeup models.GameWriteup
	if err := s.db.Where("game_id = ? AND team_id = ?", gameID, team.ID).First(&writeup).Error; err == nil {
		response.WriteupSubmitted = true
		response.WriteupStatus = string(writeup.Status)
	}
	if response.WriteupRequired && response.Status == string(models.ParticipationAccepted) && response.WriteupDeadlinePassed && !response.WriteupSubmitted {
		response.MissingWriteup = true
	}

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
		ChallengeID      uint
		ScoreOverride    int
		Title            string
		Description      string
		Category         string
		Type             string
		Difficulty       string
		Hints            string
		Attachments      string
		ContainerSpec    string
		BaseScore        int
		IsVisible        bool
		BloodTeam        string
		SecondBloodTeam  string
		ThirdBloodTeam   string
	}

	query := s.db.Table("game_challenges").
		Select("game_challenges.challenge_id, game_challenges.score_override, "+
			"challenges.title, challenges.description, challenges.category, challenges.type, challenges.difficulty, "+
			"challenges.hints, challenges.attachments, challenges.container_spec, "+
			"challenges.base_score, challenges.is_visible, "+
			"COALESCE(MAX(CASE WHEN solves.blood_type = 'first' THEN teams.name END), '') as blood_team, "+
			"COALESCE(MAX(CASE WHEN solves.blood_type = 'second' THEN teams.name END), '') as second_blood_team, "+
			"COALESCE(MAX(CASE WHEN solves.blood_type = 'third' THEN teams.name END), '') as third_blood_team").
		Joins("JOIN challenges ON challenges.id = game_challenges.challenge_id").
		Joins("LEFT JOIN solves ON solves.challenge_id = game_challenges.challenge_id AND solves.game_id = game_challenges.game_id").
		Joins("LEFT JOIN teams ON teams.id = solves.team_id").
		Where("game_challenges.game_id = ?", gameID)
	if !includeHidden {
		query = query.Where("challenges.is_visible = ?", true)
	}
	query = query.Group("game_challenges.challenge_id, game_challenges.score_override, challenges.title, challenges.description, challenges.category, challenges.type, challenges.difficulty, challenges.hints, challenges.attachments, challenges.container_spec, challenges.base_score, challenges.is_visible")

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
			ID:              r.ChallengeID,
			Title:           r.Title,
			Description:     r.Description,
			Category:        r.Category,
			Type:            r.Type,
			Difficulty:      r.Difficulty,
			Hints:           r.Hints,
			Attachments:     r.Attachments,
			ContainerSpec:   r.ContainerSpec,
			Score:           score,
			SolveCount:      countMap[r.ChallengeID],
			BloodTeam:       r.BloodTeam,
			SecondBloodTeam: r.SecondBloodTeam,
			ThirdBloodTeam:  r.ThirdBloodTeam,
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
	if err := s.db.Where("game_id = ? AND team_id = ? AND is_practice = ?", gameID, teamID, false).Find(&solves).Error; err != nil {
		return nil, err
	}

	solvedMap := make(map[uint]models.Solve, len(solves))
	for _, solve := range solves {
		solvedMap[solve.ChallengeID] = solve
	}

	for i := range challenges {
		if _, ok := solvedMap[challenges[i].ID]; ok {
			challenges[i].Solved = true
		}
	}

	return challenges, nil
}

func (s *Service) GetChallengeInstance(gameID uint, challengeID uint, userID uint) (*ChallengeInstanceResponse, error) {
	_, _, participation, _, err := s.getAcceptedParticipationForUser(gameID, userID)
	if err != nil {
		return nil, err
	}
	_, spec, err := s.loadManagedInstanceChallenge(gameID, challengeID)
	if err != nil {
		return nil, err
	}

	var lease models.GameInstanceLease
	if err := s.db.Where("game_id = ? AND challenge_id = ? AND team_id = ?", gameID, challengeID, participation.TeamID).First(&lease).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return buildInstanceResponse(gameID, challengeID, participation.TeamID, nil, spec), nil
		}
		return nil, err
	}

	return buildInstanceResponse(gameID, challengeID, participation.TeamID, &lease, spec), nil
}

func (s *Service) EnsureChallengeInstance(gameID uint, challengeID uint, userID uint) (*ChallengeInstanceResponse, error) {
	_, _, participation, _, err := s.getAcceptedParticipationForUser(gameID, userID)
	if err != nil {
		return nil, err
	}
	_, spec, err := s.loadManagedInstanceChallenge(gameID, challengeID)
	if err != nil {
		return nil, err
	}

	now := time.Now()

	var lease models.GameInstanceLease
	findErr := s.db.Where("game_id = ? AND challenge_id = ? AND team_id = ?", gameID, challengeID, participation.TeamID).First(&lease).Error
	if findErr != nil && !errors.Is(findErr, gorm.ErrRecordNotFound) {
		return nil, findErr
	}

	var existingLease *models.GameInstanceLease
	if !errors.Is(findErr, gorm.ErrRecordNotFound) {
		existingLease = &lease
	}
	provider := resolveChallengeInstanceProvider(s.instanceProviders, spec.Provider)
	leaseState, err := provider.EnsureLease(ChallengeInstanceProviderRequest{
		GameID:        gameID,
		ChallengeID:   challengeID,
		TeamID:        participation.TeamID,
		UserID:        userID,
		Now:           now,
		LeaseDuration: instanceLeaseDuration,
		Runtime:       toChallengeInstanceRuntimeSpec(spec),
		Existing:      existingLease,
	})
	if err != nil {
		return nil, err
	}

	if errors.Is(findErr, gorm.ErrRecordNotFound) {
		lease = models.GameInstanceLease{
			GameID:        gameID,
			ChallengeID:   challengeID,
			TeamID:        participation.TeamID,
		}
		applyLeaseState(&lease, leaseState, userID)
		if err := s.db.Create(&lease).Error; err != nil {
			return nil, err
		}
	} else {
		applyLeaseState(&lease, leaseState, userID)
		if err := s.db.Save(&lease).Error; err != nil {
			return nil, err
		}
	}

	return buildInstanceResponse(gameID, challengeID, participation.TeamID, &lease, spec), nil
}

func (s *Service) DestroyChallengeInstance(gameID uint, challengeID uint, userID uint) (*ChallengeInstanceResponse, error) {
	_, _, participation, _, err := s.getAcceptedParticipationForUser(gameID, userID)
	if err != nil {
		return nil, err
	}
	_, spec, err := s.loadManagedInstanceChallenge(gameID, challengeID)
	if err != nil {
		return nil, err
	}

	result := buildInstanceResponse(gameID, challengeID, participation.TeamID, nil, spec)

	var lease models.GameInstanceLease
	if err := s.db.Where("game_id = ? AND challenge_id = ? AND team_id = ?", gameID, challengeID, participation.TeamID).First(&lease).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			result.Message = "当前没有运行中的实例。"
			return result, nil
		}
		return nil, err
	}

	if err := s.db.Delete(&lease).Error; err != nil {
		return nil, err
	}

	result.Message = "当前队伍实例已销毁。"
	return result, nil
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
	isPractice := false
	if time.Now().After(game.EndTime) {
		if game.PracticeMode {
			isPractice = true
		} else {
			return nil, errors.New("game has already ended")
		}
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
		_ = s.recordSubmission(gameID, challengeID, userID, teamID, flag, models.GameSubmissionWrongFlag, "wrong flag", false, isPractice, 0, "")
		return &SubmitResult{Correct: false, Message: "wrong flag"}, nil
	}

	// Idempotent: already solved?
	var existing models.Solve
	err := s.db.Where("challenge_id = ? AND team_id = ? AND game_id = ? AND is_practice = ?", challengeID, teamID, gameID, isPractice).
		First(&existing).Error
	if err == nil {
		_ = s.recordSubmission(gameID, challengeID, userID, teamID, flag, models.GameSubmissionAlreadySolved, "already solved", true, isPractice, existing.Score, existing.BloodType)
		return &SubmitResult{Correct: true, Score: existing.Score, IsPractice: isPractice, Message: "already solved"}, nil
	}

	var (
		solvesBefore int64
		bloodType   string
		score       int
	)
	if !isPractice {
		s.db.Model(&models.Solve{}).Where("challenge_id = ? AND game_id = ? AND is_practice = ?", challengeID, gameID, false).Count(&solvesBefore)
		bloodType = scoring.BloodType(int(solvesBefore))
		score = scoring.ComputeScore(ch, int(solvesBefore))
	}

	solve := &models.Solve{
		ChallengeID: challengeID,
		UserID:      userID,
		TeamID:      teamID,
		GameID:      gameID,
		IsPractice:  isPractice,
		Score:       score,
		BloodType:   bloodType,
		SolvedAt:    time.Now(),
	}
	if err := s.db.Create(solve).Error; err != nil {
		return nil, err
	}

	message := "correct"
	if isPractice {
		message = "practice solved"
	}
	_ = s.recordSubmission(gameID, challengeID, userID, teamID, flag, models.GameSubmissionAccepted, message, true, isPractice, score, bloodType)

	return &SubmitResult{Correct: true, Score: score, BloodType: bloodType, IsPractice: isPractice, Message: message}, nil
}

func (s *Service) recordSubmission(gameID uint, challengeID uint, userID uint, teamID uint, submittedFlag string, result models.GameSubmissionResult, message string, isCorrect bool, isPractice bool, score int, bloodType string) error {
	return s.db.Create(&models.GameSubmission{
		GameID:        gameID,
		ChallengeID:   challengeID,
		UserID:        userID,
		TeamID:        teamID,
		SubmittedFlag: strings.TrimSpace(submittedFlag),
		Result:        result,
		Message:       message,
		IsCorrect:     isCorrect,
		IsPractice:    isPractice,
		Score:         score,
		BloodType:     bloodType,
		SubmittedAt:   time.Now(),
	}).Error
}

// GetScoreboard aggregates solve data into a ranked scoreboard.
func (s *Service) GetScoreboard(gameID uint, division string) (*ScoreboardResponse, error) {
	var game models.Game
	if err := s.db.First(&game, gameID).Error; err != nil {
		return nil, errors.New("game not found")
	}
	divisions := decodeDivisions(game.Divisions)
	normalizedDivision, err := normalizeParticipationDivision(divisions, division)
	if err != nil {
		return nil, err
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
		Select("participations.team_id, teams.name as team_name, participations.division").
		Joins("JOIN teams ON teams.id = participations.team_id").
		Where("participations.game_id = ? AND participations.status = ?", gameID, models.ParticipationAccepted).
		Where("(? = '' OR participations.division = ?)", normalizedDivision, normalizedDivision).
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
		Joins("JOIN participations ON participations.team_id = solves.team_id AND participations.game_id = solves.game_id").
		Where("solves.game_id = ? AND solves.is_practice = ? AND participations.status = ?", gameID, false, models.ParticipationAccepted).
		Where("(? = '' OR participations.division = ?)", normalizedDivision, normalizedDivision)

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
		ID              uint
		Title           string
		Category        string
		BaseScore       int
		ScoreOverride   int
		SolvedCount     int
		BloodTeam       string
		SecondBloodTeam string
		ThirdBloodTeam  string
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
			COALESCE(MAX(CASE WHEN solves.blood_type = 'first' THEN teams.name END), '') as blood_team,
			COALESCE(MAX(CASE WHEN solves.blood_type = 'second' THEN teams.name END), '') as second_blood_team,
			COALESCE(MAX(CASE WHEN solves.blood_type = 'third' THEN teams.name END), '') as third_blood_team
		`).
		Joins("JOIN challenges ON challenges.id = game_challenges.challenge_id").
		Joins("LEFT JOIN solves ON solves.challenge_id = game_challenges.challenge_id AND solves.game_id = game_challenges.game_id AND solves.is_practice = false").
		Joins("LEFT JOIN participations ON participations.team_id = solves.team_id AND participations.game_id = solves.game_id").
		Joins("LEFT JOIN teams ON teams.id = solves.team_id").
		Where("game_challenges.game_id = ? AND challenges.is_visible = ?", gameID, true).
		Where("(solves.id IS NULL OR participations.status = ?)", models.ParticipationAccepted).
		Where("(? = '' OR solves.id IS NULL OR participations.division = ?)", normalizedDivision, normalizedDivision)
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
			ID:              row.ID,
			Title:           row.Title,
			Category:        row.Category,
			Score:           score,
			SolvedCount:     row.SolvedCount,
			BloodTeam:       row.BloodTeam,
			SecondBloodTeam: row.SecondBloodTeam,
			ThirdBloodTeam:  row.ThirdBloodTeam,
		})
	}

	return &ScoreboardResponse{
		GameID:     gameID,
		Division:   normalizedDivision,
		Divisions:  divisions,
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
		Division   string
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
			participations.division,
			participations.created_at as joined_at,
			COALESCE(SUM(solves.score), 0) as score,
			COUNT(solves.id) as solve_count
		`).
		Joins("JOIN teams ON teams.id = participations.team_id").
		Joins("LEFT JOIN solves ON solves.team_id = participations.team_id AND solves.game_id = participations.game_id AND solves.is_practice = false").
		Where("participations.game_id = ?", gameID).
		Group("participations.team_id, teams.name, participations.status, participations.division, participations.created_at").
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
			Division:   row.Division,
			JoinedAt:   row.JoinedAt,
			Score:      row.Score,
			SolveCount: row.SolveCount,
		})
	}

	return result, nil
}

func normalizeSubmissionType(submissionType string) (string, error) {
	switch strings.TrimSpace(strings.ToLower(submissionType)) {
	case "", "all":
		return "", nil
	case string(models.GameSubmissionAccepted):
		return string(models.GameSubmissionAccepted), nil
	case string(models.GameSubmissionWrongFlag):
		return string(models.GameSubmissionWrongFlag), nil
	case string(models.GameSubmissionAlreadySolved):
		return string(models.GameSubmissionAlreadySolved), nil
	case string(models.GameSubmissionRejected):
		return string(models.GameSubmissionRejected), nil
	default:
		return "", errors.New("invalid submission type")
	}
}

func normalizeSubmissionLimit(limit int) int {
	if limit <= 0 {
		return 100
	}
	if limit > 500 {
		return 500
	}
	return limit
}

func normalizeAnnouncementContent(content string) (string, error) {
	content = strings.TrimSpace(content)
	if content == "" {
		return "", errors.New("announcement content is required")
	}
	return content, nil
}

func parseSubmissionAggregateTime(value string) (time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}, errors.New("invalid aggregate submission time")
	}

	for _, layout := range []string{
		time.RFC3339Nano,
		"2006-01-02 15:04:05.999999999Z07:00",
		"2006-01-02 15:04:05.999999999-07:00",
		"2006-01-02 15:04:05Z07:00",
		"2006-01-02 15:04:05-07:00",
		"2006-01-02 15:04:05",
	} {
		parsed, err := time.Parse(layout, value)
		if err == nil {
			return parsed, nil
		}
	}

	return time.Time{}, fmt.Errorf("invalid aggregate submission time: %s", value)
}

func (s *Service) ListSubmissionRecords(gameID uint, submissionType string, limit int) ([]GameSubmissionRecord, error) {
	var game models.Game
	if err := s.db.First(&game, gameID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("game not found")
		}
		return nil, err
	}
	normalizedType, err := normalizeSubmissionType(submissionType)
	if err != nil {
		return nil, err
	}

	type submissionRow struct {
		ID             uint
		GameID         uint
		ChallengeID    uint
		ChallengeTitle string
		Category       string
		UserID         uint
		Username       string
		TeamID         uint
		TeamName       string
		SubmittedFlag  string
		Result         string
		Message        string
		IsCorrect      bool
		IsPractice     bool
		Score          int
		BloodType      string
		SubmittedAt    time.Time
	}

	var rows []submissionRow
	query := s.db.Table("game_submissions").
		Select(`
			game_submissions.id,
			game_submissions.game_id,
			game_submissions.challenge_id,
			challenges.title as challenge_title,
			challenges.category,
			game_submissions.user_id,
			users.username,
			game_submissions.team_id,
			teams.name as team_name,
			game_submissions.submitted_flag,
			game_submissions.result,
			game_submissions.message,
			game_submissions.is_correct,
			game_submissions.is_practice,
			game_submissions.score,
			game_submissions.blood_type,
			game_submissions.submitted_at
		`).
		Joins("JOIN challenges ON challenges.id = game_submissions.challenge_id").
		Joins("JOIN users ON users.id = game_submissions.user_id").
		Joins("JOIN teams ON teams.id = game_submissions.team_id").
		Where("game_submissions.game_id = ?", gameID).
		Order("game_submissions.submitted_at DESC, game_submissions.id DESC")
	if normalizedType != "" {
		query = query.Where("game_submissions.result = ?", normalizedType)
	}
	query = query.Limit(normalizeSubmissionLimit(limit))
	if err := query.Scan(&rows).Error; err != nil {
		return nil, err
	}

	result := make([]GameSubmissionRecord, 0, len(rows))
	for _, row := range rows {
		result = append(result, GameSubmissionRecord{
			ID:             row.ID,
			GameID:         row.GameID,
			ChallengeID:    row.ChallengeID,
			ChallengeTitle: row.ChallengeTitle,
			Category:       row.Category,
			UserID:         row.UserID,
			Username:       row.Username,
			TeamID:         row.TeamID,
			TeamName:       row.TeamName,
			SubmittedFlag:  row.SubmittedFlag,
			Result:         row.Result,
			Message:        row.Message,
			IsCorrect:      row.IsCorrect,
			IsPractice:     row.IsPractice,
			Score:          row.Score,
			BloodType:      row.BloodType,
			SubmittedAt:    row.SubmittedAt,
		})
	}

	return result, nil
}

func (s *Service) ListSubmissionCheatClues(gameID uint, limit int) ([]GameSubmissionCheatClue, error) {
	var game models.Game
	if err := s.db.First(&game, gameID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("game not found")
		}
		return nil, err
	}

	type clueRow struct {
		SubmittedFlag   string
		ChallengeID     uint
		ChallengeTitle  string
		FirstSeenAt     string
		LastSeenAt      string
		TeamCount       int
		SubmissionCount int
	}

	var rows []clueRow
	if err := s.db.Table("game_submissions").
		Select(`
			game_submissions.submitted_flag,
			game_submissions.challenge_id,
			challenges.title as challenge_title,
			MIN(game_submissions.submitted_at) as first_seen_at,
			MAX(game_submissions.submitted_at) as last_seen_at,
			COUNT(DISTINCT game_submissions.team_id) as team_count,
			COUNT(game_submissions.id) as submission_count
		`).
		Joins("JOIN challenges ON challenges.id = game_submissions.challenge_id").
		Where("game_submissions.game_id = ?", gameID).
		Where("game_submissions.result = ?", models.GameSubmissionWrongFlag).
		Where("game_submissions.is_practice = ?", false).
		Where("TRIM(game_submissions.submitted_flag) <> ''").
		Group("game_submissions.submitted_flag, game_submissions.challenge_id, challenges.title").
		Having("COUNT(DISTINCT game_submissions.team_id) >= 2").
		Order("team_count DESC, submission_count DESC, last_seen_at DESC").
		Limit(normalizeSubmissionLimit(limit)).
		Scan(&rows).Error; err != nil {
		return nil, err
	}

	result := make([]GameSubmissionCheatClue, 0, len(rows))
	for _, row := range rows {
		firstSeenAt, err := parseSubmissionAggregateTime(row.FirstSeenAt)
		if err != nil {
			return nil, err
		}
		lastSeenAt, err := parseSubmissionAggregateTime(row.LastSeenAt)
		if err != nil {
			return nil, err
		}

		var teams []string
		if err := s.db.Table("game_submissions").
			Select("DISTINCT teams.name").
			Joins("JOIN teams ON teams.id = game_submissions.team_id").
			Where("game_submissions.game_id = ?", gameID).
			Where("game_submissions.challenge_id = ?", row.ChallengeID).
			Where("game_submissions.submitted_flag = ?", row.SubmittedFlag).
			Where("game_submissions.result = ?", models.GameSubmissionWrongFlag).
			Order("teams.name ASC").
			Pluck("teams.name", &teams).Error; err != nil {
			return nil, err
		}

		result = append(result, GameSubmissionCheatClue{
			SubmittedFlag:   row.SubmittedFlag,
			ChallengeID:     row.ChallengeID,
			ChallengeTitle:  row.ChallengeTitle,
			FirstSeenAt:     firstSeenAt,
			LastSeenAt:      lastSeenAt,
			TeamCount:       row.TeamCount,
			SubmissionCount: row.SubmissionCount,
			Teams:           teams,
		})
	}

	return result, nil
}

func (s *Service) UpdateParticipationStatus(gameID uint, teamID uint, status string, division *string) (*GameParticipantEntry, error) {
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
	if division != nil {
		normalizedDivision, err := normalizeParticipationDivision(decodeDivisions(game.Divisions), *division)
		if err != nil {
			return nil, err
		}
		if err := s.db.Model(&participation).Update("division", normalizedDivision).Error; err != nil {
			return nil, err
		}
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

func normalizeWriteupStatus(status string) (models.WriteupStatus, error) {
	switch models.WriteupStatus(status) {
	case models.WriteupStatusSubmitted, models.WriteupStatusApproved, models.WriteupStatusRejected:
		return models.WriteupStatus(status), nil
	default:
		return "", errors.New("invalid writeup status")
	}
}

func (s *Service) GetWriteup(gameID uint, userID uint) (*GameWriteupResponse, error) {
	var game models.Game
	if err := s.db.First(&game, gameID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("game not found")
		}
		return nil, err
	}

	participation, err := s.GetParticipationStatus(gameID, userID)
	if err != nil {
		return nil, err
	}
	if !participation.HasTeam || participation.Team == nil {
		return nil, errors.New("team not found")
	}

	var writeup models.GameWriteup
	if err := s.db.Where("game_id = ? AND team_id = ?", gameID, participation.Team.ID).First(&writeup).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return &GameWriteupResponse{
				GameID:    gameID,
				TeamID:    participation.Team.ID,
				TeamName:  participation.Team.Name,
				CanSubmit: game.WriteupRequired && participation.Status == string(models.ParticipationAccepted),
			}, nil
		}
		return nil, err
	}

	return toWriteupResponse(&writeup, participation.Team.Name, game.WriteupRequired && participation.Status == string(models.ParticipationAccepted)), nil
}

func (s *Service) SubmitWriteup(gameID uint, userID uint, req SubmitGameWriteupRequest) (*GameWriteupResponse, error) {
	var game models.Game
	if err := s.db.First(&game, gameID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("game not found")
		}
		return nil, err
	}
	if !game.WriteupRequired {
		return nil, errors.New("writeup is not required for this game")
	}
	if game.WriteupDeadline != nil && time.Now().After(*game.WriteupDeadline) {
		return nil, errors.New("writeup deadline has passed")
	}

	participation, err := s.GetParticipationStatus(gameID, userID)
	if err != nil {
		return nil, err
	}
	if !participation.HasTeam || participation.Team == nil {
		return nil, errors.New("team not found")
	}
	if !participation.Participated || participation.Status != string(models.ParticipationAccepted) {
		return nil, errors.New("team is not approved for this game yet")
	}

	content := strings.TrimSpace(req.Content)
	if content == "" {
		return nil, errors.New("writeup content is required")
	}

	var writeup models.GameWriteup
	err = s.db.Where("game_id = ? AND team_id = ?", gameID, participation.Team.ID).First(&writeup).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	now := time.Now()
	if errors.Is(err, gorm.ErrRecordNotFound) {
		writeup = models.GameWriteup{
			GameID:      gameID,
			TeamID:      participation.Team.ID,
			SubmittedBy: userID,
			Content:     content,
			Status:      models.WriteupStatusSubmitted,
			SubmittedAt: now,
		}
		if err := s.db.Create(&writeup).Error; err != nil {
			return nil, err
		}
		return toWriteupResponse(&writeup, participation.Team.Name, true), nil
	}

	updates := map[string]any{
		"content":       content,
		"submitted_by":  userID,
		"status":        models.WriteupStatusSubmitted,
		"reviewer_id":   nil,
		"review_remark": "",
		"reviewed_at":   nil,
		"submitted_at":  now,
	}
	if err := s.db.Model(&writeup).Updates(updates).Error; err != nil {
		return nil, err
	}
	writeup.Content = content
	writeup.SubmittedBy = userID
	writeup.Status = models.WriteupStatusSubmitted
	writeup.ReviewerID = nil
	writeup.ReviewRemark = ""
	writeup.ReviewedAt = nil
	writeup.SubmittedAt = now
	return toWriteupResponse(&writeup, participation.Team.Name, true), nil
}

func (s *Service) ListWriteups(gameID uint) ([]GameWriteupResponse, error) {
	var game models.Game
	if err := s.db.First(&game, gameID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("game not found")
		}
		return nil, err
	}

	var rows []models.GameWriteup
	if err := s.db.
		Preload("Team").
		Where("game_id = ?", gameID).
		Order("submitted_at DESC").
		Find(&rows).Error; err != nil {
		return nil, err
	}

	result := make([]GameWriteupResponse, 0, len(rows))
	for _, row := range rows {
		item := row
		result = append(result, *toWriteupResponse(&item, row.Team.Name, game.WriteupRequired))
	}
	return result, nil
}

func (s *Service) ReviewWriteup(gameID uint, teamID uint, reviewerID uint, req ReviewGameWriteupRequest) (*GameWriteupResponse, error) {
	status, err := normalizeWriteupStatus(req.Status)
	if err != nil {
		return nil, err
	}
	if status == models.WriteupStatusSubmitted {
		return nil, errors.New("invalid writeup status")
	}

	var game models.Game
	if err := s.db.First(&game, gameID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("game not found")
		}
		return nil, err
	}

	var writeup models.GameWriteup
	if err := s.db.Where("game_id = ? AND team_id = ?", gameID, teamID).First(&writeup).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("writeup not found")
		}
		return nil, err
	}

	var team models.Team
	if err := s.db.First(&team, teamID).Error; err != nil {
		return nil, err
	}

	now := time.Now()
	if err := s.db.Model(&writeup).Updates(map[string]any{
		"status":        status,
		"reviewer_id":   reviewerID,
		"review_remark": strings.TrimSpace(req.Remark),
		"reviewed_at":   now,
	}).Error; err != nil {
		return nil, err
	}
	writeup.Status = status
	writeup.ReviewerID = &reviewerID
	writeup.ReviewRemark = strings.TrimSpace(req.Remark)
	writeup.ReviewedAt = &now

	return toWriteupResponse(&writeup, team.Name, game.WriteupRequired), nil
}

func toResponse(g *models.Game) *GameResponse {
	return &GameResponse{
		ID:                 g.ID,
		Name:               g.Name,
		Description:        g.Description,
		Notice:             g.Notice,
		InvitationCode:     normalizeInvitationCode(g.InvitationCode),
		InvitationRequired: normalizeInvitationCode(g.InvitationCode) != "",
		Divisions:          decodeDivisions(g.Divisions),
		StartTime:          g.StartTime,
		EndTime:            g.EndTime,
		ScoreboardFreezeAt: g.ScoreboardFreezeAt,
		Status:             effectiveGameStatus(g),
		RegistrationMode:   g.RegistrationMode,
		MaxTeamMembers:     g.MaxTeamMembers,
		PracticeMode:       g.PracticeMode,
		WriteupRequired:    g.WriteupRequired,
		WriteupDeadline:    g.WriteupDeadline,
		IsPublic:           g.IsPublic,
		CreatedBy:          g.CreatedBy,
		CreatedAt:          g.CreatedAt,
	}
}

func toWriteupResponse(writeup *models.GameWriteup, teamName string, canSubmit bool) *GameWriteupResponse {
	return &GameWriteupResponse{
		GameID:       writeup.GameID,
		TeamID:       writeup.TeamID,
		TeamName:     teamName,
		SubmittedBy:  writeup.SubmittedBy,
		Content:      writeup.Content,
		Status:       string(writeup.Status),
		ReviewerID:   writeup.ReviewerID,
		ReviewRemark: writeup.ReviewRemark,
		SubmittedAt:  writeup.SubmittedAt,
		ReviewedAt:   writeup.ReviewedAt,
		CanSubmit:    canSubmit,
	}
}

func buildScoreboardEntriesCSV(entries []ScoreboardEntry) ([]byte, error) {
	var buffer bytes.Buffer
	writer := csv.NewWriter(&buffer)

	if err := writer.Write([]string{"rank", "team_id", "team_name", "score", "solve_count", "last_solve"}); err != nil {
		return nil, err
	}

	for _, entry := range entries {
		lastSolve := ""
		if !entry.LastSolve.IsZero() {
			lastSolve = entry.LastSolve.UTC().Format(time.RFC3339)
		}

		if err := writer.Write([]string{
			fmt.Sprintf("%d", entry.Rank),
			fmt.Sprintf("%d", entry.TeamID),
			entry.TeamName,
			fmt.Sprintf("%d", entry.Score),
			fmt.Sprintf("%d", entry.SolveCount),
			lastSolve,
		}); err != nil {
			return nil, err
		}
	}

	writer.Flush()
	if err := writer.Error(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func buildScoreboardChallengesCSV(challenges []ScoreboardChallengeStat) ([]byte, error) {
	var buffer bytes.Buffer
	writer := csv.NewWriter(&buffer)

	if err := writer.Write([]string{"challenge_id", "title", "category", "score", "solved_count", "first_blood_team", "second_blood_team", "third_blood_team"}); err != nil {
		return nil, err
	}

	for _, challenge := range challenges {
		if err := writer.Write([]string{
			fmt.Sprintf("%d", challenge.ID),
			challenge.Title,
			challenge.Category,
			fmt.Sprintf("%d", challenge.Score),
			fmt.Sprintf("%d", challenge.SolvedCount),
			challenge.BloodTeam,
			challenge.SecondBloodTeam,
			challenge.ThirdBloodTeam,
		}); err != nil {
			return nil, err
		}
	}

	writer.Flush()
	if err := writer.Error(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func buildWriteupsCSV(writeups []GameWriteupResponse) ([]byte, error) {
	var buffer bytes.Buffer
	writer := csv.NewWriter(&buffer)

	if err := writer.Write([]string{"game_id", "team_id", "team_name", "submitted_by", "status", "review_remark", "submitted_at", "reviewed_at", "can_submit"}); err != nil {
		return nil, err
	}

	for _, writeup := range writeups {
		reviewedAt := ""
		if writeup.ReviewedAt != nil {
			reviewedAt = writeup.ReviewedAt.UTC().Format(time.RFC3339)
		}

		if err := writer.Write([]string{
			fmt.Sprintf("%d", writeup.GameID),
			fmt.Sprintf("%d", writeup.TeamID),
			writeup.TeamName,
			fmt.Sprintf("%d", writeup.SubmittedBy),
			writeup.Status,
			writeup.ReviewRemark,
			writeup.SubmittedAt.UTC().Format(time.RFC3339),
			reviewedAt,
			fmt.Sprintf("%t", writeup.CanSubmit),
		}); err != nil {
			return nil, err
		}
	}

	writer.Flush()
	if err := writer.Error(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func buildSubmissionsCSV(submissions []GameSubmissionRecord) ([]byte, error) {
	var buffer bytes.Buffer
	writer := csv.NewWriter(&buffer)

	if err := writer.Write([]string{"id", "game_id", "challenge_id", "challenge_title", "category", "user_id", "username", "team_id", "team_name", "submitted_flag", "result", "message", "is_correct", "is_practice", "score", "blood_type", "submitted_at"}); err != nil {
		return nil, err
	}

	for _, submission := range submissions {
		if err := writer.Write([]string{
			fmt.Sprintf("%d", submission.ID),
			fmt.Sprintf("%d", submission.GameID),
			fmt.Sprintf("%d", submission.ChallengeID),
			submission.ChallengeTitle,
			submission.Category,
			fmt.Sprintf("%d", submission.UserID),
			submission.Username,
			fmt.Sprintf("%d", submission.TeamID),
			submission.TeamName,
			submission.SubmittedFlag,
			submission.Result,
			submission.Message,
			fmt.Sprintf("%t", submission.IsCorrect),
			fmt.Sprintf("%t", submission.IsPractice),
			fmt.Sprintf("%d", submission.Score),
			submission.BloodType,
			submission.SubmittedAt.UTC().Format(time.RFC3339),
		}); err != nil {
			return nil, err
		}
	}

	writer.Flush()
	if err := writer.Error(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}
