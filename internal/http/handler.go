package http

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/saurlax/sauryctf/internal/audit"
	"github.com/saurlax/sauryctf/internal/auth"
	"github.com/saurlax/sauryctf/internal/challenges"
	"github.com/saurlax/sauryctf/internal/games"
	"github.com/saurlax/sauryctf/internal/models"
	"github.com/saurlax/sauryctf/internal/rbac"
	"github.com/saurlax/sauryctf/internal/teams"
)

func requireAdminForExpandedGameAccess(c *gin.Context) bool {
	if c.Query("all") != "true" {
		return true
	}
	rbac.RequireRole(models.RoleAdmin, models.RoleSuperAdmin)(c)
	return !c.IsAborted()
}

// Handler 聚合所有子模块 handler，实现 ServerInterface。
type Handler struct {
	audit      *audit.Handler
	auth       *auth.Handler
	teams      *teams.Handler
	challenges *challenges.Handler
	games      *games.Handler
}

func NewHandler(
	auditH *audit.Handler,
	authH *auth.Handler,
	teamsH *teams.Handler,
	challengesH *challenges.Handler,
	gamesH *games.Handler,
) *Handler {
	return &Handler{
		audit:      auditH,
		auth:       authH,
		teams:      teamsH,
		challenges: challengesH,
		games:      gamesH,
	}
}

// ── Health ──────────────────────────────────────────────────────────────────

func (h *Handler) Healthz(c *gin.Context) {
	c.JSON(http.StatusOK, HealthResponse{
		Status:  "ok",
		Version: "0.1.0",
	})
}

// ── Auth ────────────────────────────────────────────────────────────────────

func (h *Handler) Register(c *gin.Context) { h.auth.Register(c) }
func (h *Handler) Login(c *gin.Context)    { h.auth.Login(c) }
func (h *Handler) Logout(c *gin.Context)   { h.auth.Logout(c) }
func (h *Handler) GetMe(c *gin.Context)    { h.auth.GetMe(c) }
func (h *Handler) ChangePassword(c *gin.Context) {
	h.auth.ChangePassword(c)
}
func (h *Handler) ListAdminUsers(c *gin.Context) {
	h.auth.ListUsers(c)
}
func (h *Handler) UpdateAdminUser(c *gin.Context, userId int) {
	h.auth.UpdateUserAccount(c, userId)
}
func (h *Handler) ListAdminAuditLogs(c *gin.Context, params ListAdminAuditLogsParams) {
	h.audit.ListLogsWithFilters(c, params.ActorUserId, valueOrEmpty(params.TargetType), intValueToString(params.Limit))
}
func (h *Handler) GetAuthSetupStatus(c *gin.Context) {
	h.auth.SetupStatus(c)
}

func valueOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func intValueToString(value *int) string {
	if value == nil {
		return ""
	}
	return fmt.Sprintf("%d", *value)
}

// ── Teams ───────────────────────────────────────────────────────────────────

func (h *Handler) CreateTeam(c *gin.Context) { h.teams.CreateTeam(c) }
func (h *Handler) GetMyTeam(c *gin.Context)  { h.teams.GetMyTeam(c) }
func (h *Handler) JoinTeam(c *gin.Context)   { h.teams.JoinTeam(c) }
func (h *Handler) LeaveTeam(c *gin.Context)  { h.teams.LeaveTeam(c) }
func (h *Handler) TransferTeamCaptain(c *gin.Context, teamId int) {
	h.teams.TransferTeamCaptain(c, teamId)
}
func (h *Handler) ResetTeamInviteCode(c *gin.Context, teamId int) {
	h.teams.ResetTeamInviteCode(c, teamId)
}
func (h *Handler) RemoveTeamMember(c *gin.Context, teamId int, memberId int) {
	h.teams.RemoveTeamMember(c, teamId, memberId)
}

// ── Challenges ──────────────────────────────────────────────────────────────

func (h *Handler) ListChallenges(c *gin.Context, params ListChallengesParams) {
	category := ""
	if params.Category != nil {
		category = *params.Category
	}
	showHidden := false
	if params.ShowHidden != nil {
		showHidden = *params.ShowHidden
	}
	h.challenges.ListChallenges(c, category, showHidden)
}

