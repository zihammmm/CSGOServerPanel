package main

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	matchStatusCreated      = "created"
	matchStatusGathering    = "gathering"
	matchStatusCaptainPick  = "captain_pick"
	matchStatusPlayerDraft  = "player_draft"
	matchStatusMapVeto      = "map_veto"
	matchStatusReadyToStart = "ready_to_start"
	matchStatusLaunching    = "launching"
	matchStatusLive         = "live"
	matchStatusFinished     = "finished"
	matchStatusCancelled    = "cancelled"
)

var (
	defaultMatchMaps = []string{"de_ancient", "de_anubis", "de_dust2", "de_inferno", "de_mirage", "de_nuke", "de_train"}
	draftTurnScript  = []string{"A", "B", "B", "A", "A", "B", "B", "A"}
)

type matchRow struct {
	ID          int64
	DisplayID   string
	CreatorUser int64
	CreatorName string
	Status      string
	Bo          int
	CaptainMode string
	ScoreA      sql.NullInt64
	ScoreB      sql.NullInt64
	ServerAddr  string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type matchPlayerItem struct {
	UserID     int64   `json:"userId"`
	SteamID    string  `json:"steamId"`
	Nickname   string  `json:"nickname"`
	Team       *string `json:"team"`
	IsCaptain  bool    `json:"isCaptain"`
	JoinedAt   string  `json:"joinedAt"`
	JoinOrder  int     `json:"-"`
	IsAssigned bool    `json:"-"`
}

type vetoStepItem struct {
	Order  int    `json:"order"`
	Team   string `json:"team"`
	Action string `json:"action"`
	Map    string `json:"map"`
}

type vetoTurn struct {
	Team   string `json:"team"`
	Action string `json:"action"`
}

type mapPlayerStatItem struct {
	UserID   int64   `json:"userId"`
	SteamID  string  `json:"steamId"`
	Nickname string  `json:"nickname"`
	Avatar   string  `json:"avatarUrl"`
	Team     string  `json:"team"`
	Kills    int     `json:"kills"`
	Deaths   int     `json:"deaths"`
	Assists  int     `json:"assists"`
	ADR      float64 `json:"adr"`
	Rating   float64 `json:"rating"`
}

type mapResultItem struct {
	Key         string              `json:"key"`
	Map         string              `json:"map"`
	ScoreA      int                 `json:"scoreA"`
	ScoreB      int                 `json:"scoreB"`
	PlayerStats []mapPlayerStatItem `json:"playerStats"`
}

func (a *App) registerMatchRoutes(authed *gin.RouterGroup, admin *gin.RouterGroup) {
	authed.GET("/matches", a.listMatches)
	authed.GET("/matches/:id", a.getMatchDetail)
	authed.POST("/matches/:id/join", a.joinMatch)
	authed.POST("/matches/:id/leave", a.leaveMatch)
	authed.POST("/matches/:id/draft/pick", a.adminDraftPick)
	authed.POST("/matches/:id/veto/action", a.adminVetoAction)

	admin.POST("/matches", a.adminCreateMatch)
	admin.POST("/matches/:id/start", a.adminStartMatch)
	admin.POST("/matches/:id/force-start", a.adminForceStartMatch)
	admin.POST("/matches/:id/cancel", a.adminCancelMatch)
	admin.POST("/matches/:id/captains", a.adminAssignCaptains)
	admin.POST("/matches/:id/launch", a.adminLaunchMatch)
	admin.POST("/matches/:id/finish", a.adminFinishMatch)
}

func (a *App) listMatches(c *gin.Context) {
	rows, err := a.db.Query(`
		SELECT m.id, m.display_id, m.creator_user_id, u.nickname, m.status, m.bo, m.captain_mode,
			m.score_a, m.score_b, m.server_addr, m.created_at, m.updated_at,
			COALESCE((SELECT COUNT(*) FROM match_players mp WHERE mp.match_id = m.id), 0) AS player_count
		FROM matches m
		JOIN users u ON u.id = m.creator_user_id
		ORDER BY m.created_at DESC`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query matches"})
		return
	}
	defer rows.Close()

	type summary struct {
		ID          string `json:"id"`
		Title       string `json:"title"`
		Status      string `json:"status"`
		Bo          int    `json:"bo"`
		CaptainMode string `json:"captainMode"`
		CreatorName string `json:"creatorName"`
		CreatedAt   string `json:"createdAt"`
		PlayerCount int    `json:"playerCount"`
		ScoreA      *int   `json:"scoreA"`
		ScoreB      *int   `json:"scoreB"`
	}

	history := make([]summary, 0)
	var active *summary
	for rows.Next() {
		var r matchRow
		var playerCount int
		if err := rows.Scan(&r.ID, &r.DisplayID, &r.CreatorUser, &r.CreatorName, &r.Status, &r.Bo, &r.CaptainMode, &r.ScoreA, &r.ScoreB, &r.ServerAddr, &r.CreatedAt, &r.UpdatedAt, &playerCount); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to scan matches"})
			return
		}
		s := summary{
			ID:          r.DisplayID,
			Title:       matchTitle(r.Bo, r.CreatedAt),
			Status:      r.Status,
			Bo:          r.Bo,
			CaptainMode: r.CaptainMode,
			CreatorName: r.CreatorName,
			CreatedAt:   r.CreatedAt.UTC().Format(time.RFC3339),
			PlayerCount: playerCount,
			ScoreA:      toIntPtr(r.ScoreA),
			ScoreB:      toIntPtr(r.ScoreB),
		}
		if isTerminalStatus(r.Status) {
			history = append(history, s)
			continue
		}
		if active == nil {
			active = &s
		}
	}
	if active == nil {
		c.JSON(http.StatusOK, gin.H{"active": nil, "history": history})
		return
	}
	c.JSON(http.StatusOK, gin.H{"active": active, "history": history})
}

