package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type matchLiveStats struct {
	Map       string                 `json:"map"`
	Round     int                    `json:"round"`
	ScoreA    int                    `json:"scoreA"`
	ScoreB    int                    `json:"scoreB"`
	UpdatedAt string                 `json:"updatedAt"`
	Players   []matchLiveStatsPlayer `json:"players"`
}

type matchLiveStatsPlayer struct {
	SteamID   string  `json:"steamId"`
	Team      string  `json:"team"`
	Nickname  string  `json:"nickname"`
	AvatarURL string  `json:"avatarUrl"`
	Kills     int     `json:"kills"`
	Deaths    int     `json:"deaths"`
	Assists   int     `json:"assists"`
	ADR       float64 `json:"adr"`
	Rating    float64 `json:"rating"`
}

type get5RawEvent struct {
	Event string `json:"event"`
}

type get5RoundEndEvent struct {
	Event       string              `json:"event"`
	MatchID     get5MatchIdentifier `json:"matchid"`
	MapNumber   int                 `json:"map_number"`
	RoundNumber int                 `json:"round_number"`
	Team1       get5StatsTeam       `json:"team1"`
	Team2       get5StatsTeam       `json:"team2"`
}

type get5StatsTeam struct {
	Score   int               `json:"score"`
	Side    string            `json:"side"`
	Players []get5StatsPlayer `json:"players"`
}

type get5StatsPlayer struct {
	SteamID string                 `json:"steamid"`
	Name    string                 `json:"name"`
	Stats   get5StatsPlayerMetrics `json:"stats"`
}

type get5StatsPlayerMetrics struct {
	Kills        int `json:"kills"`
	Deaths       int `json:"deaths"`
	Assists      int `json:"assists"`
	Damage       int `json:"damage"`
	RoundsPlayed int `json:"roundsplayed"`
}

type get5MatchIdentifier string

func (v *get5MatchIdentifier) UnmarshalJSON(data []byte) error {
	raw := strings.TrimSpace(string(data))
	raw = strings.Trim(raw, `"`)
	if raw == "" || raw == "null" {
		*v = ""
		return nil
	}
	*v = get5MatchIdentifier(raw)
	return nil
}

type liveSnapshotQueryer interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func (a *App) handleGet5Event(c *gin.Context) {
	if !a.authorizeGet5Event(c) {
		return
	}

	rawBody, err := c.GetRawData()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to read body"})
		return
	}
	var raw get5RawEvent
	if err := json.Unmarshal(rawBody, &raw); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json"})
		return
	}

	switch strings.TrimSpace(raw.Event) {
	case "round_end":
		var event get5RoundEndEvent
		if err := json.Unmarshal(rawBody, &event); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid round_end payload"})
			return
		}
		matchID, err := a.resolveGet5EventMatchID(c.Request.Context(), string(event.MatchID))
		if err == sql.ErrNoRows {
			c.Status(http.StatusNoContent)
			return
		}
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid matchid"})
			return
		}
		snapshot := buildLiveSnapshotFromRoundEnd(event)
		if err := a.upsertMatchLiveSnapshot(c.Request.Context(), matchID, snapshot, event.MapNumber); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to store live stats"})
			return
		}
	default:
		c.Status(http.StatusNoContent)
		return
	}

	c.Status(http.StatusNoContent)
}

func (a *App) resolveGet5EventMatchID(ctx context.Context, raw string) (int64, error) {
	matchKey := strings.TrimSpace(raw)
	if matchKey == "" {
		return 0, sql.ErrNoRows
	}

	row, err := getMatchByDisplayIDTx(ctx, a.db, matchKey)
	if err == nil {
		return row.ID, nil
	}
	if err != sql.ErrNoRows {
		return 0, err
	}

	id, convErr := strconv.ParseInt(matchKey, 10, 64)
	if convErr != nil {
		return 0, sql.ErrNoRows
	}
	rowByID, err := getMatchByIDTx(ctx, a.db, id)
	if err != nil {
		return 0, err
	}
	return rowByID.ID, nil
}

func (a *App) authorizeGet5Event(c *gin.Context) bool {
	headerKey := strings.TrimSpace(a.cfg.Get5EventAuthHeaderKey)
	headerValue := strings.TrimSpace(a.cfg.Get5EventAuthHeaderValue)
	if headerKey != "" && headerValue != "" {
		if strings.TrimSpace(c.GetHeader(headerKey)) != headerValue {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return false
		}
	}
	expectedServerID := strings.TrimSpace(a.cfg.Get5EventServerID)
	if expectedServerID != "" && strings.TrimSpace(c.GetHeader("Get5-ServerId")) != expectedServerID {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid get5 server id"})
		return false
	}
	return true
}

func buildLiveSnapshotFromRoundEnd(event get5RoundEndEvent) matchLiveStats {
	now := time.Now().UTC()
	players := make([]matchLiveStatsPlayer, 0, len(event.Team1.Players)+len(event.Team2.Players))
	players = append(players, buildLiveSnapshotPlayers("A", event.Team1.Players)...)
	players = append(players, buildLiveSnapshotPlayers("B", event.Team2.Players)...)
	return matchLiveStats{
		Round:     event.RoundNumber,
		ScoreA:    event.Team1.Score,
		ScoreB:    event.Team2.Score,
		UpdatedAt: now.Format(time.RFC3339),
		Players:   players,
	}
}

