package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"html"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/gorcon/rcon"
	_ "github.com/jackc/pgx/v5/stdlib"
)

const (
	roleGuest      = "guest"
	roleAdmin      = "admin"
	roleSuperAdmin = "super_admin"
)

type Config struct {
	Port                    string
	DatabaseURL             string
	JWTSecret               string
	FrontendURL             string
	FrontendAuthCallbackURL string
	SteamRealm              string
	SteamReturnTo           string
	AdminSteamIDs           map[string]struct{}
	SuperAdminSteamIDs      map[string]struct{}
	RCONHost                string
	RCONPassword            string
	RCONTimeout             time.Duration
	GameServerAddress       string
	PollInterval            time.Duration
	MatchSSHHost            string
	MatchSSHPort            string
	MatchSSHUser            string
	MatchSSHKeyPath         string
	MatchRemoteGet5Dir      string
	MatchServerRestartCmd   string
}

type App struct {
	cfg      Config
	db       *sql.DB
	rcon     *RCONClient
	snapshot *SnapshotStore
}

type User struct {
	ID        int64  `json:"id"`
	SteamID   string `json:"steamId"`
	Role      string `json:"role"`
	Nickname  string `json:"nickname"`
	SteamName string `json:"steamName,omitempty"`
}

type Claims struct {
	UserID   int64  `json:"uid"`
	SteamID  string `json:"sid"`
	Role     string `json:"role"`
	Nickname string `json:"nickname"`
	jwt.RegisteredClaims
}

type LivePlayer struct {
	PlayerID string  `json:"playerId"`
	Name     string  `json:"name"`
	Kills    int     `json:"kills"`
	Deaths   int     `json:"deaths"`
	KD       float64 `json:"kd"`
	Team     string  `json:"team"`
}

type ServerStatus struct {
	Running    bool      `json:"running"`
	Map        string    `json:"map"`
	Mode       string    `json:"mode"`
	Players    int       `json:"players"`
	MaxPlayers int       `json:"maxPlayers"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

type MatchLive struct {
	ScoreCT   int          `json:"scoreCt"`
	ScoreT    int          `json:"scoreT"`
	Players   []LivePlayer `json:"players"`
	UpdatedAt time.Time    `json:"updatedAt"`
}

type SnapshotStore struct {
	mu     sync.RWMutex
	status ServerStatus
	live   MatchLive
}

func NewSnapshotStore() *SnapshotStore {
	now := time.Now().UTC()
	return &SnapshotStore{
		status: ServerStatus{Running: false, UpdatedAt: now},
		live:   MatchLive{Players: []LivePlayer{}, UpdatedAt: now},
	}
}

func (s *SnapshotStore) Set(status ServerStatus, live MatchLive) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.status = status
	s.live = live
}

func (s *SnapshotStore) Get() (ServerStatus, MatchLive) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.status, s.live
}

type RCONClient struct {
	host     string
	password string
	timeout  time.Duration
}

func (c *RCONClient) Execute(ctx context.Context, cmd string) (string, error) {
	if c.host == "" || c.password == "" {
		return "", errors.New("rcon is not configured")
	}
	conn, err := rcon.Dial(c.host, c.password)
	if err != nil {
		return "", err
	}
	defer conn.Close()
	type execResult struct {
		out string
		err error
	}
	done := make(chan execResult, 1)
	go func() {
		out, err := conn.Execute(cmd)
		done <- execResult{out: out, err: err}
	}()
	select {
	case <-ctx.Done():
		return "", ctx.Err()
	case res := <-done:
		return res.out, res.err
	}
}

var (
	steamIDRegex               = regexp.MustCompile(`\d+$`)
	mapRegex                   = regexp.MustCompile(`map\s*:\s*([^\s]+)`)
	maxPlayersRegex            = regexp.MustCompile(`(?im)maxplayers\s*:\s*(\d+)`)
	playersLineMaxPlayersRegex = regexp.MustCompile(`(?im)players\s*:\s*.*\((\d+)\/\d+\s+max\)`)
	humanPlayersRegex          = regexp.MustCompile(`(?im)players\s*:\s*(\d+)\s+humans?`)
	playerSteam3Regex          = regexp.MustCompile(`^#\s+\d+\s+\d+\s+"([^"]+)"\s+\[U:1:(\d+)\]`)
	playerSteam2Regex          = regexp.MustCompile(`^#\s+\d+\s+\d+\s+"([^"]+)"\s+(STEAM_[^ ]+)`)
	titleRegex                 = regexp.MustCompile(`(?i)<title>\s*Steam Community\s*::\s*([^<]+)</title>`)
)

