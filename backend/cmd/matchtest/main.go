package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	_ "github.com/jackc/pgx/v5/stdlib"
)

const (
	defaultAPIBaseURL = "http://localhost:8080"
	defaultJWTSecret  = "dev-secret"
	defaultDBURL      = "postgres://postgres:postgres@localhost:5432/csgopanel?sslmode=disable"
	e2eNicknamePrefix = "E2E-"
)

type claims struct {
	UserID   int64  `json:"uid"`
	SteamID  string `json:"sid"`
	Role     string `json:"role"`
	Nickname string `json:"nickname"`
	jwt.RegisteredClaims
}

type testUser struct {
	UserID   int64  `json:"userId"`
	SteamID  string `json:"steamId"`
	Role     string `json:"role"`
	Nickname string `json:"nickname"`
	Token    string `json:"token"`
}

type prepareOutput struct {
	GeneratedAt string     `json:"generatedAt"`
	APIBaseURL  string     `json:"apiBaseUrl"`
	Users       []testUser `json:"users"`
}

type matchUser struct {
	UserID   int64  `json:"userId"`
	SteamID  string `json:"steamId"`
	Nickname string `json:"nickname"`
}

type matchPlayer struct {
	UserID    int64   `json:"userId"`
	SteamID   string  `json:"steamId"`
	Nickname  string  `json:"nickname"`
	Team      *string `json:"team"`
	IsCaptain bool    `json:"isCaptain"`
}

type vetoTurn struct {
	Team   string `json:"team"`
	Action string `json:"action"`
}

type matchDetail struct {
	ID             string        `json:"id"`
	Status         string        `json:"status"`
	CaptainMode    string        `json:"captainMode"`
	Players        []matchPlayer `json:"players"`
	DraftTurns     []string      `json:"draftTurns"`
	DraftTurnIndex int           `json:"draftTurnIndex"`
	MapsPool       []string      `json:"mapsPool"`
	VetoScript     []vetoTurn    `json:"vetoScript"`
	VetoTurnIndex  int           `json:"vetoTurnIndex"`
}

type listMatchesResponse struct {
	Active *struct {
		ID string `json:"id"`
	} `json:"active"`
}

type apiClient struct {
	baseURL string
	client  *http.Client
}

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	switch os.Args[1] {
	case "prepare-users":
		if err := runPrepareUsers(os.Args[2:]); err != nil {
			fatal(err)
		}
	case "run-flow":
		if err := runFlow(os.Args[2:]); err != nil {
			fatal(err)
		}
	case "cleanup":
		if err := runCleanup(os.Args[2:]); err != nil {
			fatal(err)
		}
	default:
		printUsage()
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Println("matchtest commands:")
	fmt.Println("  prepare-users  Create deterministic E2E users and print tokens")
	fmt.Println("  run-flow       Run an end-to-end match flow against the real API")
	fmt.Println("  cleanup        Remove E2E users and their related matches")
}

