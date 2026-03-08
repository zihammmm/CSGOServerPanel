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

func (a *App) dispatchGet5Config(ctx context.Context, configName string, configJSON []byte) (stdout string, stderr string, jobErr error) {
	if strings.TrimSpace(a.cfg.MatchSSHHost) == "" {
		return "mock launch: MATCH_SSH_HOST not configured", "", nil
	}

	if strings.TrimSpace(a.cfg.MatchSSHUser) == "" || strings.TrimSpace(a.cfg.MatchSSHKeyPath) == "" || strings.TrimSpace(a.cfg.MatchRemoteGet5Dir) == "" {
		return "", "", fmt.Errorf("missing ssh env: MATCH_SSH_USER/MATCH_SSH_KEY_PATH/MATCH_REMOTE_GET5_DIR")
	}

	keyData, err := os.ReadFile(a.cfg.MatchSSHKeyPath)
	if err != nil {
		return "", "", fmt.Errorf("read ssh key: %w", err)
	}
	signer, err := ssh.ParsePrivateKey(keyData)
	if err != nil {
		return "", "", fmt.Errorf("parse ssh key: %w", err)
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
		return "", "", fmt.Errorf("dial ssh: %w", err)
	}
	defer client.Close()

	sftpClient, err := sftp.NewClient(client)
	if err != nil {
		return "", "", fmt.Errorf("create sftp client: %w", err)
	}
	defer sftpClient.Close()

	remoteDir := strings.TrimSuffix(a.cfg.MatchRemoteGet5Dir, "/")
	remotePath := path.Join(remoteDir, configName)
	file, err := sftpClient.Create(remotePath)
	if err != nil {
		return "", "", fmt.Errorf("create remote config: %w", err)
	}
	if _, err := file.Write(configJSON); err != nil {
		file.Close()
		return "", "", fmt.Errorf("write remote config: %w", err)
	}
	if err := file.Close(); err != nil {
		return "", "", fmt.Errorf("close remote config: %w", err)
	}

	cmd := strings.TrimSpace(a.cfg.MatchServerRestartCmd)
	if cmd == "" {
		cmd = fmt.Sprintf("get5_loadmatch %s", remotePath)
	} else {
		cmd = strings.ReplaceAll(cmd, "{{CONFIG_PATH}}", remotePath)
	}

	session, err := client.NewSession()
	if err != nil {
		return "", "", fmt.Errorf("create ssh session: %w", err)
	}
	defer session.Close()

	type cmdRes struct {
		out []byte
		err error
	}
	ch := make(chan cmdRes, 1)
	go func() {
		out, runErr := session.CombinedOutput(cmd)
		ch <- cmdRes{out: out, err: runErr}
	}()

	select {
	case <-ctx.Done():
		return "", "", ctx.Err()
	case res := <-ch:
		if res.err != nil {
			return string(res.out), res.err.Error(), fmt.Errorf("remote run failed")
		}
		return fmt.Sprintf("uploaded to %s\n%s", remotePath, string(res.out)), "", nil
	}
}