func main() {
	cfg := loadConfig()
	db, err := sql.Open("pgx", cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	if err := db.Ping(); err != nil {
		log.Fatalf("ping db: %v", err)
	}
	if err := migrate(db); err != nil {
		log.Fatalf("migrate: %v", err)
	}
	if err := syncConfiguredAdmins(db, cfg.AdminSteamIDs); err != nil {
		log.Fatalf("sync configured admins: %v", err)
	}
	if err := syncConfiguredSuperAdmins(db, cfg.SuperAdminSteamIDs); err != nil {
		log.Fatalf("sync configured super admins: %v", err)
	}

	app := &App{
		cfg: cfg,
		db:  db,
		rcon: &RCONClient{
			host:     cfg.RCONHost,
			password: cfg.RCONPassword,
			timeout:  cfg.RCONTimeout,
		},
		snapshot: NewSnapshotStore(),
	}
	go app.pollSnapshots()

	gin.SetMode(gin.ReleaseMode)
	r := gin.Default()
	r.Use(cors.New(cors.Config{
		AllowOrigins:     []string{cfg.FrontendURL},
		AllowMethods:     []string{"GET", "POST", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Authorization", "Content-Type"},
		AllowCredentials: true,
	}))

	r.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	api := r.Group("/api/v1")
	{
		api.GET("/auth/steam/login", app.steamLogin)
		api.GET("/auth/steam/callback", app.steamCallback)
		api.POST("/auth/logout", func(c *gin.Context) {
			c.Status(http.StatusNoContent)
		})

		authed := api.Group("")
		authed.Use(app.authMiddleware())
		{
			authed.GET("/me", app.getMe)
			authed.PATCH("/me/nickname", app.updateNickname)
			authed.GET("/dashboard/server-status", app.getServerStatus)
			authed.GET("/dashboard/match-live", app.getMatchLive)
			authed.GET("/leaderboard", app.getLeaderboard)
		}

		admin := authed.Group("/admin")
		admin.Use(app.adminMiddleware())
		{
			admin.GET("/admins", app.listAdmins)
			admin.POST("/admins", app.addAdmin)
			admin.DELETE("/admins/:steamId", app.removeAdmin)
			admin.POST("/rcon/kick", app.adminKick)
			admin.POST("/rcon/change-map", app.adminChangeMap)
			admin.POST("/rcon/change-mode", app.adminChangeMode)
			admin.GET("/audit-logs", app.getAuditLogs)
		}

		app.registerMatchRoutes(authed, admin)
	}

	addr := ":" + cfg.Port
	log.Printf("backend running on %s", addr)
	if err := r.Run(addr); err != nil {
		log.Fatal(err)
	}
}

func loadConfig() Config {
	adminIDs := map[string]struct{}{}
	for _, v := range strings.Split(os.Getenv("ADMIN_STEAM_IDS"), ",") {
		id := strings.TrimSpace(v)
		if id != "" {
			adminIDs[id] = struct{}{}
		}
	}
	superAdminIDs := map[string]struct{}{}
	for _, v := range strings.Split(os.Getenv("SUPER_ADMIN_STEAM_IDS"), ",") {
		id := strings.TrimSpace(v)
		if id != "" {
			superAdminIDs[id] = struct{}{}
		}
	}
	frontendURL := getEnv("FRONTEND_URL", "http://localhost:3000")
	return Config{
		Port:                    getEnv("PORT", "8080"),
		DatabaseURL:             getEnv("DATABASE_URL", "postgres://postgres:postgres@db:5432/csgopanel?sslmode=disable"),
		JWTSecret:               getEnv("JWT_SECRET", "dev-secret"),
		FrontendURL:             frontendURL,
		FrontendAuthCallbackURL: getEnv("FRONTEND_AUTH_CALLBACK_URL", frontendURL+"/auth/callback"),
		SteamRealm:              getEnv("STEAM_REALM", "http://localhost:8080"),
		SteamReturnTo:           getEnv("STEAM_RETURN_TO", "http://localhost:8080/api/v1/auth/steam/callback"),
		AdminSteamIDs:           adminIDs,
		SuperAdminSteamIDs:      superAdminIDs,
		RCONHost:                getEnv("RCON_HOST", ""),
		RCONPassword:            getEnv("RCON_PASSWORD", ""),
		RCONTimeout:             getDurationEnv("RCON_TIMEOUT", 5*time.Second),
		GameServerAddress:       getEnv("GAME_SERVER_ADDRESS", "127.0.0.1:27015"),
		PollInterval:            getDurationEnv("POLL_INTERVAL", 5*time.Second),
		MatchSSHHost:            getEnv("MATCH_SSH_HOST", ""),
		MatchSSHPort:            getEnv("MATCH_SSH_PORT", "22"),
		MatchSSHUser:            getEnv("MATCH_SSH_USER", ""),
		MatchSSHKeyPath:         getEnv("MATCH_SSH_KEY_PATH", ""),
		MatchRemoteGet5Dir:      getEnv("MATCH_REMOTE_GET5_DIR", ""),
		MatchServerRestartCmd:   getEnv("MATCH_SERVER_RESTART_CMD", ""),
	}
}

func getEnv(k, def string) string {
	v := strings.TrimSpace(os.Getenv(k))
	if v == "" {
		return def
	}
	return v
}

func getDurationEnv(k string, def time.Duration) time.Duration {
	v := strings.TrimSpace(os.Getenv(k))
	if v == "" {
		return def
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return def
	}
	return d
}

func migrate(db *sql.DB) error {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS users (
			id BIGSERIAL PRIMARY KEY,
			steam_id TEXT NOT NULL UNIQUE,
			role TEXT NOT NULL DEFAULT 'guest',
			nickname TEXT NOT NULL,
			nickname_customized BOOLEAN NOT NULL DEFAULT FALSE,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS player_stats (
			user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
			total_matches INTEGER NOT NULL DEFAULT 0,
			total_wins INTEGER NOT NULL DEFAULT 0,
			total_kills INTEGER NOT NULL DEFAULT 0,
			total_deaths INTEGER NOT NULL DEFAULT 0,
			total_kd DOUBLE PRECISION NOT NULL DEFAULT 0,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname_customized BOOLEAN NOT NULL DEFAULT FALSE`,
		`CREATE TABLE IF NOT EXISTS rcon_audit_logs (
			id BIGSERIAL PRIMARY KEY,
			admin_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			action TEXT NOT NULL,
			target TEXT NOT NULL,
			payload JSONB NOT NULL,
			result TEXT NOT NULL,
			error TEXT,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS matches (
			id BIGSERIAL PRIMARY KEY,
			display_id TEXT NOT NULL UNIQUE,
			title TEXT NOT NULL DEFAULT '',
			creator_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
			status TEXT NOT NULL,
			bo INTEGER NOT NULL,
			captain_mode TEXT NOT NULL,
			score_a INTEGER NULL,
			score_b INTEGER NULL,
			server_addr TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`ALTER TABLE matches ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT ''`,
		`CREATE TABLE IF NOT EXISTS match_players (
			id BIGSERIAL PRIMARY KEY,
			match_id BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
			user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			team TEXT NULL,
			is_captain BOOLEAN NOT NULL DEFAULT FALSE,
			join_order INTEGER NOT NULL DEFAULT 0,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			UNIQUE(match_id, user_id)
		)`,
		`CREATE TABLE IF NOT EXISTS match_veto_steps (
			id BIGSERIAL PRIMARY KEY,
			match_id BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
			step_order INTEGER NOT NULL,
			team TEXT NOT NULL,
			action TEXT NOT NULL,
			map_name TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS match_map_results (
			id BIGSERIAL PRIMARY KEY,
			match_id BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
			map_order INTEGER NOT NULL,
			map_name TEXT NOT NULL,
			score_a INTEGER NOT NULL,
			score_b INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS match_player_map_stats (
			id BIGSERIAL PRIMARY KEY,
			match_map_result_id BIGINT NOT NULL REFERENCES match_map_results(id) ON DELETE CASCADE,
			user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			team TEXT NOT NULL,
			kills INTEGER NOT NULL,
			deaths INTEGER NOT NULL,
			assists INTEGER NOT NULL,
			adr DOUBLE PRECISION NOT NULL,
			rating DOUBLE PRECISION NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS match_events (
			id BIGSERIAL PRIMARY KEY,
			match_id BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
			actor_user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
			event_type TEXT NOT NULL,
			payload JSONB NOT NULL DEFAULT '{}'::jsonb,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS match_get5_jobs (
			id BIGSERIAL PRIMARY KEY,
			match_id BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
			status TEXT NOT NULL,
			config_path TEXT NOT NULL,
			stdout TEXT,
			stderr TEXT,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
	}
	for _, q := range queries {
		if _, err := db.Exec(q); err != nil {
			return err
		}
	}
	return nil
}

func (a *App) steamLogin(c *gin.Context) {
	params := url.Values{}
	params.Set("openid.ns", "http://specs.openid.net/auth/2.0")
	params.Set("openid.mode", "checkid_setup")
	params.Set("openid.return_to", a.cfg.SteamReturnTo)
	params.Set("openid.realm", a.cfg.SteamRealm)
	params.Set("openid.identity", "http://specs.openid.net/auth/2.0/identifier_select")
	params.Set("openid.claimed_id", "http://specs.openid.net/auth/2.0/identifier_select")
	c.Redirect(http.StatusFound, "https://steamcommunity.com/openid/login?"+params.Encode())
}

func (a *App) steamCallback(c *gin.Context) {
	q := c.Request.URL.Query()
	ok, err := verifySteamResponse(q)
	if err != nil || !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "steam verification failed"})
		return
	}
	claimedID := q.Get("openid.claimed_id")
	steamID := steamIDRegex.FindString(claimedID)
	if steamID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "steam id missing"})
		return
	}

	nickname := "Player-" + steamID[max(0, len(steamID)-6):]
	ctx, cancel := context.WithTimeout(c.Request.Context(), 8*time.Second)
	defer cancel()
	if steamName, err := fetchSteamPersonaName(ctx, steamID); err == nil && strings.TrimSpace(steamName) != "" {
		nickname = strings.TrimSpace(steamName)
	}

	user, err := a.upsertUser(steamID, nickname, false)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to upsert user"})
		return
	}

	token, err := a.issueToken(user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to sign token"})
		return
	}

	cb, err := url.Parse(a.cfg.FrontendAuthCallbackURL)
	if err == nil {
		query := cb.Query()
		query.Set("token", token)
		cb.RawQuery = query.Encode()
		c.Redirect(http.StatusFound, cb.String())
		return
	}
	c.JSON(http.StatusOK, gin.H{"token": token, "user": user})
}

func verifySteamResponse(query url.Values) (bool, error) {
	payload := url.Values{}
	for key, values := range query {
		for _, value := range values {
			payload.Add(key, value)
		}
	}
	payload.Set("openid.mode", "check_authentication")

	resp, err := http.PostForm("https://steamcommunity.com/openid/login", payload)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return false, err
	}
	return strings.Contains(string(raw), "is_valid:true"), nil
}

func (a *App) upsertUser(steamID, nickname string, forceAdmin bool) (User, error) {
	role := roleGuest
	if forceAdmin {
		role = roleAdmin
	}
	query := `
	INSERT INTO users (steam_id, role, nickname)
	VALUES ($1, $2, $3)
	ON CONFLICT (steam_id) DO UPDATE
	SET role = CASE
			WHEN users.role = 'super_admin' THEN 'super_admin'
			WHEN EXCLUDED.role = 'admin' THEN 'admin'
			ELSE users.role
		END,
		nickname = CASE
			WHEN users.nickname_customized THEN users.nickname
			ELSE EXCLUDED.nickname
		END,
		updated_at = NOW()
	RETURNING id, steam_id, role, nickname
	`
	var u User
	if err := a.db.QueryRow(query, steamID, role, nickname).Scan(&u.ID, &u.SteamID, &u.Role, &u.Nickname); err != nil {
		return User{}, err
	}
	_, _ = a.db.Exec(`INSERT INTO player_stats (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, u.ID)
	return u, nil
}

func syncConfiguredAdmins(db *sql.DB, adminIDs map[string]struct{}) error {
	for steamID := range adminIDs {
		nickname := "Player-" + steamID[max(0, len(steamID)-6):]
		if _, err := db.Exec(`
			INSERT INTO users (steam_id, role, nickname)
			VALUES ($1, $2, $3)
			ON CONFLICT (steam_id) DO UPDATE
			SET role = 'admin',
				updated_at = NOW()
		`, steamID, roleAdmin, nickname); err != nil {
			return err
		}
	}
	return nil
}

func syncConfiguredSuperAdmins(db *sql.DB, superAdminIDs map[string]struct{}) error {
	for steamID := range superAdminIDs {
		nickname := "Player-" + steamID[max(0, len(steamID)-6):]
		if _, err := db.Exec(`
			INSERT INTO users (steam_id, role, nickname)
			VALUES ($1, $2, $3)
			ON CONFLICT (steam_id) DO UPDATE
			SET role = 'super_admin',
				updated_at = NOW()
		`, steamID, roleSuperAdmin, nickname); err != nil {
			return err
		}
	}
	return nil
}

func (a *App) issueToken(user User) (string, error) {
	now := time.Now()
	claims := Claims{
		UserID:   user.ID,
		SteamID:  user.SteamID,
		Role:     user.Role,
		Nickname: user.Nickname,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(now.Add(7 * 24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(now),
			Subject:   strconv.FormatInt(user.ID, 10),
		},
	}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return t.SignedString([]byte(a.cfg.JWTSecret))
}

func (a *App) authMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		header := strings.TrimSpace(c.GetHeader("Authorization"))
		token := strings.TrimSpace(strings.TrimPrefix(header, "Bearer"))
		if token == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing token"})
			return
		}
		claims := &Claims{}
		parsed, err := jwt.ParseWithClaims(token, claims, func(token *jwt.Token) (interface{}, error) {
			return []byte(a.cfg.JWTSecret), nil
		})
		if err != nil || !parsed.Valid {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			return
		}
		currentUser, err := a.getUserByID(claims.UserID)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "user not found"})
			return
		}
		claims.Role = currentUser.Role
		claims.Nickname = currentUser.Nickname
		c.Set("user", claims)
		c.Next()
	}
}

func (a *App) adminMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		claims, ok := c.Get("user")
		if !ok {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "admin only"})
			return
		}
		role := claims.(*Claims).Role
		if role != roleAdmin && role != roleSuperAdmin {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "admin only"})
			return
		}
		c.Next()
	}
}