func runPrepareUsers(args []string) error {
	fs := flag.NewFlagSet("prepare-users", flag.ExitOnError)
	apiBaseURL := fs.String("api-base-url", envOrDefault("API_BASE_URL", defaultAPIBaseURL), "API base URL")
	dbURL := fs.String("database-url", envOrDefault("DATABASE_URL", defaultDBURL), "PostgreSQL DSN")
	jwtSecret := fs.String("jwt-secret", envOrDefault("JWT_SECRET", defaultJWTSecret), "JWT secret")
	outPath := fs.String("out", "", "optional JSON output path")
	envOutPath := fs.String("env-out", "", "optional shell env output path")
	if err := fs.Parse(args); err != nil {
		return err
	}

	db, err := openDB(*dbURL)
	if err != nil {
		return err
	}
	defer db.Close()

	users, err := prepareUsers(db, *jwtSecret)
	if err != nil {
		return err
	}

	output := prepareOutput{
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		APIBaseURL:  strings.TrimRight(*apiBaseURL, "/"),
		Users:       users,
	}
	data, err := json.MarshalIndent(output, "", "  ")
	if err != nil {
		return err
	}

	if *outPath != "" {
		if err := os.MkdirAll(filepath.Dir(*outPath), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(*outPath, data, 0o644); err != nil {
			return err
		}
	}
	if *envOutPath != "" {
		if err := os.MkdirAll(filepath.Dir(*envOutPath), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(*envOutPath, []byte(buildEnvFile(users)), 0o644); err != nil {
			return err
		}
	}

	fmt.Println(string(data))
	return nil
}

func runFlow(args []string) error {
	fs := flag.NewFlagSet("run-flow", flag.ExitOnError)
	apiBaseURL := fs.String("api-base-url", envOrDefault("API_BASE_URL", defaultAPIBaseURL), "API base URL")
	dbURL := fs.String("database-url", envOrDefault("DATABASE_URL", defaultDBURL), "PostgreSQL DSN")
	jwtSecret := fs.String("jwt-secret", envOrDefault("JWT_SECRET", defaultJWTSecret), "JWT secret")
	captainMode := fs.String("captain-mode", "admin_assigned", "admin_assigned or random")
	bo := fs.Int("bo", 3, "best-of value: 1, 3, or 5")
	forceStart := fs.Bool("force-start", false, "use force-start after only 6 joins")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *captainMode != "admin_assigned" && *captainMode != "random" {
		return fmt.Errorf("captain-mode must be admin_assigned or random")
	}
	if *bo != 1 && *bo != 3 && *bo != 5 {
		return fmt.Errorf("bo must be 1, 3, or 5")
	}
	if *forceStart && *captainMode == "random" {
		return fmt.Errorf("force-start with random captains is unsupported because bots can be selected as captains")
	}

	db, err := openDB(*dbURL)
	if err != nil {
		return err
	}
	defer db.Close()

	users, err := prepareUsers(db, *jwtSecret)
	if err != nil {
		return err
	}
	if len(users) < 10 {
		return fmt.Errorf("need at least 10 prepared users")
	}

	api := &apiClient{
		baseURL: strings.TrimRight(*apiBaseURL, "/"),
		client:  &http.Client{Timeout: 20 * time.Second},
	}

	if err := ensureNoActiveMatch(api, users[0].Token); err != nil {
		return err
	}

	admin := users[0]
	roomUsers := users[:10]

	match, err := createMatch(api, admin.Token, *bo, *captainMode)
	if err != nil {
		return err
	}
	logStep("created match %s in status %s", match.ID, match.Status)

	joinCount := len(roomUsers)
	if *forceStart {
		joinCount = 6
	}
	for i := 0; i < joinCount; i++ {
		next, err := postMatchAction(api, roomUsers[i].Token, http.MethodPost, fmt.Sprintf("/api/v1/matches/%s/join", match.ID), map[string]any{})
		if err != nil {
			return fmt.Errorf("join user %s: %w", roomUsers[i].Nickname, err)
		}
		match = next
	}
	logStep("joined %d users, room count is %d", joinCount, len(match.Players))

	if *forceStart {
		match, err = postMatchAction(api, admin.Token, http.MethodPost, fmt.Sprintf("/api/v1/admin/matches/%s/force-start", match.ID), map[string]any{})
		if err != nil {
			return fmt.Errorf("force start: %w", err)
		}
		logStep("force-started match, status is now %s", match.Status)
	} else {
		match, err = postMatchAction(api, admin.Token, http.MethodPost, fmt.Sprintf("/api/v1/admin/matches/%s/start", match.ID), map[string]any{})
		if err != nil {
			return fmt.Errorf("start match: %w", err)
		}
		logStep("started match, status is now %s", match.Status)
	}

	tokenByUserID := map[int64]string{}
	for _, user := range roomUsers {
		tokenByUserID[user.UserID] = user.Token
	}

	if match.Status == "captain_pick" {
		captainA := roomUsers[0].UserID
		captainB := roomUsers[1].UserID
		match, err = postMatchAction(api, admin.Token, http.MethodPost, fmt.Sprintf("/api/v1/admin/matches/%s/captains", match.ID), map[string]any{
			"captainAUserId": captainA,
			"captainBUserId": captainB,
		})
		if err != nil {
			return fmt.Errorf("assign captains: %w", err)
		}
		logStep("assigned captains %d and %d", captainA, captainB)
	}

	for match.Status == "player_draft" {
		turnTeam := match.DraftTurns[match.DraftTurnIndex]
		captain, ok := findCaptainByTeam(match.Players, turnTeam)
		if !ok {
			return fmt.Errorf("draft turn %s has no captain", turnTeam)
		}
		target, ok := firstUndrafted(match.Players)
		if !ok {
			return fmt.Errorf("no undrafted players remaining")
		}
		token, ok := tokenByUserID[captain.UserID]
		if !ok {
			return fmt.Errorf("missing token for captain %d", captain.UserID)
		}
		match, err = postMatchAction(api, token, http.MethodPost, fmt.Sprintf("/api/v1/matches/%s/draft/pick", match.ID), map[string]any{
			"targetUserId": target.UserID,
		})
		if err != nil {
			return fmt.Errorf("draft pick by captain %d: %w", captain.UserID, err)
		}
		logStep("draft turn %s picked user %d", turnTeam, target.UserID)
	}

	for match.Status == "map_veto" {
		if match.VetoTurnIndex >= len(match.VetoScript) {
			return fmt.Errorf("veto turn index %d out of range", match.VetoTurnIndex)
		}
		turn := match.VetoScript[match.VetoTurnIndex]
		captain, ok := findCaptainByTeam(match.Players, turn.Team)
		if !ok {
			return fmt.Errorf("veto turn %s has no captain", turn.Team)
		}
		token, ok := tokenByUserID[captain.UserID]
		if !ok {
			return fmt.Errorf("missing token for captain %d", captain.UserID)
		}
		if len(match.MapsPool) == 0 {
			return fmt.Errorf("no maps left in pool")
		}
		mapName := match.MapsPool[0]
		match, err = postMatchAction(api, token, http.MethodPost, fmt.Sprintf("/api/v1/matches/%s/veto/action", match.ID), map[string]any{
			"mapName": mapName,
		})
		if err != nil {
			return fmt.Errorf("veto action by captain %d: %w", captain.UserID, err)
		}
		logStep("veto turn %s %s %s", turn.Team, turn.Action, mapName)
	}

	if match.Status != "ready_to_start" {
		return fmt.Errorf("expected ready_to_start before launch, got %s", match.Status)
	}
	match, err = postMatchAction(api, admin.Token, http.MethodPost, fmt.Sprintf("/api/v1/admin/matches/%s/launch", match.ID), map[string]any{})
	if err != nil {
		return fmt.Errorf("launch match: %w", err)
	}
	logStep("launched match, status is now %s", match.Status)

	match, err = postMatchAction(api, admin.Token, http.MethodPost, fmt.Sprintf("/api/v1/admin/matches/%s/finish", match.ID), map[string]any{})
	if err != nil {
		return fmt.Errorf("finish match: %w", err)
	}
	logStep("finished match %s, final status is %s", match.ID, match.Status)
	return nil
}

func runCleanup(args []string) error {
	fs := flag.NewFlagSet("cleanup", flag.ExitOnError)
	dbURL := fs.String("database-url", envOrDefault("DATABASE_URL", defaultDBURL), "PostgreSQL DSN")
	if err := fs.Parse(args); err != nil {
		return err
	}

	db, err := openDB(*dbURL)
	if err != nil {
		return err
	}
	defer db.Close()

	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`
		DELETE FROM matches
		WHERE creator_user_id IN (
			SELECT id FROM users WHERE nickname LIKE $1
		) OR id IN (
			SELECT mp.match_id
			FROM match_players mp
			JOIN users u ON u.id = mp.user_id
			WHERE u.nickname LIKE $1
		)
	`, e2eNicknamePrefix+"%"); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM users WHERE nickname LIKE $1`, e2eNicknamePrefix+"%"); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	logStep("cleaned up E2E matches and users")
	return nil
}

func openDB(dbURL string) (*sql.DB, error) {
	db, err := sql.Open("pgx", dbURL)
	if err != nil {
		return nil, err
	}
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func prepareUsers(db *sql.DB, jwtSecret string) ([]testUser, error) {
	seedUsers := []struct {
		steamID  string
		role     string
		nickname string
	}{
		{steamID: "76561199000000001", role: "admin", nickname: "E2E-Admin"},
		{steamID: "76561199000000002", role: "guest", nickname: "E2E-P01"},
		{steamID: "76561199000000003", role: "guest", nickname: "E2E-P02"},
		{steamID: "76561199000000004", role: "guest", nickname: "E2E-P03"},
		{steamID: "76561199000000005", role: "guest", nickname: "E2E-P04"},
		{steamID: "76561199000000006", role: "guest", nickname: "E2E-P05"},
		{steamID: "76561199000000007", role: "guest", nickname: "E2E-P06"},
		{steamID: "76561199000000008", role: "guest", nickname: "E2E-P07"},
		{steamID: "76561199000000009", role: "guest", nickname: "E2E-P08"},
		{steamID: "76561199000000010", role: "guest", nickname: "E2E-P09"},
		{steamID: "76561199000000011", role: "guest", nickname: "E2E-P10"},
	}

	users := make([]testUser, 0, len(seedUsers))
	for _, seed := range seedUsers {
		var user testUser
		if err := db.QueryRow(`
			INSERT INTO users (steam_id, role, nickname, nickname_customized)
			VALUES ($1, $2, $3, FALSE)
			ON CONFLICT (steam_id) DO UPDATE
			SET role = EXCLUDED.role,
				nickname = EXCLUDED.nickname,
				nickname_customized = FALSE,
				updated_at = NOW()
			RETURNING id, steam_id, role, nickname
		`, seed.steamID, seed.role, seed.nickname).Scan(&user.UserID, &user.SteamID, &user.Role, &user.Nickname); err != nil {
			return nil, err
		}
		if _, err := db.Exec(`INSERT INTO player_stats (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, user.UserID); err != nil {
			return nil, err
		}
		token, err := signToken(jwtSecret, user)
		if err != nil {
			return nil, err
		}
		user.Token = token
		users = append(users, user)
	}
	return users, nil
}