func (h *Handler) CreateChallenge(c *gin.Context) {
	rbac.RequireRole(models.RoleAdmin, models.RoleSuperAdmin)(c)
	if c.IsAborted() {
		return
	}
	h.challenges.CreateChallenge(c)
}
func (h *Handler) UploadChallengeAttachment(c *gin.Context) {
	rbac.RequireRole(models.RoleAdmin, models.RoleSuperAdmin)(c)
	if c.IsAborted() {
		return
	}
	h.challenges.UploadAttachment(c)
}
func (h *Handler) GetChallenge(c *gin.Context, id int) {
	h.challenges.GetChallenge(c, id)
}
func (h *Handler) UpdateChallenge(c *gin.Context, id int) {
	rbac.RequireRole(models.RoleAdmin, models.RoleSuperAdmin)(c)
	if c.IsAborted() {
		return
	}
	h.challenges.UpdateChallenge(c, id)
}
func (h *Handler) DeleteChallenge(c *gin.Context, id int) {
	rbac.RequireRole(models.RoleAdmin, models.RoleSuperAdmin)(c)
	if c.IsAborted() {
		return
	}
	h.challenges.DeleteChallenge(c, id)
}
func (h *Handler) SubmitChallengeFlag(c *gin.Context, id int) {
	h.challenges.SubmitChallengeFlag(c, id)
}

// ── Games ───────────────────────────────────────────────────────────────────

func (h *Handler) ListGames(c *gin.Context, params ListGamesParams) {
	showAll := false
	if params.All != nil {
		showAll = *params.All
	}
	if showAll && !requireAdminForExpandedGameAccess(c) {
		return
	}
	h.games.ListGames(c, showAll)
}