func (a *App) getMe(c *gin.Context) {
	claims := c.MustGet("user").(*Claims)
	row := a.db.QueryRow(`SELECT id, steam_id, role, nickname FROM users WHERE id = $1`, claims.UserID)
	var u User
	if err := row.Scan(&u.ID, &u.SteamID, &u.Role, &u.Nickname); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 8*time.Second)
	defer cancel()
	if steamName, err := fetchSteamPersonaName(ctx, u.SteamID); err == nil {
		u.SteamName = steamName
	}
	c.JSON(http.StatusOK, u)
}

func (a *App) getUserByID(userID int64) (User, error) {
	row := a.db.QueryRow(`SELECT id, steam_id, role, nickname FROM users WHERE id = $1`, userID)
	var u User
	err := row.Scan(&u.ID, &u.SteamID, &u.Role, &u.Nickname)
	return u, err
}

func (a *App) getUserBySteamID(steamID string) (User, error) {
	row := a.db.QueryRow(`SELECT id, steam_id, role, nickname FROM users WHERE steam_id = $1`, steamID)
	var u User
	err := row.Scan(&u.ID, &u.SteamID, &u.Role, &u.Nickname)
	return u, err
}

func defaultNicknameForSteamID(steamID string) string {
	return "Player-" + steamID[max(0, len(steamID)-6):]
}