func signToken(jwtSecret string, user testUser) (string, error) {
	now := time.Now()
	tokenClaims := claims{
		UserID:   user.UserID,
		SteamID:  user.SteamID,
		Role:     user.Role,
		Nickname: user.Nickname,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(now.Add(7 * 24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(now),
			Subject:   strconv.FormatInt(user.UserID, 10),
		},
	}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, tokenClaims)
	return t.SignedString([]byte(jwtSecret))
}

func ensureNoActiveMatch(api *apiClient, token string) error {
	var res listMatchesResponse
	if err := api.doJSON(http.MethodGet, "/api/v1/matches", token, nil, &res); err != nil {
		return err
	}
	if res.Active != nil {
		return fmt.Errorf("there is already an active match (%s); finish or cancel it before running E2E flow", res.Active.ID)
	}
	return nil
}

func createMatch(api *apiClient, token string, bo int, captainMode string) (matchDetail, error) {
	return postMatchAction(api, token, http.MethodPost, "/api/v1/admin/matches", map[string]any{
		"bo":          bo,
		"captainMode": captainMode,
	})
}

func postMatchAction(api *apiClient, token, method, path string, body any) (matchDetail, error) {
	var out matchDetail
	err := api.doJSON(method, path, token, body, &out)
	return out, err
}