func buildLiveSnapshotPlayers(team string, players []get5StatsPlayer) []matchLiveStatsPlayer {
	out := make([]matchLiveStatsPlayer, 0, len(players))
	for _, player := range players {
		adr := 0.0
		if player.Stats.RoundsPlayed > 0 {
			adr = roundFloat(float64(player.Stats.Damage)/float64(player.Stats.RoundsPlayed), 1)
		}
		rating := roundFloat(0.8+float64(player.Stats.Kills-player.Stats.Deaths)/30+float64(player.Stats.Assists)/40+adr/400, 2)
		out = append(out, matchLiveStatsPlayer{
			SteamID:  strings.TrimSpace(player.SteamID),
			Team:     team,
			Nickname: strings.TrimSpace(player.Name),
			Kills:    player.Stats.Kills,
			Deaths:   player.Stats.Deaths,
			Assists:  player.Stats.Assists,
			ADR:      adr,
			Rating:   rating,
		})
	}
	return out
}

func (a *App) upsertMatchLiveSnapshot(ctx context.Context, matchID int64, snapshot matchLiveStats, mapNumber int) error {
	payload, err := json.Marshal(snapshot)
	if err != nil {
		return err
	}
	_, err = a.db.ExecContext(ctx, `
		INSERT INTO match_live_snapshots (match_id, map_number, round_number, score_a, score_b, updated_at, payload)
		VALUES ($1, $2, $3, $4, $5, NOW(), $6)
		ON CONFLICT (match_id) DO UPDATE
		SET map_number = EXCLUDED.map_number,
			round_number = EXCLUDED.round_number,
			score_a = EXCLUDED.score_a,
			score_b = EXCLUDED.score_b,
			updated_at = NOW(),
			payload = EXCLUDED.payload
	`, matchID, max(mapNumber, 1), snapshot.Round, snapshot.ScoreA, snapshot.ScoreB, payload)
	return err
}

func deleteMatchLiveSnapshotTx(ctx context.Context, tx *sql.Tx, matchID int64) error {
	_, err := tx.ExecContext(ctx, `DELETE FROM match_live_snapshots WHERE match_id = $1`, matchID)
	return err
}

func getMatchLiveSnapshotTx(ctx context.Context, q liveSnapshotQueryer, matchID int64, pickedMaps []string) (*matchLiveStats, error) {
	var (
		mapNumber  int
		payloadRaw []byte
		updatedAt  time.Time
	)
	err := q.QueryRowContext(ctx, `
		SELECT map_number, payload, updated_at
		FROM match_live_snapshots
		WHERE match_id = $1
	`, matchID).Scan(&mapNumber, &payloadRaw, &updatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	var snapshot matchLiveStats
	if err := json.Unmarshal(payloadRaw, &snapshot); err != nil {
		return nil, err
	}
	snapshot.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
	if mapNumber > 0 && mapNumber <= len(pickedMaps) {
		snapshot.Map = pickedMaps[mapNumber-1]
	}
	if snapshot.Map == "" && len(pickedMaps) > 0 {
		snapshot.Map = pickedMaps[0]
	}

	if len(snapshot.Players) == 0 {
		return &snapshot, nil
	}
	avatars, err := getUserAvatarMapBySteamIDs(ctx, q, collectSteamIDs(snapshot.Players))
	if err != nil {
		return nil, err
	}
	for i := range snapshot.Players {
		player := &snapshot.Players[i]
		player.AvatarURL = resolveAvatarURL(player.SteamID, player.Nickname, avatars[player.SteamID])
	}
	return &snapshot, nil
}

func collectSteamIDs(players []matchLiveStatsPlayer) []string {
	out := make([]string, 0, len(players))
	for _, player := range players {
		if strings.TrimSpace(player.SteamID) != "" {
			out = append(out, strings.TrimSpace(player.SteamID))
		}
	}
	return out
}

func getUserAvatarMapBySteamIDs(ctx context.Context, q liveSnapshotQueryer, steamIDs []string) (map[string]string, error) {
	profiles, err := getUserProfileMapBySteamIDs(ctx, q, steamIDs)
	if err != nil {
		return nil, err
	}
	out := make(map[string]string, len(profiles))
	for steamID, profile := range profiles {
		out[steamID] = profile.AvatarURL
	}
	return out, nil
}

type userProfileRef struct {
	Nickname  string
	AvatarURL string
}

func getUserProfileMapBySteamIDs(ctx context.Context, q liveSnapshotQueryer, steamIDs []string) (map[string]userProfileRef, error) {
	if len(steamIDs) == 0 {
		return map[string]userProfileRef{}, nil
	}
	rows, err := q.QueryContext(ctx, `
		SELECT steam_id, nickname, avatar_url
		FROM users
		WHERE steam_id = ANY($1)
	`, steamIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make(map[string]userProfileRef, len(steamIDs))
	for rows.Next() {
		var steamID string
		var nickname string
		var avatarURL string
		if err := rows.Scan(&steamID, &nickname, &avatarURL); err != nil {
			return nil, err
		}
		out[strings.TrimSpace(steamID)] = userProfileRef{
			Nickname:  strings.TrimSpace(nickname),
			AvatarURL: strings.TrimSpace(avatarURL),
		}
	}
	return out, nil
}