func (a *App) listAdmins(c *gin.Context) {
	rows, err := a.db.Query(`
		SELECT id, steam_id, role, nickname
		FROM users
		WHERE role IN ('admin', 'super_admin')
		ORDER BY updated_at DESC, id DESC
	`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query admins"})
		return
	}
	defer rows.Close()

	items := make([]User, 0)
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.SteamID, &u.Role, &u.Nickname); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to scan admins"})
			return
		}
		items = append(items, u)
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (a *App) addAdmin(c *gin.Context) {
	var req struct {
		SteamID  string `json:"steamId"`
		Nickname string `json:"nickname"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	steamID := strings.TrimSpace(req.SteamID)
	if !steamIDRegex.MatchString(steamID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid steamId"})
		return
	}
	nickname := strings.TrimSpace(req.Nickname)
	if nickname == "" {
		defaultNickname := defaultNicknameForSteamID(steamID)
		existingUser, err := a.getUserBySteamID(steamID)
		if err == nil && strings.TrimSpace(existingUser.Nickname) != "" && existingUser.Nickname != defaultNickname {
			nickname = existingUser.Nickname
		} else if err != nil && err != sql.ErrNoRows {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query existing user"})
			return
		} else {
			nickname = defaultNickname
		}
		if nickname == defaultNickname {
			ctx, cancel := context.WithTimeout(c.Request.Context(), 8*time.Second)
			defer cancel()
			if steamName, err := fetchSteamPersonaName(ctx, steamID); err == nil && strings.TrimSpace(steamName) != "" {
				nickname = strings.TrimSpace(steamName)
			}
		}
	}
	user, err := a.upsertUser(steamID, nickname, true)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to add admin"})
		return
	}
	c.JSON(http.StatusOK, user)
}

func (a *App) removeAdmin(c *gin.Context) {
	claims := c.MustGet("user").(*Claims)
	if claims.Role != roleSuperAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "super admin only"})
		return
	}
	steamID := strings.TrimSpace(c.Param("steamId"))
	if !steamIDRegex.MatchString(steamID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid steamId"})
		return
	}
	res, err := a.db.Exec(`UPDATE users SET role = 'guest', updated_at = NOW() WHERE steam_id = $1 AND role = 'admin'`, steamID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to remove admin"})
		return
	}
	aff, _ := res.RowsAffected()
	if aff == 0 {
		var existingRole string
		err := a.db.QueryRow(`SELECT role FROM users WHERE steam_id = $1`, steamID).Scan(&existingRole)
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "admin not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query admin"})
			return
		}
		if existingRole == roleSuperAdmin {
			c.JSON(http.StatusBadRequest, gin.H{"error": "cannot remove super admin"})
			return
		}
		c.JSON(http.StatusNotFound, gin.H{"error": "admin not found"})
		return
	}
	c.Status(http.StatusNoContent)
}

type steamProfileXML struct {
	SteamID string `xml:"steamID"`
}

func fetchSteamPersonaName(ctx context.Context, steamID string) (string, error) {
	profileBaseURL := fmt.Sprintf("https://steamcommunity.com/profiles/%s/", url.PathEscape(steamID))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, profileBaseURL+"?xml=1", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "CSGOServer/1.0 (+https://steamcommunity.com)")
	req.Header.Set("Accept", "text/xml,application/xml;q=0.9,*/*;q=0.8")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fetchSteamPersonaNameFromHTML(ctx, profileBaseURL)
	}
	var profile steamProfileXML
	if err := xml.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&profile); err != nil {
		return fetchSteamPersonaNameFromHTML(ctx, profileBaseURL)
	}
	name := strings.TrimSpace(profile.SteamID)
	if name == "" {
		return fetchSteamPersonaNameFromHTML(ctx, profileBaseURL)
	}
	return name, nil
}

func fetchSteamPersonaNameFromHTML(ctx context.Context, profileBaseURL string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, profileBaseURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "CSGOServer/1.0 (+https://steamcommunity.com)")
	req.Header.Set("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return "", fmt.Errorf("steam profile html status: %d", res.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if err != nil {
		return "", err
	}
	matches := titleRegex.FindStringSubmatch(string(raw))
	if len(matches) < 2 {
		return "", errors.New("steam profile title missing")
	}
	name := strings.TrimSpace(html.UnescapeString(matches[1]))
	if name == "" {
		return "", errors.New("steam profile title empty")
	}
	return name, nil
}

func (a *App) updateNickname(c *gin.Context) {
	claims := c.MustGet("user").(*Claims)
	var req struct {
		Nickname string `json:"nickname"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	req.Nickname = strings.TrimSpace(req.Nickname)
	if len(req.Nickname) < 2 || len(req.Nickname) > 24 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "nickname must be 2-24 chars"})
		return
	}
	if _, err := a.db.Exec(`UPDATE users SET nickname = $1, nickname_customized = TRUE, updated_at = NOW() WHERE id = $2`, req.Nickname, claims.UserID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update nickname"})
		return
	}
	c.Status(http.StatusNoContent)
}