func (a *apiClient) doJSON(method, path, token string, body any, out any) error {
	var reader io.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(payload)
	}
	req, err := http.NewRequest(method, a.baseURL+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := a.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		return err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("status %d: %s", res.StatusCode, strings.TrimSpace(string(raw)))
	}
	if out == nil || len(raw) == 0 {
		return nil
	}
	return json.Unmarshal(raw, out)
}

func buildEnvFile(users []testUser) string {
	lines := []string{
		fmt.Sprintf("export MATCHTEST_API_BASE_URL=%q", envOrDefault("API_BASE_URL", defaultAPIBaseURL)),
	}
	for idx, user := range users {
		name := "MATCHTEST_ADMIN"
		if idx > 0 {
			name = fmt.Sprintf("MATCHTEST_PLAYER_%02d", idx)
		}
		lines = append(lines,
			fmt.Sprintf("export %s_USER_ID=%q", name, strconv.FormatInt(user.UserID, 10)),
			fmt.Sprintf("export %s_STEAM_ID=%q", name, user.SteamID),
			fmt.Sprintf("export %s_NICKNAME=%q", name, user.Nickname),
			fmt.Sprintf("export %s_TOKEN=%q", name, user.Token),
		)
	}
	return strings.Join(lines, "\n") + "\n"
}

func findCaptainByTeam(players []matchPlayer, team string) (matchPlayer, bool) {
	for _, player := range players {
		if player.IsCaptain && player.Team != nil && *player.Team == team {
			return player, true
		}
	}
	return matchPlayer{}, false
}

func firstUndrafted(players []matchPlayer) (matchPlayer, bool) {
	for _, player := range players {
		if !player.IsCaptain && player.Team == nil {
			return player, true
		}
	}
	return matchPlayer{}, false
}

func envOrDefault(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func logStep(format string, args ...any) {
	fmt.Printf("[matchtest] "+format+"\n", args...)
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, "[matchtest]", err)
	os.Exit(1)
}
