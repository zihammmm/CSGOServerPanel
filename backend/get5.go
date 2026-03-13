package main

import (
	"context"
	"fmt"
	"net"
	"os"
	"path"
	"strings"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

func (a *App) dispatchGet5Config(ctx context.Context, configName string, firstMap string, configJSON []byte) (stdout string, stderr string, jobErr error) {
	if strings.TrimSpace(a.cfg.MatchSSHHost) == "" {
		return "mock launch: MATCH_SSH_HOST not configured", "", nil
	}
	remotePath, err := a.uploadGet5Config(configName, configJSON)
	if err != nil {
		return "", "", err
	}

	cmd := strings.TrimSpace(a.cfg.MatchServerRestartCmd)
	configRef := get5ConfigReference(remotePath)
	if cmd == "" {
		cmd = fmt.Sprintf("get5_loadmatch %s; changelevel %s", configRef, firstMap)
	} else {
		cmd = strings.ReplaceAll(cmd, "{{CONFIG_PATH}}", remotePath)
		cmd = strings.ReplaceAll(cmd, "{{CONFIG_REF}}", configRef)
		cmd = strings.ReplaceAll(cmd, "{{CONFIG_NAME}}", path.Base(remotePath))
		cmd = strings.ReplaceAll(cmd, "{{MAP_NAME}}", strings.TrimSpace(firstMap))
	}
	out, err := a.rcon.Execute(ctx, cmd)
	if err != nil {
		return fmt.Sprintf("uploaded to %s", remotePath), err.Error(), fmt.Errorf("rcon run failed: %w", err)
	}
	return fmt.Sprintf("uploaded to %s\n%s", remotePath, out), "", nil
}

func (a *App) uploadGet5Config(configName string, configJSON []byte) (string, error) {
	if strings.TrimSpace(a.cfg.MatchSSHUser) == "" || strings.TrimSpace(a.cfg.MatchSSHKeyPath) == "" || strings.TrimSpace(a.cfg.MatchRemoteGet5Dir) == "" {
		return "", fmt.Errorf("missing ssh env: MATCH_SSH_USER/MATCH_SSH_KEY_PATH/MATCH_REMOTE_GET5_DIR")
	}

	keyData, err := os.ReadFile(a.cfg.MatchSSHKeyPath)
	if err != nil {
		return "", fmt.Errorf("read ssh key: %w", err)
	}
	signer, err := ssh.ParsePrivateKey(keyData)
	if err != nil {
		return "", fmt.Errorf("parse ssh key: %w", err)
	}

	addr := net.JoinHostPort(a.cfg.MatchSSHHost, fallback(a.cfg.MatchSSHPort, "22"))
	sshCfg := &ssh.ClientConfig{
		User:            a.cfg.MatchSSHUser,
		Auth:            []ssh.AuthMethod{ssh.PublicKeys(signer)},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         10 * time.Second,
	}

	client, err := ssh.Dial("tcp", addr, sshCfg)
	if err != nil {
		return "", fmt.Errorf("dial ssh: %w", err)
	}
	defer client.Close()

	sftpClient, err := sftp.NewClient(client)
	if err != nil {
		return "", fmt.Errorf("create sftp client: %w", err)
	}
	defer sftpClient.Close()

	remoteDir := strings.TrimSuffix(a.cfg.MatchRemoteGet5Dir, "/")
	remotePath := path.Join(remoteDir, configName)
	file, err := sftpClient.Create(remotePath)
	if err != nil {
		return "", fmt.Errorf("create remote config: %w", err)
	}
	if _, err := file.Write(configJSON); err != nil {
		file.Close()
		return "", fmt.Errorf("write remote config: %w", err)
	}
	if err := file.Close(); err != nil {
		return "", fmt.Errorf("close remote config: %w", err)
	}

	return remotePath, nil
}

func get5ConfigReference(remotePath string) string {
	cleaned := strings.TrimSpace(remotePath)
	if cleaned == "" {
		return ""
	}
	if idx := strings.Index(cleaned, "/csgo/"); idx >= 0 {
		return strings.TrimPrefix(cleaned[idx+len("/csgo/"):], "/")
	}
	return path.Base(cleaned)
}