func (a *App) getServerStatus(c *gin.Context) {
	status, _ := a.snapshot.Get()
	if status.MaxPlayers == 0 {
		status.MaxPlayers = 32
	}
	status.Map = fallback(status.Map, "unknown")
	status.Mode = fallback(status.Mode, "competitive")
	c.JSON(http.StatusOK, status)
}

func (a *App) getMatchLive(c *gin.Context) {
	_, live := a.snapshot.Get()
	c.JSON(http.StatusOK, live)
}

func (a *App) getLeaderboard(c *gin.Context) {
	sort := c.DefaultQuery("sort", "total_wins")
	if sort != "total_wins" && sort != "total_kd" {
		sort = "total_wins"
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 100 {
		size = 20
	}
	offset := (page - 1) * size

	query := fmt.Sprintf(`
	SELECT u.steam_id, u.nickname, ps.total_wins, ps.total_kd, ps.total_kills, ps.total_deaths
	FROM player_stats ps
	JOIN users u ON u.id = ps.user_id
	ORDER BY %s DESC, ps.total_wins DESC
	LIMIT $1 OFFSET $2`, sort)

	rows, err := a.db.Query(query, size, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query leaderboard"})
		return
	}
	defer rows.Close()

	type item struct {
		SteamID     string  `json:"steamId"`
		Nickname    string  `json:"nickname"`
		TotalWins   int     `json:"totalWins"`
		TotalKD     float64 `json:"totalKd"`
		TotalKills  int     `json:"totalKills"`
		TotalDeaths int     `json:"totalDeaths"`
	}
	items := []item{}
	for rows.Next() {
		var it item
		if err := rows.Scan(&it.SteamID, &it.Nickname, &it.TotalWins, &it.TotalKD, &it.TotalKills, &it.TotalDeaths); err == nil {
			items = append(items, it)
		}
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "page": page, "pageSize": size, "sort": sort})
}