func (a *App) getMatchDetail(c *gin.Context) {
	matchID := strings.TrimSpace(c.Param("id"))
	row, err := a.getMatchByDisplayID(c.Request.Context(), matchID)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{"error": "match not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query match"})
		return
	}

	players, err := a.getMatchPlayers(c.Request.Context(), row.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query players"})
		return
	}
	steps, err := a.getVetoSteps(c.Request.Context(), row.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query veto steps"})
		return
	}
	mapsPool, pickedMaps, bannedMaps := computeMapState(row.Bo, row.Status, steps)
	if mapsPool == nil {
		mapsPool = []string{}
	}
	if pickedMaps == nil {
		pickedMaps = []string{}
	}
	if bannedMaps == nil {
		bannedMaps = []string{}
	}
	draftTurnIndex, _ := computeDraftState(players)
	vetoScript := buildVetoScript(row.Bo)
	vetoTurnIndex := len(steps)

	mapResults, overallStats, err := a.getMatchResults(c.Request.Context(), row.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query match results"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":             row.DisplayID,
		"title":          matchTitle(row.Bo, row.CreatedAt),
		"status":         row.Status,
		"bo":             row.Bo,
		"captainMode":    row.CaptainMode,
		"creatorName":    row.CreatorName,
		"creatorUserId":  row.CreatorUser,
		"createdAt":      row.CreatedAt.UTC().Format(time.RFC3339),
		"updatedAt":      row.UpdatedAt.UTC().Format(time.RFC3339),
		"serverAddr":     row.ServerAddr,
		"scoreA":         toIntPtr(row.ScoreA),
		"scoreB":         toIntPtr(row.ScoreB),
		"players":        players,
		"mapsPool":       mapsPool,
		"pickedMaps":     pickedMaps,
		"bannedMaps":     bannedMaps,
		"vetoSteps":      steps,
		"draftTurns":     draftTurnScript,
		"draftTurnIndex": draftTurnIndex,
		"vetoScript":     vetoScript,
		"vetoTurnIndex":  vetoTurnIndex,
		"playerStats":    overallStats,
		"mapResults":     mapResults,
	})
}

func (a *App) adminCreateMatch(c *gin.Context) {
	claims := c.MustGet("user").(*Claims)
	var req struct {
		Bo          int    `json:"bo"`
		CaptainMode string `json:"captainMode"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if req.Bo != 1 && req.Bo != 3 && req.Bo != 5 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bo must be 1/3/5"})
		return
	}
	if req.CaptainMode != "admin_assigned" && req.CaptainMode != "random" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid captainMode"})
		return
	}

	tx, err := a.db.BeginTx(c.Request.Context(), nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to start tx"})
		return
	}
	defer tx.Rollback()
	if err := a.ensureSingleActiveMatchTx(tx, 0); err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	displayID := generateDisplayID()
	if _, err := tx.ExecContext(c.Request.Context(), `
		INSERT INTO matches (display_id, creator_user_id, status, bo, captain_mode, server_addr)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, displayID, claims.UserID, matchStatusGathering, req.Bo, req.CaptainMode, a.cfg.GameServerAddress); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create match"})
		return
	}
	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to commit match"})
		return
	}

	a.writeMatchEventAsync(displayID, claims.UserID, "match_created", gin.H{"bo": req.Bo, "captainMode": req.CaptainMode})
	a.returnMatchDetailByDisplayID(c, displayID)
}

func (a *App) adminStartMatch(c *gin.Context) {
	claims := c.MustGet("user").(*Claims)
	id := strings.TrimSpace(c.Param("id"))
	err := a.updateMatchWithTx(c, id, claims, func(tx *sql.Tx, row matchRow) error {
		if row.Status != matchStatusGathering {
			return fmt.Errorf("current status cannot start")
		}
		var count int
		if err := tx.QueryRowContext(c.Request.Context(), `SELECT COUNT(*) FROM match_players WHERE match_id = $1`, row.ID).Scan(&count); err != nil {
			return err
		}
		if count != 10 {
			return fmt.Errorf("match room must have 10 players to start")
		}
		if err := insertMatchEventTx(c.Request.Context(), tx, row.ID, claims.UserID, "match_started", gin.H{"playerCount": count}); err != nil {
			return err
		}
		return a.progressAfterPlayerCount(c.Request.Context(), tx, row.ID, row.CaptainMode)
	})
	if err != nil {
		a.handleMatchError(c, err)
		return
	}
	a.returnMatchDetailByDisplayID(c, id)
}

func (a *App) joinMatch(c *gin.Context) {
	claims := c.MustGet("user").(*Claims)
	id := strings.TrimSpace(c.Param("id"))
	err := a.updateMatchWithTx(c, id, claims, func(tx *sql.Tx, row matchRow) error {
		if row.Status != matchStatusGathering {
			return fmt.Errorf("current status cannot join")
		}
		var joined bool
		if err := tx.QueryRowContext(c.Request.Context(), `SELECT EXISTS(SELECT 1 FROM match_players WHERE match_id = $1 AND user_id = $2)`, row.ID, claims.UserID).Scan(&joined); err != nil {
			return err
		}
		if !joined {
			var count int
			if err := tx.QueryRowContext(c.Request.Context(), `SELECT COUNT(*) FROM match_players WHERE match_id = $1`, row.ID).Scan(&count); err != nil {
				return err
			}
			if count >= 10 {
				return fmt.Errorf("match room is full")
			}
			if _, err := tx.ExecContext(c.Request.Context(), `
				INSERT INTO match_players (match_id, user_id, team, is_captain, join_order)
				VALUES ($1, $2, NULL, FALSE, $3)
			`, row.ID, claims.UserID, count+1); err != nil {
				return err
			}
			if err := insertMatchEventTx(c.Request.Context(), tx, row.ID, claims.UserID, "player_joined", gin.H{"userId": claims.UserID}); err != nil {
				return err
			}
		}
		_, err := tx.ExecContext(c.Request.Context(), `UPDATE matches SET updated_at = NOW() WHERE id = $1`, row.ID)
		return err
	})
	if err != nil {
		a.handleMatchError(c, err)
		return
	}
	a.returnMatchDetailByDisplayID(c, id)
}