func (h *Handler) CreateGame(c *gin.Context) {
	rbac.RequireRole(models.RoleAdmin, models.RoleSuperAdmin)(c)
	if c.IsAborted() {
		return
	}
	h.games.CreateGame(c)
}
func (h *Handler) GetGame(c *gin.Context, id int) {
	if !requireAdminForExpandedGameAccess(c) {
		return
	}
	h.games.GetGame(c, id)
}
func (h *Handler) UpdateGame(c *gin.Context, id int) {
	rbac.RequireRole(models.RoleAdmin, models.RoleSuperAdmin)(c)
	if c.IsAborted() {
		return
	}
	h.games.UpdateGame(c, id)
}
func (h *Handler) DeleteGame(c *gin.Context, id int) {
	rbac.RequireRole(models.RoleAdmin, models.RoleSuperAdmin)(c)
	if c.IsAborted() {
		return
	}
	h.games.DeleteGame(c, id)
}
func (h *Handler) DeleteAdminGame(c *gin.Context, id int) {
	h.DeleteGame(c, id)
}
func (h *Handler) ExportGamePackage(c *gin.Context, id int) {
	rbac.RequireRole(models.RoleAdmin, models.RoleSuperAdmin)(c)
	if c.IsAborted() {
		return
	}
	h.games.ExportGamePackage(c, id)
}
func (h *Handler) ExportAdminGamePackage(c *gin.Context, id int) {
	h.ExportGamePackage(c, id)
}
func (h *Handler) ImportGamePackage(c *gin.Context) {
	rbac.RequireRole(models.RoleAdmin, models.RoleSuperAdmin)(c)
	if c.IsAborted() {
		return
	}
	h.games.ImportGamePackage(c)
}
func (h *Handler) ImportAdminGamePackage(c *gin.Context) {
	h.ImportGamePackage(c)
}
func (h *Handler) GetGameChallenges(c *gin.Context, id int) {
	h.games.GetGameChallenges(c, id)
}
func (h *Handler) AddChallengeToGame(c *gin.Context, id int) {
	rbac.RequireRole(models.RoleAdmin, models.RoleSuperAdmin)(c)
	if c.IsAborted() {
		return
	}
	h.games.AddChallengeToGame(c, id)
}
func (h *Handler) RemoveChallengeFromGame(c *gin.Context, id int, challengeId int) {
	rbac.RequireRole(models.RoleAdmin, models.RoleSuperAdmin)(c)
	if c.IsAborted() {
		return
	}
	h.games.RemoveChallengeFromGame(c, id, challengeId)
}
func (h *Handler) SubmitGameFlag(c *gin.Context, id int, challengeId int) {
	h.games.SubmitGameFlag(c, id, challengeId)
}
func (h *Handler) GetChallengeInstance(c *gin.Context, id int, challengeId int) {
	h.games.GetChallengeInstance(c, id, challengeId)
}
func (h *Handler) EnsureChallengeInstance(c *gin.Context, id int, challengeId int) {
	h.games.EnsureChallengeInstance(c, id, challengeId)
}
func (h *Handler) DestroyChallengeInstance(c *gin.Context, id int, challengeId int) {
	h.games.DestroyChallengeInstance(c, id, challengeId)
}
func (h *Handler) JoinGame(c *gin.Context, id int)  { h.games.JoinGame(c, id) }
func (h *Handler) LeaveGame(c *gin.Context, id int) { h.games.LeaveGame(c, id) }
func (h *Handler) GetGameParticipation(c *gin.Context, id int) {
	h.games.GetGameParticipation(c, id)
}
func (h *Handler) GetGameWriteup(c *gin.Context, id int) {
	h.games.GetWriteup(c, id)
}
func (h *Handler) SubmitGameWriteup(c *gin.Context, id int) {
	h.games.SubmitWriteup(c, id)
}
func (h *Handler) GetScoreboard(c *gin.Context, id int, _ GetScoreboardParams) {
	h.games.GetScoreboard(c, id)
}
func (h *Handler) GetGameParticipants(c *gin.Context, id int) {
	rbac.RequireRole(models.RoleAdmin, models.RoleSuperAdmin)(c)
	if c.IsAborted() {
		return
	}
	h.games.GetParticipants(c, id)
}
func (h *Handler) GetAdminGameChallenges(c *gin.Context, id int) {
	rbac.RequireRole(models.RoleAdmin, models.RoleSuperAdmin)(c)
	if c.IsAborted() {
		return
	}
	h.games.GetAdminGameChallenges(c, id)
}
func (h *Handler) GetAdminGameInstances(c *gin.Context, id int) {
	rbac.RequireRole(models.RoleAdmin, models.RoleSuperAdmin)(c)
	if c.IsAborted() {
		return
	}
	h.games.ListInstanceLeases(c, id)
}
func (h *Handler) DeleteAdminGameInstance(c *gin.Context, id int, leaseId int) {
	rbac.RequireRole(models.RoleAdmin, models.RoleSuperAdmin)(c)
	if c.IsAborted() {
		return
	}
	h.games.DestroyInstanceLease(c, id, leaseId)
}
func (h *Handler) GetAdminGameWriteups(c *gin.Context, id int) {
	h.GetGameWriteups(c, id)
}
func (h *Handler) UpdateGameParticipant(c *gin.Context, id int, teamId int) {
	rbac.RequireRole(models.RoleAdmin, models.RoleSuperAdmin)(c)
	if c.IsAborted() {
		return
	}
	h.games.UpdateParticipantStatus(c, id, teamId)
}
func (h *Handler) DeleteGameParticipant(c *gin.Context, id int, teamId int) {
	rbac.RequireRole(models.RoleAdmin, models.RoleSuperAdmin)(c)
	if c.IsAborted() {
		return
	}
	h.games.RemoveParticipant(c, id, teamId)
}
func (h *Handler) GetGameWriteups(c *gin.Context, id int) {
	rbac.RequireRole(models.RoleAdmin, models.RoleSuperAdmin)(c)
	if c.IsAborted() {
		return
	}
	h.games.ListWriteups(c, id)
}
func (h *Handler) UpdateGameWriteup(c *gin.Context, id int, teamId int) {
	rbac.RequireRole(models.RoleAdmin, models.RoleSuperAdmin)(c)
	if c.IsAborted() {
		return
	}
	h.games.ReviewWriteup(c, id, teamId)
}
func (h *Handler) UpdateAdminGameWriteup(c *gin.Context, id int, teamId int) {
	h.UpdateGameWriteup(c, id, teamId)
}