func (a *App) adminKick(c *gin.Context) {
	var req struct {
		Player string `json:"player"`
		Reason string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Player) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	cmd := fmt.Sprintf("kickid %s %s", req.Player, shellEscape(req.Reason))
	a.execAdminCommand(c, "kick", req.Player, map[string]string{"reason": req.Reason}, cmd)
}

func (a *App) adminChangeMap(c *gin.Context) {
	var req struct {
		Map string `json:"map"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Map) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	cmd := fmt.Sprintf("changelevel %s", shellEscape(req.Map))
	a.execAdminCommand(c, "change_map", req.Map, map[string]string{"map": req.Map}, cmd)
}

func (a *App) adminChangeMode(c *gin.Context) {
	var req struct {
		Mode string `json:"mode"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Mode) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	cmd := modeToCommand(req.Mode)
	if cmd == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported mode"})
		return
	}
	a.execAdminCommand(c, "change_mode", req.Mode, map[string]string{"mode": req.Mode}, cmd)
}

func (a *App) execAdminCommand(c *gin.Context, action, target string, payload any, cmd string) {
	claims := c.MustGet("user").(*Claims)
	ctx, cancel := context.WithTimeout(c.Request.Context(), a.cfg.RCONTimeout)
	defer cancel()

	out, err := a.rcon.Execute(ctx, cmd)
	result := "success"
	errMsg := ""
	if err != nil {
		result = "failed"
		errMsg = err.Error()
	}

	payloadJSON, _ := json.Marshal(payload)
	_, _ = a.db.Exec(`INSERT INTO rcon_audit_logs (admin_user_id, action, target, payload, result, error) VALUES ($1, $2, $3, $4, $5, $6)`,
		claims.UserID, action, target, payloadJSON, result, nullable(errMsg))

	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "rcon command failed", "detail": errMsg})
		return
	}
	c.JSON(http.StatusOK, gin.H{"result": result, "output": out})
}

