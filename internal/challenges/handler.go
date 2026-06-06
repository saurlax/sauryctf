package challenges

import (
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
)

type Handler struct {
	svc ServiceInterface
}

func NewHandler(svc ServiceInterface) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) CreateChallenge(c *gin.Context) {
	var req CreateChallengeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}

	userID, _ := c.Get("user_id")
	ch, err := h.svc.CreateChallenge(req, userID.(uint))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, ch)
}

func (h *Handler) GetChallenge(c *gin.Context, id int) {
	ch, err := h.svc.GetChallenge(uint(id))
	if err != nil {
		if err.Error() == "challenge not found" {
			c.JSON(http.StatusNotFound, gin.H{"message": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, ch)
}

func (h *Handler) ListChallenges(c *gin.Context, category string, showHidden bool) {
	challenges, err := h.svc.ListChallenges(category, showHidden)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, challenges)
}

func (h *Handler) UpdateChallenge(c *gin.Context, id int) {
	var req UpdateChallengeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}

	userID := c.MustGet("user_id").(uint)
	ch, err := h.svc.UpdateChallenge(uint(id), req, userID)
	if err != nil {
		if err.Error() == "challenge not found" {
			c.JSON(http.StatusNotFound, gin.H{"message": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, ch)
}

func (h *Handler) DeleteChallenge(c *gin.Context, id int) {
	userID := c.MustGet("user_id").(uint)
	if err := h.svc.DeleteChallenge(uint(id), userID); err != nil {
		if err.Error() == "challenge not found" {
			c.JSON(http.StatusNotFound, gin.H{"message": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

func (h *Handler) UploadAttachment(c *gin.Context) {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "missing file"})
		return
	}

	file, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}
	defer file.Close()

	content, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}

	result, err := h.svc.SaveAttachment(fileHeader.Filename, content)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, result)
}

func (h *Handler) SubmitChallengeFlag(c *gin.Context, id int) {
	var req struct {
		Flag   string `json:"flag" binding:"required"`
		GameID uint   `json:"game_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}

	userID, _ := c.Get("user_id")
	teamID, _ := c.Get("team_id")

	result, err := h.svc.SubmitFlag(uint(id), req.GameID, userID.(uint), teamID.(uint), req.Flag)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}

	if result.Correct {
		c.JSON(http.StatusOK, result)
	} else {
		c.JSON(http.StatusForbidden, result)
	}
}