func (a *App) leaveMatch(c *gin.Context) {
	claims := c.MustGet("user").(*Claims)
	id := strings.TrimSpace(c.Param("id"))
	err := a.updateMatchWithTx(c, id, claims, func(tx *sql.Tx, row matchRow) error {
		if row.Status != matchStatusGathering {
			return fmt.Errorf("current status cannot leave")
		}
		res, err := tx.ExecContext(c.Request.Context(), `DELETE FROM match_players WHERE match_id = $1 AND user_id = $2`, row.ID, claims.UserID)
		if err != nil {
			return err
		}
		aff, _ := res.RowsAffected()
		if aff == 0 {
			return fmt.Errorf("player is not in room")
		}
		if _, err := tx.ExecContext(c.Request.Context(), `
			WITH ordered AS (
				SELECT id, ROW_NUMBER() OVER (ORDER BY join_order ASC, created_at ASC) AS next_order
				FROM match_players
				WHERE match_id = $1
			)
			UPDATE match_players mp
			SET join_order = ordered.next_order
			FROM ordered
			WHERE mp.id = ordered.id
		`, row.ID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(c.Request.Context(), `UPDATE matches SET updated_at = NOW() WHERE id = $1`, row.ID); err != nil {
			return err
		}
		return insertMatchEventTx(c.Request.Context(), tx, row.ID, claims.UserID, "player_left", gin.H{"userId": claims.UserID})
	})
	if err != nil {
		a.handleMatchError(c, err)
		return
	}
	a.returnMatchDetailByDisplayID(c, id)
}

func (a *App) adminForceStartMatch(c *gin.Context) {
	claims := c.MustGet("user").(*Claims)
	id := strings.TrimSpace(c.Param("id"))
	err := a.updateMatchWithTx(c, id, claims, func(tx *sql.Tx, row matchRow) error {
		if row.Status != matchStatusGathering {
			return fmt.Errorf("current status cannot force start")
		}
		var count int
		if err := tx.QueryRowContext(c.Request.Context(), `SELECT COUNT(*) FROM match_players WHERE match_id = $1`, row.ID).Scan(&count); err != nil {
			return err
		}
		if count >= 10 {
			return fmt.Errorf("match room already has 10 players")
		}
		for count < 10 {
			botNo := time.Now().UnixNano()%1000000 + int64(count)
			steamID := fmt.Sprintf("bot_%d_%d", row.ID, botNo)
			nickname := fmt.Sprintf("BOT-%d", count+1)
			var userID int64
			if err := tx.QueryRowContext(c.Request.Context(), `
				INSERT INTO users (steam_id, role, nickname)
				VALUES ($1, $2, $3)
				ON CONFLICT (steam_id) DO UPDATE SET nickname = EXCLUDED.nickname, updated_at = NOW()
				RETURNING id
			`, steamID, roleGuest, nickname).Scan(&userID); err != nil {
				return err
			}
			if _, err := tx.ExecContext(c.Request.Context(), `
				INSERT INTO match_players (match_id, user_id, team, is_captain, join_order)
				VALUES ($1, $2, NULL, FALSE, $3)
				ON CONFLICT (match_id, user_id) DO NOTHING
			`, row.ID, userID, count+1); err != nil {
				return err
			}
			count++
		}
		if err := insertMatchEventTx(c.Request.Context(), tx, row.ID, claims.UserID, "force_started", gin.H{"filledTo": 10}); err != nil {
			return err
		}
		return a.progressAfterPlayerCount(c.Request.Context(), tx, row.ID, row.CaptainMode)
	})
	if err != nil {
		a.handleMatchError(c, err)
		return
	}
	a.returnMatchDetailByDisplayID(c, id)
}

func (a *App) adminCancelMatch(c *gin.Context) {
	claims := c.MustGet("user").(*Claims)
	id := strings.TrimSpace(c.Param("id"))
	err := a.updateMatchWithTx(c, id, claims, func(tx *sql.Tx, row matchRow) error {
		if row.Status == matchStatusFinished || row.Status == matchStatusCancelled {
			return fmt.Errorf("current status cannot cancel")
		}
		if _, err := tx.ExecContext(c.Request.Context(), `UPDATE matches SET status = $1, updated_at = NOW() WHERE id = $2`, matchStatusCancelled, row.ID); err != nil {
			return err
		}
		return insertMatchEventTx(c.Request.Context(), tx, row.ID, claims.UserID, "match_cancelled", gin.H{"previousStatus": row.Status})
	})
	if err != nil {
		a.handleMatchError(c, err)
		return
	}
	a.returnMatchDetailByDisplayID(c, id)
}

func (a *App) adminAssignCaptains(c *gin.Context) {
	claims := c.MustGet("user").(*Claims)
	id := strings.TrimSpace(c.Param("id"))
	var req struct {
		CaptainAUserID int64 `json:"captainAUserId"`
		CaptainBUserID int64 `json:"captainBUserId"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.CaptainAUserID == 0 || req.CaptainBUserID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if req.CaptainAUserID == req.CaptainBUserID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "captains must be different"})
		return
	}

	err := a.updateMatchWithTx(c, id, claims, func(tx *sql.Tx, row matchRow) error {
		if row.CreatorUser != claims.UserID {
			return fmt.Errorf("only creator can assign captains")
		}
		if row.CaptainMode != "admin_assigned" || row.Status != matchStatusCaptainPick {
			return fmt.Errorf("current status cannot assign captains")
		}
		if _, err := tx.ExecContext(c.Request.Context(), `UPDATE match_players SET team = NULL, is_captain = FALSE WHERE match_id = $1`, row.ID); err != nil {
			return err
		}
		for _, it := range []struct {
			uid  int64
			team string
		}{
			{uid: req.CaptainAUserID, team: "A"},
			{uid: req.CaptainBUserID, team: "B"},
		} {
			res, err := tx.ExecContext(c.Request.Context(), `
				UPDATE match_players
				SET team = $1, is_captain = TRUE
				WHERE match_id = $2 AND user_id = $3
			`, it.team, row.ID, it.uid)
			if err != nil {
				return err
			}
			aff, _ := res.RowsAffected()
			if aff == 0 {
				return fmt.Errorf("captain must exist in room")
			}
		}
		if _, err := tx.ExecContext(c.Request.Context(), `UPDATE matches SET status = $1, updated_at = NOW() WHERE id = $2`, matchStatusPlayerDraft, row.ID); err != nil {
			return err
		}
		return insertMatchEventTx(c.Request.Context(), tx, row.ID, claims.UserID, "captains_assigned", gin.H{"captainAUserId": req.CaptainAUserID, "captainBUserId": req.CaptainBUserID})
	})
	if err != nil {
		a.handleMatchError(c, err)
		return
	}
	a.returnMatchDetailByDisplayID(c, id)
}

func (a *App) adminDraftPick(c *gin.Context) {
	claims := c.MustGet("user").(*Claims)
	id := strings.TrimSpace(c.Param("id"))
	var req struct {
		TargetUserID int64 `json:"targetUserId"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.TargetUserID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}

	err := a.updateMatchWithTx(c, id, claims, func(tx *sql.Tx, row matchRow) error {
		if row.Status != matchStatusPlayerDraft {
			return fmt.Errorf("current status is not player_draft")
		}
		players, err := getMatchPlayersTx(c.Request.Context(), tx, row.ID)
		if err != nil {
			return err
		}
		idx, team := computeDraftState(players)
		if idx >= len(draftTurnScript) {
			if _, err := tx.ExecContext(c.Request.Context(), `UPDATE matches SET status = $1, updated_at = NOW() WHERE id = $2`, matchStatusMapVeto, row.ID); err != nil {
				return err
			}
			return nil
		}
		captain, ok := findCaptain(players, claims.UserID)
		if !ok {
			return fmt.Errorf("only captain can draft")
		}
		if captain.Team == nil || *captain.Team != team {
			return fmt.Errorf("not your draft turn")
		}
		target, ok := findPlayer(players, req.TargetUserID)
		if !ok {
			return fmt.Errorf("target player not in match")
		}
		if target.Team != nil || target.IsCaptain {
			return fmt.Errorf("target player already assigned")
		}
		if _, err := tx.ExecContext(c.Request.Context(), `UPDATE match_players SET team = $1 WHERE match_id = $2 AND user_id = $3`, team, row.ID, req.TargetUserID); err != nil {
			return err
		}
		if err := insertMatchEventTx(c.Request.Context(), tx, row.ID, claims.UserID, "draft_pick", gin.H{"team": team, "targetUserId": req.TargetUserID, "turn": idx}); err != nil {
			return err
		}
		players, err = getMatchPlayersTx(c.Request.Context(), tx, row.ID)
		if err != nil {
			return err
		}
		nextIdx, _ := computeDraftState(players)
		if nextIdx >= len(draftTurnScript) {
			if _, err := tx.ExecContext(c.Request.Context(), `UPDATE matches SET status = $1, updated_at = NOW() WHERE id = $2`, matchStatusMapVeto, row.ID); err != nil {
				return err
			}
			return insertMatchEventTx(c.Request.Context(), tx, row.ID, claims.UserID, "draft_finished", gin.H{})
		}
		if _, err := tx.ExecContext(c.Request.Context(), `UPDATE matches SET updated_at = NOW() WHERE id = $1`, row.ID); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		a.handleMatchError(c, err)
		return
	}
	a.returnMatchDetailByDisplayID(c, id)
}

func (a *App) adminVetoAction(c *gin.Context) {
	claims := c.MustGet("user").(*Claims)
	id := strings.TrimSpace(c.Param("id"))
	var req struct {
		MapName string `json:"mapName"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.MapName) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	mapName := strings.TrimSpace(req.MapName)

	err := a.updateMatchWithTx(c, id, claims, func(tx *sql.Tx, row matchRow) error {
		if row.Status != matchStatusMapVeto {
			return fmt.Errorf("current status is not map_veto")
		}
		players, err := getMatchPlayersTx(c.Request.Context(), tx, row.ID)
		if err != nil {
			return err
		}
		captain, ok := findCaptain(players, claims.UserID)
		if !ok || captain.Team == nil {
			return fmt.Errorf("only captain can veto")
		}
		steps, err := getVetoStepsTx(c.Request.Context(), tx, row.ID)
		if err != nil {
			return err
		}
		script := buildVetoScript(row.Bo)
		if len(steps) >= len(script) {
			return fmt.Errorf("veto already finished")
		}
		turn := script[len(steps)]
		if captain.Team == nil || *captain.Team != turn.Team {
			return fmt.Errorf("not your veto turn")
		}
		mapsPool, _, _ := computeMapState(row.Bo, row.Status, steps)
		if !slices.Contains(mapsPool, mapName) {
			return fmt.Errorf("map is not available")
		}
		if _, err := tx.ExecContext(c.Request.Context(), `
			INSERT INTO match_veto_steps (match_id, step_order, team, action, map_name)
			VALUES ($1, $2, $3, $4, $5)
		`, row.ID, len(steps)+1, turn.Team, turn.Action, mapName); err != nil {
			return err
		}
		if err := insertMatchEventTx(c.Request.Context(), tx, row.ID, claims.UserID, "veto_action", gin.H{"order": len(steps) + 1, "team": turn.Team, "action": turn.Action, "map": mapName}); err != nil {
			return err
		}

		steps, err = getVetoStepsTx(c.Request.Context(), tx, row.ID)
		if err != nil {
			return err
		}
		if len(steps) >= len(script) {
			_, picked, _ := computeMapState(row.Bo, matchStatusReadyToStart, steps)
			payload, _ := json.Marshal(gin.H{"pickedMaps": picked})
			if _, err := tx.ExecContext(c.Request.Context(), `
				INSERT INTO match_events (match_id, actor_user_id, event_type, payload)
				VALUES ($1, $2, 'veto_finalized', $3)
			`, row.ID, claims.UserID, payload); err != nil {
				return err
			}
			if _, err := tx.ExecContext(c.Request.Context(), `UPDATE matches SET status = $1, updated_at = NOW() WHERE id = $2`, matchStatusReadyToStart, row.ID); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(c.Request.Context(), `UPDATE matches SET updated_at = NOW() WHERE id = $1`, row.ID); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		a.handleMatchError(c, err)
		return
	}
	a.returnMatchDetailByDisplayID(c, id)
}

func (a *App) adminLaunchMatch(c *gin.Context) {
	claims := c.MustGet("user").(*Claims)
	id := strings.TrimSpace(c.Param("id"))
	err := a.updateMatchWithTx(c, id, claims, func(tx *sql.Tx, row matchRow) error {
		if row.CreatorUser != claims.UserID {
			return fmt.Errorf("only creator can launch match")
		}
		if row.Status != matchStatusReadyToStart {
			return fmt.Errorf("current status cannot launch")
		}
		if _, err := tx.ExecContext(c.Request.Context(), `UPDATE matches SET status = $1, updated_at = NOW() WHERE id = $2`, matchStatusLaunching, row.ID); err != nil {
			return err
		}

		players, err := getMatchPlayersTx(c.Request.Context(), tx, row.ID)
		if err != nil {
			return err
		}
		steps, err := getVetoStepsTx(c.Request.Context(), tx, row.ID)
		if err != nil {
			return err
		}
		_, pickedMaps, _ := computeMapState(row.Bo, row.Status, steps)
		if len(pickedMaps) == 0 {
			pickedMaps = []string{"de_mirage"}
		}
		cfgJSON, err := buildGet5Config(row, players, pickedMaps)
		if err != nil {
			return err
		}
		configPath := fmt.Sprintf("match_%s.json", row.DisplayID)
		stdout, stderr, dispatchErr := a.dispatchGet5Config(c.Request.Context(), configPath, cfgJSON)
		jobStatus := "success"
		if dispatchErr != nil {
			jobStatus = "failed"
			if strings.TrimSpace(stderr) == "" {
				stderr = dispatchErr.Error()
			} else {
				stderr = stderr + "\n" + dispatchErr.Error()
			}
		}

		if _, err := tx.ExecContext(c.Request.Context(), `
				INSERT INTO match_get5_jobs (match_id, status, config_path, stdout, stderr)
				VALUES ($1, $2, $3, $4, $5)
			`, row.ID, jobStatus, configPath, stdout+"\n"+string(cfgJSON), nullable(stderr)); err != nil {
			return err
		}

		if jobStatus == "success" {
			if _, err := tx.ExecContext(c.Request.Context(), `UPDATE matches SET status = $1, updated_at = NOW() WHERE id = $2`, matchStatusLive, row.ID); err != nil {
				return err
			}
			return insertMatchEventTx(c.Request.Context(), tx, row.ID, claims.UserID, "match_launched", gin.H{"configPath": configPath, "status": "success"})
		}

		if _, err := tx.ExecContext(c.Request.Context(), `UPDATE matches SET status = $1, updated_at = NOW() WHERE id = $2`, matchStatusReadyToStart, row.ID); err != nil {
			return err
		}
		return insertMatchEventTx(c.Request.Context(), tx, row.ID, claims.UserID, "match_launch_failed", gin.H{
			"configPath": configPath,
			"status":     "failed",
			"error":      stderr,
		})
	})
	if err != nil {
		a.handleMatchError(c, err)
		return
	}
	a.returnMatchDetailByDisplayID(c, id)
}

func (a *App) adminFinishMatch(c *gin.Context) {
	claims := c.MustGet("user").(*Claims)
	id := strings.TrimSpace(c.Param("id"))
	err := a.updateMatchWithTx(c, id, claims, func(tx *sql.Tx, row matchRow) error {
		if row.CreatorUser != claims.UserID {
			return fmt.Errorf("only creator can finish match")
		}
		if row.Status != matchStatusLive {
			return fmt.Errorf("only live match can finish")
		}
		players, err := getMatchPlayersTx(c.Request.Context(), tx, row.ID)
		if err != nil {
			return err
		}
		steps, err := getVetoStepsTx(c.Request.Context(), tx, row.ID)
		if err != nil {
			return err
		}
		_, pickedMaps, _ := computeMapState(row.Bo, matchStatusFinished, steps)
		if len(pickedMaps) == 0 {
			pickedMaps = []string{"de_mirage"}
		}
		seriesA, seriesB := computeSeriesScore(row.Bo, len(pickedMaps), row.ID)
		if _, err := tx.ExecContext(c.Request.Context(), `UPDATE matches SET status = $1, score_a = $2, score_b = $3, updated_at = NOW() WHERE id = $4`, matchStatusFinished, seriesA, seriesB, row.ID); err != nil {
			return err
		}

		for idx, mapName := range pickedMaps {
			winnerA := idx%2 == 0
			if row.ID%2 == 0 {
				winnerA = !winnerA
			}
			scoreA := 13
			scoreB := 8 + idx%5
			if !winnerA {
				scoreA, scoreB = scoreB, scoreA
			}
			var mapResultID int64
			if err := tx.QueryRowContext(c.Request.Context(), `
				INSERT INTO match_map_results (match_id, map_order, map_name, score_a, score_b)
				VALUES ($1, $2, $3, $4, $5)
				RETURNING id
			`, row.ID, idx+1, mapName, scoreA, scoreB).Scan(&mapResultID); err != nil {
				return err
			}
			for _, p := range players {
				if p.Team == nil {
					continue
				}
				k, d, as, adr, rating := buildPlayerStats(p.UserID, idx)
				if _, err := tx.ExecContext(c.Request.Context(), `
					INSERT INTO match_player_map_stats (match_map_result_id, user_id, team, kills, deaths, assists, adr, rating)
					VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
				`, mapResultID, p.UserID, *p.Team, k, d, as, adr, rating); err != nil {
					return err
				}
			}
		}
		return insertMatchEventTx(c.Request.Context(), tx, row.ID, claims.UserID, "match_finished", gin.H{"scoreA": seriesA, "scoreB": seriesB})
	})
	if err != nil {
		a.handleMatchError(c, err)
		return
	}
	a.returnMatchDetailByDisplayID(c, id)
}

func (a *App) updateMatchWithTx(c *gin.Context, displayID string, claims *Claims, fn func(tx *sql.Tx, row matchRow) error) error {
	tx, err := a.db.BeginTx(c.Request.Context(), nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	row, err := getMatchByDisplayIDTx(c.Request.Context(), tx, displayID)
	if err != nil {
		return err
	}
	if err := fn(tx, row); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	_ = claims
	return nil
}

func (a *App) returnMatchDetailByDisplayID(c *gin.Context, displayID string) {
	c.Params = append(c.Params[:0], gin.Param{Key: "id", Value: displayID})
	a.getMatchDetail(c)
}

func (a *App) handleMatchError(c *gin.Context, err error) {
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{"error": "match not found"})
		return
	}
	msg := strings.TrimSpace(err.Error())
	switch {
	case strings.Contains(msg, "only"), strings.Contains(msg, "not your"), strings.Contains(msg, "cannot"), strings.Contains(msg, "must"), strings.Contains(msg, "already has"), strings.Contains(msg, "not in room"):
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
	case strings.Contains(msg, "already an active match"):
		c.JSON(http.StatusConflict, gin.H{"error": msg})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": msg})
	}
}

func (a *App) progressAfterPlayerCount(ctx context.Context, tx *sql.Tx, matchID int64, captainMode string) error {
	var count int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM match_players WHERE match_id = $1`, matchID).Scan(&count); err != nil {
		return err
	}
	if count < 10 {
		if _, err := tx.ExecContext(ctx, `UPDATE matches SET updated_at = NOW() WHERE id = $1`, matchID); err != nil {
			return err
		}
		return nil
	}
	if captainMode == "random" {
		rows, err := tx.QueryContext(ctx, `
			SELECT user_id FROM match_players WHERE match_id = $1 ORDER BY RANDOM() LIMIT 2
		`, matchID)
		if err != nil {
			return err
		}
		defer rows.Close()
		ids := make([]int64, 0, 2)
		for rows.Next() {
			var id int64
			if err := rows.Scan(&id); err == nil {
				ids = append(ids, id)
			}
		}
		if len(ids) != 2 {
			return fmt.Errorf("failed to choose random captains")
		}
		if _, err := tx.ExecContext(ctx, `UPDATE match_players SET team = NULL, is_captain = FALSE WHERE match_id = $1`, matchID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE match_players SET team = 'A', is_captain = TRUE WHERE match_id = $1 AND user_id = $2`, matchID, ids[0]); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE match_players SET team = 'B', is_captain = TRUE WHERE match_id = $1 AND user_id = $2`, matchID, ids[1]); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE matches SET status = $1, updated_at = NOW() WHERE id = $2`, matchStatusPlayerDraft, matchID); err != nil {
			return err
		}
		return insertMatchEventTx(ctx, tx, matchID, nil, "captains_randomized", gin.H{"captainAUserId": ids[0], "captainBUserId": ids[1]})
	}
	if _, err := tx.ExecContext(ctx, `UPDATE matches SET status = $1, updated_at = NOW() WHERE id = $2`, matchStatusCaptainPick, matchID); err != nil {
		return err
	}
	return insertMatchEventTx(ctx, tx, matchID, nil, "captain_pick_ready", gin.H{})
}

func (a *App) ensureSingleActiveMatchTx(tx *sql.Tx, excludeID int64) error {
	q := `SELECT COUNT(*) FROM matches WHERE status NOT IN ('finished','cancelled')`
	args := []any{}
	if excludeID > 0 {
		q += ` AND id <> $1`
		args = append(args, excludeID)
	}
	var count int
	if err := tx.QueryRow(q, args...).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return fmt.Errorf("already an active match")
	}
	return nil
}

func (a *App) getMatchByDisplayID(ctx context.Context, displayID string) (matchRow, error) {
	return getMatchByDisplayIDTx(ctx, a.db, displayID)
}

func getMatchByDisplayIDTx(ctx context.Context, q queryer, displayID string) (matchRow, error) {
	row := q.QueryRowContext(ctx, `
		SELECT m.id, m.display_id, m.creator_user_id, u.nickname, m.status, m.bo, m.captain_mode,
			m.score_a, m.score_b, m.server_addr, m.created_at, m.updated_at
		FROM matches m
		JOIN users u ON u.id = m.creator_user_id
		WHERE m.display_id = $1
	`, displayID)
	var m matchRow
	err := row.Scan(&m.ID, &m.DisplayID, &m.CreatorUser, &m.CreatorName, &m.Status, &m.Bo, &m.CaptainMode, &m.ScoreA, &m.ScoreB, &m.ServerAddr, &m.CreatedAt, &m.UpdatedAt)
	return m, err
}

type queryer interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func (a *App) getMatchPlayers(ctx context.Context, matchID int64) ([]matchPlayerItem, error) {
	return getMatchPlayersTx(ctx, a.db, matchID)
}

func getMatchPlayersTx(ctx context.Context, q dbQueryer, matchID int64) ([]matchPlayerItem, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT mp.user_id, u.steam_id, u.nickname, mp.team, mp.is_captain, mp.created_at, mp.join_order
		FROM match_players mp
		JOIN users u ON u.id = mp.user_id
		WHERE mp.match_id = $1
		ORDER BY mp.join_order ASC, mp.created_at ASC
	`, matchID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]matchPlayerItem, 0, 10)
	for rows.Next() {
		var it matchPlayerItem
		var joined time.Time
		if err := rows.Scan(&it.UserID, &it.SteamID, &it.Nickname, &it.Team, &it.IsCaptain, &joined, &it.JoinOrder); err != nil {
			return nil, err
		}
		it.JoinedAt = joined.UTC().Format(time.RFC3339)
		it.IsAssigned = it.Team != nil
		items = append(items, it)
	}
	return items, nil
}

type dbQueryer interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

func (a *App) getVetoSteps(ctx context.Context, matchID int64) ([]vetoStepItem, error) {
	return getVetoStepsTx(ctx, a.db, matchID)
}

func getVetoStepsTx(ctx context.Context, q dbQueryer, matchID int64) ([]vetoStepItem, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT step_order, team, action, map_name
		FROM match_veto_steps
		WHERE match_id = $1
		ORDER BY step_order ASC
	`, matchID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	steps := make([]vetoStepItem, 0, 8)
	for rows.Next() {
		var it vetoStepItem
		if err := rows.Scan(&it.Order, &it.Team, &it.Action, &it.Map); err != nil {
			return nil, err
		}
		steps = append(steps, it)
	}
	return steps, nil
}

func (a *App) getMatchResults(ctx context.Context, matchID int64) ([]mapResultItem, []mapPlayerStatItem, error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT id, map_order, map_name, score_a, score_b
		FROM match_map_results
		WHERE match_id = $1
		ORDER BY map_order ASC
	`, matchID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	mapResults := make([]mapResultItem, 0, 5)
	aggregates := map[int64]*mapPlayerStatItem{}
	mapCount := map[int64]int{}

	for rows.Next() {
		var mapResultID int64
		var order int
		var mr mapResultItem
		if err := rows.Scan(&mapResultID, &order, &mr.Map, &mr.ScoreA, &mr.ScoreB); err != nil {
			return nil, nil, err
		}
		mr.Key = fmt.Sprintf("map_%d_%s", order-1, mr.Map)

		statsRows, err := a.db.QueryContext(ctx, `
			SELECT s.user_id, u.steam_id, u.nickname, s.team, s.kills, s.deaths, s.assists, s.adr, s.rating
			FROM match_player_map_stats s
			JOIN users u ON u.id = s.user_id
			WHERE s.match_map_result_id = $1
			ORDER BY s.rating DESC
		`, mapResultID)
		if err != nil {
			return nil, nil, err
		}
		mr.PlayerStats = make([]mapPlayerStatItem, 0, 10)
		for statsRows.Next() {
			var s mapPlayerStatItem
			if err := statsRows.Scan(&s.UserID, &s.SteamID, &s.Nickname, &s.Team, &s.Kills, &s.Deaths, &s.Assists, &s.ADR, &s.Rating); err != nil {
				statsRows.Close()
				return nil, nil, err
			}
			s.Avatar = makeAvatarURL(s.SteamID, s.Nickname)
			mr.PlayerStats = append(mr.PlayerStats, s)

			if existing, ok := aggregates[s.UserID]; ok {
				existing.Kills += s.Kills
				existing.Deaths += s.Deaths
				existing.Assists += s.Assists
				existing.ADR += s.ADR
				existing.Rating += s.Rating
				mapCount[s.UserID]++
			} else {
				copyS := s
				aggregates[s.UserID] = &copyS
				mapCount[s.UserID] = 1
			}
		}
		statsRows.Close()
		mapResults = append(mapResults, mr)
	}
	overall := make([]mapPlayerStatItem, 0, len(aggregates))
	for uid, s := range aggregates {
		cnt := float64(max(mapCount[uid], 1))
		s.ADR = roundFloat(s.ADR/cnt, 1)
		s.Rating = roundFloat(s.Rating/cnt, 2)
		overall = append(overall, *s)
	}
	slices.SortFunc(overall, func(a, b mapPlayerStatItem) int {
		if a.Rating == b.Rating {
			return 0
		}
		if a.Rating > b.Rating {
			return -1
		}
		return 1
	})
	return mapResults, overall, nil
}

func computeDraftState(players []matchPlayerItem) (int, string) {
	countA, countB := 0, 0
	for _, p := range players {
		if p.Team == nil {
			continue
		}
		if *p.Team == "A" {
			countA++
		}
		if *p.Team == "B" {
			countB++
		}
	}
	picksMade := max(0, (countA-1)+(countB-1))
	idx := picksMade
	for idx < len(draftTurnScript) {
		team := draftTurnScript[idx]
		if (team == "A" && countA >= 5) || (team == "B" && countB >= 5) {
			idx++
			continue
		}
		return idx, team
	}
	return len(draftTurnScript), ""
}

func buildVetoScript(bo int) []vetoTurn {
	if bo == 1 {
		return []vetoTurn{{"A", "ban"}, {"B", "ban"}, {"A", "ban"}, {"B", "ban"}, {"A", "ban"}, {"B", "ban"}}
	}
	if bo == 3 {
		return []vetoTurn{{"A", "ban"}, {"B", "ban"}, {"A", "pick"}, {"B", "pick"}, {"A", "ban"}, {"B", "ban"}}
	}
	return []vetoTurn{{"A", "ban"}, {"B", "ban"}}
}

func computeMapState(bo int, status string, steps []vetoStepItem) (mapsPool []string, picked []string, banned []string) {
	mapsPool = append([]string{}, defaultMatchMaps...)
	for _, s := range steps {
		mapsPool = removeString(mapsPool, s.Map)
		if s.Action == "pick" {
			picked = append(picked, s.Map)
		} else {
			banned = append(banned, s.Map)
		}
	}

	if status == matchStatusReadyToStart || status == matchStatusLaunching || status == matchStatusLive || status == matchStatusFinished {
		if bo == 1 {
			if len(mapsPool) == 1 {
				picked = []string{mapsPool[0]}
				mapsPool = []string{}
			}
		} else if bo == 3 {
			if len(mapsPool) == 1 {
				picked = append(picked, mapsPool[0])
				mapsPool = []string{}
			}
		} else if bo == 5 {
			picked = append(picked, mapsPool...)
			mapsPool = []string{}
		}
	}
	return mapsPool, picked, banned
}

func findCaptain(players []matchPlayerItem, userID int64) (matchPlayerItem, bool) {
	for _, p := range players {
		if p.UserID == userID && p.IsCaptain {
			return p, true
		}
	}
	return matchPlayerItem{}, false
}

func findPlayer(players []matchPlayerItem, userID int64) (matchPlayerItem, bool) {
	for _, p := range players {
		if p.UserID == userID {
			return p, true
		}
	}
	return matchPlayerItem{}, false
}

func insertMatchEventTx(ctx context.Context, tx *sql.Tx, matchID int64, actorUserID any, eventType string, payload any) error {
	data, _ := json.Marshal(payload)
	_, err := tx.ExecContext(ctx, `
		INSERT INTO match_events (match_id, actor_user_id, event_type, payload)
		VALUES ($1, $2, $3, $4)
	`, matchID, actorUserID, eventType, data)
	return err
}

func (a *App) writeMatchEventAsync(displayID string, actorUserID int64, eventType string, payload any) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	match, err := a.getMatchByDisplayID(ctx, displayID)
	if err != nil {
		return
	}
	data, _ := json.Marshal(payload)
	_, _ = a.db.ExecContext(ctx, `
		INSERT INTO match_events (match_id, actor_user_id, event_type, payload)
		VALUES ($1, $2, $3, $4)
	`, match.ID, actorUserID, eventType, data)
}