func (a *App) getAuditLogs(c *gin.Context) {
	rows, err := a.db.Query(`
		SELECT r.id, r.action, r.target, r.payload, r.result, COALESCE(r.error,''), r.created_at, u.nickname
		FROM rcon_audit_logs r
		JOIN users u ON u.id = r.admin_user_id
		ORDER BY r.created_at DESC
		LIMIT 100`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query logs"})
		return
	}
	defer rows.Close()

	type item struct {
		ID        int64           `json:"id"`
		Action    string          `json:"action"`
		Target    string          `json:"target"`
		Payload   json.RawMessage `json:"payload"`
		Result    string          `json:"result"`
		Error     string          `json:"error"`
		CreatedAt time.Time       `json:"createdAt"`
		Admin     string          `json:"admin"`
	}
	items := []item{}
	for rows.Next() {
		var it item
		if err := rows.Scan(&it.ID, &it.Action, &it.Target, &it.Payload, &it.Result, &it.Error, &it.CreatedAt, &it.Admin); err == nil {
			items = append(items, it)
		}
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (a *App) pollSnapshots() {
	ticker := time.NewTicker(a.cfg.PollInterval)
	defer ticker.Stop()
	for {
		a.refreshSnapshot()
		<-ticker.C
	}
}

func (a *App) refreshSnapshot() {
	ctx, cancel := context.WithTimeout(context.Background(), a.cfg.RCONTimeout)
	defer cancel()

	statusOutput, err := a.rcon.Execute(ctx, "status")
	now := time.Now().UTC()
	if err != nil {
		a.snapshot.Set(ServerStatus{Running: false, UpdatedAt: now, MaxPlayers: 32}, MatchLive{Players: []LivePlayer{}, UpdatedAt: now})
		return
	}

	players := parsePlayers(statusOutput)
	mapName := "unknown"
	if matches := mapRegex.FindStringSubmatch(strings.ToLower(statusOutput)); len(matches) == 2 {
		mapName = matches[1]
	}
	playerCount := parseHumanPlayers(statusOutput)
	if playerCount == 0 && len(players) > 0 {
		playerCount = len(players)
	}
	maxPlayers := parseMaxPlayers(statusOutput)
	if maxPlayers == 0 {
		maxPlayers = 32
	}

	status := ServerStatus{
		Running:    true,
		Map:        mapName,
		Mode:       "competitive",
		Players:    playerCount,
		MaxPlayers: maxPlayers,
		UpdatedAt:  now,
	}
	live := MatchLive{
		ScoreCT:   0,
		ScoreT:    0,
		Players:   players,
		UpdatedAt: now,
	}
	a.snapshot.Set(status, live)
}

func parsePlayers(statusOutput string) []LivePlayer {
	lines := strings.Split(statusOutput, "\n")
	players := make([]LivePlayer, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		playerID, name, ok := parsePlayerLine(line)
		if !ok {
			continue
		}
		players = append(players, LivePlayer{
			PlayerID: playerID,
			Name:     name,
			Kills:    0,
			Deaths:   0,
			KD:       0,
			Team:     "unknown",
		})
	}
	return players
}

func parsePlayerLine(line string) (playerID, name string, ok bool) {
	if matches := playerSteam3Regex.FindStringSubmatch(line); len(matches) == 3 {
		return matches[2], matches[1], true
	}
	if matches := playerSteam2Regex.FindStringSubmatch(line); len(matches) == 3 {
		return matches[2], matches[1], true
	}
	return "", "", false
}

func parseMaxPlayers(statusOutput string) int {
	for _, re := range []*regexp.Regexp{maxPlayersRegex, playersLineMaxPlayersRegex} {
		matches := re.FindStringSubmatch(statusOutput)
		if len(matches) != 2 {
			continue
		}
		maxPlayers, err := strconv.Atoi(matches[1])
		if err != nil || maxPlayers < 0 {
			continue
		}
		return maxPlayers
	}
	return 0
}

func parseHumanPlayers(statusOutput string) int {
	matches := humanPlayersRegex.FindStringSubmatch(statusOutput)
	if len(matches) != 2 {
		return 0
	}
	playerCount, err := strconv.Atoi(matches[1])
	if err != nil || playerCount < 0 {
		return 0
	}
	return playerCount
}

func modeToCommand(mode string) string {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "competitive":
		return "game_type 0; game_mode 1"
	case "casual":
		return "game_type 0; game_mode 0"
	case "deathmatch":
		return "game_type 1; game_mode 2"
	default:
		return ""
	}
}

func shellEscape(in string) string {
	in = strings.TrimSpace(in)
	if in == "" {
		return ""
	}
	return strings.ReplaceAll(in, `"`, "")
}

func nullable(v string) any {
	if strings.TrimSpace(v) == "" {
		return nil
	}
	return v
}

func fallback(v, def string) string {
	if strings.TrimSpace(v) == "" {
		return def
	}
	return v
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