func buildGet5Config(m matchRow, players []matchPlayerItem, maps []string) ([]byte, error) {
	teamA := make([]gin.H, 0, 5)
	teamB := make([]gin.H, 0, 5)
	for _, p := range players {
		if p.Team == nil {
			continue
		}
		item := gin.H{"steamId": p.SteamID, "nickname": p.Nickname}
		if *p.Team == "A" {
			teamA = append(teamA, item)
		} else {
			teamB = append(teamB, item)
		}
	}
	payload := gin.H{
		"matchId":     m.DisplayID,
		"bo":          m.Bo,
		"maplist":     maps,
		"teamA":       teamA,
		"teamB":       teamB,
		"server":      m.ServerAddr,
		"generatedAt": time.Now().UTC().Format(time.RFC3339),
	}
	return json.Marshal(payload)
}

func computeSeriesScore(bo, pickedMaps int, seed int64) (int, int) {
	if bo == 1 {
		if seed%2 == 0 {
			return 13, 10
		}
		return 10, 13
	}
	need := bo/2 + 1
	if pickedMaps < need {
		pickedMaps = need
	}
	a := need
	b := max(0, pickedMaps-need)
	if seed%2 == 0 {
		return a, b
	}
	return b, a
}

func buildPlayerStats(userID int64, salt int) (int, int, int, float64, float64) {
	seed := math.Abs(float64((userID*1103515245 + int64(12345+salt*97)) % 997))
	kills := 12 + int(seed)%17
	deaths := 10 + int(seed)%13
	assists := 2 + int(seed)%9
	adr := 58 + int(seed)%65
	rating := roundFloat(0.8+float64(kills-deaths)/30+float64(assists)/40+float64(adr)/400, 2)
	return kills, deaths, assists, float64(adr), rating
}

func makeAvatarURL(steamID, nickname string) string {
	initial := "?"
	n := strings.TrimSpace(nickname)
	if n != "" {
		initial = strings.ToUpper(string([]rune(n)[0]))
	}
	hue := 0
	if len(steamID) > 0 {
		num, _ := strconv.Atoi(lastN(steamID, 6))
		hue = int(math.Abs(float64(num % 360)))
	}
	svg := fmt.Sprintf("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='32' fill='hsl(%d,55%%,34%%)'/><text x='32' y='39' text-anchor='middle' font-size='28' font-family='Segoe UI, Arial, sans-serif' fill='#eef4ff' font-weight='700'>%s</text></svg>", hue, initial)
	return "data:image/svg+xml;base64," + base64.StdEncoding.EncodeToString([]byte(svg))
}

func generateDisplayID() string {
	return fmt.Sprintf("%d%03d", time.Now().UnixMilli(), rand.Intn(1000))
}

func removeString(items []string, target string) []string {
	result := make([]string, 0, len(items))
	for _, it := range items {
		if it != target {
			result = append(result, it)
		}
	}
	return result
}

func toIntPtr(v sql.NullInt64) *int {
	if !v.Valid {
		return nil
	}
	x := int(v.Int64)
	return &x
}

func isTerminalStatus(status string) bool {
	return status == matchStatusFinished || status == matchStatusCancelled
}

func matchTitle(bo int, createdAt time.Time) string {
	local := createdAt.Local()
	return fmt.Sprintf("5v5 竞技 BO%d - %d/%d %02d:%02d", bo, local.Month(), local.Day(), local.Hour(), local.Minute())
}

func lastN(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[len(s)-n:]
}

func roundFloat(v float64, digits int) float64 {
	pow := math.Pow10(digits)
	return math.Round(v*pow) / pow
}
